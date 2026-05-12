export function gatewayApiUrl(host: string, port: number): string {
  const connectHost = host === '0.0.0.0' ? '127.0.0.1' : host;
  return `http://${connectHost}:${port}`;
}
