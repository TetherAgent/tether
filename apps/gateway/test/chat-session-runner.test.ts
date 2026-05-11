import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatSessionRunner } from '../src/chat-session-runner.js';
import { Store } from '../src/store.js';

function tempStore(): { store: Store; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'tether-chat-runner-'));
  return {
    store: new Store(path.join(dir, 'tether.db')),
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  };
}

function installFakeClaude(outputLines: Array<Record<string, unknown>>): { pathPrefix: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'tether-fake-claude-'));
  const bin = path.join(dir, 'claude');
  writeFileSync(
    bin,
    `#!/usr/bin/env node\nif (process.env.TETHER_FAKE_CLAUDE_ARGS_FILE) require('node:fs').writeFileSync(process.env.TETHER_FAKE_CLAUDE_ARGS_FILE, JSON.stringify(process.argv.slice(2)));\nfor (const line of ${JSON.stringify(outputLines)}) console.log(JSON.stringify(line));\n`,
    'utf8'
  );
  chmodSync(bin, 0o755);
  return {
    pathPrefix: dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  };
}

test('chat runner parses Claude verbose stream assistant and result events', async () => {
  const { store, cleanup: cleanupStore } = tempStore();
  const fakeClaude = installFakeClaude([
    {
      type: 'assistant',
      session_id: 'claude-session-1',
      message: {
        usage: { input_tokens: 3, output_tokens: 2 },
        content: [{ type: 'text', text: 'OK' }]
      }
    },
    {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'OK',
      session_id: 'claude-session-1',
      usage: { input_tokens: 3, output_tokens: 2 },
      terminal_reason: 'completed'
    }
  ]);
  const argsFile = path.join(fakeClaude.pathPrefix, 'args.json');
  const previousPath = process.env.PATH;
  const previousArgsFile = process.env.TETHER_FAKE_CLAUDE_ARGS_FILE;
  process.env.PATH = `${fakeClaude.pathPrefix}${path.delimiter}${previousPath ?? ''}`;
  process.env.TETHER_FAKE_CLAUDE_ARGS_FILE = argsFile;
  try {
    let createdSessionId = '';
    const deltas: string[] = [];
    const results: string[] = [];
    const errors: string[] = [];
    const chatEventTypes: string[] = [];
    let resolveResult: (() => void) | undefined;
    const resultPromise = new Promise<void>((resolve) => {
      resolveResult = resolve;
    });
    const runner = new ChatSessionRunner({
      store,
      gatewayId: () => 'gateway-test',
      onSessionCreated: (_clientId, sessionId) => {
        createdSessionId = sessionId;
      },
      onUserMessage: ({ event }) => {
        chatEventTypes.push(event.type);
      },
      onDelta: ({ text }) => {
        deltas.push(text);
      },
      onResult: ({ event, text }) => {
        chatEventTypes.push(event.type);
        results.push(text);
        resolveResult?.();
      },
      onTool: () => undefined,
      onPermissionRequest: () => undefined,
      onError: ({ message }) => {
        errors.push(message);
      },
      onAgentIdUpdate: () => undefined
    });

    await runner.run({
      clientId: 'client-test',
      sessionId: null,
      provider: 'claude',
      model: 'claude-sonnet-4-5',
      cwd: '',
      message: 'test',
      accountId: 'acct-test',
      userId: 'user-test'
    });
    await resultPromise;

    assert.equal(errors.length, 0);
    assert.equal(createdSessionId.startsWith('tth_'), true);
    assert.deepEqual(deltas, ['OK']);
    assert.deepEqual(results, ['OK']);
    assert.equal(store.getSession(createdSessionId)?.agentSessionId, 'claude-session-1');
    assert.equal(store.getSession(createdSessionId)?.projectPath, process.cwd());
    assert.deepEqual(chatEventTypes, ['user.message', 'agent.result']);
    assert.deepEqual(JSON.parse(readFileSync(argsFile, 'utf8')) as string[], [
      '-p',
      'test',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--model',
      'claude-sonnet-4-5'
    ]);
  } finally {
    process.env.PATH = previousPath;
    if (previousArgsFile === undefined) {
      delete process.env.TETHER_FAKE_CLAUDE_ARGS_FILE;
    } else {
      process.env.TETHER_FAKE_CLAUDE_ARGS_FILE = previousArgsFile;
    }
    fakeClaude.cleanup();
    cleanupStore();
  }
});

