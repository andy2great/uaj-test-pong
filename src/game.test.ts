import { describe, expect, it } from 'vitest';
import {
  FAST_BALL_MULTIPLIER,
  Game,
  GIANT_PADDLE_DURATION_SECONDS,
  GIANT_PADDLE_MULTIPLIER,
  MULTI_BALL_DURATION_SECONDS,
  PADDLE_MOVE_STEP_RATIO,
  POWER_UP_KINDS,
  POWER_UP_SPAWN_INTERVAL_SECONDS,
  SPEED_BOOST_DURATION_SECONDS,
  SPEED_BOOST_MULTIPLIER,
  clamp,
  reflectOffPaddle,
} from './game';

describe('clamp', () => {
  it('returns the value when inside the range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('clamps below the minimum', () => {
    expect(clamp(-2, 0, 10)).toBe(0);
  });

  it('clamps above the maximum', () => {
    expect(clamp(12, 0, 10)).toBe(10);
  });
});

describe('reflectOffPaddle', () => {
  it('bounces straight down when hitting the top paddle dead center', () => {
    const { vx, vy } = reflectOffPaddle(100, 100, 80, 300, true);
    expect(vx).toBeCloseTo(0);
    expect(vy).toBeCloseTo(300);
  });

  it('bounces straight up when hitting the bottom paddle dead center', () => {
    const { vx, vy } = reflectOffPaddle(100, 100, 80, 300, false);
    expect(vx).toBeCloseTo(0);
    expect(vy).toBeCloseTo(-300);
  });

  it('adds horizontal velocity when hitting off-center, varying with hit position', () => {
    const nearCenter = reflectOffPaddle(105, 100, 80, 300, true);
    const nearEdge = reflectOffPaddle(135, 100, 80, 300, true);
    expect(nearEdge.vx).toBeGreaterThan(nearCenter.vx);
    expect(nearCenter.vx).toBeGreaterThan(0);
  });

  it('clamps the rebound angle for hits beyond the paddle half-width', () => {
    const atEdge = reflectOffPaddle(140, 100, 80, 300, true);
    const beyondEdge = reflectOffPaddle(500, 100, 80, 300, true);
    expect(beyondEdge.vx).toBeCloseTo(atEdge.vx);
    expect(beyondEdge.vy).toBeCloseTo(atEdge.vy);
  });
});

describe('Game paddle control', () => {
  it('moves player 1 paddle on a touch in the top half', () => {
    const game = new Game();
    game.onPointerDown(1, 200, 50, 400, 800);
    expect(game.paddle1X).toBe(200);
    expect(game.paddle2X).toBe(200); // still at its initial center position
  });

  it('moves player 2 paddle on a touch in the bottom half', () => {
    const game = new Game();
    game.onPointerDown(1, 300, 700, 400, 800);
    expect(game.paddle2X).toBe(300);
  });

  it('clamps paddle position to the canvas width', () => {
    const game = new Game();
    game.onPointerDown(1, -1000, 50, 400, 800);
    expect(game.paddle1X).toBeCloseTo(56); // half the paddle width (0.28 * 400 / 2)

    game.onPointerDown(2, 10000, 50, 400, 800);
    expect(game.paddle1X).toBeCloseTo(344); // width - half the paddle width
  });

  it('tracks independent pointers for each paddle simultaneously', () => {
    const game = new Game();
    game.onPointerDown(1, 100, 50, 400, 800); // player 1, top half
    game.onPointerDown(2, 300, 750, 400, 800); // player 2, bottom half
    expect(game.paddle1X).toBe(100);
    expect(game.paddle2X).toBe(300);

    game.onPointerMove(1, 150, 400);
    game.onPointerMove(2, 250, 400);
    expect(game.paddle1X).toBe(150);
    expect(game.paddle2X).toBe(250);
  });

  it('ignores pointermove for a pointer that never went down', () => {
    const game = new Game();
    game.onPointerMove(99, 150, 400);
    expect(game.paddle1X).toBe(0);
  });

  it('stops tracking a pointer after pointerup', () => {
    const game = new Game();
    game.onPointerDown(1, 100, 50, 400, 800);
    game.onPointerUp(1);
    game.onPointerMove(1, 350, 400);
    expect(game.paddle1X).toBe(100);
  });
});

