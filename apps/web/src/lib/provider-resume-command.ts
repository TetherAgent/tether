export function providerResumeCommand(provider: string, agentSessionId: string): string {
  if (provider === 'claude') return `claude --resume ${agentSessionId}`;
  if (provider === 'codex') return `codex resume ${agentSessionId}`;
  if (provider === 'copilot') return `gh copilot resume ${agentSessionId}`;
  return agentSessionId;
}
