export type AgentSelectOption = { index: number; label: string };

export function detectSelectOptions(lines: string[]): AgentSelectOption[] | null {
  const matchedOptions: AgentSelectOption[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*(\d+)\.\s+(.+)$/);
    if (m) {
      matchedOptions.push({ index: parseInt(m[1]!, 10), label: m[2]!.trim() });
    } else if (matchedOptions.length > 0) {
      break;
    }
  }
  return matchedOptions.length >= 2 ? matchedOptions : null;
}
