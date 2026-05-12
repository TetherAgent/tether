export class NonTetherGatewayError extends Error {
  constructor(url: string) {
    super(`端口已被非 Tether 服务占用，无法作为常驻 Gateway 使用：${url}`);
  }
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