test('chat runner streams Claude content block text deltas', async () => {
  const { store, cleanup: cleanupStore } = tempStore();
  const fakeClaude = installFakeClaude([
    {
      type: 'message_start',
      message: {
        id: 'claude-session-2',
        usage: { input_tokens: 5, output_tokens: 0 }
      }
    },
    {
      type: 'content_block_delta',
      delta: { type: 'text', text: 'Hel' }
    },
    {
      type: 'content_block_delta',
      delta: { type: 'text', text: 'lo' }
    },
    {
      type: 'message_stop',
      message: {
        usage: { input_tokens: 5, output_tokens: 2 }
      }
    }
  ]);
  const previousPath = process.env.PATH;
  process.env.PATH = `${fakeClaude.pathPrefix}${path.delimiter}${previousPath ?? ''}`;
  try {
    let createdSessionId = '';
    const deltas: string[] = [];
    const results: string[] = [];
    let resolveResult: (() => void) | undefined;
    const resultPromise = new Promise<void>((resolve) => {
      resolveResult = resolve;
    });
    const runner = new ChatSessionRunner({
      store,
      gatewayId: () => 'gateway-test',
      onSessionCreated: (_clientId, sessionId) => {
        createdSessionId = sessionId;
      },
      onUserMessage: () => undefined,
      onDelta: ({ text }) => {
        deltas.push(text);
      },
      onResult: ({ text }) => {
        results.push(text);
        resolveResult?.();
      },
      onTool: () => undefined,
      onPermissionRequest: () => undefined,
      onError: ({ message }) => {
        assert.fail(message);
      },
      onAgentIdUpdate: () => undefined
    });

    await runner.run({
      clientId: 'client-test',
      sessionId: null,
      provider: 'claude',
      model: 'sonnet',
      cwd: '',
      message: 'test'
    });
    await resultPromise;

    assert.equal(createdSessionId.startsWith('tth_'), true);
    assert.deepEqual(deltas, ['Hel', 'lo']);
    assert.deepEqual(results, ['Hello']);
  } finally {
    process.env.PATH = previousPath;
    fakeClaude.cleanup();
    cleanupStore();
  }
});

test('chat runner maps Claude permission denials to next suggestions', async () => {
  const { store, cleanup: cleanupStore } = tempStore();
  const fakeClaude = installFakeClaude([
    {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: '没有执行被拒绝的操作。',
      session_id: 'claude-session-denied',
      usage: { input_tokens: 8, output_tokens: 4 },
      terminal_reason: 'completed',
      permission_denials: [
        {
          tool_name: 'Bash',
          input: { command: 'pnpm test' },
          reason: 'user denied'
        }
      ]
    }
  ]);
  const previousPath = process.env.PATH;
  process.env.PATH = `${fakeClaude.pathPrefix}${path.delimiter}${previousPath ?? ''}`;
  try {
    let suggestions: Array<{ description: string; toolName?: string; reason?: string }> | undefined;
    let resolveResult: (() => void) | undefined;
    const resultPromise = new Promise<void>((resolve) => {
      resolveResult = resolve;
    });
    const runner = new ChatSessionRunner({
      store,
      gatewayId: () => 'gateway-test',
      onSessionCreated: () => undefined,
      onUserMessage: () => undefined,
      onDelta: () => undefined,
      onResult: ({ nextSuggestions }) => {
        suggestions = nextSuggestions;
        resolveResult?.();
      },
      onTool: () => undefined,
      onPermissionRequest: () => undefined,
      onError: ({ message }) => {
        assert.fail(message);
      },
      onAgentIdUpdate: () => undefined
    });

    await runner.run({
      clientId: 'client-test',
      sessionId: null,
      provider: 'claude',
      model: 'sonnet',
      cwd: '',
      message: 'test'
    });
    await resultPromise;

    assert.equal(suggestions?.length, 1);
    assert.equal(suggestions?.[0]?.toolName, 'Bash');
    assert.equal(suggestions?.[0]?.reason, 'user denied');
    assert.equal(suggestions?.[0]?.description.includes('pnpm test'), true);
  } finally {
    process.env.PATH = previousPath;
    fakeClaude.cleanup();
    cleanupStore();
  }
});

// ─── Phase 15: Chat Remote Session Metadata ────────────────────────────────

test('Phase15-T4: chat runner resumes existing session from frame.session without calling store.getSession', { skip: 'Phase 15 not implemented' }, async () => {
  // 续聊分支：runner.run({ sessionId: 'tth_xxx', session: trustedMetadata, message: 'hi' })
  // 断言：store.getSession 从未被调用
  // 断言：subprocess 被以正确 provider/cwd/agentSessionId 启动
});

test('Phase15-T5: createChatSession does not call store.insertSession', { skip: 'Phase 15 not implemented' }, async () => {
  // 新建分支：runner.run({ sessionId: null, provider: 'claude', cwd: '/tmp', ... })
  // 断言：store.insertSession 从未被调用
  // 断言：onChatSessionCreated 回调被调用（取代 onSessionCreated）
});
