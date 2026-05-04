import { Terminal } from '@xterm/xterm';

// Headless xterm parser used by the simple chat view to turn raw PTY bytes
// into clean visible text.
//
// Strategy: only collect lines that the cursor advanced past via line feed.
// TUI chrome (spinner frames, status boxes, input prompts) is rendered with
// CSI cursor-position sequences and never produces a line feed, so it is
// naturally filtered out. Only streamed text — which is punctuated by \n —
// reaches the committed list.
export class TerminalTextExtractor {
  private readonly term: Terminal;
  private writeChain: Promise<void> = Promise.resolve();
  private committed: string[] = [];

  constructor(cols = 200, rows = 50) {
    this.term = new Terminal({
      cols,
      rows,
      scrollback: 0,
      cursorBlink: false,
      convertEol: true
    });
    this.term.onLineFeed(() => {
      const buffer = this.term.buffer.active;
      // After line feed the cursor sits on the new row; the line just left
      // behind is at the previous row in the active buffer.
      const y = buffer.baseY + buffer.cursorY - 1;
      if (y < 0) {
        return;
      }
      const text = buffer.getLine(y)?.translateToString(true) ?? '';
      this.committed.push(text);
    });
  }

  push(data: string): void {
    this.writeChain = this.writeChain.then(
      () => new Promise<void>((resolve) => this.term.write(data, resolve))
    );
  }

  async snapshot(): Promise<string> {
    await this.writeChain;
    const lines = [...this.committed];
    while (lines.length > 0 && lines[0].trim() === '') {
      lines.shift();
    }
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
      lines.pop();
    }
    const collapsed: string[] = [];
    let prevEmpty = false;
    for (const line of lines) {
      const isEmpty = line.trim() === '';
      if (isEmpty && prevEmpty) {
        continue;
      }
      collapsed.push(line);
      prevEmpty = isEmpty;
    }
    return collapsed.join('\n');
  }

  reset(): void {
    this.writeChain = this.writeChain.then(() => {
      this.term.clear();
      this.term.reset();
      this.committed = [];
    });
  }

  dispose(): void {
    this.term.dispose();
  }
}
