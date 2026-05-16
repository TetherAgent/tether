import assert from 'node:assert/strict';
import test from 'node:test';
import type { TrustedChatSessionMetadata } from '@tether/protocol';
import { ChatRuntime } from '../src/chat/chat-runtime.js';
import { ChatSessionRegistry } from '../src/chat/chat-session-registry.js';
import { CodexChatRunner, type ChatRunnerOptions } from '../src/chat/chat-session-runner.js';

type SentFrame =
  | { type: 'event'; eventType: string; sessionId: string; inFlightAtSend?: boolean }
  | { type: 'chat-session-created'; sessionId: string }
  | { type: 'error'; code: string; sessionId: string };

type CodexRun = typeof CodexChatRunner.prototype.run;

function chatMeta(sessionId: string): TrustedChatSessionMetadata {
  return {
    accountId: 'acct_1',
    gatewayId: 'gw_1',
    id: sessionId,
    projectPath: '/repo',
    provider: 'codex',
    title: 'hello',
    transport: 'chat',
    userId: 'user_1'
  };
}

function patchCodexRun(run: CodexRun): () => void {
  const original = CodexChatRunner.prototype.run;
  CodexChatRunner.prototype.run = run;
  return () => {
    CodexChatRunner.prototype.run = original;
  };
}

function createRuntime() {
  const chatRegistry = new ChatSessionRegistry();
  const frames: SentFrame[] = [];
  const relaySender = {
    event: (event: { type: string; sessionId: string }) => {
      frames.push({
        type: 'event',
        eventType: event.type,
        sessionId: event.sessionId,
        inFlightAtSend: chatRegistry.isInFlight(event.sessionId)
      });
    },
    chatSessionCreated: (_clientId: string, metadata: TrustedChatSessionMetadata) => {
      frames.push({ type: 'chat-session-created', sessionId: metadata.id });
    },
    error: (_clientId: string, sessionId: string, code: string) => {
      frames.push({ type: 'error', code, sessionId });
    },
    sessionCreated: () => {},
  };
  const runtime = new ChatRuntime({
    chatRegistry,
    gatewayId: () => 'gw_1',
    relaySender: relaySender as never,
    sendSessions: () => {}
  });
  return { chatRegistry, frames, runtime };
}

test('ChatRuntime new session emits chat-session-created before first agent.delta', async () => {
  const sessionId = 'tth_runtime_new';
  const restore = patchCodexRun(function (this: { options: ChatRunnerOptions }, params) {
    this.options.onChatSessionCreated(params.clientId, chatMeta(sessionId));
    this.options.onDelta({
      clientId: params.clientId,
      event: {
        id: 1,
        eventSeq: 1,
        sessionId,
        ts: Date.now(),
        turnId: 'turn_1',
        type: 'agent.delta',
        payload: { text: 'partial' }
      },
      sessionId,
      text: 'partial'
    });
    return Promise.resolve();
  } as CodexRun);
  const { frames, runtime } = createRuntime();
  try {
    await runtime.runnerForProvider('codex')!.run({
      accountId: 'acct_1',
      clientId: 'client_1',
      cwd: '/repo',
      message: 'hello',
      model: 'gpt-test',
      provider: 'codex',
      sessionId: null,
      userId: 'user_1'
    });

    assert.deepEqual(
      frames.map((frame) => frame.type === 'event' ? frame.eventType : frame.type),
      ['chat-session-created', 'agent.delta']
    );
  } finally {
    restore();
  }
});

test('ChatRuntime releases in-flight before sending agent.result', async () => {
  const sessionId = 'tth_runtime_result';
  const restore = patchCodexRun(function (this: { options: ChatRunnerOptions }, params) {
    this.options.onResult({
      clientId: params.clientId,
      event: {
        id: 2,
        eventSeq: 2,
        sessionId,
        ts: Date.now(),
        turnId: 'turn_2',
        type: 'agent.result',
        payload: { text: 'done', usage: { input_tokens: 1, output_tokens: 1 } }
      },
      sessionId,
      text: 'done',
      usage: { input_tokens: 1, output_tokens: 1 }
    });
    return Promise.resolve();
  } as CodexRun);
  const { chatRegistry, frames, runtime } = createRuntime();
  try {
    chatRegistry.upsertFromMetadata(chatMeta(sessionId));
    chatRegistry.markInFlight(sessionId);

    await runtime.runnerForProvider('codex')!.run({
      clientId: 'client_1',
      message: 'continue',
      model: 'gpt-test',
      session: chatMeta(sessionId),
      sessionId
    });

    const resultFrame = frames.find((frame): frame is Extract<SentFrame, { type: 'event' }> =>
      frame.type === 'event' && frame.eventType === 'agent.result'
    );
    assert.ok(resultFrame);
    assert.equal(resultFrame.inFlightAtSend, false);
  } finally {
    restore();
  }
});

test('ChatRuntime error path releases in-flight, emits session.error, then gateway.error', async () => {
  const sessionId = 'tth_runtime_error';
  const restore = patchCodexRun(function (this: { options: ChatRunnerOptions }, params) {
    this.options.onError({
      clientId: params.clientId,
      code: 'runner_failed',
      event: {
        id: 3,
        eventSeq: 3,
        sessionId,
        ts: Date.now(),
        turnId: 'turn_3',
        type: 'session.error',
        payload: { code: 'runner_failed', message: 'failed' }
      },
      message: 'failed',
      sessionId
    });
    return Promise.resolve();
  } as CodexRun);
  const { chatRegistry, frames, runtime } = createRuntime();
  try {
    chatRegistry.upsertFromMetadata(chatMeta(sessionId));
    chatRegistry.markInFlight(sessionId);

    await runtime.runnerForProvider('codex')!.run({
      clientId: 'client_1',
      message: 'continue',
      model: 'gpt-test',
      session: chatMeta(sessionId),
      sessionId
    });

    assert.deepEqual(
      frames.map((frame) => frame.type === 'event' ? frame.eventType : frame.type),
      ['session.error', 'error']
    );
    const errorEvent = frames[0] as Extract<SentFrame, { type: 'event' }>;
    assert.equal(errorEvent.inFlightAtSend, false);
  } finally {
    restore();
  }
});