describe('Game ball physics', () => {
  it('starts the ball at the center moving diagonally', () => {
    const game = new Game();
    game.update(0, 400, 800);
    expect(game.ballX).toBe(200);
    expect(game.ballY).toBe(400);
    expect(game.ballVX).not.toBe(0);
    expect(game.ballVY).not.toBe(0);
  });

  it('bounces off the left wall', () => {
    const game = new Game();
    game.update(0, 400, 800);
    game.ballX = 2;
    game.ballVX = -300;
    game.update(0.001, 400, 800);
    expect(game.ballVX).toBeGreaterThan(0);
    expect(game.ballX).toBeGreaterThanOrEqual(0);
  });

  it('bounces off the right wall', () => {
    const game = new Game();
    game.update(0, 400, 800);
    game.ballX = 398;
    game.ballVX = 300;
    game.update(0.001, 400, 800);
    expect(game.ballVX).toBeLessThan(0);
    expect(game.ballX).toBeLessThanOrEqual(400);
  });

  it('reflects off player 1 (top) paddle when moving up into it', () => {
    const game = new Game();
    game.update(0, 400, 800); // initialize
    game.paddle1X = 200;
    game.ballX = 200;
    game.ballY = 60; // just above the top paddle band (margin = 0.06 * 800 = 48)
    game.ballVX = 0;
    game.ballVY = -300;

    game.update(0.05, 400, 800);

    expect(game.ballVY).toBeGreaterThan(0); // rebounds downward
  });

  it('reflects off player 2 (bottom) paddle when moving down into it', () => {
    const game = new Game();
    game.update(0, 400, 800); // initialize
    game.paddle2X = 200;
    game.ballX = 200;
    game.ballY = 730; // just above the bottom paddle band (margin = 0.06 * 800 = 48 from bottom -> y=752)
    game.ballVX = 0;
    game.ballVY = 300;

    game.update(0.05, 400, 800);

    expect(game.ballVY).toBeLessThan(0); // rebounds upward
  });

  it('does not reflect off a paddle it misses horizontally', () => {
    const game = new Game();
    game.update(0, 400, 800);
    game.paddle1X = 50; // far from where the ball is
    game.ballX = 350;
    game.ballY = 55;
    game.ballVX = 0;
    game.ballVY = -300;

    game.update(0.05, 400, 800);

    expect(game.ballVY).toBeLessThan(0); // keeps moving up, no bounce
  });

  it('resets to center when the ball exits past the top edge', () => {
    const game = new Game();
    game.update(0, 400, 800);
    game.ballX = 200;
    game.ballY = -100;
    game.ballVY = -300;

    game.update(0.001, 400, 800);

    expect(game.ballX).toBe(200);
    expect(game.ballY).toBe(400);
  });

  it('resets to center when the ball exits past the bottom edge', () => {
    const game = new Game();
    game.update(0, 400, 800);
    game.ballX = 200;
    game.ballY = 900;
    game.ballVY = 300;

    game.update(0.001, 400, 800);

    expect(game.ballX).toBe(200);
    expect(game.ballY).toBe(400);
  });
});

