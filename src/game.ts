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
const MAX_BOUNCE_ANGLE = Math.PI / 3; // 60 degrees from vertical at the paddle edges
const WINNING_SCORE = 11; // first player to reach this score wins the match
const SERVE_DELAY_SECONDS = 1; // pause after a point before the ball re-serves

type PaddleId = 1 | 2;

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

  private initialized = false;
  private serveDelayRemaining = 0;
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

  // Centers the ball and immediately launches it in a random diagonal direction.
  private serve(width: number, height: number): void {
    this.ballX = width / 2;
    this.ballY = height / 2;
    const speed = height * BALL_SPEED_RATIO;
    // Angle from vertical, kept between 30 and 60 degrees so the launch is
    // always visibly diagonal (never near-horizontal or near-vertical).
    const angleFromVertical = Math.PI / 6 + Math.random() * (Math.PI / 6);
    const xSign = Math.random() < 0.5 ? -1 : 1;
    const ySign = Math.random() < 0.5 ? -1 : 1;
    this.ballVX = Math.sin(angleFromVertical) * speed * xSign;
    this.ballVY = Math.cos(angleFromVertical) * speed * ySign;
  }

  // Centers the ball with zero velocity and starts the pre-serve pause.
  private awardPoint(scorer: PaddleId, width: number, height: number): void {
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

    this.ballX = width / 2;
    this.ballY = height / 2;
    this.ballVX = 0;
    this.ballVY = 0;
    if (this.winner === null) {
      this.serveDelayRemaining = SERVE_DELAY_SECONDS;
    }
  }

  private restartMatch(width: number, height: number): void {
    this.score1 = 0;
    this.score2 = 0;
    this.winner = null;
    this.serveDelayRemaining = 0;
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
    this.movePaddle(paddle, x, width);
  }

  onPointerUp(pointerId: number): void {
    this.pointerPaddle.delete(pointerId);
  }

  private movePaddle(paddle: PaddleId, x: number, width: number): void {
    const halfWidth = (width * PADDLE_WIDTH_RATIO) / 2;
    const clamped = clamp(x, halfWidth, width - halfWidth);
    if (paddle === 1) {
      this.paddle1X = clamped;
    } else {
      this.paddle2X = clamped;
    }
  }

  update(dt: number, width: number, height: number): void {
    this.ensureInitialized(width, height);

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

    this.ballX += this.ballVX * dt;
    this.ballY += this.ballVY * dt;

    const radius = height * BALL_RADIUS_RATIO;

    if (this.ballX - radius <= 0) {
      this.ballX = radius;
      this.ballVX = Math.abs(this.ballVX);
    } else if (this.ballX + radius >= width) {
      this.ballX = width - radius;
      this.ballVX = -Math.abs(this.ballVX);
    }

    const paddleWidth = width * PADDLE_WIDTH_RATIO;
    const paddleHalfWidth = paddleWidth / 2;
    const paddleHeight = height * PADDLE_HEIGHT_RATIO;
    const paddle1Y = height * PADDLE_MARGIN_RATIO;
    const paddle2Y = height * (1 - PADDLE_MARGIN_RATIO);
    const speed = height * BALL_SPEED_RATIO;

    const overlapsPaddleX = (paddleX: number): boolean =>
      this.ballX + radius >= paddleX - paddleHalfWidth && this.ballX - radius <= paddleX + paddleHalfWidth;

    if (
      this.ballVY < 0 &&
      this.ballY - radius <= paddle1Y + paddleHeight / 2 &&
      this.ballY + radius >= paddle1Y - paddleHeight / 2 &&
      overlapsPaddleX(this.paddle1X)
    ) {
      this.ballY = paddle1Y + paddleHeight / 2 + radius;
      const { vx, vy } = reflectOffPaddle(this.ballX, this.paddle1X, paddleWidth, speed, true);
      this.ballVX = vx;
      this.ballVY = vy;
    } else if (
      this.ballVY > 0 &&
      this.ballY + radius >= paddle2Y - paddleHeight / 2 &&
      this.ballY - radius <= paddle2Y + paddleHeight / 2 &&
      overlapsPaddleX(this.paddle2X)
    ) {
      this.ballY = paddle2Y - paddleHeight / 2 - radius;
      const { vx, vy } = reflectOffPaddle(this.ballX, this.paddle2X, paddleWidth, speed, false);
      this.ballVX = vx;
      this.ballVY = vy;
    }

    if (this.ballY + radius < 0) {
      // Ball exited past the top edge: bottom player (player 2) scores.
      this.awardPoint(2, width, height);
    } else if (this.ballY - radius > height) {
      // Ball exited past the bottom edge: top player (player 1) scores.
      this.awardPoint(1, width, height);
    }
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    this.ensureInitialized(width, height);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0a1128';
    ctx.fillRect(0, 0, width, height);

    const paddleHalfWidth = (width * PADDLE_WIDTH_RATIO) / 2;
    const paddleHeight = height * PADDLE_HEIGHT_RATIO;
    const paddle1Y = height * PADDLE_MARGIN_RATIO;
    const paddle2Y = height * (1 - PADDLE_MARGIN_RATIO);

    ctx.fillStyle = '#e8ecf5';
    ctx.fillRect(this.paddle1X - paddleHalfWidth, paddle1Y - paddleHeight / 2, paddleHalfWidth * 2, paddleHeight);
    ctx.fillRect(this.paddle2X - paddleHalfWidth, paddle2Y - paddleHeight / 2, paddleHalfWidth * 2, paddleHeight);

    ctx.beginPath();
    ctx.arc(this.ballX, this.ballY, height * BALL_RADIUS_RATIO, 0, Math.PI * 2);
    ctx.fillStyle = '#5b8cff';
    ctx.fill();

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
