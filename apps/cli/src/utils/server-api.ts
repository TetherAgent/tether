export function unwrapServerApiData(body: unknown): unknown {
  if (!body || typeof body !== 'object' || !('code' in body)) {
    return body;
  }
  const payload = body as { code?: unknown; msg?: unknown; data?: unknown; stack?: unknown };
  if (payload.code === 200) {
    return payload.data;
  }
  const message = typeof payload.msg === 'string' ? payload.msg : 'server_error';
  const stack = typeof payload.stack === 'string' ? `\n${payload.stack}` : '';
  throw new Error(`${message}${stack}`);
}