describe('Game scoring', () => {
  it('awards a point to the bottom player when the ball exits past the top edge', () => {
    const game = new Game();
    game.update(0, 400, 800);
    game.ballY = -100;
    game.ballVY = -300;

    game.update(0.001, 400, 800);

    expect(game.score2).toBe(1);
    expect(game.score1).toBe(0);
  });

  it('awards a point to the top player when the ball exits past the bottom edge', () => {
    const game = new Game();
    game.update(0, 400, 800);
    game.ballY = 900;
    game.ballVY = 300;

    game.update(0.001, 400, 800);

    expect(game.score1).toBe(1);
    expect(game.score2).toBe(0);
  });

  it('parks the ball at the center with zero velocity during the post-point serve delay', () => {
    const game = new Game();
    game.update(0, 400, 800);
    game.ballY = -100;
    game.ballVY = -300;

    game.update(0.001, 400, 800);

    expect(game.ballVX).toBe(0);
    expect(game.ballVY).toBe(0);
    expect(game.ballX).toBe(200);
    expect(game.ballY).toBe(400);
  });

  it('re-serves the ball with velocity once the serve delay elapses', () => {
    const game = new Game();
    game.update(0, 400, 800);
    game.ballY = -100;
    game.ballVY = -300;
    game.update(0.001, 400, 800); // scores the point and starts the serve delay

    game.update(2, 400, 800); // longer than the serve delay

    expect(game.ballVX !== 0 || game.ballVY !== 0).toBe(true);
  });

  it('declares a winner once a player reaches the winning score', () => {
    const game = new Game();
    game.update(0, 400, 800);

    for (let i = 0; i < 11; i += 1) {
      game.ballY = 900;
      game.ballVY = 300;
      game.update(0.001, 400, 800); // scores for player 1
      game.update(2, 400, 800); // clears the serve delay for the next point
    }

    expect(game.score1).toBe(11);
    expect(game.winner).toBe(1);
  });

  it('stops updating the ball once the match is won', () => {
    const game = new Game();
    game.update(0, 400, 800);

    for (let i = 0; i < 11; i += 1) {
      game.ballY = 900;
      game.ballVY = 300;
      game.update(0.001, 400, 800);
      game.update(2, 400, 800);
    }
    expect(game.winner).toBe(1);

    game.ballY = 900;
    game.ballVY = 300;
    game.update(0.001, 400, 800);

    expect(game.score1).toBe(11); // no further scoring after the match ends
  });

  it('restarts the match with both scores reset when tapping the game-over state', () => {
    const game = new Game();
    game.update(0, 400, 800);

    for (let i = 0; i < 11; i += 1) {
      game.ballY = 900;
      game.ballVY = 300;
      game.update(0.001, 400, 800);
      game.update(2, 400, 800);
    }
    expect(game.winner).toBe(1);

    game.onPointerDown(1, 200, 400, 400, 800);

    expect(game.winner).toBeNull();
    expect(game.score1).toBe(0);
    expect(game.score2).toBe(0);
  });
});

