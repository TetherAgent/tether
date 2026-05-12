import net from 'node:net';
import { randomUUID } from 'node:crypto';
import {
  RUNNER_MAX_FRAME_BYTES,
  type RunnerEventFrame,
  type RunnerFrame,
  type RunnerRequest,
  type RunnerResponse
} from './session-runner.js';

export type SessionRunnerClientOptions = {
  socketPath: string;
  requestTimeoutMs?: number;
  maxInFlightRequests?: number;
};

type PendingRequest = {
  resolve: (response: RunnerResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

type EventListener = (frame: RunnerEventFrame) => void;

export class SessionRunnerClient {
  private socket?: net.Socket;
  private buffer = '';
  private readonly pending = new Map<string, PendingRequest>();
  private readonly eventListeners = new Set<EventListener>();
  private readonly requestTimeoutMs: number;
  private readonly maxInFlightRequests: number;

  constructor(private readonly options: SessionRunnerClientOptions) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 5000;
    this.maxInFlightRequests = options.maxInFlightRequests ?? 32;
  }

  async connect(): Promise<void> {
    if (this.socket && !this.socket.destroyed) {
      return;
    }
    const socket = net.createConnection(this.options.socketPath);
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => this.handleData(chunk));
    socket.on('close', () => this.rejectAll(new Error('runner socket closed')));
    socket.on('error', (error) => this.rejectAll(error));
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    this.socket = socket;
  }

  async ping(): Promise<Record<string, unknown> | undefined> {
    return (await this.request({ id: createRequestId(), type: 'ping' })).result;
  }

  async write(data: string, clientId: string): Promise<void> {
    await this.request({ id: createRequestId(), type: 'write', data, clientId });
  }

  async resize(cols: number, rows: number, clientId: string): Promise<void> {
    await this.request({ id: createRequestId(), type: 'resize', cols, rows, clientId });
  }

  async stop(reason?: string): Promise<void> {
    await this.request({ id: createRequestId(), type: 'stop', reason });
  }

  async subscribeEvents(listener: EventListener, after?: number): Promise<() => Promise<void>> {
    this.eventListeners.add(listener);
    await this.request({ id: createRequestId(), type: 'subscribeEvents', after });
    return async () => {
      this.eventListeners.delete(listener);
      if (this.eventListeners.size === 0 && this.socket && !this.socket.destroyed) {
        await this.request({ id: createRequestId(), type: 'unsubscribeEvents' });
      }
    };
  }

  async close(): Promise<void> {
    const socket = this.socket;
    this.socket = undefined;
    if (!socket || socket.destroyed) {
      return;
    }
    await new Promise<void>((resolve) => {
      socket.once('close', resolve);
      socket.end();
    });
  }

  private async request(request: RunnerRequest): Promise<Extract<RunnerResponse, { ok: true }>> {
    await this.connect();
    if (this.pending.size >= this.maxInFlightRequests) {
      throw new Error('too many in-flight runner requests');
    }
    const socket = this.socket;
    if (!socket || socket.destroyed || !socket.writable) {
      throw new Error('runner socket is not writable');
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(request.id);
        reject(new Error(`runner request timed out: ${request.type}`));
      }, this.requestTimeoutMs);
      timeout.unref();
      this.pending.set(request.id, {
        resolve: (response) => {
          if (response.ok) {
            resolve(response);
            return;
          }
          reject(new Error(response.message ?? response.error));
        },
        reject,
        timeout
      });
      socket.write(`${JSON.stringify(request)}\n`);
    });
  }

  private handleData(chunk: string | Buffer): void {
    this.buffer += chunk.toString();
    if (Buffer.byteLength(this.buffer) > RUNNER_MAX_FRAME_BYTES) {
      this.socket?.destroy(new Error('runner frame is too large'));
      return;
    }
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const raw = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      this.handleRawFrame(raw);
      newlineIndex = this.buffer.indexOf('\n');
    }
  }

  private handleRawFrame(raw: string): void {
    let frame: RunnerFrame;
    try {
      frame = JSON.parse(raw) as RunnerFrame;
    } catch {
      return;
    }
    if ('type' in frame && frame.type === 'event') {
      for (const listener of this.eventListeners) {
        listener(frame);
      }
      return;
    }
    if (!('id' in frame)) {
      return;
    }
    const pending = this.pending.get(frame.id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pending.delete(frame.id);
    pending.resolve(frame);
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

function createRequestId(): string {
  return `rr_${randomUUID().replace(/-/g, '')}`;
}
