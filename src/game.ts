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
const MAX_WALL_BOUNCES_PER_FRAME = 8; // safety bound on the per-frame wall-bounce segment walk below

// Pointermove events fire often enough during a real drag that this cap is
// imperceptible in normal play; it only becomes visible (and boostable) when
// a power-up scales it up.
export const PADDLE_MOVE_STEP_RATIO = 0.3; // max fraction of canvas width a paddle may travel per drag event
export const POWER_UP_SPAWN_INTERVAL_SECONDS = 6; // gap between power-up spawns during an active rally
const POWER_UP_RADIUS_RATIO = 0.03; // fraction of canvas height
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

// Orbiting planets drift behind the play field, evoking a slow solar-system
// backdrop. Orbit center is fixed as a fraction of canvas size so it holds up
// across the portrait aspect ratios the game supports.
interface PlanetConfig {
  colorNear: string;
  colorFar: string;
  radiusRatio: number; // planet radius, fraction of canvas height
  orbitRadiusRatio: number; // orbit radius, fraction of min(width, height)
  angularSpeed: number; // radians per second
  phase: number; // initial angle offset
}
const ORBIT_CENTER_X_RATIO = 0.5;
const ORBIT_CENTER_Y_RATIO = 0.38;
const PLANETS: PlanetConfig[] = [
  {
    colorNear: '#f4a261',
    colorFar: '#9c4f21',
    radiusRatio: 0.05,
    orbitRadiusRatio: 0.55,
    angularSpeed: 0.12,
    phase: 0,
  },
  {
    colorNear: '#8ecae6',
    colorFar: '#2a6f97',
    radiusRatio: 0.032,
    orbitRadiusRatio: 0.32,
    angularSpeed: -0.2,
    phase: Math.PI * 0.6,
  },
  {
    colorNear: '#c9a0f5',
    colorFar: '#5e3b8f',
    radiusRatio: 0.022,
    orbitRadiusRatio: 0.75,
    angularSpeed: 0.07,
    phase: Math.PI * 1.3,
  },
];

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

const POWER_UP_VISUALS: Record<PowerUpKind, { color: string; label: string }> = {
  'speed-boost': { color: '#ffd166', label: 'S' },
  'fast-ball': { color: '#ff5b7f', label: 'F' },
  'giant-paddle': { color: '#06d6a0', label: 'G' },
  'multi-ball': { color: '#a78bfa', label: 'M' },
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
  backdropTime = 0; // seconds elapsed, drives the starfield twinkle and planet orbits

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
    this.serve(width, height);
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
    } else if (this.score2 >= WINNING_SCORE) {
      this.winner = 2;
    }
  }

  // Centers the ball with zero velocity and starts the pre-serve pause.
  private awardPoint(scorer: PaddleId, width: number, height: number): void {
    this.addScore(scorer);

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
    this.serve(width, height);
  }

  onPointerDown(pointerId: number, x: number, y: number, width: number, height: number): void {
    this.ensureInitialized(width, height);
    if (this.winner !== null) {
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

  // Like movePaddle, but rate-limited to PADDLE_MOVE_STEP_RATIO per call so a
  // Speed Boost (which scales the limit) has a visible effect.
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
    ctx.fillStyle = '#f4f7ff';
    for (const star of STARS) {
      const twinkle = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(this.backdropTime * star.twinkleSpeed + star.twinklePhase));
      ctx.globalAlpha = twinkle;
      ctx.beginPath();
      ctx.arc(star.xRatio * width, star.yRatio * height, star.radiusPx, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const centerX = width * ORBIT_CENTER_X_RATIO;
    const centerY = height * ORBIT_CENTER_Y_RATIO;
    const minSide = Math.min(width, height);
    for (const planet of PLANETS) {
      const { x, y } = orbitPosition(
        centerX,
        centerY,
        planet.orbitRadiusRatio * minSide,
        planet.angularSpeed,
        planet.phase,
        this.backdropTime,
      );
      const radius = planet.radiusRatio * height;
      const gradient = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, radius * 0.1, x, y, radius);
      gradient.addColorStop(0, planet.colorNear);
      gradient.addColorStop(1, planet.colorFar);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
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

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    this.ensureInitialized(width, height);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0a1128';
    ctx.fillRect(0, 0, width, height);
    this.renderBackdrop(ctx, width, height);

    const paddle1HalfWidth = this.paddleWidth(1, width) / 2;
    const paddle2HalfWidth = this.paddleWidth(2, width) / 2;
    const paddleHeight = height * PADDLE_HEIGHT_RATIO;
    const paddle1Y = height * PADDLE_MARGIN_RATIO;
    const paddle2Y = height * (1 - PADDLE_MARGIN_RATIO);

    ctx.fillStyle = '#e8ecf5';
    ctx.fillRect(this.paddle1X - paddle1HalfWidth, paddle1Y - paddleHeight / 2, paddle1HalfWidth * 2, paddleHeight);
    ctx.fillRect(this.paddle2X - paddle2HalfWidth, paddle2Y - paddleHeight / 2, paddle2HalfWidth * 2, paddleHeight);

    const ballRadius = height * BALL_RADIUS_RATIO;
    const cometBaseSpeed = height * BALL_SPEED_RATIO;
    const balls: Ball[] = [{ x: this.ballX, y: this.ballY, vx: this.ballVX, vy: this.ballVY }, ...this.extraBalls];
    for (const ball of balls) {
      this.renderComet(ctx, ball.x, ball.y, ball.vx, ball.vy, ballRadius, cometBaseSpeed);
    }

    if (this.activePowerUp !== null) {
      const powerUpRadius = height * POWER_UP_RADIUS_RATIO;
      const visual = POWER_UP_VISUALS[this.activePowerUp.kind];
      ctx.beginPath();
      ctx.arc(this.activePowerUp.x, this.activePowerUp.y, powerUpRadius, 0, Math.PI * 2);
      ctx.fillStyle = visual.color;
      ctx.fill();
      ctx.fillStyle = '#0a1128';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${Math.round(powerUpRadius * 1.2)}px sans-serif`;
      ctx.fillText(visual.label, this.activePowerUp.x, this.activePowerUp.y);
    }

    ctx.fillStyle = '#e8ecf5';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(height * 0.05)}px sans-serif`;
    ctx.fillText(String(this.score1), width / 2, height * 0.28);
    ctx.fillText(String(this.score2), width / 2, height * 0.72);

    if (this.winner !== null) {
      ctx.fillStyle = 'rgba(10, 17, 40, 0.85)';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#e8ecf5';
      ctx.font = `${Math.round(height * 0.045)}px sans-serif`;
      ctx.fillText(`Player ${this.winner} wins`, width / 2, height / 2 - height * 0.04);
      ctx.font = `${Math.round(height * 0.025)}px sans-serif`;
      ctx.fillText('Tap to play again', width / 2, height / 2 + height * 0.04);
    }
  }
}
