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

type Rect = { x: number; y: number; w: number; h: number };

function rectContains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

// Uniform shrink applied to a menu button's rect while pressed (issue #77):
// gives tactile "pushed down" feedback since fill/border/icon/label are all
// derived from the rect passed to each button's render function.
const PRESSED_BUTTON_SCALE = 0.94;

function shrinkRectForPress(rect: Rect): Rect {
  const w = rect.w * PRESSED_BUTTON_SCALE;
  const h = rect.h * PRESSED_BUTTON_SCALE;
  return { x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w, h };
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

// Paddle buff/debuff indicators: purely cosmetic bars drawn on the outer side
// of an affected paddle, read from `freezeRemaining*`/`giantPaddleRemaining*`
// and scaled against the matching *_DURATION_SECONDS constant. They never
// feed back into `paddleSpeedMultiplier*`/`paddleWidthMultiplier*` or collisions.
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
export const FREEZE_PADDLE_MULTIPLIER = 0.4; // fraction of normal paddle speed while frozen
export const FREEZE_PADDLE_DURATION_SECONDS = 4;
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

// Earth theme (#68): soft fluffy clouds drift across the upper sky, giving
// the "fun" backdrop the stakeholder asked for instead of a recolored
// starfield. Positions wrap horizontally as `backdropTime` advances.
const CLOUD_COUNT = 6;
interface Cloud {
  xRatio: number;
  yRatio: number;
  scale: number;
  speedRatio: number; // canvas-widths per second, drifting left-to-right
}
const CLOUDS: Cloud[] = Array.from({ length: CLOUD_COUNT }, (_, i) => ({
  xRatio: hash01(i * 4.7 + 11),
  yRatio: 0.05 + hash01(i * 6.3 + 13) * 0.18,
  scale: 0.6 + hash01(i * 8.1 + 17) * 0.8,
  speedRatio: 0.015 + hash01(i * 2.9 + 19) * 0.02,
}));

// Mars theme (#68): a thin reddish dust haze drifts diagonally across the
// backdrop, evoking the Outer Wilds-style harsh, dusty look the ticket asked
// for instead of a recolored starfield.
const DUST_STREAK_COUNT = 10;
interface DustStreak {
  xRatio: number;
  yRatio: number;
  lengthRatio: number; // fraction of canvas width
  speedRatio: number; // canvas-widths per second
  angle: number; // radians
}
const DUST_STREAKS: DustStreak[] = Array.from({ length: DUST_STREAK_COUNT }, (_, i) => ({
  xRatio: hash01(i * 5.9 + 23),
  yRatio: hash01(i * 3.3 + 29),
  lengthRatio: 0.04 + hash01(i * 7.1 + 31) * 0.06,
  speedRatio: 0.03 + hash01(i * 9.7 + 37) * 0.04,
  angle: Math.PI * 0.15 + hash01(i * 4.1 + 41) * Math.PI * 0.1,
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

// Subtle procedural grain layered over the backdrop and menu panels so they
// read as textured material rather than flat digital fills (#88). The tile
// is generated once from a deterministic hash (same convention as the
// starfield) and cached as a repeating CanvasPattern -- redoing per-pixel
// noise every frame would be wasteful for a purely decorative overlay.
const GRAIN_TILE_SIZE = 64;
const GRAIN_BACKDROP_ALPHA = 0.05;
const GRAIN_PANEL_ALPHA = 0.16;
let grainPatternCache: CanvasPattern | null = null;

function getGrainPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (grainPatternCache) {
    return grainPatternCache;
  }
  if (typeof OffscreenCanvas === 'undefined') {
    return null;
  }
  const tile = new OffscreenCanvas(GRAIN_TILE_SIZE, GRAIN_TILE_SIZE);
  const tileCtx = tile.getContext('2d');
  if (!tileCtx) {
    return null;
  }
  const imageData = tileCtx.createImageData(GRAIN_TILE_SIZE, GRAIN_TILE_SIZE);
  for (let p = 0; p < GRAIN_TILE_SIZE * GRAIN_TILE_SIZE; p++) {
    const shade = Math.floor(hash01(p * 12.9898 + 78.233) * 255);
    const i = p * 4;
    imageData.data[i] = shade;
    imageData.data[i + 1] = shade;
    imageData.data[i + 2] = shade;
    imageData.data[i + 3] = 255;
  }
  tileCtx.putImageData(imageData, 0, 0);
  grainPatternCache = ctx.createPattern(tile, 'repeat');
  return grainPatternCache;
}

// Fills `w`x`h` at (x, y) with the cached grain pattern using 'overlay'
// blending, so it reads as material texture (darkening/lightening what's
// underneath) instead of a flat translucent haze on top of it. Callers that
// need it confined to a shape (e.g. a rounded panel) should clip before
// calling. No-ops if OffscreenCanvas isn't available (#88).
function renderGrain(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, alpha: number): void {
  const pattern = getGrainPattern(ctx);
  if (!pattern) {
    return;
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = pattern;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
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
const MARS_TUMBLE_SPEED = 0.35; // radians/sec the Mars surface texture rotates by, evoking a slowly tumbling body
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
// which swaps the backdrop's background color/palette below and, per-theme
// (#68), its backdrop elements and motion too -- see `renderEarthBackdrop`/
// `renderMarsBackdrop`. Gameplay (ball/paddle/power-ups) never reads
// `selectedMap` or these palettes.
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

// Pause button (#70): a small tappable icon shown only during an active
// match (never on title/map-select/win screens), sized as a comfortable
// one-thumb tap target. Docked on the right edge, vertically centered (#79)
// so it sits clear of both paddles' full-height touch/drag zones instead of
// inside the top player's.
const PAUSE_BUTTON_SIZE_RATIO = 0.07; // fraction of canvas height
const PAUSE_BUTTON_MARGIN_RATIO = 0.025; // distance from the right edge, fraction of canvas height

// Pause overlay (#70): three stacked, thumb-reachable action buttons --
// Resume, Restart Match, Quit to Title -- styled like the map-select cards
// so the overlay reads as the same designed menu system (issue #67).
const PAUSE_OVERLAY_BUTTON_WIDTH_RATIO = 0.62; // fraction of canvas width
const PAUSE_OVERLAY_BUTTON_HEIGHT_RATIO = 0.085; // fraction of canvas height
const PAUSE_OVERLAY_BUTTON_GAP_RATIO = 0.03; // fraction of canvas height, between buttons
const PAUSE_OVERLAY_HEADING_GAP_RATIO = 0.06; // gap between the "Paused" heading and the first button, fraction of canvas height
const PAUSE_OVERLAY_PANEL_TOP_PADDING_RATIO = 0.05; // fraction of canvas height, above the heading
const PAUSE_OVERLAY_PANEL_BOTTOM_PADDING_RATIO = 0.05; // fraction of canvas height, below the last button

type PauseAction = 'resume' | 'map' | 'settings' | 'restart' | 'quit';
const PAUSE_ACTIONS: { action: PauseAction; label: string }[] = [
  { action: 'resume', label: 'Resume' },
  { action: 'map', label: 'Change Map' },
  { action: 'settings', label: 'Settings' },
  { action: 'restart', label: 'Restart Match' },
  { action: 'quit', label: 'Quit to Title' },
];

// Mode select (#80): a two-button stacked screen, styled like the pause
// overlay, shown right after a map is picked and before the first serve.
// "2 Player" preserves the pre-existing touch-both-paddles behavior; "1
// Player" only sets the `singlePlayer` flag here -- the AI that drives the
// top paddle from it is a companion ticket's responsibility.
type ModeSelectAction = 'one-player' | 'two-player';
const MODE_SELECT_ACTIONS: { action: ModeSelectAction; label: string }[] = [
  { action: 'one-player', label: '1 Player' },
  { action: 'two-player', label: '2 Player' },
];

// Pause > Settings (#71): a single stacked-button screen, styled like the
// pause overlay itself, exposing session-scoped options (currently just the
// WebAudio sound toggle) without leaving the paused match.
type PauseSettingsAction = 'toggle-sound' | 'back';
const PAUSE_SETTINGS_ACTIONS: { action: PauseSettingsAction }[] = [{ action: 'toggle-sound' }, { action: 'back' }];

// Shared menu identity: the title and map-select screens both draw inside a
// bordered, vignetted panel topped by the same orbiting-icon flourish, so
// they read as one designed system instead of two disconnected overlays
// (issue #67).
const MENU_PANEL_WIDTH_RATIO = 0.78; // fraction of canvas width
const MENU_PANEL_RADIUS_RATIO = 0.08; // fraction of panel height, corner radius
const MENU_TITLE_PANEL_HEIGHT_RATIO = 0.3; // fraction of canvas height
const MAP_SELECT_PANEL_TOP_PADDING_RATIO = 0.052; // fraction of canvas height, above the flourish icon
const MAP_SELECT_PANEL_BOTTOM_PADDING_RATIO = 0.05; // fraction of canvas height, below the last map card
const MENU_ICON_ORBIT_RADIUS_RATIO = 0.032; // fraction of canvas height
const MENU_ICON_CORE_RADIUS_RATIO = 0.013; // fraction of canvas height
const MENU_ICON_DOT_RADIUS_RATIO = 0.008; // fraction of canvas height
const MENU_ICON_ORBIT_SPEED = 1.4; // radians/second

// Map-select card iconography: a small themed "planet" swatch to the left of
// each map's label, hinting at the map beyond a plain text button.
const MAP_CARD_ICON_RADIUS_RATIO = 0.32; // fraction of card height
const MAP_CARD_ICON_MARGIN_RATIO = 0.55; // fraction of card height, icon center from the card's left edge

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

// Pure so it can be unit tested directly: like `orbitPosition`, but the
// orbit radius itself stretches and compresses as the angle advances,
// tracing an elongated, comet-like path instead of a smooth ellipse --
// used by the Mars/Outer-Wilds-inspired backdrop so its bodies read as
// eccentric orbiters rather than the default map's calm circular drift.
export function eccentricOrbitPosition(
  centerX: number,
  centerY: number,
  orbitRadius: number,
  angularSpeed: number,
  phase: number,
  time: number,
): { x: number; y: number } {
  const angle = phase + angularSpeed * time;
  const stretch = 1 + 0.4 * Math.cos(angle * 2);
  return {
    x: centerX + Math.cos(angle) * orbitRadius * stretch,
    y: centerY + Math.sin(angle) * orbitRadius * 0.55 * (2 - stretch),
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

export type PowerUpKind = 'freeze-paddle' | 'fast-ball' | 'giant-paddle' | 'multi-ball';

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
  { kind: 'freeze-paddle', activate: (game) => game.activateFreezePaddle() },
  { kind: 'fast-ball', activate: (game) => game.activateFastBall() },
  { kind: 'giant-paddle', activate: (game) => game.activateGiantPaddle() },
  { kind: 'multi-ball', activate: (game) => game.activateMultiBall() },
];

export const POWER_UP_KINDS: readonly PowerUpKind[] = POWER_UP_DEFINITIONS.map((entry) => entry.kind);

const POWER_UP_VISUALS: Record<PowerUpKind, { color: string; highlight: string; glow: string; label: string }> = {
  'freeze-paddle': { color: '#48cae4', highlight: '#caf0f8', glow: 'rgba(72, 202, 228, 0.55)', label: 'Z' },
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
  modeSelectActive = false; // shown right after a map is picked, dismissed by choosing 1 or 2 Player
  singlePlayer = false; // true once "1 Player" is chosen; reset to false (and reselectable) on Quit to Title
  paused = false; // true while the pause overlay (#70) is up; freezes ball/paddle/power-up updates
  pauseMapSelectActive = false; // true while Change Map (#71) is up, shown from within the pause overlay
  pauseSettingsActive = false; // true while Settings (#71) is up, shown from within the pause overlay
  soundEnabled = true; // toggled from Pause > Settings (#71); gates playSound() calls in main.ts, persists for the session
  // Menu buttons "arm" on pointerdown and only take effect on pointerup, so a
  // pressed visual can render for the full duration of the hold instead of
  // being replaced by the resulting screen on the very same event (#77).
  // pressedButtonKey identifies the armed button (e.g. 'pause-icon' or
  // 'map-select:0') for render() to compare against; null means no button is
  // currently pressed.
  pressedPointerId: number | null = null;
  pressedButtonKey: string | null = null;

  activePowerUp: PowerUp | null = null;
  lastPaddleTouch: PaddleId | null = null; // paddle that most recently hit the ball this rally
  paddleSpeedMultiplier1 = 1;
  paddleSpeedMultiplier2 = 1;
  freezeRemaining1 = 0;
  freezeRemaining2 = 0;
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
  // The armed button's rect (for move-off cancellation) and the mutation it
  // performs once committed on pointerup -- paired with pressedPointerId
  // above.
  private pressedButtonRect: Rect | null = null;
  private pressedCommit: (() => void) | null = null;

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

  // Shared by restartMatch and quitToTitle: resets score/ball/power-up/buff
  // state, stopping short of either re-serving or touching the title/map
  // screens so each caller can pick what happens next.
  private resetMatchState(): void {
    this.score1 = 0;
    this.score2 = 0;
    this.winner = null;
    this.serveDelayRemaining = 0;
    this.activePowerUp = null;
    this.powerUpSpawnTimer = POWER_UP_SPAWN_INTERVAL_SECONDS;
    this.lastPaddleTouch = null;
    this.paddleSpeedMultiplier1 = 1;
    this.paddleSpeedMultiplier2 = 1;
    this.freezeRemaining1 = 0;
    this.freezeRemaining2 = 0;
    this.paddleWidthMultiplier1 = 1;
    this.paddleWidthMultiplier2 = 1;
    this.giantPaddleRemaining1 = 0;
    this.giantPaddleRemaining2 = 0;
    this.extraBalls = [];
    this.impacts = [];
    this.screenShakeRemaining = 0;
    this.hapticEvents = [];
    this.winCelebrationElapsed = 0;
  }

  private restartMatch(width: number, height: number): void {
    this.resetMatchState();
    this.serve(width, height);
  }

  // Quit to Title (#70): resets the match and returns to the title screen,
  // clearing selectedMap so the player re-picks a map before the next match
  // -- consistent with selectedMap's existing null-until-picked behavior.
  private quitToTitle(): void {
    this.resetMatchState();
    this.selectedMap = null;
    this.titleScreenActive = true;
    this.mapSelectActive = false;
    this.modeSelectActive = false;
    this.singlePlayer = false;
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
  private mapButtonRect(index: number, width: number, height: number): Rect {
    const themeCount = Object.keys(MAP_THEMES).length;
    const w = width * MAP_BUTTON_WIDTH_RATIO;
    const h = height * MAP_BUTTON_HEIGHT_RATIO;
    const gap = height * MAP_BUTTON_GAP_RATIO;
    const totalHeight = h * themeCount + gap * (themeCount - 1);
    const x = (width - w) / 2;
    const y = height / 2 - totalHeight / 2 + index * (h + gap);
    return { x, y, w, h };
  }

  // True only during an active match (never on the title, map-select, or
  // win screens) -- shared by the pause button's visibility/hit-test and its
  // render.
  private isMatchActive(): boolean {
    return !this.titleScreenActive && !this.mapSelectActive && !this.modeSelectActive && this.winner === null;
  }

  private pauseButtonRect(width: number, height: number): Rect {
    const size = height * PAUSE_BUTTON_SIZE_RATIO;
    const margin = height * PAUSE_BUTTON_MARGIN_RATIO;
    return { x: width - margin - size, y: height / 2 - size / 2, w: size, h: size };
  }

  private pauseButtonAt(x: number, y: number, width: number, height: number): boolean {
    if (!this.isMatchActive()) {
      return false;
    }
    return rectContains(this.pauseButtonRect(width, height), x, y);
  }

  // Bounding box of the index-th button in a stack of `count` pause-styled
  // action buttons, shared by the pause overlay and the pause-settings
  // screen so their hit-testing and rendering can never drift apart.
  private stackedActionButtonRect(index: number, count: number, width: number, height: number): Rect {
    const w = width * PAUSE_OVERLAY_BUTTON_WIDTH_RATIO;
    const h = height * PAUSE_OVERLAY_BUTTON_HEIGHT_RATIO;
    const gap = height * PAUSE_OVERLAY_BUTTON_GAP_RATIO;
    const totalHeight = h * count + gap * (count - 1);
    const x = (width - w) / 2;
    const startY = height / 2 - totalHeight / 2 + height * PAUSE_OVERLAY_HEADING_GAP_RATIO * 0.5;
    const y = startY + index * (h + gap);
    return { x, y, w, h };
  }

  // Bounding box of the index-th pause-overlay action button (0 = Resume, in
  // PAUSE_ACTIONS order), shared by hit-testing and rendering.
  private pauseOverlayButtonRect(index: number, width: number, height: number): Rect {
    return this.stackedActionButtonRect(index, PAUSE_ACTIONS.length, width, height);
  }

  // Bounding box of the index-th pause-settings action button (0 = the sound
  // toggle, 1 = Back), shared by hit-testing and rendering.
  private pauseSettingsButtonRect(index: number, width: number, height: number): Rect {
    return this.stackedActionButtonRect(index, PAUSE_SETTINGS_ACTIONS.length, width, height);
  }

  // Arms `key`/`rect`/`commit` as the pointer's pressed button: render() can
  // now show the pressed visual, and the mutation in `commit` only runs once
  // onPointerUp confirms the pointer is still over the same button (#77).
  private armButton(pointerId: number, key: string, rect: Rect, commit: () => void): void {
    this.pressedPointerId = pointerId;
    this.pressedButtonKey = key;
    this.pressedButtonRect = rect;
    this.pressedCommit = commit;
  }

  private isPressed(key: string): boolean {
    return this.pressedButtonKey === key;
  }

  private clearPressedButton(): void {
    this.pressedPointerId = null;
    this.pressedButtonKey = null;
    this.pressedButtonRect = null;
    this.pressedCommit = null;
  }

  // Shared by the pre-match map-select flow and Pause > Change Map (#71),
  // which render/hit-test the exact same button layout but commit to
  // different fields.
  private armMapButton(pointerId: number, x: number, y: number, width: number, height: number, screen: 'map-select' | 'pause-map-select'): void {
    const themes = Object.values(MAP_THEMES);
    for (let i = 0; i < themes.length; i += 1) {
      const rect = this.mapButtonRect(i, width, height);
      if (rectContains(rect, x, y)) {
        const themeId = themes[i].id;
        this.armButton(pointerId, `${screen}:${i}`, rect, () => {
          this.selectedMap = themeId;
          if (screen === 'map-select') {
            this.mapSelectActive = false;
            this.modeSelectActive = true;
          } else {
            // Pause > Change Map (#71): applies the picked map to the
            // backdrop and returns to the pause overlay (still paused)
            // without touching score, ball, or power-up state.
            this.pauseMapSelectActive = false;
          }
        });
        return;
      }
    }
  }

  private armPauseIconButton(pointerId: number, width: number, height: number): void {
    this.armButton(pointerId, 'pause-icon', this.pauseButtonRect(width, height), () => {
      this.paused = true;
    });
  }

  private armPauseOverlayButton(pointerId: number, x: number, y: number, width: number, height: number): void {
    for (let i = 0; i < PAUSE_ACTIONS.length; i += 1) {
      const rect = this.pauseOverlayButtonRect(i, width, height);
      if (rectContains(rect, x, y)) {
        const action = PAUSE_ACTIONS[i].action;
        this.armButton(pointerId, `pause-overlay:${i}`, rect, () => {
          if (action === 'resume') {
            this.paused = false;
          } else if (action === 'map') {
            this.pauseMapSelectActive = true;
          } else if (action === 'settings') {
            this.pauseSettingsActive = true;
          } else if (action === 'restart') {
            this.paused = false;
            this.restartMatch(width, height);
          } else if (action === 'quit') {
            this.paused = false;
            this.quitToTitle();
          }
        });
        return;
      }
    }
  }

  // Bounding box of the index-th mode-select action button (0 = 1 Player, 1
  // = 2 Player), shared by hit-testing and rendering.
  private modeSelectButtonRect(index: number, width: number, height: number): Rect {
    return this.stackedActionButtonRect(index, MODE_SELECT_ACTIONS.length, width, height);
  }

  // Mode select (#80): shown right after a map is picked. Commits
  // `singlePlayer` and starts the pre-serve countdown, mirroring what
  // armMapButton's map-select branch used to do directly before this screen
  // existed.
  private armModeSelectButton(pointerId: number, x: number, y: number, width: number, height: number): void {
    for (let i = 0; i < MODE_SELECT_ACTIONS.length; i += 1) {
      const rect = this.modeSelectButtonRect(i, width, height);
      if (rectContains(rect, x, y)) {
        const action = MODE_SELECT_ACTIONS[i].action;
        this.armButton(pointerId, `mode-select:${i}`, rect, () => {
          this.singlePlayer = action === 'one-player';
          this.modeSelectActive = false;
          this.serveDelayRemaining = SERVE_DELAY_SECONDS;
        });
        return;
      }
    }
  }

  // Pause > Settings (#71): toggles session-scoped options or returns to the
  // pause overlay, without touching match state.
  private armPauseSettingsButton(pointerId: number, x: number, y: number, width: number, height: number): void {
    for (let i = 0; i < PAUSE_SETTINGS_ACTIONS.length; i += 1) {
      const rect = this.pauseSettingsButtonRect(i, width, height);
      if (rectContains(rect, x, y)) {
        const action = PAUSE_SETTINGS_ACTIONS[i].action;
        this.armButton(pointerId, `pause-settings:${i}`, rect, () => {
          if (action === 'toggle-sound') {
            this.soundEnabled = !this.soundEnabled;
          } else if (action === 'back') {
            this.pauseSettingsActive = false;
          }
        });
        return;
      }
    }
  }

  onPointerDown(pointerId: number, x: number, y: number, width: number, height: number): void {
    this.ensureInitialized(width, height);
    if (this.titleScreenActive) {
      this.titleScreenActive = false;
      this.mapSelectActive = true;
      return;
    }
    if (this.mapSelectActive) {
      this.armMapButton(pointerId, x, y, width, height, 'map-select');
      return;
    }
    if (this.modeSelectActive) {
      this.armModeSelectButton(pointerId, x, y, width, height);
      return;
    }
    if (this.pauseMapSelectActive) {
      this.armMapButton(pointerId, x, y, width, height, 'pause-map-select');
      return;
    }
    if (this.pauseSettingsActive) {
      this.armPauseSettingsButton(pointerId, x, y, width, height);
      return;
    }
    if (this.paused) {
      this.armPauseOverlayButton(pointerId, x, y, width, height);
      return;
    }
    if (this.winner !== null) {
      this.restartMatch(width, height);
      return;
    }
    if (this.pauseButtonAt(x, y, width, height)) {
      this.armPauseIconButton(pointerId, width, height);
      return;
    }
    const paddle: PaddleId = y < height / 2 ? 1 : 2;
    if (paddle === 1 && this.singlePlayer) {
      // AI-controlled in single-player mode: ignore touches on the top half.
      return;
    }
    this.pointerPaddle.set(pointerId, paddle);
    this.movePaddle(paddle, x, width);
  }

  // `y` is optional so paddle-drag callers (which only ever move
  // horizontally) don't need to supply it; it's required to detect a held
  // menu button's pointer moving off it, which cancels the press (#77).
  onPointerMove(pointerId: number, x: number, width: number, y?: number): void {
    if (this.pressedPointerId === pointerId) {
      if (y !== undefined && this.pressedButtonRect !== null && !rectContains(this.pressedButtonRect, x, y)) {
        this.clearPressedButton();
      }
      return;
    }
    if (this.paused) {
      return;
    }
    const paddle = this.pointerPaddle.get(pointerId);
    if (paddle === undefined) {
      return;
    }
    this.dragPaddle(paddle, x, width);
  }

  onPointerUp(pointerId: number): void {
    if (this.pressedPointerId === pointerId) {
      const commit = this.pressedCommit;
      this.clearPressedButton();
      commit?.();
      return;
    }
    this.pointerPaddle.delete(pointerId);
  }

  // Distinct from onPointerUp so a cancelled touch (e.g. the OS taking over
  // the gesture) reverts the pressed visual without committing the button's
  // action -- see acceptance criteria on #77.
  onPointerCancel(pointerId: number): void {
    if (this.pressedPointerId === pointerId) {
      this.clearPressedButton();
      return;
    }
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
  // paddle speed is an actual gameplay quantity: Freeze (which scales the
  // limit down for whichever paddle didn't just hit the ball) visibly
  // changes how fast that paddle can catch up.
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

  // Single-player AI (#81): tracks the ball's x position, reusing
  // dragPaddle's per-frame step clamp so it catches up at the same rate a
  // human drag would rather than snapping instantly -- keeps the AI
  // beatable.
  private updateAIPaddle(width: number): void {
    this.dragPaddle(1, this.ballX, width);
  }

  // Slows down whichever paddle did NOT most recently touch the ball, giving
  // the toucher's opponent a harder time catching up to the return volley.
  activateFreezePaddle(): void {
    const toucher = this.lastPaddleTouch;
    if (toucher === null) {
      return;
    }
    const target: PaddleId = toucher === 1 ? 2 : 1;
    if (target === 1) {
      this.paddleSpeedMultiplier1 = FREEZE_PADDLE_MULTIPLIER;
      this.freezeRemaining1 = FREEZE_PADDLE_DURATION_SECONDS;
    } else {
      this.paddleSpeedMultiplier2 = FREEZE_PADDLE_MULTIPLIER;
      this.freezeRemaining2 = FREEZE_PADDLE_DURATION_SECONDS;
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
    const collisionRadius = height * BALL_RADIUS_RATIO + height * POWER_UP_RADIUS_RATIO;
    // Re-roll a spawn point that would land on top of the ball's current
    // position: an icon spawning already inside collision range would be
    // consumed before ever appearing, defeating the point of it being a
    // collectible. A few retries are enough since the ball only rules out a
    // small fraction of the spawn area.
    let x: number;
    let y: number;
    let attempts = 0;
    do {
      x = marginX + Math.random() * (width - marginX * 2);
      y = marginY + Math.random() * (height - marginY * 2);
      attempts += 1;
    } while (
      attempts < 10 &&
      (x - this.ballX) * (x - this.ballX) + (y - this.ballY) * (y - this.ballY) < collisionRadius * collisionRadius
    );
    this.activePowerUp = {
      id: this.nextPowerUpId++,
      kind: definition.kind,
      x,
      y,
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
    // Freeze and Giant Paddle attribute their effect based on whichever
    // paddle last touched the ball. If neither paddle has touched it yet,
    // leave the icon in play instead of silently consuming it for nothing.
    if ((powerUp.kind === 'freeze-paddle' || powerUp.kind === 'giant-paddle') && this.lastPaddleTouch === null) {
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

    if (this.titleScreenActive || this.mapSelectActive || this.modeSelectActive || this.paused) {
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

    if (this.freezeRemaining1 > 0) {
      this.freezeRemaining1 = Math.max(0, this.freezeRemaining1 - dt);
      if (this.freezeRemaining1 === 0) {
        this.paddleSpeedMultiplier1 = 1;
      }
    }
    if (this.freezeRemaining2 > 0) {
      this.freezeRemaining2 = Math.max(0, this.freezeRemaining2 - dt);
      if (this.freezeRemaining2 === 0) {
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

    if (this.singlePlayer) {
      this.updateAIPaddle(width);
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

  // Dispatches to the per-map backdrop. Purely decorative: reads
  // `backdropTime`/`selectedMap` but never touches ball/paddle state. Before
  // a map is picked (title/map-select screens), the shared default backdrop
  // is shown so it stays visually distinct from either selectable theme.
  private renderBackdrop(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    if (this.selectedMap === 'earth') {
      this.renderEarthBackdrop(ctx, width, height);
    } else if (this.selectedMap === 'mars') {
      this.renderMarsBackdrop(ctx, width, height);
    } else {
      this.renderDefaultBackdrop(ctx, width, height);
    }
    renderGrain(ctx, 0, 0, width, height, GRAIN_BACKDROP_ALPHA);
  }

  // Twinkling starfield, shared by all three backdrops -- only the star
  // color/glow tint varies per theme.
  private renderStarfield(ctx: CanvasRenderingContext2D, width: number, height: number, starColor: string, starGlowRgb: string): void {
    const glowGradients = getStarGlowGradients(ctx, width, height, starGlowRgb);
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
  }

  // Shown before a map is picked: the original calm starfield + circular
  // planet orbits, kept exactly as before so it reads as its own neutral
  // backdrop rather than a third theme.
  private renderDefaultBackdrop(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    this.renderStarfield(ctx, width, height, DEFAULT_STAR_COLOR, DEFAULT_STAR_GLOW_RGB);
    const centerX = width * ORBIT_CENTER_X_RATIO;
    const centerY = height * ORBIT_CENTER_Y_RATIO;
    const minSide = Math.min(width, height);
    PLANETS.forEach((planet, planetIndex) => {
      const { x, y } = orbitPosition(
        centerX,
        centerY,
        planet.orbitRadiusRatio * minSide,
        planet.angularSpeed,
        planet.phase,
        this.backdropTime,
      );
      const radius = planet.radiusRatio * height;
      this.renderPlanet(ctx, x, y, radius, DEFAULT_PLANET_PALETTES[planetIndex], planetIndex, planet.ring, 'bands', 0);
    });
  }

  // Earth theme (#68): fluffy drifting clouds plus a small bubbly moon
  // orbiting each planet -- a "fun", lived-in backdrop rather than the
  // default backdrop with swapped colors.
  private renderEarthBackdrop(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const theme = MAP_THEMES.earth;
    this.renderStarfield(ctx, width, height, theme.starColor, theme.starGlowRgb);
    this.renderClouds(ctx, width, height);
    const centerX = width * ORBIT_CENTER_X_RATIO;
    const centerY = height * ORBIT_CENTER_Y_RATIO;
    const minSide = Math.min(width, height);
    PLANETS.forEach((planet, planetIndex) => {
      const { x, y } = orbitPosition(
        centerX,
        centerY,
        planet.orbitRadiusRatio * minSide,
        planet.angularSpeed,
        planet.phase,
        this.backdropTime,
      );
      const radius = planet.radiusRatio * height;
      this.renderPlanet(ctx, x, y, radius, theme.planetPalettes[planetIndex], planetIndex, planet.ring, 'bands', 0);
      this.renderMoon(ctx, x, y, radius, planetIndex);
    });
  }

  // Mars theme (#68), inspired by Outer Wilds: bodies trace elongated,
  // comet-like orbits and slowly tumble, their surfaces cracked rather than
  // banded, under a drifting reddish dust haze -- a harsher, distinct
  // backdrop rather than the default backdrop with swapped colors.
  private renderMarsBackdrop(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const theme = MAP_THEMES.mars;
    this.renderStarfield(ctx, width, height, theme.starColor, theme.starGlowRgb);
    this.renderDustHaze(ctx, width, height);
    const centerX = width * ORBIT_CENTER_X_RATIO;
    const centerY = height * ORBIT_CENTER_Y_RATIO;
    const minSide = Math.min(width, height);
    PLANETS.forEach((planet, planetIndex) => {
      const { x, y } = eccentricOrbitPosition(
        centerX,
        centerY,
        planet.orbitRadiusRatio * minSide,
        planet.angularSpeed,
        planet.phase,
        this.backdropTime,
      );
      const radius = planet.radiusRatio * height;
      const tumble = this.backdropTime * MARS_TUMBLE_SPEED * (planetIndex % 2 === 0 ? 1 : -1);
      this.renderPlanet(ctx, x, y, radius, theme.planetPalettes[planetIndex], planetIndex, planet.ring, 'cracks', tumble);
    });
  }

  // Draws one orbiting body: gradient-shaded sphere, clipped surface
  // texture (theme-dependent), day/night terminator, and optional ring.
  // `textureRotation` slowly spins the texture around the disc's center,
  // independent of the (fixed-direction) terminator shadow, to read as a
  // tumbling body rather than a static shaded ball.
  private renderPlanet(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    palette: PlanetPalette,
    planetIndex: number,
    ring: PlanetRing | undefined,
    texture: 'bands' | 'cracks',
    textureRotation: number,
  ): void {
    if (ring) {
      this.renderPlanetRing(ctx, x, y, radius, ring, 'back');
    }

    const gradient = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, radius * 0.1, x, y, radius);
    gradient.addColorStop(0, palette.colorNear);
    gradient.addColorStop(1, palette.colorFar);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    // Surface texture + a day/night terminator, both clipped to the
    // planet's disc, are what turn the flat gradient fill into something
    // that reads as a lit sphere rather than a plain shaded ball.
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.clip();

    ctx.save();
    if (textureRotation !== 0) {
      ctx.translate(x, y);
      ctx.rotate(textureRotation);
      ctx.translate(-x, -y);
    }
    if (texture === 'cracks') {
      this.renderPlanetCracks(ctx, x, y, radius, planetIndex);
    } else {
      this.renderPlanetBands(ctx, x, y, radius, palette, planetIndex);
    }
    ctx.restore();

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

    if (ring) {
      this.renderPlanetRing(ctx, x, y, radius, ring, 'front');
    }
  }

  // Default/Earth surface texture: soft horizontal bands, tinted from the
  // planet's own palette.
  private renderPlanetBands(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    palette: PlanetPalette,
    planetIndex: number,
  ): void {
    const bandCount = 4;
    ctx.fillStyle = palette.bandColor;
    for (let band = 0; band < bandCount; band++) {
      const bandSeed = planetIndex * 19.7 + band * 7.3;
      const bandY = y - radius + hash01(bandSeed + 61) * radius * 2;
      const bandHeight = radius * (0.12 + hash01(bandSeed + 67) * 0.22);
      ctx.globalAlpha = 0.1 + hash01(bandSeed + 73) * 0.16;
      ctx.fillRect(x - radius, bandY, radius * 2, bandHeight);
    }
    ctx.globalAlpha = 1;
  }

  // Mars/Outer-Wilds surface texture: jagged dark canyon cracks instead of
  // smooth bands, reading as a cratered rock rather than a banded planet.
  private renderPlanetCracks(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, planetIndex: number): void {
    ctx.strokeStyle = 'rgba(40, 12, 6, 0.55)';
    ctx.lineWidth = Math.max(1, radius * 0.05);
    ctx.lineJoin = 'round';
    const crackCount = 5;
    for (let crack = 0; crack < crackCount; crack++) {
      const seed = planetIndex * 31.3 + crack * 11.7;
      const startAngle = hash01(seed + 1) * Math.PI * 2;
      const startRadius = hash01(seed + 2) * radius * 0.6;
      let px = x + Math.cos(startAngle) * startRadius;
      let py = y + Math.sin(startAngle) * startRadius;
      ctx.beginPath();
      ctx.moveTo(px, py);
      const segments = 3 + Math.floor(hash01(seed + 3) * 2);
      for (let seg = 0; seg < segments; seg++) {
        const segSeed = seed + seg * 5.1;
        const angle = hash01(segSeed + 4) * Math.PI * 2;
        const dist = radius * (0.25 + hash01(segSeed + 5) * 0.35);
        px += Math.cos(angle) * dist;
        py += Math.sin(angle) * dist;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }

  // Earth theme: a small bright moon on its own faster orbit around a
  // planet, adding a playful secondary motion the default backdrop lacks.
  private renderMoon(ctx: CanvasRenderingContext2D, planetX: number, planetY: number, planetRadius: number, planetIndex: number): void {
    const moonRadius = planetRadius * 0.28;
    const orbitRadius = planetRadius * 1.9;
    const { x, y } = orbitPosition(planetX, planetY, orbitRadius, 1.1 + planetIndex * 0.3, planetIndex * 2.1, this.backdropTime);
    const gradient = ctx.createRadialGradient(x - moonRadius * 0.3, y - moonRadius * 0.3, 0, x, y, moonRadius);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(1, '#cfe8ff');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, moonRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Earth theme: soft fluffy clouds drifting left-to-right across the upper
  // sky, wrapping around once they exit the right edge.
  private renderClouds(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    for (const cloud of CLOUDS) {
      const driftedX = (((cloud.xRatio + this.backdropTime * cloud.speedRatio) % 1.3) - 0.15) * width;
      const y = cloud.yRatio * height;
      const puffRadius = height * 0.03 * cloud.scale;
      ctx.beginPath();
      ctx.ellipse(driftedX, y, puffRadius * 1.8, puffRadius * 0.7, 0, 0, Math.PI * 2);
      ctx.ellipse(driftedX + puffRadius * 1.1, y - puffRadius * 0.2, puffRadius * 1.2, puffRadius * 0.6, 0, 0, Math.PI * 2);
      ctx.ellipse(driftedX - puffRadius * 1.1, y + puffRadius * 0.1, puffRadius * 1.1, puffRadius * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Mars theme: thin reddish dust streaks drifting diagonally across the
  // backdrop, wrapping around once they exit the field.
  private renderDustHaze(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.strokeStyle = 'rgba(200, 110, 70, 0.25)';
    ctx.lineWidth = Math.max(1, height * 0.004);
    for (const streak of DUST_STREAKS) {
      const driftedX = (((streak.xRatio + this.backdropTime * streak.speedRatio) % 1.2) - 0.1) * width;
      const y = streak.yRatio * height;
      const len = streak.lengthRatio * width;
      ctx.beginPath();
      ctx.moveTo(driftedX, y);
      ctx.lineTo(driftedX + Math.cos(streak.angle) * len, y + Math.sin(streak.angle) * len);
      ctx.stroke();
    }
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
  // reading `freezeRemaining*`/`giantPaddleRemaining*` without touching
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
    const freezeRemaining = paddle === 1 ? this.freezeRemaining1 : this.freezeRemaining2;
    if (freezeRemaining > 0) {
      const progress = freezeRemaining / FREEZE_PADDLE_DURATION_SECONDS;
      this.renderBuffIndicator(
        ctx,
        centerX,
        edgeY,
        direction,
        halfWidth,
        paddleHeight,
        slot,
        progress,
        POWER_UP_VISUALS['freeze-paddle'].color,
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

  // Small orbiting-dot icon shared by the title and map-select screens: a
  // glowing core with one satellite, echoing the backdrop's orbiting planets
  // so both menu screens read as the same designed system (issue #67).
  private renderMenuIcon(ctx: CanvasRenderingContext2D, x: number, y: number, height: number): void {
    const coreRadius = height * MENU_ICON_CORE_RADIUS_RATIO;
    const orbitRadius = height * MENU_ICON_ORBIT_RADIUS_RATIO;
    const dotRadius = height * MENU_ICON_DOT_RADIUS_RATIO;
    const dot = orbitPosition(x, y, orbitRadius, MENU_ICON_ORBIT_SPEED, 0, this.backdropTime);

    ctx.save();
    ctx.strokeStyle = 'rgba(232, 236, 245, 0.3)';
    ctx.lineWidth = Math.max(1, coreRadius * 0.15);
    ctx.beginPath();
    ctx.arc(x, y, orbitRadius, 0, Math.PI * 2);
    ctx.stroke();

    const glow = ctx.createRadialGradient(x, y, 0, x, y, coreRadius * 2.6);
    glow.addColorStop(0, 'rgba(120, 170, 255, 0.85)');
    glow.addColorStop(1, 'rgba(120, 170, 255, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, coreRadius * 2.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#e8ecf5';
    ctx.beginPath();
    ctx.arc(x, y, coreRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, dotRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Draws the bordered, vignetted panel that frames title/map-select
  // content, replacing the plain full-screen tint with a shared "menu card"
  // treatment (issue #67).
  private renderMenuPanel(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    panelWidth: number,
    panelHeight: number,
  ): void {
    const radius = panelHeight * MENU_PANEL_RADIUS_RATIO;
    const x = centerX - panelWidth / 2;
    const y = centerY - panelHeight / 2;
    ctx.save();
    const vignette = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, panelWidth / 2);
    vignette.addColorStop(0, 'rgba(10, 17, 40, 0.7)');
    vignette.addColorStop(1, 'rgba(10, 17, 40, 0.35)');
    ctx.fillStyle = vignette;
    ctx.beginPath();
    ctx.roundRect(x, y, panelWidth, panelHeight, radius);
    ctx.fill();
    // Grained/brushed surface instead of a flat gradient panel (#88); clipped
    // to the panel's own rounded-rect path so it never bleeds past the edge.
    ctx.clip();
    renderGrain(ctx, x, y, panelWidth, panelHeight, GRAIN_PANEL_ALPHA);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, panelWidth, panelHeight, radius);
    ctx.strokeStyle = 'rgba(232, 236, 245, 0.3)';
    ctx.lineWidth = Math.max(1, panelHeight * 0.006);
    ctx.stroke();
    ctx.restore();
  }

  // Strokes a rounded-rect border inset by half the line width, so the
  // outer edge of the drawn stroke lands exactly on `rect` instead of
  // bleeding past it (canvas centers strokes on the path by default). Used
  // by every tappable button so its visible bounds never exceed the AABB
  // used for hit-testing (issue #78).
  private strokeInsetRoundRect(ctx: CanvasRenderingContext2D, rect: Rect, radius: number, lineWidth: number): void {
    const inset = lineWidth / 2;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.roundRect(rect.x + inset, rect.y + inset, rect.w - lineWidth, rect.h - lineWidth, Math.max(0, radius - inset));
    ctx.stroke();
  }

  // Draws one map-select button as a themed card -- gradient fill, glowing
  // border, and a small planet swatch that hints at the map -- replacing the
  // flat filled rectangle + plain label from the original map-select screen
  // (issue #67).
  private renderMapCard(
    ctx: CanvasRenderingContext2D,
    theme: MapTheme,
    rect: Rect,
    pressed: boolean,
  ): void {
    if (pressed) {
      rect = shrinkRectForPress(rect);
    }
    const centerY = rect.y + rect.h / 2;
    const radius = rect.h * 0.25;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, radius);
    const fill = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
    fill.addColorStop(0, theme.backgroundColor);
    fill.addColorStop(1, 'rgba(10, 17, 40, 0.92)');
    ctx.fillStyle = fill;
    ctx.globalAlpha = pressed ? 0.8 : 1;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.shadowColor = `rgba(${theme.starGlowRgb}, 0.45)`;
    ctx.shadowBlur = rect.h * 0.3;
    ctx.strokeStyle = 'rgba(232, 236, 245, 0.4)';
    this.strokeInsetRoundRect(ctx, rect, radius, Math.max(1, rect.h * 0.035));
    ctx.restore();

    const iconRadius = rect.h * MAP_CARD_ICON_RADIUS_RATIO;
    const iconX = rect.x + rect.h * MAP_CARD_ICON_MARGIN_RATIO;
    const palette = theme.planetPalettes[0];
    ctx.save();
    const iconGradient = ctx.createRadialGradient(
      iconX - iconRadius * 0.3,
      centerY - iconRadius * 0.3,
      iconRadius * 0.1,
      iconX,
      centerY,
      iconRadius,
    );
    iconGradient.addColorStop(0, palette.colorNear);
    iconGradient.addColorStop(1, palette.colorFar);
    ctx.fillStyle = iconGradient;
    ctx.beginPath();
    ctx.arc(iconX, centerY, iconRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const textX = iconX + iconRadius + rect.h * 0.28;
    ctx.save();
    ctx.fillStyle = '#e8ecf5';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    applyTextStyle(ctx, 'primary', rect.h * 0.34);
    ctx.fillText(theme.label, textX, centerY - rect.h * 0.12);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = 'rgba(232, 236, 245, 0.65)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    applyTextStyle(ctx, 'secondary', rect.h * 0.15);
    ctx.fillText('Tap to launch', textX, centerY + rect.h * 0.18);
    ctx.restore();
  }

  // Draws the map-select screen: a dark scrim, the "Choose your map" heading
  // inside a menu panel, and the theme cards. Shared by the pre-match flow
  // (mapSelectActive) and Pause > Change Map (#71, pauseMapSelectActive) so
  // both read as the exact same designed screen.
  private renderMapSelectScreen(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.fillStyle = 'rgba(10, 17, 40, 0.55)';
    ctx.fillRect(0, 0, width, height);

    const screen = this.pauseMapSelectActive ? 'pause-map-select' : 'map-select';
    const themes = Object.values(MAP_THEMES);
    const firstRect = this.mapButtonRect(0, width, height);
    const lastRect = this.mapButtonRect(themes.length - 1, width, height);
    const headingY = firstRect.y - height * 0.06;
    const iconY = headingY - height * 0.065;

    const panelWidth = width * MENU_PANEL_WIDTH_RATIO;
    const panelTop = iconY - height * MAP_SELECT_PANEL_TOP_PADDING_RATIO;
    const panelBottom = lastRect.y + lastRect.h + height * MAP_SELECT_PANEL_BOTTOM_PADDING_RATIO;
    const panelHeight = panelBottom - panelTop;
    this.renderMenuPanel(ctx, width / 2, panelTop + panelHeight / 2, panelWidth, panelHeight);
    this.renderMenuIcon(ctx, width / 2, iconY, height);

    ctx.save();
    ctx.fillStyle = '#e8ecf5';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(120, 170, 255, 0.85)';
    ctx.shadowBlur = height * 0.02;
    applyTextStyle(ctx, 'secondary', height * 0.03);
    ctx.fillText('Choose your map', width / 2, headingY);
    ctx.restore();

    themes.forEach((theme, i) => {
      const rect = this.mapButtonRect(i, width, height);
      this.renderMapCard(ctx, theme, rect, this.isPressed(`${screen}:${i}`));
    });
  }

  // Draws the mode-select screen (#80): a dark scrim, the "Choose your mode"
  // heading inside a menu panel, and the 1P/2P action buttons -- shown right
  // after a map is picked, reusing the pause overlay's stacked-button layout
  // and card styling so the whole pre-match flow reads as one designed menu
  // system.
  private renderModeSelectScreen(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.fillStyle = 'rgba(10, 17, 40, 0.55)';
    ctx.fillRect(0, 0, width, height);

    const count = MODE_SELECT_ACTIONS.length;
    const firstRect = this.modeSelectButtonRect(0, width, height);
    const lastRect = this.modeSelectButtonRect(count - 1, width, height);
    const headingY = firstRect.y - height * PAUSE_OVERLAY_HEADING_GAP_RATIO;
    const panelWidth = width * MENU_PANEL_WIDTH_RATIO;
    const panelTop = headingY - height * PAUSE_OVERLAY_PANEL_TOP_PADDING_RATIO;
    const panelBottom = lastRect.y + lastRect.h + height * PAUSE_OVERLAY_PANEL_BOTTOM_PADDING_RATIO;
    const panelHeight = panelBottom - panelTop;
    this.renderMenuPanel(ctx, width / 2, panelTop + panelHeight / 2, panelWidth, panelHeight);

    ctx.save();
    ctx.fillStyle = '#e8ecf5';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(120, 170, 255, 0.85)';
    ctx.shadowBlur = height * 0.02;
    applyTextStyle(ctx, 'secondary', height * 0.03);
    ctx.fillText('Choose your mode', width / 2, headingY);
    ctx.restore();

    MODE_SELECT_ACTIONS.forEach((entry, i) => {
      const rect = this.modeSelectButtonRect(i, width, height);
      this.renderPauseActionButton(ctx, entry.label, rect, this.isPressed(`mode-select:${i}`));
    });
  }

  // Draws the pause button: a rounded translucent icon showing two vertical
  // bars, docked on the right edge, vertically centered (#79). Purely visual
  // -- hit-testing lives in pauseButtonAt/pauseButtonRect above so they can
  // never drift apart.
  private renderPauseButton(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const pressed = this.isPressed('pause-icon');
    const rect = pressed ? shrinkRectForPress(this.pauseButtonRect(width, height)) : this.pauseButtonRect(width, height);
    const centerX = rect.x + rect.w / 2;
    const centerY = rect.y + rect.h / 2;
    const radius = rect.h * 0.28;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, radius);
    ctx.fillStyle = pressed ? 'rgba(10, 17, 40, 0.8)' : 'rgba(10, 17, 40, 0.55)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(232, 236, 245, 0.4)';
    this.strokeInsetRoundRect(ctx, rect, radius, Math.max(1, rect.h * 0.04));
    ctx.restore();

    const barWidth = rect.w * 0.12;
    const barHeight = rect.h * 0.42;
    const barGap = rect.w * 0.14;
    ctx.fillStyle = '#e8ecf5';
    ctx.fillRect(centerX - barGap / 2 - barWidth, centerY - barHeight / 2, barWidth, barHeight);
    ctx.fillRect(centerX + barGap / 2, centerY - barHeight / 2, barWidth, barHeight);
  }

  // Draws one pause-overlay action button as a themed card -- gradient fill
  // plus glowing border, matching renderMapCard's treatment -- with a plain
  // centered label instead of a map icon.
  private renderPauseActionButton(ctx: CanvasRenderingContext2D, label: string, rect: Rect, pressed: boolean): void {
    if (pressed) {
      rect = shrinkRectForPress(rect);
    }
    const centerX = rect.x + rect.w / 2;
    const centerY = rect.y + rect.h / 2;
    const radius = rect.h * 0.25;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, radius);
    const fill = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
    fill.addColorStop(0, 'rgba(232, 236, 245, 0.14)');
    fill.addColorStop(1, 'rgba(10, 17, 40, 0.92)');
    ctx.fillStyle = fill;
    ctx.globalAlpha = pressed ? 0.8 : 1;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(232, 236, 245, 0.4)';
    this.strokeInsetRoundRect(ctx, rect, radius, Math.max(1, rect.h * 0.035));
    ctx.restore();

    ctx.save();
    ctx.fillStyle = '#e8ecf5';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    applyTextStyle(ctx, 'primary', rect.h * 0.3);
    ctx.fillText(label, centerX, centerY);
    ctx.restore();
  }

  // Draws the full-screen pause overlay: a dark scrim, the "Paused" heading
  // inside a menu panel (matching the title/map-select treatment), and the
  // three action buttons.
  private renderPauseOverlay(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.fillStyle = 'rgba(10, 17, 40, 0.85)';
    ctx.fillRect(0, 0, width, height);

    const firstRect = this.pauseOverlayButtonRect(0, width, height);
    const lastRect = this.pauseOverlayButtonRect(PAUSE_ACTIONS.length - 1, width, height);
    const headingY = firstRect.y - height * PAUSE_OVERLAY_HEADING_GAP_RATIO;
    const panelWidth = width * MENU_PANEL_WIDTH_RATIO;
    const panelTop = headingY - height * PAUSE_OVERLAY_PANEL_TOP_PADDING_RATIO;
    const panelBottom = lastRect.y + lastRect.h + height * PAUSE_OVERLAY_PANEL_BOTTOM_PADDING_RATIO;
    const panelHeight = panelBottom - panelTop;
    this.renderMenuPanel(ctx, width / 2, panelTop + panelHeight / 2, panelWidth, panelHeight);

    ctx.save();
    ctx.fillStyle = '#e8ecf5';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(120, 170, 255, 0.85)';
    ctx.shadowBlur = height * 0.02;
    applyTextStyle(ctx, 'primary', height * 0.045);
    ctx.fillText('Paused', width / 2, headingY);
    ctx.restore();

    PAUSE_ACTIONS.forEach((entry, i) => {
      const rect = this.pauseOverlayButtonRect(i, width, height);
      this.renderPauseActionButton(ctx, entry.label, rect, this.isPressed(`pause-overlay:${i}`));
    });
  }

  // Draws the Pause > Settings screen (#71): a dark scrim, the "Settings"
  // heading inside a menu panel, and the toggle/back buttons -- styled like
  // renderPauseOverlay so it reads as the same designed system.
  private renderPauseSettingsScreen(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.fillStyle = 'rgba(10, 17, 40, 0.85)';
    ctx.fillRect(0, 0, width, height);

    const count = PAUSE_SETTINGS_ACTIONS.length;
    const firstRect = this.pauseSettingsButtonRect(0, width, height);
    const lastRect = this.pauseSettingsButtonRect(count - 1, width, height);
    const headingY = firstRect.y - height * PAUSE_OVERLAY_HEADING_GAP_RATIO;
    const panelWidth = width * MENU_PANEL_WIDTH_RATIO;
    const panelTop = headingY - height * PAUSE_OVERLAY_PANEL_TOP_PADDING_RATIO;
    const panelBottom = lastRect.y + lastRect.h + height * PAUSE_OVERLAY_PANEL_BOTTOM_PADDING_RATIO;
    const panelHeight = panelBottom - panelTop;
    this.renderMenuPanel(ctx, width / 2, panelTop + panelHeight / 2, panelWidth, panelHeight);

    ctx.save();
    ctx.fillStyle = '#e8ecf5';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(120, 170, 255, 0.85)';
    ctx.shadowBlur = height * 0.02;
    applyTextStyle(ctx, 'primary', height * 0.045);
    ctx.fillText('Settings', width / 2, headingY);
    ctx.restore();

    this.renderPauseActionButton(ctx, `Sound: ${this.soundEnabled ? 'On' : 'Off'}`, firstRect, this.isPressed('pause-settings:0'));
    this.renderPauseActionButton(ctx, 'Back', lastRect, this.isPressed('pause-settings:1'));
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

    if (this.isMatchActive() && !this.paused) {
      this.renderPauseButton(ctx, width, height);
    }

    if (this.titleScreenActive) {
      ctx.fillStyle = 'rgba(10, 17, 40, 0.55)';
      ctx.fillRect(0, 0, width, height);

      const panelWidth = width * MENU_PANEL_WIDTH_RATIO;
      const panelHeight = height * MENU_TITLE_PANEL_HEIGHT_RATIO;
      this.renderMenuPanel(ctx, width / 2, height / 2, panelWidth, panelHeight);
      this.renderMenuIcon(ctx, width / 2, height / 2 - panelHeight * 0.32, height);

      ctx.save();
      ctx.fillStyle = '#e8ecf5';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(120, 170, 255, 0.85)';
      ctx.shadowBlur = height * 0.025;
      applyTextStyle(ctx, 'primary', height * 0.06);
      ctx.fillText(GAME_TITLE, width / 2, height / 2 - height * 0.01);
      ctx.restore();

      ctx.save();
      ctx.fillStyle = '#e8ecf5';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(120, 170, 255, 0.85)';
      ctx.shadowBlur = height * 0.02;
      applyTextStyle(ctx, 'secondary', height * 0.025);
      ctx.fillText('Tap to start', width / 2, height / 2 + height * 0.08);
      ctx.restore();
    }

    // mapSelectActive covers the pre-match flow (title -> map-select); the
    // Pause > Change Map flow (#71) shows the exact same screen via
    // pauseMapSelectActive, rendered further down alongside the rest of the
    // pause sub-screens so it never draws underneath the pause overlay.
    if (this.mapSelectActive) {
      this.renderMapSelectScreen(ctx, width, height);
    }

    if (this.modeSelectActive) {
      this.renderModeSelectScreen(ctx, width, height);
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

    if (this.paused) {
      if (this.pauseMapSelectActive) {
        this.renderMapSelectScreen(ctx, width, height);
      } else if (this.pauseSettingsActive) {
        this.renderPauseSettingsScreen(ctx, width, height);
      } else {
        this.renderPauseOverlay(ctx, width, height);
      }
    }

    ctx.restore();
  }
}
