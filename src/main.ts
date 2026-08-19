import { Game } from './game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const game = new Game();

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener('resize', resize);
resize();

canvas.addEventListener('pointerdown', (event) => {
  canvas.setPointerCapture(event.pointerId);
  game.onPointerDown(event.pointerId, event.clientX, event.clientY, window.innerWidth, window.innerHeight);
});

canvas.addEventListener('pointermove', (event) => {
  game.onPointerMove(event.pointerId, event.clientX, window.innerWidth);
});

canvas.addEventListener('pointerup', (event) => {
  game.onPointerUp(event.pointerId);
});

canvas.addEventListener('pointercancel', (event) => {
  game.onPointerUp(event.pointerId);
});

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  game.update(dt, window.innerWidth, window.innerHeight);
  game.render(ctx, window.innerWidth, window.innerHeight);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
