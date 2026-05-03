import { createAlova } from 'alova';
import adapterFetch from 'alova/fetch';
import { ResponseCode, type ApiFailure, type ApiResponse } from '@tether/core';

type Primitive = string | number | boolean;
type QueryValue = Primitive | null | undefined;
type QueryParams = Record<string, QueryValue>;

type RequestOptions = {
  token?: string;
  headers?: HeadersInit;
  suppressGlobalError?: boolean;
};

export type BodyRequestOptions = RequestOptions;
export type QueryRequestOptions = RequestOptions;

export class ApiRequestError extends Error {
  readonly code: number;
  readonly data: unknown | null;
  readonly stackDetail?: string;

  constructor(payload: ApiFailure) {
    super(payload.msg ?? String(payload.code));
    this.name = 'ApiRequestError';
    this.code = payload.code;
    this.data = payload.data ?? null;
    this.stackDetail = payload.stack;
  }
}

class EventBus {
  private readonly apiErrorListeners: Array<(payload: string) => void> = [];

  on(event: 'apiError', callback: (payload: string) => void): void {
    if (event !== 'apiError') {
      return;
    }
    this.apiErrorListeners.push(callback);
  }

  off(event: 'apiError', callback: (payload: string) => void): void {
    if (event !== 'apiError') {
      return;
    }
    const index = this.apiErrorListeners.indexOf(callback);
    if (index >= 0) {
      this.apiErrorListeners.splice(index, 1);
    }
  }

  emit(event: 'apiError', payload: string): void {
    if (event !== 'apiError') {
      return;
    }
    for (const listener of this.apiErrorListeners) {
      listener(payload);
    }
  }
}

export const eventBus = new EventBus();

function filterQuery(params?: QueryParams): QueryParams | undefined {
  if (!params) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== null && value !== undefined && value !== '')
  );
}

function formatApiError(error: ApiRequestError): string {
  return `${error.code}: ${error.message}`;
}

function normalizeUnknownError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error('network_error');
}

export type HttpClientOptions = {
  baseURL?: string;
  timeout?: number;
  tokenHeaderName?: string;
  tokenFormatter?: (token: string) => string;
};

export function createHttpClient(options: HttpClientOptions = {}) {
  const tokenHeaderName = options.tokenHeaderName ?? 'Authorization';
  const tokenFormatter = options.tokenFormatter ?? ((token: string) => `Bearer ${token}`);

  const alova = createAlova({
    baseURL: options.baseURL ?? '',
    timeout: options.timeout ?? 30_000,
    cacheFor: null,
    requestAdapter: adapterFetch(),
    responded: {
      onSuccess: async (response) => {
        const payload = await (response as Response).json().catch(() => undefined) as ApiResponse<unknown> | undefined;
        if (!payload || typeof payload !== 'object' || typeof payload.code !== 'number') {
          throw new Error('invalid_response');
        }
        if (payload.code === ResponseCode.SUCCESS) {
          return payload.data;
        }
        throw new ApiRequestError(payload);
      }
    }
  });

  async function run<T>(method: Promise<T>, suppressGlobalError = false): Promise<T> {
    try {
      return await method;
    } catch (error) {
      const normalized = normalizeUnknownError(error);
      if (!suppressGlobalError) {
        if (normalized instanceof ApiRequestError) {
          eventBus.emit('apiError', formatApiError(normalized));
        } else {
          eventBus.emit('apiError', '网络错误，请稍后重试');
        }
      }
      throw normalized;
    }
  }

  function buildHeaders(options: RequestOptions): Record<string, string> | undefined {
    const headers = new Headers(options.headers);
    if (options.token) {
      headers.set(tokenHeaderName, tokenFormatter(options.token));
    }
    const entries = Array.from(headers.entries());
    if (entries.length === 0) {
      return undefined;
    }
    return Object.fromEntries(entries);
  }

  function applyHeaders(method: { config: { headers?: HeadersInit } }, options: RequestOptions): void {
    if (!options.token && !options.headers) {
      return;
    }
    const headers = buildHeaders(options);
    if (!headers) {
      return;
    }
    method.config.headers = headers;
  }

  return {
    instance: alova,
    get<T>(url: string, params?: QueryParams, options: QueryRequestOptions = {}) {
      const method = alova.Get<T>(url, {
        params: filterQuery(params)
      });
      applyHeaders(method, options);
      return run(method, options.suppressGlobalError);
    },
    post<T>(url: string, body?: Record<string, unknown> | BodyInit | null, options: BodyRequestOptions = {}) {
      const method = alova.Post<T>(url, body ?? undefined);
      applyHeaders(method, options);
      return run(method, options.suppressGlobalError);
    },
    put<T>(url: string, body?: Record<string, unknown> | BodyInit | null, options: BodyRequestOptions = {}) {
      const method = alova.Put<T>(url, body ?? undefined);
      applyHeaders(method, options);
      return run(method, options.suppressGlobalError);
    },
    delete<T>(url: string, body?: Record<string, unknown> | BodyInit | null, options: BodyRequestOptions = {}) {
      const method = alova.Delete<T>(url, body ?? undefined);
      applyHeaders(method, options);
      return run(method, options.suppressGlobalError);
    }
  };
}