describe('Game power-ups', () => {
  it('registers all four power-ups via the extensible kind registry', () => {
    expect(POWER_UP_KINDS).toContain('speed-boost');
    expect(POWER_UP_KINDS).toContain('fast-ball');
    expect(POWER_UP_KINDS).toContain('giant-paddle');
    expect(POWER_UP_KINDS).toContain('multi-ball');
  });

  it('spawns a power-up on the field once the spawn interval elapses during an active rally', () => {
    const game = new Game();
    game.update(0, 400, 800); // initializes and serves
    game.ballVX = 0;
    game.ballVY = 0; // freeze the ball so the rally never ends during the wait

    expect(game.activePowerUp).toBeNull();
    game.update(POWER_UP_SPAWN_INTERVAL_SECONDS, 400, 800);

    expect(game.activePowerUp).not.toBeNull();
    expect(POWER_UP_KINDS).toContain(game.activePowerUp!.kind);
  });

  it('does not spawn a power-up while the ball is off-screen during the post-point serve delay', () => {
    const game = new Game();
    game.update(0, 400, 800);
    game.ballY = -100;
    game.ballVY = -300;
    game.update(0.001, 400, 800); // scores the point and starts the serve delay

    game.update(POWER_UP_SPAWN_INTERVAL_SECONDS, 400, 800); // long enough to spawn if it were active

    expect(game.activePowerUp).toBeNull();
  });

  it('does not spawn a second power-up while one is already active', () => {
    const game = new Game();
    game.update(0, 400, 800);
    game.ballVX = 0;
    game.ballVY = 0;
    game.update(POWER_UP_SPAWN_INTERVAL_SECONDS, 400, 800);
    const firstPowerUp = game.activePowerUp;
    expect(firstPowerUp).not.toBeNull();

    game.update(POWER_UP_SPAWN_INTERVAL_SECONDS, 400, 800);

    expect(game.activePowerUp).toBe(firstPowerUp);
  });

  it('activates the Speed Boost effect and removes the icon when the ball collides with it', () => {
    const game = new Game();
    game.update(0, 400, 800);
    game.lastPaddleTouch = 1;
    game.activePowerUp = { id: 1, kind: 'speed-boost', x: game.ballX, y: game.ballY };

    game.update(0, 400, 800);

    expect(game.activePowerUp).toBeNull();
    expect(game.paddleSpeedMultiplier1).toBe(SPEED_BOOST_MULTIPLIER);
    expect(game.speedBoostRemaining).toBe(SPEED_BOOST_DURATION_SECONDS);
  });

  it('increases how far a drag can move the boosted paddle in a single move event', () => {
    const game = new Game();
    game.update(0, 400, 800);
    game.onPointerDown(1, 200, 50, 400, 800); // registers the pointer as controlling paddle 1

    game.paddle1X = 0; // simulate the paddle sitting at the far left edge
    game.onPointerMove(1, 400, 400); // drag toward the far right edge, well beyond the step cap
    const paddle1XAfterUnboosted = game.paddle1X;

    game.paddle1X = 0;
    game.paddleSpeedMultiplier1 = SPEED_BOOST_MULTIPLIER;
    game.onPointerMove(1, 400, 400);
    const paddle1XAfterBoosted = game.paddle1X;

    expect(paddle1XAfterUnboosted).toBeCloseTo(400 * PADDLE_MOVE_STEP_RATIO);
    expect(paddle1XAfterBoosted).toBeCloseTo(400 * PADDLE_MOVE_STEP_RATIO * SPEED_BOOST_MULTIPLIER);
    expect(paddle1XAfterBoosted).toBeGreaterThan(paddle1XAfterUnboosted);
  });

  it('reverts the Speed Boost automatically once its duration elapses', () => {
    const game = new Game();
    game.update(0, 400, 800);
    game.lastPaddleTouch = 2;
    game.activePowerUp = { id: 1, kind: 'speed-boost', x: game.ballX, y: game.ballY };
    game.ballVX = 0;
    game.ballVY = 0; // freeze the ball so the rally does not end during the wait

    game.update(0, 400, 800); // activates the boost
    expect(game.paddleSpeedMultiplier2).toBe(SPEED_BOOST_MULTIPLIER);

    game.update(SPEED_BOOST_DURATION_SECONDS, 400, 800);

    expect(game.paddleSpeedMultiplier2).toBe(1);
    expect(game.speedBoostRemaining).toBe(0);
  });

  it('leaves the Speed Boost icon uncollected if no paddle has touched the ball yet', () => {
    const game = new Game();
    game.update(0, 400, 800);
    expect(game.lastPaddleTouch).toBeNull();
    game.activePowerUp = { id: 1, kind: 'speed-boost', x: game.ballX, y: game.ballY };

    game.update(0, 400, 800);

    expect(game.activePowerUp).not.toBeNull();
    expect(game.paddleSpeedMultiplier1).toBe(1);
    expect(game.paddleSpeedMultiplier2).toBe(1);
    expect(game.speedBoostRemaining).toBe(0);
  });

  it('activates the Fast Ball effect, multiplying the current ball speed, when the ball collides with it', () => {
    const game = new Game();
    game.update(0, 400, 800);
    game.ballVX = 100;
    game.ballVY = -200;
    game.activePowerUp = { id: 1, kind: 'fast-ball', x: game.ballX, y: game.ballY };

    game.update(0, 400, 800);

    expect(game.activePowerUp).toBeNull();
    expect(game.ballVX).toBeCloseTo(100 * FAST_BALL_MULTIPLIER);
    expect(game.ballVY).toBeCloseTo(-200 * FAST_BALL_MULTIPLIER);
  });

  it('keeps the Fast Ball speed boost through a paddle bounce', () => {
    const game = new Game();
    game.update(0, 400, 800); // initialize
    game.ballVX = 100;
    game.ballVY = -200;
    game.activePowerUp = { id: 1, kind: 'fast-ball', x: game.ballX, y: game.ballY };
    game.update(0, 400, 800); // pick up the power-up
    const boostedSpeed = Math.hypot(game.ballVX, game.ballVY);

    game.paddle1X = game.ballX;
    game.ballY = 60; // just above the top paddle band (margin = 0.06 * 800 = 48)
    game.ballVX = 0;
    game.ballVY = -boostedSpeed;

    game.update(0.05, 400, 800); // bounce off player 1's paddle

    expect(game.ballVY).toBeGreaterThan(0); // rebounds downward
    expect(Math.hypot(game.ballVX, game.ballVY)).toBeCloseTo(boostedSpeed);
  });

  it('still bounces off a paddle when a stacked Fast Ball speed would otherwise skip past the collision band in one frame', () => {
    const game = new Game();
    game.update(0, 400, 800); // initialize

    // Reproduces issue #15: speed reached after ~6 stacked Fast Ball pickups
    // (440 * FAST_BALL_MULTIPLIER^6 =~ 2663.5px/s on an 800px-tall canvas),
    // starting just above the paddle's collision band ([28, 68]) so a single
    // 1/60s frame would jump clean over it under the old end-of-frame-only check.
    game.paddle1X = game.ballX;
    game.ballY = 68.5;
    game.ballVX = 0;
    game.ballVY = -2663.5;

    game.update(1 / 60, 400, 800);

    expect(game.ballVY).toBeGreaterThan(0); // rebounds downward instead of tunneling through
    expect(game.score2).toBe(0); // player 2 must not be awarded an undeserved point
  });

  it('ignores a power-up the ball has not reached yet', () => {
    const game = new Game();
    game.update(0, 400, 800);
    game.activePowerUp = { id: 1, kind: 'fast-ball', x: game.ballX + 1000, y: game.ballY + 1000 };
    const vx = game.ballVX;
    const vy = game.ballVY;

    game.update(0, 400, 800);

    expect(game.activePowerUp).not.toBeNull();
    expect(game.ballVX).toBe(vx);
    expect(game.ballVY).toBe(vy);
  });

  it('activates the Giant Paddle effect, widening the collecting paddle, when the ball collides with it', () => {
    const game = new Game();
    game.update(0, 400, 800);
    game.lastPaddleTouch = 1;
    game.activePowerUp = { id: 1, kind: 'giant-paddle', x: game.ballX, y: game.ballY };

    game.update(0, 400, 800);

    expect(game.activePowerUp).toBeNull();
    expect(game.paddleWidthMultiplier1).toBe(GIANT_PADDLE_MULTIPLIER);
    expect(game.giantPaddleRemaining).toBe(GIANT_PADDLE_DURATION_SECONDS);
  });

  it('leaves the Giant Paddle icon uncollected if no paddle has touched the ball yet', () => {
    const game = new Game();
    game.update(0, 400, 800);
    expect(game.lastPaddleTouch).toBeNull();
    game.activePowerUp = { id: 1, kind: 'giant-paddle', x: game.ballX, y: game.ballY };

    game.update(0, 400, 800);

    expect(game.activePowerUp).not.toBeNull();
    expect(game.paddleWidthMultiplier1).toBe(1);
    expect(game.paddleWidthMultiplier2).toBe(1);
    expect(game.giantPaddleRemaining).toBe(0);
  });

  it('re-clamps a paddle sitting at the edge so it stays fully on-canvas when Giant Paddle activates', () => {
    const game = new Game();
    game.update(0, 400, 800);
    game.onPointerDown(1, -1000, 50, 400, 800); // drag paddle 1 flush against the left edge
    const halfWidthNormal = 400 * 0.28 * 1 * 0.5;
    expect(game.paddle1X).toBeCloseTo(halfWidthNormal);

    game.lastPaddleTouch = 1;
    game.activePowerUp = { id: 1, kind: 'giant-paddle', x: game.ballX, y: game.ballY };
    game.update(0, 400, 800); // ball collects the power-up while the paddle is still at the edge

    const halfWidthGiant = 400 * 0.28 * GIANT_PADDLE_MULTIPLIER * 0.5;
    expect(game.paddleWidthMultiplier1).toBe(GIANT_PADDLE_MULTIPLIER);
    expect(game.paddle1X).toBeGreaterThanOrEqual(halfWidthGiant);
    expect(game.paddle1X - halfWidthGiant).toBeCloseTo(0); // left edge of the paddle sits at x=0, not negative
  });

  it('keeps the wider paddle further from the canvas edge when clamped', () => {
    const game = new Game();
    game.update(0, 400, 800);

    game.onPointerDown(1, -1000, 50, 400, 800);
    const clampedNormal = game.paddle1X;

    game.paddleWidthMultiplier1 = GIANT_PADDLE_MULTIPLIER;
    game.onPointerDown(1, -1000, 50, 400, 800);
    const clampedGiant = game.paddle1X;

    expect(clampedGiant).toBeGreaterThan(clampedNormal);
  });

  it('reverts the Giant Paddle automatically once its duration elapses', () => {
    const game = new Game();
    game.update(0, 400, 800);
    game.lastPaddleTouch = 2;
    game.activePowerUp = { id: 1, kind: 'giant-paddle', x: game.ballX, y: game.ballY };
    game.ballVX = 0;
    game.ballVY = 0; // freeze the ball so the rally does not end during the wait

    game.update(0, 400, 800); // activates the effect
    expect(game.paddleWidthMultiplier2).toBe(GIANT_PADDLE_MULTIPLIER);

    game.update(GIANT_PADDLE_DURATION_SECONDS, 400, 800);

    expect(game.paddleWidthMultiplier2).toBe(1);
    expect(game.giantPaddleRemaining).toBe(0);
  });

  it('activates the Multi-Ball effect, putting an extra ball into play, when the ball collides with it', () => {
    const game = new Game();
    game.update(0, 400, 800);
    game.activePowerUp = { id: 1, kind: 'multi-ball', x: game.ballX, y: game.ballY };

    game.update(0, 400, 800);

    expect(game.activePowerUp).toBeNull();
    expect(game.extraBalls).toHaveLength(1);
    expect(game.extraBalls[0].vx !== 0 || game.extraBalls[0].vy !== 0).toBe(true);
  });

  it('moves the extra ball independently and lets it score a point for whichever side it exits past', () => {
    const game = new Game();
    game.update(0, 400, 800);
    game.extraBalls.push({ x: 200, y: 900, vx: 0, vy: 300, remaining: MULTI_BALL_DURATION_SECONDS });
    game.ballVX = 0;
    game.ballVY = 0; // freeze the primary ball so only the extra ball scores

    game.update(0.001, 400, 800);

    expect(game.score1).toBe(1);
    expect(game.score2).toBe(0);
    expect(game.extraBalls).toHaveLength(0);
    // the primary ball keeps playing; only the extra ball was removed
    expect(game.ballX).toBe(200);
    expect(game.ballY).toBe(400);
  });

  it('removes the extra ball once its duration elapses, without affecting the score', () => {
    const game = new Game();
    game.update(0, 400, 800);
    game.extraBalls.push({ x: 200, y: 400, vx: 0, vy: 0, remaining: MULTI_BALL_DURATION_SECONDS });
    game.ballVX = 0;
    game.ballVY = 0; // freeze the primary ball so it doesn't score during the long wait

    game.update(MULTI_BALL_DURATION_SECONDS, 400, 800);

    expect(game.extraBalls).toHaveLength(0);
    expect(game.score1).toBe(0);
    expect(game.score2).toBe(0);
  });

  it('clears any extra balls once the primary ball ends the rally', () => {
    const game = new Game();
    game.update(0, 400, 800);
    game.extraBalls.push({ x: 200, y: 400, vx: 0, vy: 0, remaining: MULTI_BALL_DURATION_SECONDS });
    game.ballY = -100;
    game.ballVY = -300;

    game.update(0.001, 400, 800); // primary ball exits and scores

    expect(game.extraBalls).toHaveLength(0);
  });
});
