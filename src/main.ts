import { Game, HapticEventKind } from './game';
import { playSound, resumeAudio } from './audio';

// Short, distinct vibration patterns per event, in milliseconds. A single
// number is one pulse; an array alternates vibrate/pause.
const HAPTIC_PATTERNS: Record<HapticEventKind, number | number[]> = {
  'paddle-hit': 10,
  'wall-bounce': 8,
  score: [20, 30, 20],
  'power-up': 15,
};

function vibrate(kind: HapticEventKind): void {
  if (typeof navigator.vibrate !== 'function') {
    return;
  }
  navigator.vibrate(HAPTIC_PATTERNS[kind]);
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const game = new Game();

// Reads the actually-visible viewport, not the layout viewport: on mobile
// Safari/Chrome, window.innerWidth/innerHeight can measure the viewport at
// its largest (browser chrome collapsed), so content near the bottom edge
// ends up placed under chrome that's still showing and never receives the
// touch (#87). visualViewport tracks what's currently on screen.
function viewportSize(): { width: number; height: number } {
  const vv = window.visualViewport;
  return { width: vv?.width ?? window.innerWidth, height: vv?.height ?? window.innerHeight };
}

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const { width, height } = viewportSize();
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener('resize', resize);
window.visualViewport?.addEventListener('resize', resize);
resize();

canvas.addEventListener('pointerdown', (event) => {
  resumeAudio();
  canvas.setPointerCapture(event.pointerId);
  const { width, height } = viewportSize();
  game.onPointerDown(event.pointerId, event.clientX, event.clientY, width, height);
});

canvas.addEventListener('pointermove', (event) => {
  const { width } = viewportSize();
  game.onPointerMove(event.pointerId, event.clientX, width, event.clientY);
});

canvas.addEventListener('pointerup', (event) => {
  game.onPointerUp(event.pointerId);
});

canvas.addEventListener('pointercancel', (event) => {
  game.onPointerCancel(event.pointerId);
});

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  const { width, height } = viewportSize();
  game.update(dt, width, height);
  for (const event of game.consumeHapticEvents()) {
    vibrate(event);
    if (game.soundEnabled) {
      playSound(event);
    }
  }
  game.render(ctx, width, height);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
