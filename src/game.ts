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

const PADDLE_WIDTH_RATIO = 0.28; // fraction of canvas width
const PADDLE_HEIGHT_RATIO = 0.018; // fraction of canvas height
const PADDLE_MARGIN_RATIO = 0.06; // distance from top/bottom edge, fraction of canvas height
const BALL_RADIUS_RATIO = 0.016; // fraction of canvas height
const BALL_SPEED_RATIO = 0.55; // canvas-heights per second

// Comet tail tuning (purely cosmetic, does not affect BALL_RADIUS_RATIO or
// physics). Speed is normalized against BALL_SPEED_RATIO so the tail reads
// as "faster comet" when a Fast Ball power-up (or any other speed change)
// pushes the ball past its base launch speed.
const COMET_MAX_SPEED_FACTOR = 2.2; // caps how much extra speed keeps growing the tail
const COMET_GLOW_RADIUS_RATIO = 3.2; // glow radius, multiple of ball radius
const COMET_TAIL_BASE_LENGTH_RATIO = 1.6; // tail length at rest, multiple of ball radius
const COMET_TAIL_SPEED_LENGTH_RATIO = 3.2; // extra tail length per unit of speed factor
const COMET_TAIL_BASE_OPACITY = 0.25;
const COMET_TAIL_SPEED_OPACITY = 0.5;
const MAX_BOUNCE_ANGLE = Math.PI / 3; // 60 degrees from vertical at the paddle edges
const WINNING_SCORE = 11; // first player to reach this score wins the match
const SERVE_DELAY_SECONDS = 1; // pause after a point before the ball re-serves
const GAME_TITLE = 'PONG';
const MAX_WALL_BOUNCES_PER_FRAME = 8; // safety bound on the per-frame wall-bounce segment walk below

// Type system: one font stack plus a small set of named text roles, so every
// piece of drawn text (score, win title, subtext, power-up labels) reads as
// one deliberate system instead of ad-hoc font strings. A tidy monospaced
// stack was chosen over a generic sans-serif fallback for its digital
// scoreboard feel, which fits a Pong-style game.
const TYPE_FONT_STACK = "'Courier New', ui-monospace, 'Cascadia Code', Menlo, Consolas, monospace";
type TextRole = 'primary' | 'secondary';
interface TextStyle {
  weight: number;
  letterSpacingRatio: number; // letter-spacing, as a fraction of font size
}
const TEXT_STYLES: Record<TextRole, TextStyle> = {
  // Score, win title, power-up labels: bold and tightly tracked so they read
  // as the focal point of the screen.
  primary: { weight: 700, letterSpacingRatio: 0.01 },
  // Subtext/labels: lighter weight and wider tracking, reading as secondary
  // to primary text.
  secondary: { weight: 500, letterSpacingRatio: 0.12 },
};
function applyTextStyle(ctx: CanvasRenderingContext2D, role: TextRole, sizePx: number): void {
  const style = TEXT_STYLES[role];
  const roundedSize = Math.round(sizePx);
  ctx.font = `${style.weight} ${roundedSize}px ${TYPE_FONT_STACK}`;
  ctx.letterSpacing = `${(roundedSize * style.letterSpacingRatio).toFixed(2)}px`;
}

// Ball-wall/ball-paddle impact flashes: purely cosmetic, decay via `dt` and
// never feed back into collision timing or outcome.
const IMPACT_DURATION_SECONDS = 0.25;
const IMPACT_PARTICLE_COUNT = 6;

// Screen shake: a brief, subtle global render-transform offset on high-impact
// moments (power-up pickup, boosted paddle hits). Decays via `dt` in
// update(), same pattern as `impacts`, and is read only by render() -- it
// never feeds back into paddle input, ball physics, or collision outcomes.
const SCREEN_SHAKE_DURATION_SECONDS = 0.18;
const SCREEN_SHAKE_AMPLITUDE_RATIO = 0.012; // peak offset, fraction of canvas height

// Pre-serve countdown ring: purely cosmetic, driven by `serveDelayRemaining`
// and never feeds back into serve timing. Starts wide and shrinks down onto
// the ball as the pause elapses, so it reads as a visible countdown rather
// than a frozen frame.
const SERVE_COUNTDOWN_RING_MAX_RADIUS_RATIO = 6; // ring's starting radius, multiple of ball radius
const SERVE_COUNTDOWN_RING_LINE_WIDTH_RATIO = 0.35; // ring stroke width, multiple of ball radius

// Paddle buff indicators: purely cosmetic bars drawn on the outer side of a
// buffed paddle, read from `speedBoostRemaining*`/`giantPaddleRemaining*` and
// scaled against the matching *_DURATION_SECONDS constant. They never feed
// back into `paddleSpeedMultiplier*`/`paddleWidthMultiplier*` or collisions.
const BUFF_INDICATOR_HEIGHT_RATIO = 0.4; // bar thickness, multiple of paddle height
const BUFF_INDICATOR_GAP_RATIO = 1.6; // gap from paddle edge to first bar, multiple of paddle height
const BUFF_INDICATOR_SPACING_RATIO = 1.2; // gap between stacked bars, multiple of paddle height

// Win-screen celebration: a one-time particle burst plus a title scale/fade
// entrance, both driven by `winCelebrationElapsed` (elapsed seconds since
// `winner` last transitioned from null). Purely cosmetic -- render-only state
// that never feeds back into score1/score2/winner.
const WIN_CELEBRATION_DURATION_SECONDS = 1.8; // length of the particle burst
const WIN_TITLE_ENTRANCE_DURATION_SECONDS = 0.5; // length of the title scale/fade-in
const WIN_PARTICLE_COUNT = 28;
const WIN_PARTICLE_COLORS = ['#ffd166', '#ff5b7f', '#06d6a0', '#a78bfa', '#8ecae6'];
interface WinParticle {
  angle: number;
  distanceRatio: number; // fraction of min(width, height) traveled by the time the burst ends
  sizeRatio: number; // particle radius, multiple of the ball radius
  spinSpeed: number; // radians per second added to `angle` over the burst
  color: string;
}
const WIN_PARTICLES: WinParticle[] = Array.from({ length: WIN_PARTICLE_COUNT }, (_, i) => ({
  angle: hash01(i * 4.7 + 11) * Math.PI * 2,
  distanceRatio: 0.18 + hash01(i * 6.1 + 12) * 0.22,
  sizeRatio: 0.5 + hash01(i * 3.3 + 13) * 0.8,
  spinSpeed: 2 + hash01(i * 8.3 + 14) * 4,
  color: WIN_PARTICLE_COLORS[i % WIN_PARTICLE_COLORS.length],
}));

// HUD: a subtle center-court divider plus a soft panel behind each score, so
// the scoreboard reads as one designed element instead of numbers floating
// directly on the starfield. Purely visual -- reads score1/score2 without
// touching them.
const HUD_DIVIDER_DASH_RATIO = 0.018; // dash length, fraction of canvas width
const HUD_DIVIDER_GAP_RATIO = 0.014; // gap between dashes, fraction of canvas width
const HUD_DIVIDER_LINE_WIDTH_RATIO = 0.0035; // stroke width, fraction of canvas height
const HUD_PANEL_WIDTH_RATIO = 0.34; // panel width, fraction of canvas width
const HUD_PANEL_HEIGHT_RATIO = 0.11; // panel height, fraction of canvas height
const HUD_PANEL_RADIUS_RATIO = 0.28; // corner radius, fraction of panel height

// Kept low enough to be an actual per-event speed limit (not just a safety
// clamp) so that scaling it via a power-up produces a real, perceptible
// change in how fast the paddle catches up to the finger during a drag.
// Normal one-thumb dragging still tracks the finger closely because
// pointermove fires many times per second, so per-event deltas rarely
// exceed this cap outside of very fast full-width flicks.
export const PADDLE_MOVE_STEP_RATIO = 0.05; // max fraction of canvas width a paddle may travel per drag event
export const POWER_UP_SPAWN_INTERVAL_SECONDS = 6; // gap between power-up spawns during an active rally
const POWER_UP_RADIUS_RATIO = 0.03; // fraction of canvas height

