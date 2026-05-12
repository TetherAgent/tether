import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatSessionRunner, CodexChatRunner } from '../src/chat/chat-session-runner.js';
import { tempSessionState, type TestSessionState } from './helpers/test-session-state.js';

function tempStore(): { store: TestSessionState; cleanup: () => void } {
  return tempSessionState();
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

function installFakeCodex(outputLines: Array<Record<string, unknown>>, stderrLines: string[] = []): { pathPrefix: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'tether-fake-codex-'));
  const bin = path.join(dir, 'codex');
  writeFileSync(
    bin,
    `#!/usr/bin/env node\nif (process.env.TETHER_FAKE_CODEX_ARGS_FILE) require('node:fs').writeFileSync(process.env.TETHER_FAKE_CODEX_ARGS_FILE, JSON.stringify(process.argv.slice(2)));\nfor (const line of ${JSON.stringify(stderrLines)}) console.error(line);\nfor (const line of ${JSON.stringify(outputLines)}) console.log(JSON.stringify(line));\n`,
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
    let createdProjectPath = '';
    let createdTitle = '';
    const deltas: string[] = [];
    const results: string[] = [];
    const errors: string[] = [];
    const chatEventTypes: string[] = [];
    let resolveResult: (() => void) | undefined;
    const resultPromise = new Promise<void>((resolve) => {
      resolveResult = resolve;
    });
    const runner = new ChatSessionRunner({
      gatewayId: () => 'gateway-test',
      onSessionCreated: (_clientId, sessionId) => {
        createdSessionId = sessionId;
      },
      onChatSessionCreated: (_clientId, metadata) => {
        createdSessionId = metadata.id;
        createdProjectPath = metadata.projectPath;
        createdTitle = metadata.title ?? '';
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
      message: '帮我看一下这个登录问题',
      accountId: 'acct-test',
      userId: 'user-test'
    });
    await resultPromise;

    assert.equal(errors.length, 0);
    assert.equal(createdSessionId.startsWith('tth_'), true);
    assert.deepEqual(deltas, ['OK']);
    assert.deepEqual(results, ['OK']);
    assert.equal(createdProjectPath, process.cwd());
    assert.equal(createdTitle, '帮我看一下这个登录问题');
    assert.equal(store.getSession(createdSessionId), undefined);
    assert.deepEqual(chatEventTypes, ['user.message', 'agent.result']);
    assert.deepEqual(JSON.parse(readFileSync(argsFile, 'utf8')) as string[], [
      '-p',
      '帮我看一下这个登录问题',
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

test('chat runner ignores non-fatal Codex stderr diagnostics', async () => {
  const { store, cleanup: cleanupStore } = tempStore();
  const fakeCodex = installFakeCodex(
    [
      { type: 'thread.started', thread_id: '019e158b-0c21-7ee2-8024-0c07f94aaad7' },
      { type: 'item.completed', item: { type: 'agent_message', text: '收到，测试正常。' } },
      { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 4 } }
    ],
    [
      'Reading additional input from stdin...',
      '2026-05-11T06:18:08.260874Z ERROR codex_core::session: failed to record rollout items: thread 019e158b-0c21-7ee2-8024-0c07f94aaad7 not found'
    ]
  );
  const argsFile = path.join(fakeCodex.pathPrefix, 'args.json');
  const previousPath = process.env.PATH;
  const previousArgsFile = process.env.TETHER_FAKE_CODEX_ARGS_FILE;
  process.env.PATH = `${fakeCodex.pathPrefix}${path.delimiter}${previousPath ?? ''}`;
  process.env.TETHER_FAKE_CODEX_ARGS_FILE = argsFile;
  try {
    const errors: string[] = [];
    const results: string[] = [];
    const agentIds: string[] = [];
    let resolveDone: (() => void) | undefined;
    const donePromise = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const runner = new CodexChatRunner({
      gatewayId: () => 'gateway-test',
      onSessionCreated: () => undefined,
      onChatSessionCreated: () => undefined,
      onUserMessage: () => undefined,
      onDelta: () => undefined,
      onResult: ({ text }) => {
        results.push(text);
        resolveDone?.();
      },
      onTool: () => undefined,
      onPermissionRequest: () => undefined,
      onError: ({ message }) => {
        errors.push(message);
        resolveDone?.();
      },
      onAgentIdUpdate: (_sessionId, agentSessionId) => {
        agentIds.push(agentSessionId);
      }
    });

    await runner.run({
      clientId: 'client-test',
      sessionId: null,
      provider: 'codex',
      model: 'gpt-5.4',
      cwd: '',
      message: 'test'
    });
    await donePromise;

    assert.deepEqual(errors, []);
    assert.deepEqual(results, ['收到，测试正常。']);
    assert.equal(agentIds.includes('019e158b-0c21-7ee2-8024-0c07f94aaad7'), true);
    assert.deepEqual(JSON.parse(readFileSync(argsFile, 'utf8')) as string[], [
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--color',
      'never',
      '-C',
      process.cwd(),
      '--model',
      'gpt-5.4',
      'test'
    ]);
  } finally {
    process.env.PATH = previousPath;
    if (previousArgsFile === undefined) {
      delete process.env.TETHER_FAKE_CODEX_ARGS_FILE;
    } else {
      process.env.TETHER_FAKE_CODEX_ARGS_FILE = previousArgsFile;
    }
    fakeCodex.cleanup();
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
      gatewayId: () => 'gateway-test',
      onSessionCreated: (_clientId, sessionId) => {
        createdSessionId = sessionId;
      },
      onChatSessionCreated: (_clientId, metadata) => {
        createdSessionId = metadata.id;
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
      gatewayId: () => 'gateway-test',
      onSessionCreated: () => undefined,
      onChatSessionCreated: () => undefined,
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

test('Phase15-T4: chat runner resumes existing session from frame.session without calling store.getSession', async () => {
  const { store, cleanup: cleanupStore } = tempStore();
  const fakeClaude = installFakeClaude([
    {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'resumed',
      session_id: 'claude-resumed',
      usage: { input_tokens: 1, output_tokens: 1 },
      terminal_reason: 'completed'
    }
  ]);
  const previousPath = process.env.PATH;
  process.env.PATH = `${fakeClaude.pathPrefix}${path.delimiter}${previousPath ?? ''}`;
  let getSessionCalls = 0;
  const originalGetSession = store.getSession.bind(store);
  store.getSession = ((sessionId: string) => {
    getSessionCalls += 1;
    return originalGetSession(sessionId);
  }) as TestSessionState['getSession'];
  try {
    let result = '';
    let resolveResult: (() => void) | undefined;
    const resultPromise = new Promise<void>((resolve) => {
      resolveResult = resolve;
    });
    const runner = new ChatSessionRunner({
      gatewayId: () => 'gateway-test',
      onSessionCreated: () => undefined,
      onChatSessionCreated: () => undefined,
      onUserMessage: () => undefined,
      onDelta: () => undefined,
      onResult: ({ text }) => {
        result = text;
        resolveResult?.();
      },
      onTool: () => undefined,
      onPermissionRequest: () => undefined,
      onError: ({ message }) => assert.fail(message),
      onAgentIdUpdate: () => undefined
    });

    await runner.run({
      clientId: 'client-test',
      sessionId: 'tth_resume',
      message: 'resume',
      model: 'sonnet',
      session: {
        id: 'tth_resume',
        provider: 'claude',
        projectPath: process.cwd(),
        agentSessionId: 'claude-existing',
        accountId: 'acct-test',
        userId: 'user-test',
        gatewayId: 'gateway-test',
        transport: 'chat'
      }
    });
    await resultPromise;

    assert.equal(result, 'resumed');
    assert.equal(getSessionCalls, 0);
  } finally {
    process.env.PATH = previousPath;
    fakeClaude.cleanup();
    cleanupStore();
  }
});

test('Phase15-T5: createChatSession does not call store.insertSession', async () => {
  const { store, cleanup: cleanupStore } = tempStore();
  const fakeClaude = installFakeClaude([
    {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'created',
      session_id: 'claude-created',
      usage: { input_tokens: 1, output_tokens: 1 },
      terminal_reason: 'completed'
    }
  ]);
  const previousPath = process.env.PATH;
  process.env.PATH = `${fakeClaude.pathPrefix}${path.delimiter}${previousPath ?? ''}`;
  let insertSessionCalls = 0;
  const originalInsertSession = store.insertSession.bind(store);
  store.insertSession = ((session) => {
    insertSessionCalls += 1;
    return originalInsertSession(session);
  }) as TestSessionState['insertSession'];
  try {
    let createdSessionId = '';
    let resolveResult: (() => void) | undefined;
    const resultPromise = new Promise<void>((resolve) => {
      resolveResult = resolve;
    });
    const runner = new ChatSessionRunner({
      gatewayId: () => 'gateway-test',
      onSessionCreated: () => undefined,
      onChatSessionCreated: (_clientId, metadata) => {
        createdSessionId = metadata.id;
      },
      onUserMessage: () => undefined,
      onDelta: () => undefined,
      onResult: () => {
        resolveResult?.();
      },
      onTool: () => undefined,
      onPermissionRequest: () => undefined,
      onError: ({ message }) => assert.fail(message),
      onAgentIdUpdate: () => undefined
    });

    await runner.run({
      clientId: 'client-test',
      sessionId: null,
      provider: 'claude',
      model: 'sonnet',
      cwd: '/tmp',
      message: 'create',
      accountId: 'acct-test',
      userId: 'user-test'
    });
    await resultPromise;

    assert.equal(createdSessionId.startsWith('tth_'), true);
    assert.equal(insertSessionCalls, 0);
    assert.equal(store.getSession(createdSessionId), undefined);
  } finally {
    process.env.PATH = previousPath;
    fakeClaude.cleanup();
    cleanupStore();
  }
});
