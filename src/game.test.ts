import { describe, expect, it } from 'vitest';
import { Game, clamp, reflectOffPaddle } from './game';

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
