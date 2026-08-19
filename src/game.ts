// Core game logic. Keep this file free of DOM globals so it stays unit-testable;
// everything that touches the canvas element lives in main.ts.

export function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

export class Game {
  score = 0;
  private elapsed = 0;

  update(dt: number): void {
    this.elapsed += dt;
  }

  onTap(_x: number, _y: number): void {
    this.score += 1;
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = '#e8ecf5';
    ctx.textAlign = 'center';
    ctx.font = `${Math.round(height * 0.04)}px system-ui, sans-serif`;
    ctx.fillText('Game shell ready', width / 2, height * 0.4);

    const pulse = 1 + Math.sin(this.elapsed * 3) * 0.1;
    ctx.beginPath();
    ctx.arc(width / 2, height * 0.6, height * 0.03 * pulse, 0, Math.PI * 2);
    ctx.fillStyle = '#5b8cff';
    ctx.fill();

    ctx.fillStyle = '#8b93a7';
    ctx.font = `${Math.round(height * 0.025)}px system-ui, sans-serif`;
    ctx.fillText(`taps: ${this.score}`, width / 2, height * 0.7);
  }
}
