export function buildClaudeHudHookScript(endpoint: string): string {
  return `#!/usr/bin/env node
const defaultEndpoint = ${JSON.stringify(endpoint)};
const endpointArgIndex = process.argv.indexOf('--endpoint');
const endpoint = endpointArgIndex >= 0 && typeof process.argv[endpointArgIndex + 1] === 'string'
  ? process.argv[endpointArgIndex + 1]
  : defaultEndpoint;

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
  if (input.length > 32768) process.exit(0);
});
process.stdin.on('end', async () => {
  try {
    const raw = input.trim() ? JSON.parse(input) : {};
    const body = {
      tetherSessionId: process.env.TETHER_SESSION_ID,
      claudeSessionId: typeof raw.session_id === 'string' ? raw.session_id : undefined,
      hookEventName: typeof raw.hook_event_name === 'string' ? raw.hook_event_name : undefined,
      contextWindow: raw.context_window,
      rateLimits: raw.rate_limits,
      ts: Date.now()
    };
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch {
    // Claude hooks must never block or fail the user's CLI turn.
  }
});
`;
}
