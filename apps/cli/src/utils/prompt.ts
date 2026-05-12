import readline from 'node:readline/promises';

export async function promptLine(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(prompt)).trim();
  } finally {
    rl.close();
  }
}

export async function promptRequiredLine(prompt: string): Promise<string> {
  const answer = await promptLine(prompt);
  if (!answer) {
    throw new Error(`${prompt.replace(/:\s*$/, '')} 不能为空`);
  }
  return answer;
}