// Idle pulse/bob tuning (purely cosmetic -- driven by `backdropTime`, never
// touches POWER_UP_RADIUS_RATIO or the pickup's collision position).
const POWER_UP_GLOW_RADIUS_RATIO = 2.4; // glow radius, multiple of pickup radius
const POWER_UP_PULSE_SPEED = 2.6; // radians/sec
const POWER_UP_PULSE_SCALE_RATIO = 0.1; // +/- fraction of radius the pickup breathes by
const POWER_UP_BOB_SPEED = 1.7; // radians/sec
const POWER_UP_BOB_RATIO = 0.3; // bob amplitude, multiple of pickup radius
export const SPEED_BOOST_MULTIPLIER = 1.6;
export const SPEED_BOOST_DURATION_SECONDS = 5;
export const FAST_BALL_MULTIPLIER = 1.35;
export const GIANT_PADDLE_MULTIPLIER = 1.8;
export const GIANT_PADDLE_DURATION_SECONDS = 5;
export const MULTI_BALL_DURATION_SECONDS = 8;

// Deterministic pseudo-random hash (no Math.random) so the starfield layout
// is stable across renders instead of reshuffling every frame.
function hash01(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

const STAR_COUNT = 50;
const STAR_GLOW_RADIUS_RATIO = 4; // max glow radius, multiple of star radius
interface Star {
  xRatio: number;
  yRatio: number;
  radiusPx: number;
  twinkleSpeed: number;
  twinklePhase: number;
}
const STARS: Star[] = Array.from({ length: STAR_COUNT }, (_, i) => ({
  xRatio: hash01(i * 3.1 + 1),
  yRatio: hash01(i * 7.7 + 2),
  radiusPx: 0.6 + hash01(i * 5.3 + 3) * 1.2,
  twinkleSpeed: 0.5 + hash01(i * 9.1 + 4) * 1.5,
  twinklePhase: hash01(i * 2.3 + 5) * Math.PI * 2,
}));

// Glow gradients are anchored to absolute canvas pixel positions, so they're
// only rebuilt when the canvas size changes rather than allocated fresh every
// frame -- 50 stars x 60fps worth of `createRadialGradient` calls would be
// wasteful for a purely decorative backdrop.
let starGlowCache: { width: number; height: number; glowRgb: string; gradients: CanvasGradient[] } | null = null;
function getStarGlowGradients(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  glowRgb: string,
): CanvasGradient[] {
  if (
    starGlowCache &&
    starGlowCache.width === width &&
    starGlowCache.height === height &&
    starGlowCache.glowRgb === glowRgb
  ) {
    return starGlowCache.gradients;
  }
  const gradients = STARS.map((star) => {
    const x = star.xRatio * width;
    const y = star.yRatio * height;
    const glowRadius = star.radiusPx * STAR_GLOW_RADIUS_RATIO;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
    gradient.addColorStop(0, `rgba(${glowRgb}, 0.85)`);
    gradient.addColorStop(1, `rgba(${glowRgb}, 0)`);
    return gradient;
  });
  starGlowCache = { width, height, glowRgb, gradients };
  return gradients;
}

// Orbiting planets drift behind the play field, evoking a slow solar-system
// backdrop. Orbit center is fixed as a fraction of canvas size so it holds up
// across the portrait aspect ratios the game supports.
interface PlanetRing {
  color: string;
  radiusXRatio: number; // ring radius (x-axis), fraction of planet radius
  radiusYRatio: number; // ring radius (y-axis), fraction of planet radius
  tilt: number; // ring rotation, radians
}
interface PlanetConfig {
  radiusRatio: number; // planet radius, fraction of canvas height
  orbitRadiusRatio: number; // orbit radius, fraction of min(width, height)
  angularSpeed: number; // radians per second
  phase: number; // initial angle offset
  ring?: PlanetRing;
}
const ORBIT_CENTER_X_RATIO = 0.5;
const ORBIT_CENTER_Y_RATIO = 0.38;
const PLANETS: PlanetConfig[] = [
  {
    radiusRatio: 0.05,
    orbitRadiusRatio: 0.55,
    angularSpeed: 0.12,
    phase: 0,
    ring: { color: '#e9c893', radiusXRatio: 1.9, radiusYRatio: 0.55, tilt: -0.35 },
  },
  {
    radiusRatio: 0.032,
    orbitRadiusRatio: 0.32,
    angularSpeed: -0.2,
    phase: Math.PI * 0.6,
  },
  {
    radiusRatio: 0.022,
    orbitRadiusRatio: 0.75,
    angularSpeed: 0.07,
    phase: Math.PI * 1.3,
  },
];

// Map-select (#57): the player picks Earth or Mars before the first serve,
// which swaps the backdrop's background/star/planet colors below. Gameplay
// (ball/paddle/power-ups) never reads `selectedMap` or these palettes.
export type MapId = 'earth' | 'mars';

interface PlanetPalette {
  colorNear: string;
  colorFar: string;
  bandColor: string; // subtle surface-band overlay tint
}

interface MapTheme {
  id: MapId;
  label: string;
  backgroundColor: string;
  starColor: string;
  starGlowRgb: string; // "r, g, b" components, used at alpha 0.85/0 in the glow gradient
  planetPalettes: PlanetPalette[]; // same order/length as PLANETS
}

const DEFAULT_BACKGROUND_COLOR = '#0a1128';
const DEFAULT_STAR_COLOR = '#f4f7ff';
const DEFAULT_STAR_GLOW_RGB = '244, 247, 255';
const DEFAULT_PLANET_PALETTES: PlanetPalette[] = [
  { colorNear: '#f4a261', colorFar: '#9c4f21', bandColor: '#fff3e0' },
  { colorNear: '#8ecae6', colorFar: '#2a6f97', bandColor: '#eaf7ff' },
  { colorNear: '#c9a0f5', colorFar: '#5e3b8f', bandColor: '#f4e9ff' },
];

// Shown before a map is chosen (title screen, map-select screen), so it
// stays visually distinct from the two selectable themes below.
export const MAP_THEMES: Record<MapId, MapTheme> = {
  earth: {
    id: 'earth',
    label: 'Earth',
    backgroundColor: '#031a1f',
    starColor: '#eafff5',
    starGlowRgb: '160, 230, 210',
    planetPalettes: [
      { colorNear: '#7ec8e3', colorFar: '#1b4d6b', bandColor: '#eaffea' },
      { colorNear: '#8fd694', colorFar: '#2f6e3a', bandColor: '#eaffea' },
      { colorNear: '#5e8fd6', colorFar: '#233c6b', bandColor: '#e7f0ff' },
    ],
  },
  mars: {
    id: 'mars',
    label: 'Mars',
    backgroundColor: '#2a0e08',
    starColor: '#ffe9db',
    starGlowRgb: '255, 176, 130',
    planetPalettes: [
      { colorNear: '#e07a4f', colorFar: '#7a2e12', bandColor: '#ffe3cc' },
      { colorNear: '#c15c3c', colorFar: '#5c1f0d', bandColor: '#ffd8bd' },
      { colorNear: '#8f4a33', colorFar: '#3d1a0d', bandColor: '#ffcaa8' },
    ],
  },
};

// Map-select buttons: two stacked, thumb-reachable rects centered on screen.
const MAP_BUTTON_WIDTH_RATIO = 0.6; // fraction of canvas width
const MAP_BUTTON_HEIGHT_RATIO = 0.1; // fraction of canvas height
const MAP_BUTTON_GAP_RATIO = 0.04; // fraction of canvas height, between buttons

// Pure so it can be unit tested directly: position of a body orbiting
// (centerX, centerY) at the given radius/speed/phase at time `time`. The
// vertical axis is flattened slightly to read as a gentle drift rather than a
// perfect circle.
export function orbitPosition(
  centerX: number,
  centerY: number,
  orbitRadius: number,
  angularSpeed: number,
  phase: number,
  time: number,
): { x: number; y: number } {
  const angle = phase + angularSpeed * time;
  return {
    x: centerX + Math.cos(angle) * orbitRadius,
    y: centerY + Math.sin(angle) * orbitRadius * 0.55,
  };
}

type PaddleId = 1 | 2;

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

// A bonus ball spawned by the Multi-Ball power-up. Expires after its duration
// elapses or as soon as it exits the field, whichever comes first.
interface ExtraBall extends Ball {
  remaining: number;
}

// A brief flash/particle burst spawned where a ball hits a wall or paddle.
// `age` grows by `dt` each frame in `update` and the effect is dropped once
// it reaches IMPACT_DURATION_SECONDS; purely visual, read only by render.
type ImpactKind = 'paddle' | 'wall';
interface Impact {
  x: number;
  y: number;
  age: number;
  kind: ImpactKind;
}

// Emitted by update() whenever an event `main.ts` may want to react to (e.g.
// with haptic feedback) occurs. Drained via consumeHapticEvents() so this
// file never touches the Vibration API or any other DOM global itself.
export type HapticEventKind = 'paddle-hit' | 'wall-bounce' | 'score' | 'power-up';

export type PowerUpKind = 'speed-boost' | 'fast-ball' | 'giant-paddle' | 'multi-ball';

export interface PowerUp {
  id: number;
  kind: PowerUpKind;
  x: number;
  y: number;
}

interface PowerUpDefinition {
  kind: PowerUpKind;
  activate: (game: Game) => void;
}

// Registry of power-up effects: add a new { kind, activate } entry to
// introduce another power-up. Spawn/collision/expiry logic below stays
// generic and never branches on `kind` directly.
const POWER_UP_DEFINITIONS: PowerUpDefinition[] = [
  { kind: 'speed-boost', activate: (game) => game.activateSpeedBoost() },
  { kind: 'fast-ball', activate: (game) => game.activateFastBall() },
  { kind: 'giant-paddle', activate: (game) => game.activateGiantPaddle() },
  { kind: 'multi-ball', activate: (game) => game.activateMultiBall() },
];

export const POWER_UP_KINDS: readonly PowerUpKind[] = POWER_UP_DEFINITIONS.map((entry) => entry.kind);

const POWER_UP_VISUALS: Record<PowerUpKind, { color: string; highlight: string; glow: string; label: string }> = {
  'speed-boost': { color: '#f4a261', highlight: '#ffe0b3', glow: 'rgba(244, 162, 97, 0.55)', label: 'S' },
  'fast-ball': { color: '#e76f51', highlight: '#ffb59e', glow: 'rgba(231, 111, 81, 0.55)', label: 'F' },
  'giant-paddle': { color: '#8ecae6', highlight: '#e0f4ff', glow: 'rgba(142, 202, 230, 0.55)', label: 'G' },
  'multi-ball': { color: '#c9a0f5', highlight: '#ecdcff', glow: 'rgba(201, 160, 245, 0.55)', label: 'M' },
};

// Pure so it can be unit tested directly: given where the ball hit a paddle
// (relative to the paddle's center and width), returns the rebound velocity.
// Hits near the paddle center rebound close to vertical; hits near the edges
// rebound at a steeper angle.
export function reflectOffPaddle(
  ballX: number,
  paddleX: number,
  paddleWidth: number,
  speed: number,
  movingDown: boolean,
): { vx: number; vy: number } {
  const offset = clamp((ballX - paddleX) / (paddleWidth / 2), -1, 1);
  const angle = offset * MAX_BOUNCE_ANGLE;
  const verticalSign = movingDown ? 1 : -1;
  return {
    vx: speed * Math.sin(angle),
    vy: speed * Math.cos(angle) * verticalSign,
  };
}

// Returns the fraction-of-frame interval [tMin, tMax] (within [0, 1]) during
// which a value moving linearly from `start` to `end` lies inside [lo, hi],
// or null if it never does. Used to correlate the X and Y axes of a swept
// collision check so a bounce only registers when both axes are in-band at
// the *same instant*, not just independently at some point during the frame.
function axisBandInterval(start: number, end: number, lo: number, hi: number): [number, number] | null {
  if (start === end) {
    return start >= lo && start <= hi ? [0, 1] : null;
  }
  const tLo = (lo - start) / (end - start);
  const tHi = (hi - start) / (end - start);
  const tMin = Math.max(0, Math.min(tLo, tHi));
  const tMax = Math.min(1, Math.max(tLo, tHi));
  return tMin <= tMax ? [tMin, tMax] : null;
}

// True when the ball's straight-line path this frame actually crosses the
// given rectangular band (already expanded by the ball radius on both axes)
// at a shared instant, rather than merely having independently-overlapping X
// and Y bounding ranges over the whole frame.
function pathCrossesBand(
  startX: number,
  endX: number,
  xLo: number,
  xHi: number,
  startY: number,
  endY: number,
  yLo: number,
  yHi: number,
): boolean {
  const xInterval = axisBandInterval(startX, endX, xLo, xHi);
  if (xInterval === null) {
    return false;
  }
  const yInterval = axisBandInterval(startY, endY, yLo, yHi);
  if (yInterval === null) {
    return false;
  }
  return Math.max(xInterval[0], yInterval[0]) <= Math.min(xInterval[1], yInterval[1]);
}

export class Game {
  paddle1X = 0; // player 1 (top) paddle center, in canvas pixels
  paddle2X = 0; // player 2 (bottom) paddle center, in canvas pixels
  ballX = 0;
  ballY = 0;
  ballVX = 0;
  ballVY = 0;
  score1 = 0; // player 1 (top) score
  score2 = 0; // player 2 (bottom) score
  winner: PaddleId | null = null;
  titleScreenActive = true; // shown once on first load, dismissed by the first tap
  mapSelectActive = false; // shown right after the title screen, dismissed by picking a map
  selectedMap: MapId | null = null; // null until a map is picked; persists across restartMatch

  activePowerUp: PowerUp | null = null;
  lastPaddleTouch: PaddleId | null = null; // paddle that most recently hit the ball this rally
  paddleSpeedMultiplier1 = 1;
  paddleSpeedMultiplier2 = 1;
  speedBoostRemaining1 = 0;
  speedBoostRemaining2 = 0;
  paddleWidthMultiplier1 = 1;
  paddleWidthMultiplier2 = 1;
  giantPaddleRemaining1 = 0;
  giantPaddleRemaining2 = 0;
  extraBalls: ExtraBall[] = [];
  impacts: Impact[] = []; // active collision flashes/particle bursts, decayed in update()
  screenShakeRemaining = 0; // seconds left of the current shake, decayed in update()
  backdropTime = 0; // seconds elapsed, drives the starfield twinkle and planet orbits
  winCelebrationElapsed = 0; // seconds since `winner` last became non-null, drives the win-screen celebration
  private hapticEvents: HapticEventKind[] = []; // queued since the last consumeHapticEvents() call

  private initialized = false;
  private serveDelayRemaining = 0;
  private powerUpSpawnTimer = POWER_UP_SPAWN_INTERVAL_SECONDS;
  private nextPowerUpId = 1;
  private lastHeight = 0;
  private lastWidth = 0;
  private readonly pointerPaddle = new Map<number, PaddleId>();

  private ensureInitialized(width: number, height: number): void {
    if (this.initialized) {
      return;
    }
    this.paddle1X = width / 2;
    this.paddle2X = width / 2;
    this.ballX = width / 2;
    this.ballY = height / 2;
    this.initialized = true;
  }

  // Angle from vertical, kept between 30 and 60 degrees so the launch is
  // always visibly diagonal (never near-horizontal or near-vertical).
  private randomLaunchVelocity(height: number): { vx: number; vy: number } {
    const speed = height * BALL_SPEED_RATIO;
    const angleFromVertical = Math.PI / 6 + Math.random() * (Math.PI / 6);
    const xSign = Math.random() < 0.5 ? -1 : 1;
    const ySign = Math.random() < 0.5 ? -1 : 1;
    return {
      vx: Math.sin(angleFromVertical) * speed * xSign,
      vy: Math.cos(angleFromVertical) * speed * ySign,
    };
  }

  // Centers the ball and immediately launches it in a random diagonal direction.
  private serve(width: number, height: number): void {
    this.ballX = width / 2;
    this.ballY = height / 2;
    const { vx, vy } = this.randomLaunchVelocity(height);
    this.ballVX = vx;
    this.ballVY = vy;
  }

  private addScore(scorer: PaddleId): void {
    if (scorer === 1) {
      this.score1 += 1;
    } else {
      this.score2 += 1;
    }
    if (this.score1 >= WINNING_SCORE) {
      this.winner = 1;
      this.winCelebrationElapsed = 0;
    } else if (this.score2 >= WINNING_SCORE) {
      this.winner = 2;
      this.winCelebrationElapsed = 0;
    }
  }

  // Centers the ball with zero velocity and starts the pre-serve pause.
  private awardPoint(scorer: PaddleId, width: number, height: number): void {
    this.addScore(scorer);
    this.hapticEvents.push('score');

    this.ballX = width / 2;
    this.ballY = height / 2;
    this.ballVX = 0;
    this.ballVY = 0;
    this.activePowerUp = null;
    this.powerUpSpawnTimer = POWER_UP_SPAWN_INTERVAL_SECONDS;
    this.extraBalls = [];
    if (this.winner === null) {
      this.serveDelayRemaining = SERVE_DELAY_SECONDS;
    }
  }

  private restartMatch(width: number, height: number): void {
    this.score1 = 0;
    this.score2 = 0;
    this.winner = null;
    this.serveDelayRemaining = 0;
    this.activePowerUp = null;
    this.powerUpSpawnTimer = POWER_UP_SPAWN_INTERVAL_SECONDS;
    this.lastPaddleTouch = null;
    this.paddleSpeedMultiplier1 = 1;
    this.paddleSpeedMultiplier2 = 1;
    this.speedBoostRemaining1 = 0;
    this.speedBoostRemaining2 = 0;
    this.paddleWidthMultiplier1 = 1;
    this.paddleWidthMultiplier2 = 1;
    this.giantPaddleRemaining1 = 0;
    this.giantPaddleRemaining2 = 0;
    this.extraBalls = [];
    this.impacts = [];
    this.screenShakeRemaining = 0;
    this.hapticEvents = [];
    this.winCelebrationElapsed = 0;
    this.serve(width, height);
  }

  private spawnImpact(x: number, y: number, kind: ImpactKind): void {
    this.impacts.push({ x, y, age: 0, kind });
  }

  // Resets (never accumulates) the shake countdown so overlapping triggers
  // don't stack the effect beyond SCREEN_SHAKE_DURATION_SECONDS.
  private triggerScreenShake(): void {
    this.screenShakeRemaining = SCREEN_SHAKE_DURATION_SECONDS;
  }

  // Drains and returns the haptic events queued since the last call, for
  // `main.ts` to translate into navigator.vibrate() patterns.
  consumeHapticEvents(): HapticEventKind[] {
    if (this.hapticEvents.length === 0) {
      return this.hapticEvents;
    }
    const events = this.hapticEvents;
    this.hapticEvents = [];
    return events;
  }

  // Bounding box of the index-th map-select button (0 = first theme, in
  // `MAP_THEMES` insertion order), shared by hit-testing and rendering so
  // they can never drift apart.
  private mapButtonRect(index: number, width: number, height: number): { x: number; y: number; w: number; h: number } {
    const themeCount = Object.keys(MAP_THEMES).length;
    const w = width * MAP_BUTTON_WIDTH_RATIO;
    const h = height * MAP_BUTTON_HEIGHT_RATIO;
    const gap = height * MAP_BUTTON_GAP_RATIO;
    const totalHeight = h * themeCount + gap * (themeCount - 1);
    const x = (width - w) / 2;
    const y = height / 2 - totalHeight / 2 + index * (h + gap);
    return { x, y, w, h };
  }

  // Returns the map tapped at (x, y) during the map-select screen, or null
  // when the tap missed both buttons.
  private mapAt(x: number, y: number, width: number, height: number): MapId | null {
    const themes = Object.values(MAP_THEMES);
    for (let i = 0; i < themes.length; i += 1) {
      const rect = this.mapButtonRect(i, width, height);
      if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) {
        return themes[i].id;
      }
    }
    return null;
  }

  onPointerDown(pointerId: number, x: number, y: number, width: number, height: number): void {
    this.ensureInitialized(width, height);
    if (this.titleScreenActive) {
      this.titleScreenActive = false;
      this.mapSelectActive = true;
      return;
    }
    if (this.mapSelectActive) {
      const chosen = this.mapAt(x, y, width, height);
      if (chosen !== null) {
        this.selectedMap = chosen;
        this.mapSelectActive = false;
        this.serveDelayRemaining = SERVE_DELAY_SECONDS;
      }
    } else if (this.winner !== null) {
      this.restartMatch(width, height);
      return;
    }
    const paddle: PaddleId = y < height / 2 ? 1 : 2;
    this.pointerPaddle.set(pointerId, paddle);
    this.movePaddle(paddle, x, width);
  }

  onPointerMove(pointerId: number, x: number, width: number): void {
    const paddle = this.pointerPaddle.get(pointerId);
    if (paddle === undefined) {
      return;
    }
    this.dragPaddle(paddle, x, width);
  }

  onPointerUp(pointerId: number): void {
    this.pointerPaddle.delete(pointerId);
  }

  private paddleWidth(paddle: PaddleId, width: number): number {
    const multiplier = paddle === 1 ? this.paddleWidthMultiplier1 : this.paddleWidthMultiplier2;
    return width * PADDLE_WIDTH_RATIO * multiplier;
  }

  private movePaddle(paddle: PaddleId, x: number, width: number): void {
    const halfWidth = this.paddleWidth(paddle, width) / 2;
    const clamped = clamp(x, halfWidth, width - halfWidth);
    if (paddle === 1) {
      this.paddle1X = clamped;
    } else {
      this.paddle2X = clamped;
    }
  }

  // Like movePaddle, but rate-limited to PADDLE_MOVE_STEP_RATIO per call so
  // paddle speed is an actual gameplay quantity: Speed Boost (which scales
  // the limit) now visibly changes how fast the paddle can catch up.
  private dragPaddle(paddle: PaddleId, x: number, width: number): void {
    const halfWidth = this.paddleWidth(paddle, width) / 2;
    const target = clamp(x, halfWidth, width - halfWidth);
    const current = paddle === 1 ? this.paddle1X : this.paddle2X;
    const multiplier = paddle === 1 ? this.paddleSpeedMultiplier1 : this.paddleSpeedMultiplier2;
    const maxStep = width * PADDLE_MOVE_STEP_RATIO * multiplier;
    const next = current + clamp(target - current, -maxStep, maxStep);
    if (paddle === 1) {
      this.paddle1X = next;
    } else {
      this.paddle2X = next;
    }
  }

  activateSpeedBoost(): void {
    const paddle = this.lastPaddleTouch;
    if (paddle === null) {
      return;
    }
    if (paddle === 1) {
      this.paddleSpeedMultiplier1 = SPEED_BOOST_MULTIPLIER;
      this.speedBoostRemaining1 = SPEED_BOOST_DURATION_SECONDS;
    } else {
      this.paddleSpeedMultiplier2 = SPEED_BOOST_MULTIPLIER;
      this.speedBoostRemaining2 = SPEED_BOOST_DURATION_SECONDS;
    }
  }

  activateFastBall(): void {
    this.ballVX *= FAST_BALL_MULTIPLIER;
    this.ballVY *= FAST_BALL_MULTIPLIER;
  }

  activateGiantPaddle(): void {
    const paddle = this.lastPaddleTouch;
    if (paddle === null) {
      return;
    }
    if (paddle === 1) {
      this.paddleWidthMultiplier1 = GIANT_PADDLE_MULTIPLIER;
      this.giantPaddleRemaining1 = GIANT_PADDLE_DURATION_SECONDS;
    } else {
      this.paddleWidthMultiplier2 = GIANT_PADDLE_MULTIPLIER;
      this.giantPaddleRemaining2 = GIANT_PADDLE_DURATION_SECONDS;
    }
    if (this.lastWidth > 0) {
      const halfWidth = this.paddleWidth(paddle, this.lastWidth) / 2;
      const clamped = clamp(paddle === 1 ? this.paddle1X : this.paddle2X, halfWidth, this.lastWidth - halfWidth);
      if (paddle === 1) {
        this.paddle1X = clamped;
      } else {
        this.paddle2X = clamped;
      }
    }
  }

  activateMultiBall(): void {
    const { vx, vy } = this.randomLaunchVelocity(this.lastHeight);
    this.extraBalls.push({
      x: this.ballX,
      y: this.ballY,
      vx,
      vy,
      remaining: MULTI_BALL_DURATION_SECONDS,
    });
  }

  private spawnPowerUp(width: number, height: number): void {
    const definition = POWER_UP_DEFINITIONS[Math.floor(Math.random() * POWER_UP_DEFINITIONS.length)];
    const marginX = width * 0.15;
    const marginY = height * (PADDLE_MARGIN_RATIO + 0.1);
    this.activePowerUp = {
      id: this.nextPowerUpId++,
      kind: definition.kind,
      x: marginX + Math.random() * (width - marginX * 2),
      y: marginY + Math.random() * (height - marginY * 2),
    };
  }

  private handlePowerUpCollision(height: number): void {
    const powerUp = this.activePowerUp;
    if (powerUp === null) {
      return;
    }
    const collisionRadius = height * BALL_RADIUS_RATIO + height * POWER_UP_RADIUS_RATIO;
    const dx = this.ballX - powerUp.x;
    const dy = this.ballY - powerUp.y;
    if (dx * dx + dy * dy > collisionRadius * collisionRadius) {
      return;
    }
    // Speed Boost and Giant Paddle attribute their effect to whichever
    // paddle last touched the ball. If neither paddle has touched it yet,
    // leave the icon in play instead of silently consuming it for nothing.
    if ((powerUp.kind === 'speed-boost' || powerUp.kind === 'giant-paddle') && this.lastPaddleTouch === null) {
      return;
    }
    this.activePowerUp = null;
    this.hapticEvents.push('power-up');
    this.triggerScreenShake();
    const definition = POWER_UP_DEFINITIONS.find((entry) => entry.kind === powerUp.kind);
    definition?.activate(this);
  }

  // Moves a ball, bounces it off the side walls and either paddle, and
  // reports which paddle (if any) it just reflected off. Shared by the
  // primary ball and every Multi-Ball bonus ball so their physics never
  // diverge.
  private stepBallPhysics(ball: Ball, dt: number, width: number, height: number): PaddleId | null {
    const radius = height * BALL_RADIUS_RATIO;
    const paddle1Width = this.paddleWidth(1, width);
    const paddle2Width = this.paddleWidth(2, width);
    const paddleHeight = height * PADDLE_HEIGHT_RATIO;
    const paddle1Y = height * PADDLE_MARGIN_RATIO;
    const paddle2Y = height * (1 - PADDLE_MARGIN_RATIO);

    // Boosted (e.g. stacked Fast Ball) speeds can carry the ball across a
    // side wall and back across the court within a single frame. Walk the
    // frame as a sequence of straight-line segments split at each wall
    // bounce, running the swept paddle check (pathCrossesBand) against every
    // segment's true pre-move/post-move span -- not just the first,
    // pre-bounce leg -- so a paddle sitting anywhere on the ball's real path
    // is never skipped.
    let segStartX = ball.x;
    let segStartY = ball.y;
    let remaining = dt;

    for (let bounce = 0; bounce < MAX_WALL_BOUNCES_PER_FRAME; bounce += 1) {
      const rawEndX = segStartX + ball.vx * remaining;
      const rawEndY = segStartY + ball.vy * remaining;

      let wallT: number | null = null;
      if (ball.vx < 0 && rawEndX - radius < 0) {
        wallT = (radius - segStartX) / (rawEndX - segStartX);
      } else if (ball.vx > 0 && rawEndX + radius > width) {
        wallT = (width - radius - segStartX) / (rawEndX - segStartX);
      }

      const segEndX = wallT === null ? rawEndX : segStartX + (rawEndX - segStartX) * wallT;
      const segEndY = wallT === null ? rawEndY : segStartY + (rawEndY - segStartY) * wallT;
      const speed = Math.hypot(ball.vx, ball.vy);

      if (
        ball.vy < 0 &&
        pathCrossesBand(
          segStartX,
          segEndX,
          this.paddle1X - paddle1Width / 2 - radius,
          this.paddle1X + paddle1Width / 2 + radius,
          segStartY,
          segEndY,
          paddle1Y - paddleHeight / 2 - radius,
          paddle1Y + paddleHeight / 2 + radius,
        )
      ) {
        ball.x = segEndX;
        ball.y = paddle1Y + paddleHeight / 2 + radius;
        const { vx, vy } = reflectOffPaddle(ball.x, this.paddle1X, paddle1Width, speed, true);
        ball.vx = vx;
        ball.vy = vy;
        this.spawnImpact(ball.x, ball.y, 'paddle');
        this.hapticEvents.push('paddle-hit');
        if (speed > height * BALL_SPEED_RATIO) {
          this.triggerScreenShake();
        }
        return 1;
      }
      if (
        ball.vy > 0 &&
        pathCrossesBand(
          segStartX,
          segEndX,
          this.paddle2X - paddle2Width / 2 - radius,
          this.paddle2X + paddle2Width / 2 + radius,
          segStartY,
          segEndY,
          paddle2Y - paddleHeight / 2 - radius,
          paddle2Y + paddleHeight / 2 + radius,
        )
      ) {
        ball.x = segEndX;
        ball.y = paddle2Y - paddleHeight / 2 - radius;
        const { vx, vy } = reflectOffPaddle(ball.x, this.paddle2X, paddle2Width, speed, false);
        ball.vx = vx;
        ball.vy = vy;
        this.spawnImpact(ball.x, ball.y, 'paddle');
        this.hapticEvents.push('paddle-hit');
        if (speed > height * BALL_SPEED_RATIO) {
          this.triggerScreenShake();
        }
        return 2;
      }

      if (wallT === null) {
        ball.x = segEndX;
        ball.y = segEndY;
        return null;
      }

      const hitLeftWall = ball.vx < 0;
      segStartX = hitLeftWall ? radius : width - radius;
      segStartY = segEndY;
      ball.vx = -ball.vx;
      remaining *= 1 - wallT;
      this.spawnImpact(segStartX, segStartY, 'wall');
      this.hapticEvents.push('wall-bounce');
    }

    ball.x = segStartX;
    ball.y = segStartY;
    return null;
  }

  update(dt: number, width: number, height: number): void {
    this.ensureInitialized(width, height);
    this.lastHeight = height;
    this.lastWidth = width;
    this.backdropTime += dt;

    if (this.titleScreenActive || this.mapSelectActive) {
      return;
    }

    if (this.impacts.length > 0) {
      this.impacts = this.impacts.filter((impact) => {
        impact.age += dt;
        return impact.age < IMPACT_DURATION_SECONDS;
      });
    }

    if (this.screenShakeRemaining > 0) {
      this.screenShakeRemaining = Math.max(0, this.screenShakeRemaining - dt);
    }

    if (this.speedBoostRemaining1 > 0) {
      this.speedBoostRemaining1 = Math.max(0, this.speedBoostRemaining1 - dt);
      if (this.speedBoostRemaining1 === 0) {
        this.paddleSpeedMultiplier1 = 1;
      }
    }
    if (this.speedBoostRemaining2 > 0) {
      this.speedBoostRemaining2 = Math.max(0, this.speedBoostRemaining2 - dt);
      if (this.speedBoostRemaining2 === 0) {
        this.paddleSpeedMultiplier2 = 1;
      }
    }

    if (this.giantPaddleRemaining1 > 0) {
      this.giantPaddleRemaining1 = Math.max(0, this.giantPaddleRemaining1 - dt);
      if (this.giantPaddleRemaining1 === 0) {
        this.paddleWidthMultiplier1 = 1;
      }
    }
    if (this.giantPaddleRemaining2 > 0) {
      this.giantPaddleRemaining2 = Math.max(0, this.giantPaddleRemaining2 - dt);
      if (this.giantPaddleRemaining2 === 0) {
        this.paddleWidthMultiplier2 = 1;
      }
    }

    if (this.winner !== null) {
      this.winCelebrationElapsed += dt;
      return;
    }

    if (this.serveDelayRemaining > 0) {
      this.serveDelayRemaining = Math.max(0, this.serveDelayRemaining - dt);
      if (this.serveDelayRemaining === 0) {
        this.serve(width, height);
      }
      return;
    }

    const primaryBall: Ball = { x: this.ballX, y: this.ballY, vx: this.ballVX, vy: this.ballVY };
    const touched = this.stepBallPhysics(primaryBall, dt, width, height);
    this.ballX = primaryBall.x;
    this.ballY = primaryBall.y;
    this.ballVX = primaryBall.vx;
    this.ballVY = primaryBall.vy;
    if (touched !== null) {
      this.lastPaddleTouch = touched;
    }

    this.powerUpSpawnTimer -= dt;
    if (this.activePowerUp === null && this.powerUpSpawnTimer <= 0) {
      this.spawnPowerUp(width, height);
      this.powerUpSpawnTimer = POWER_UP_SPAWN_INTERVAL_SECONDS;
    }
    this.handlePowerUpCollision(height);

    const radius = height * BALL_RADIUS_RATIO;
    if (this.ballY + radius < 0) {
      // Ball exited past the top edge: bottom player (player 2) scores.
      this.awardPoint(2, width, height);
    } else if (this.ballY - radius > height) {
      // Ball exited past the bottom edge: top player (player 1) scores.
      this.awardPoint(1, width, height);
    }

    if (this.extraBalls.length > 0) {
      this.extraBalls = this.extraBalls.filter((ball) => {
        ball.remaining -= dt;
        if (ball.remaining <= 0) {
          return false;
        }
        const extraTouched = this.stepBallPhysics(ball, dt, width, height);
        if (extraTouched !== null) {
          this.lastPaddleTouch = extraTouched;
        }
        if (ball.y + radius < 0) {
          this.addScore(2);
          return false;
        }
        if (ball.y - radius > height) {
          this.addScore(1);
          return false;
        }
        return true;
      });
    }
  }

  // Starfield + orbiting planets, drawn behind everything else. Purely
  // decorative: reads `backdropTime` (advanced by `update`) but never
  // touches ball/paddle state.
  private renderBackdrop(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const theme = this.selectedMap ? MAP_THEMES[this.selectedMap] : null;
    const starColor = theme?.starColor ?? DEFAULT_STAR_COLOR;
    const planetPalettes = theme?.planetPalettes ?? DEFAULT_PLANET_PALETTES;
    const glowGradients = getStarGlowGradients(ctx, width, height, theme?.starGlowRgb ?? DEFAULT_STAR_GLOW_RGB);
    STARS.forEach((star, i) => {
      const twinkle = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(this.backdropTime * star.twinkleSpeed + star.twinklePhase));
      const x = star.xRatio * width;
      const y = star.yRatio * height;

      // Soft halo behind the star, sized and faded with the twinkle so
      // brighter moments shine wider instead of just fading in place.
      ctx.globalAlpha = twinkle;
      ctx.fillStyle = glowGradients[i];
      ctx.beginPath();
      ctx.arc(x, y, star.radiusPx * STAR_GLOW_RADIUS_RATIO * (0.5 + 0.5 * twinkle), 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = starColor;
      ctx.beginPath();
      ctx.arc(x, y, star.radiusPx, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    const centerX = width * ORBIT_CENTER_X_RATIO;
    const centerY = height * ORBIT_CENTER_Y_RATIO;
    const minSide = Math.min(width, height);
    PLANETS.forEach((planet, planetIndex) => {
      const palette = planetPalettes[planetIndex];
      const { x, y } = orbitPosition(
        centerX,
        centerY,
        planet.orbitRadiusRatio * minSide,
        planet.angularSpeed,
        planet.phase,
        this.backdropTime,
      );
      const radius = planet.radiusRatio * height;

      if (planet.ring) {
        this.renderPlanetRing(ctx, x, y, radius, planet.ring, 'back');
      }

      const gradient = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, radius * 0.1, x, y, radius);
      gradient.addColorStop(0, palette.colorNear);
      gradient.addColorStop(1, palette.colorFar);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();

      // Surface bands + a day/night terminator, both clipped to the planet's
      // disc, are what turn the flat gradient fill into something that reads
      // as a lit sphere with texture rather than a plain shaded ball.
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.clip();

      const bandCount = 4;
      ctx.fillStyle = palette.bandColor;
      for (let band = 0; band < bandCount; band++) {
        const bandSeed = planetIndex * 19.7 + band * 7.3;
        const bandY = y - radius + hash01(bandSeed + 61) * radius * 2;
        const bandHeight = radius * (0.12 + hash01(bandSeed + 67) * 0.22);
        ctx.globalAlpha = 0.1 + hash01(bandSeed + 73) * 0.16;
        ctx.fillRect(x - radius, bandY, radius * 2, bandHeight);
      }

      const shadowCenterX = x + radius * 0.45;
      const shadowCenterY = y + radius * 0.45;
      const terminator = ctx.createRadialGradient(
        shadowCenterX,
        shadowCenterY,
        radius * 0.15,
        shadowCenterX,
        shadowCenterY,
        radius * 1.3,
      );
      terminator.addColorStop(0, 'rgba(6, 8, 24, 0)');
      terminator.addColorStop(1, 'rgba(6, 8, 24, 0.6)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = terminator;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      ctx.restore();
      ctx.globalAlpha = 1;

      if (planet.ring) {
        this.renderPlanetRing(ctx, x, y, radius, planet.ring, 'front');
      }
    });
  }

  // Draws one half of a planet's ring, clipped above/below the planet's
  // center so the ring can be layered behind the planet on one call and in
  // front of it on another -- giving the ring proper depth around the disc.
  private renderPlanetRing(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    planetRadius: number,
    ring: PlanetRing,
    side: 'back' | 'front',
  ): void {
    const radiusX = planetRadius * ring.radiusXRatio;
    const radiusY = planetRadius * ring.radiusYRatio;
    const clipMargin = radiusX * 2;
    ctx.save();
    ctx.beginPath();
    if (side === 'back') {
      ctx.rect(x - clipMargin, y - clipMargin, clipMargin * 2, clipMargin);
    } else {
      ctx.rect(x - clipMargin, y, clipMargin * 2, clipMargin);
    }
    ctx.clip();
    ctx.beginPath();
    ctx.ellipse(x, y, radiusX, radiusY, ring.tilt, 0, Math.PI * 2);
    ctx.strokeStyle = ring.color;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = Math.max(1, planetRadius * 0.12);
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // Draws the ball as an Outer Wilds-style comet: a glowing core plus a tail
  // that points opposite the current velocity and grows longer/brighter with
  // speed. Purely visual -- collision radius/position/physics are untouched.
  private renderComet(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    vx: number,
    vy: number,
    radius: number,
    baseSpeed: number,
  ): void {
    const speed = Math.hypot(vx, vy);
    const speedFactor = baseSpeed > 0 ? clamp(speed / baseSpeed, 0, COMET_MAX_SPEED_FACTOR) : 0;

    // Points opposite the velocity vector; falls back to straight up when
    // the ball is momentarily stationary (e.g. during the pre-serve pause).
    const dirX = speed > 1e-3 ? -vx / speed : 0;
    const dirY = speed > 1e-3 ? -vy / speed : -1;

    const tailLength = radius * (COMET_TAIL_BASE_LENGTH_RATIO + COMET_TAIL_SPEED_LENGTH_RATIO * speedFactor);
    const tailOpacity = clamp(COMET_TAIL_BASE_OPACITY + COMET_TAIL_SPEED_OPACITY * speedFactor, 0, 0.9);
    const tipX = x + dirX * tailLength;
    const tipY = y + dirY * tailLength;
    const perpX = -dirY * radius * 0.85;
    const perpY = dirX * radius * 0.85;

    const tailGradient = ctx.createLinearGradient(x, y, tipX, tipY);
    tailGradient.addColorStop(0, `rgba(214, 228, 255, ${tailOpacity})`);
    tailGradient.addColorStop(1, 'rgba(214, 228, 255, 0)');
    ctx.fillStyle = tailGradient;
    ctx.beginPath();
    ctx.moveTo(x + perpX, y + perpY);
    ctx.lineTo(x - perpX, y - perpY);
    ctx.lineTo(tipX, tipY);
    ctx.closePath();
    ctx.fill();

    const glowRadius = radius * COMET_GLOW_RADIUS_RATIO;
    const glowGradient = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
    glowGradient.addColorStop(0, 'rgba(214, 228, 255, 0.9)');
    glowGradient.addColorStop(0.4, 'rgba(120, 170, 255, 0.35)');
    glowGradient.addColorStop(1, 'rgba(120, 170, 255, 0)');
    ctx.fillStyle = glowGradient;
    ctx.beginPath();
    ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
    ctx.fill();

    const coreGradient = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, 0, x, y, radius);
    coreGradient.addColorStop(0, '#ffffff');
    coreGradient.addColorStop(0.5, '#cfe0ff');
    coreGradient.addColorStop(1, '#5b8cff');
    ctx.fillStyle = coreGradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draws a paddle as a rounded, gradient-shaded bar with a drop shadow and a
  // highlight strip near the top edge, so it reads as a raised 3D bar instead
  // of a flat rectangle. Purely visual -- paddle position/width are untouched.
  private renderPaddle(ctx: CanvasRenderingContext2D, centerX: number, centerY: number, halfWidth: number, paddleHeight: number): void {
    const x = centerX - halfWidth;
    const y = centerY - paddleHeight / 2;
    const w = halfWidth * 2;

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = paddleHeight * 1.4;
    ctx.shadowOffsetY = paddleHeight * 0.9;
    const gradient = ctx.createLinearGradient(x, y, x, y + paddleHeight);
    gradient.addColorStop(0, '#eaf2ff');
    gradient.addColorStop(0.45, '#8ecae6');
    gradient.addColorStop(1, '#2a6f97');
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, w, paddleHeight);
    ctx.restore();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fillRect(x + w * 0.06, y + paddleHeight * 0.12, w * 0.88, paddleHeight * 0.22);
  }

  // Draws one shrinking buff bar on the outer side of a paddle (above paddle 1,
  // below paddle 2), stacked by `slot` when a paddle carries more than one
  // active buff. `progress` is remaining/duration, so the bar empties exactly
  // as the buff expires.
  private renderBuffIndicator(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    edgeY: number,
    direction: 1 | -1,
    halfWidth: number,
    paddleHeight: number,
    slot: number,
    progress: number,
    color: string,
  ): void {
    const barHeight = paddleHeight * BUFF_INDICATOR_HEIGHT_RATIO;
    const offset = paddleHeight * (BUFF_INDICATOR_GAP_RATIO + slot * BUFF_INDICATOR_SPACING_RATIO);
    const y = edgeY + direction * offset;
    const barWidth = halfWidth * 2 * clamp(progress, 0, 1);
    ctx.fillStyle = color;
    ctx.fillRect(centerX - barWidth / 2, y - barHeight / 2, barWidth, barHeight);
  }

  // Renders the buff bars for one paddle: a distinct color per buff type,
  // reading `speedBoostRemaining*`/`giantPaddleRemaining*` without touching
  // the multipliers those fields also gate.
  private renderPaddleBuffs(
    ctx: CanvasRenderingContext2D,
    paddle: PaddleId,
    centerX: number,
    edgeY: number,
    halfWidth: number,
    paddleHeight: number,
  ): void {
    const direction: 1 | -1 = paddle === 1 ? -1 : 1;
    let slot = 0;
    const speedRemaining = paddle === 1 ? this.speedBoostRemaining1 : this.speedBoostRemaining2;
    if (speedRemaining > 0) {
      const progress = speedRemaining / SPEED_BOOST_DURATION_SECONDS;
      this.renderBuffIndicator(
        ctx,
        centerX,
        edgeY,
        direction,
        halfWidth,
        paddleHeight,
        slot,
        progress,
        POWER_UP_VISUALS['speed-boost'].color,
      );
      slot += 1;
    }
    const giantRemaining = paddle === 1 ? this.giantPaddleRemaining1 : this.giantPaddleRemaining2;
    if (giantRemaining > 0) {
      const progress = giantRemaining / GIANT_PADDLE_DURATION_SECONDS;
      this.renderBuffIndicator(
        ctx,
        centerX,
        edgeY,
        direction,
        halfWidth,
        paddleHeight,
        slot,
        progress,
        POWER_UP_VISUALS['giant-paddle'].color,
      );
      slot += 1;
    }
  }

  // Draws active collision flashes/particle bursts (see `impacts`); each one
  // fades and expands as `impact.age` approaches IMPACT_DURATION_SECONDS.
  private renderImpacts(ctx: CanvasRenderingContext2D, height: number): void {
    if (this.impacts.length === 0) {
      return;
    }
    const baseRadius = height * BALL_RADIUS_RATIO;
    for (const impact of this.impacts) {
      const t = clamp(impact.age / IMPACT_DURATION_SECONDS, 0, 1);
      const fade = 1 - t;
      const color = impact.kind === 'paddle' ? '255, 255, 255' : '255, 214, 102';

      const flashRadius = baseRadius * (1.2 + t * 2.2);
      const flashGradient = ctx.createRadialGradient(impact.x, impact.y, 0, impact.x, impact.y, flashRadius);
      flashGradient.addColorStop(0, `rgba(${color}, ${0.65 * fade})`);
      flashGradient.addColorStop(1, `rgba(${color}, 0)`);
      ctx.fillStyle = flashGradient;
      ctx.beginPath();
      ctx.arc(impact.x, impact.y, flashRadius, 0, Math.PI * 2);
      ctx.fill();

      const particleDistance = baseRadius * (0.6 + t * 3);
      const particleRadius = baseRadius * 0.22 * fade;
      ctx.fillStyle = `rgba(${color}, ${0.8 * fade})`;
      for (let i = 0; i < IMPACT_PARTICLE_COUNT; i += 1) {
        const angle = (Math.PI * 2 * i) / IMPACT_PARTICLE_COUNT;
        const px = impact.x + Math.cos(angle) * particleDistance;
        const py = impact.y + Math.sin(angle) * particleDistance;
        ctx.beginPath();
        ctx.arc(px, py, particleRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Draws the one-time win-screen particle burst: each WIN_PARTICLES entry
  // radiates outward from the canvas center and fades as `elapsed` (seconds
  // since `winner` became non-null) approaches WIN_CELEBRATION_DURATION_SECONDS,
  // following the same age-driven fade/expand approach as renderImpacts.
  // Purely visual -- reads winCelebrationElapsed without touching win state.
  private renderWinCelebration(ctx: CanvasRenderingContext2D, width: number, height: number, elapsed: number): void {
    const t = clamp(elapsed / WIN_CELEBRATION_DURATION_SECONDS, 0, 1);
    if (t >= 1) {
      return;
    }
    const eased = 1 - (1 - t) * (1 - t);
    const fade = 1 - t;
    const centerX = width / 2;
    const centerY = height / 2;
    const minSide = Math.min(width, height);
    const baseRadius = height * BALL_RADIUS_RATIO;

    ctx.save();
    for (const particle of WIN_PARTICLES) {
      const distance = eased * particle.distanceRatio * minSide;
      const angle = particle.angle + elapsed * particle.spinSpeed;
      const px = centerX + Math.cos(angle) * distance;
      const py = centerY + Math.sin(angle) * distance;
      const radius = baseRadius * particle.sizeRatio * fade;
      ctx.globalAlpha = fade;
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Draws the pre-serve countdown ring, centered on the ball's serve
  // position. Shrinks and brightens as `serveDelayRemaining` counts down to
  // zero; purely visual, reads existing state without touching serve timing.
  private renderServeCountdown(ctx: CanvasRenderingContext2D, x: number, y: number, ballRadius: number): void {
    const progress = 1 - clamp(this.serveDelayRemaining / SERVE_DELAY_SECONDS, 0, 1);
    const ringRadius = ballRadius + ballRadius * (SERVE_COUNTDOWN_RING_MAX_RADIUS_RATIO - 1) * (1 - progress);
    const opacity = 0.25 + 0.65 * progress;
    ctx.save();
    ctx.strokeStyle = `rgba(232, 236, 245, ${opacity})`;
    ctx.lineWidth = ballRadius * SERVE_COUNTDOWN_RING_LINE_WIDTH_RATIO;
    ctx.beginPath();
    ctx.arc(x, y, ringRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Draws a soft, borderless panel centered at (centerX, centerY) that frames
  // a score number, so it reads as sitting inside a designed treatment
  // rather than floating unframed on the backdrop. Purely visual.
  private renderScorePanel(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    panelWidth: number,
    panelHeight: number,
    radius: number,
  ): void {
    const x = centerX - panelWidth / 2;
    const y = centerY - panelHeight / 2;
    ctx.save();
    const vignette = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, panelWidth / 2);
    vignette.addColorStop(0, 'rgba(232, 236, 245, 0.10)');
    vignette.addColorStop(1, 'rgba(232, 236, 245, 0)');
    ctx.fillStyle = vignette;
    ctx.beginPath();
    ctx.roundRect(x, y, panelWidth, panelHeight, radius);
    ctx.fill();
    ctx.strokeStyle = 'rgba(232, 236, 245, 0.22)';
    ctx.lineWidth = panelHeight * 0.02;
    ctx.stroke();
    ctx.restore();
  }

  // Draws the HUD: a dashed center-court divider separating the two players'
  // halves, plus a score panel behind each score. Drawn above the backdrop
  // but below the paddles/ball/impacts so it never obstructs gameplay.
  private renderHud(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.save();
    ctx.strokeStyle = 'rgba(232, 236, 245, 0.18)';
    ctx.lineWidth = height * HUD_DIVIDER_LINE_WIDTH_RATIO;
    ctx.setLineDash([width * HUD_DIVIDER_DASH_RATIO, width * HUD_DIVIDER_GAP_RATIO]);
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();
    ctx.restore();

    const panelWidth = width * HUD_PANEL_WIDTH_RATIO;
    const panelHeight = height * HUD_PANEL_HEIGHT_RATIO;
    const panelRadius = panelHeight * HUD_PANEL_RADIUS_RATIO;
    this.renderScorePanel(ctx, width / 2, height * 0.28, panelWidth, panelHeight, panelRadius);
    this.renderScorePanel(ctx, width / 2, height * 0.72, panelWidth, panelHeight, panelRadius);
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    this.ensureInitialized(width, height);

    ctx.clearRect(0, 0, width, height);

    // Screen shake offsets everything below via a canvas transform, never
    // paddle/ball state. The background rect is overdrawn by the max shake
    // margin on every side so the shifted frame still fully covers the
    // canvas instead of leaving a sliver of the previous frame visible.
    const shakeMargin = height * SCREEN_SHAKE_AMPLITUDE_RATIO;
    const shakeT = this.screenShakeRemaining / SCREEN_SHAKE_DURATION_SECONDS;
    const shakeAmount = shakeMargin * shakeT;
    ctx.save();
    ctx.translate((Math.random() * 2 - 1) * shakeAmount, (Math.random() * 2 - 1) * shakeAmount);

    ctx.fillStyle = this.selectedMap ? MAP_THEMES[this.selectedMap].backgroundColor : DEFAULT_BACKGROUND_COLOR;
    ctx.fillRect(-shakeMargin, -shakeMargin, width + shakeMargin * 2, height + shakeMargin * 2);
    this.renderBackdrop(ctx, width, height);
    this.renderHud(ctx, width, height);

    const paddle1HalfWidth = this.paddleWidth(1, width) / 2;
    const paddle2HalfWidth = this.paddleWidth(2, width) / 2;
    const paddleHeight = height * PADDLE_HEIGHT_RATIO;
    const paddle1Y = height * PADDLE_MARGIN_RATIO;
    const paddle2Y = height * (1 - PADDLE_MARGIN_RATIO);

    this.renderPaddle(ctx, this.paddle1X, paddle1Y, paddle1HalfWidth, paddleHeight);
    this.renderPaddle(ctx, this.paddle2X, paddle2Y, paddle2HalfWidth, paddleHeight);
    this.renderPaddleBuffs(ctx, 1, this.paddle1X, paddle1Y, paddle1HalfWidth, paddleHeight);
    this.renderPaddleBuffs(ctx, 2, this.paddle2X, paddle2Y, paddle2HalfWidth, paddleHeight);

    const ballRadius = height * BALL_RADIUS_RATIO;
    const cometBaseSpeed = height * BALL_SPEED_RATIO;
    const balls: Ball[] = [{ x: this.ballX, y: this.ballY, vx: this.ballVX, vy: this.ballVY }, ...this.extraBalls];
    for (const ball of balls) {
      this.renderComet(ctx, ball.x, ball.y, ball.vx, ball.vy, ballRadius, cometBaseSpeed);
    }
    this.renderImpacts(ctx, height);

    if (this.serveDelayRemaining > 0) {
      this.renderServeCountdown(ctx, this.ballX, this.ballY, ballRadius);
    }

    if (this.activePowerUp !== null) {
      const powerUpRadius = height * POWER_UP_RADIUS_RATIO;
      const visual = POWER_UP_VISUALS[this.activePowerUp.kind];
      const pulse = 0.5 + 0.5 * Math.sin(this.backdropTime * POWER_UP_PULSE_SPEED);
      const drawRadius = powerUpRadius * (1 + POWER_UP_PULSE_SCALE_RATIO * pulse);
      const drawX = this.activePowerUp.x;
      const drawY = this.activePowerUp.y + Math.sin(this.backdropTime * POWER_UP_BOB_SPEED) * powerUpRadius * POWER_UP_BOB_RATIO;

      const glowGradient = ctx.createRadialGradient(drawX, drawY, 0, drawX, drawY, drawRadius * POWER_UP_GLOW_RADIUS_RATIO);
      glowGradient.addColorStop(0, visual.glow);
      glowGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = glowGradient;
      ctx.beginPath();
      ctx.arc(drawX, drawY, drawRadius * POWER_UP_GLOW_RADIUS_RATIO, 0, Math.PI * 2);
      ctx.fill();

      const coreGradient = ctx.createRadialGradient(drawX - drawRadius * 0.3, drawY - drawRadius * 0.3, 0, drawX, drawY, drawRadius);
      coreGradient.addColorStop(0, visual.highlight);
      coreGradient.addColorStop(1, visual.color);
      ctx.fillStyle = coreGradient;
      ctx.beginPath();
      ctx.arc(drawX, drawY, drawRadius, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#0a1128';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      applyTextStyle(ctx, 'primary', drawRadius * 1.2);
      ctx.fillText(visual.label, drawX, drawY);
    }

    ctx.save();
    ctx.fillStyle = '#e8ecf5';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(120, 170, 255, 0.85)';
    ctx.shadowBlur = height * 0.025;
    applyTextStyle(ctx, 'primary', height * 0.05);
    ctx.fillText(String(this.score1), width / 2, height * 0.28);
    ctx.fillText(String(this.score2), width / 2, height * 0.72);
    ctx.restore();

    if (this.titleScreenActive) {
      ctx.fillStyle = 'rgba(10, 17, 40, 0.55)';
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.fillStyle = '#e8ecf5';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(120, 170, 255, 0.85)';
      ctx.shadowBlur = height * 0.025;
      applyTextStyle(ctx, 'primary', height * 0.06);
      ctx.fillText(GAME_TITLE, width / 2, height / 2 - height * 0.04);
      ctx.restore();

      ctx.save();
      ctx.fillStyle = '#e8ecf5';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(120, 170, 255, 0.85)';
      ctx.shadowBlur = height * 0.02;
      applyTextStyle(ctx, 'secondary', height * 0.025);
      ctx.fillText('Tap to start', width / 2, height / 2 + height * 0.04);
      ctx.restore();
    }

    if (this.mapSelectActive) {
      ctx.fillStyle = 'rgba(10, 17, 40, 0.55)';
      ctx.fillRect(0, 0, width, height);

      const themes = Object.values(MAP_THEMES);
      const firstRect = this.mapButtonRect(0, width, height);

      ctx.save();
      ctx.fillStyle = '#e8ecf5';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(120, 170, 255, 0.85)';
      ctx.shadowBlur = height * 0.02;
      applyTextStyle(ctx, 'secondary', height * 0.03);
      ctx.fillText('Choose your map', width / 2, firstRect.y - height * 0.06);
      ctx.restore();

      themes.forEach((theme, i) => {
        const rect = this.mapButtonRect(i, width, height);
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(rect.x, rect.y, rect.w, rect.h, rect.h * 0.25);
        ctx.fillStyle = theme.backgroundColor;
        ctx.fill();
        ctx.strokeStyle = 'rgba(232, 236, 245, 0.35)';
        ctx.lineWidth = Math.max(1, rect.h * 0.04);
        ctx.stroke();

        ctx.fillStyle = '#e8ecf5';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        applyTextStyle(ctx, 'primary', rect.h * 0.4);
        ctx.fillText(theme.label, rect.x + rect.w / 2, rect.y + rect.h / 2);
        ctx.restore();
      });
    }

    if (this.winner !== null) {
      ctx.fillStyle = 'rgba(10, 17, 40, 0.85)';
      ctx.fillRect(0, 0, width, height);

      this.renderWinCelebration(ctx, width, height, this.winCelebrationElapsed);

      // Title scales/fades in over WIN_TITLE_ENTRANCE_DURATION_SECONDS, then
      // settles at scale=1/alpha=1 -- the same static look as before this
      // animation existed.
      const entranceT = clamp(this.winCelebrationElapsed / WIN_TITLE_ENTRANCE_DURATION_SECONDS, 0, 1);
      const entranceEased = 1 - (1 - entranceT) * (1 - entranceT) * (1 - entranceT);
      ctx.save();
      ctx.fillStyle = '#e8ecf5';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(120, 170, 255, 0.85)';
      ctx.shadowBlur = height * 0.02;
      ctx.globalAlpha = entranceEased;
      ctx.translate(width / 2, height / 2 - height * 0.04);
      ctx.scale(0.6 + 0.4 * entranceEased, 0.6 + 0.4 * entranceEased);
      applyTextStyle(ctx, 'primary', height * 0.045);
      ctx.fillText(`Player ${this.winner} wins`, 0, 0);
      ctx.restore();

      ctx.save();
      ctx.fillStyle = '#e8ecf5';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(120, 170, 255, 0.85)';
      ctx.shadowBlur = height * 0.02;
      applyTextStyle(ctx, 'secondary', height * 0.025);
      ctx.fillText('Tap to play again', width / 2, height / 2 + height * 0.04);
      ctx.restore();
    }

    ctx.restore();
  }
}
