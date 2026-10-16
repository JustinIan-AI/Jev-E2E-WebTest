const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class Progress {
  private interval: ReturnType<typeof setInterval> | null = null;
  private frameIndex = 0;
  private message = '';
  private isTTY: boolean;

  constructor() {
    this.isTTY = !!process.stderr.isTTY;
  }

  start(message: string): void {
    this.stop(); // Clean up any existing interval
    this.message = message;
    if (this.isTTY) {
      this.interval = setInterval(() => {
        const frame = SPINNER_FRAMES[this.frameIndex % SPINNER_FRAMES.length];
        process.stderr.write(`\r${frame} ${this.message}`);
        this.frameIndex++;
      }, 80);
    } else {
      process.stderr.write(`${message}\n`);
    }
  }

  update(message: string): void {
    this.message = message;
    if (!this.isTTY) {
      process.stderr.write(`${message}\n`);
    }
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.isTTY) {
      process.stderr.write('\r\x1b[K');
    }
  }

  done(message: string): void {
    this.stop();
    process.stderr.write(`${this.isTTY ? '\r\x1b[K' : ''}✓ ${message}\n`);
  }

  stream(token: string): void {
    process.stderr.write(token);
  }
}
