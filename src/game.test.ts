import { describe, expect, it } from 'vitest';
import {
  FAST_BALL_MULTIPLIER,
  FREEZE_PADDLE_DURATION_SECONDS,
  FREEZE_PADDLE_MULTIPLIER,
  Game,
  GIANT_PADDLE_DURATION_SECONDS,
  GIANT_PADDLE_MULTIPLIER,
  MULTI_BALL_DURATION_SECONDS,
  PADDLE_MOVE_STEP_RATIO,
  POWER_UP_KINDS,
  POWER_UP_SPAWN_INTERVAL_SECONDS,
  clamp,
  eccentricOrbitPosition,
  orbitPosition,
  reflectOffPaddle,
} from './game';

// Dismisses the title screen, picks the Earth map, and clears the pre-serve
// pause, matching what a player does on first load, so tests can exercise
// active gameplay directly. The map button's center sits at height * 0.43
// regardless of canvas size -- see the "Game map select" tests below, which
// derive the same ratio from the button layout constants.
function startGame(width = 400, height = 800): Game {
  const game = new Game();
  game.update(0, width, height); // initializes, shows the title screen
  game.onPointerDown(-1, width / 2, height / 2, width, height); // dismiss the title screen, shows map-select
  game.onPointerDown(-1, width / 2, height * 0.43, width, height); // taps the Earth button, starts the first-serve countdown
  game.onPointerUp(-1);
  game.update(2, width, height); // clears the pre-serve pause and serves the ball
  return game;
}

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

describe('orbitPosition', () => {
  it('starts at the phase angle when time is zero', () => {
    const { x, y } = orbitPosition(100, 100, 50, 1, 0, 0);
    expect(x).toBeCloseTo(150);
    expect(y).toBeCloseTo(100);
  });

  it('advances around the orbit as time increases', () => {
    const start = orbitPosition(100, 100, 50, 1, 0, 0);
    const later = orbitPosition(100, 100, 50, 1, 0, 1);
    expect(later.x).not.toBeCloseTo(start.x);
  });

  it('moves in the opposite direction for a negative angular speed', () => {
    const positiveSpeed = orbitPosition(0, 0, 50, 1, 0, 0.5);
    const negativeSpeed = orbitPosition(0, 0, 50, -1, 0, 0.5);
    expect(positiveSpeed.y).toBeCloseTo(-negativeSpeed.y);
  });
});

describe('eccentricOrbitPosition', () => {
  it('starts at the phase angle when time is zero', () => {
    const { x, y } = eccentricOrbitPosition(100, 100, 50, 1, 0, 0);
    expect(x).toBeCloseTo(100 + 50 * 1.4);
    expect(y).toBeCloseTo(100);
  });

  it('advances around the orbit as time increases', () => {
    const start = eccentricOrbitPosition(100, 100, 50, 1, 0, 0);
    const later = eccentricOrbitPosition(100, 100, 50, 1, 0, 1);
    expect(later.x).not.toBeCloseTo(start.x);
  });

  it('stretches the orbit radius beyond a circular orbit at some points', () => {
    const stretched = eccentricOrbitPosition(0, 0, 50, 1, 0, 0);
    const circular = orbitPosition(0, 0, 50, 1, 0, 0);
    expect(Math.hypot(stretched.x, stretched.y)).toBeGreaterThan(Math.hypot(circular.x, circular.y));
  });
});

describe('Game title screen', () => {
  it('shows the title screen on first load, before the first serve', () => {
    const game = new Game();
    game.update(0, 400, 800);

    expect(game.titleScreenActive).toBe(true);
    expect(game.ballVX).toBe(0);
    expect(game.ballVY).toBe(0);
  });

  it('dismisses the title screen into map-select, then starts the first-serve countdown once a map is tapped', () => {
    const game = new Game();
    game.update(0, 400, 800);

    game.onPointerDown(1, 200, 400, 400, 800); // a tap anywhere dismisses the title screen

    expect(game.titleScreenActive).toBe(false);
    expect(game.mapSelectActive).toBe(true);
    expect(game.ballVX).toBe(0);
    expect(game.ballVY).toBe(0); // still paused, waiting for a map to be picked

    game.update(2, 400, 800); // map-select also pauses gameplay, same as the title screen
    expect(game.ballVX).toBe(0);
    expect(game.ballVY).toBe(0);

    game.onPointerDown(1, 200, 800 * 0.43, 400, 800); // taps the Earth button
    game.onPointerUp(1);

    expect(game.mapSelectActive).toBe(false);
    expect(game.selectedMap).toBe('earth');

    game.update(2, 400, 800); // longer than the serve delay

    expect(game.ballVX !== 0 || game.ballVY !== 0).toBe(true);
  });

  it('does not also register as a map pick when the dismissing tap lands on the "Tap to start" text', () => {
    const game = new Game();
    const width = 400;
    const height = 800;
    game.update(0, width, height);

    // Matches the exact spot where "Tap to start" is rendered, which overlaps
    // the Mars button's hit-region on the map-select screen (issue #63).
    game.onPointerDown(1, width / 2, height / 2 + height * 0.04, width, height);

    expect(game.titleScreenActive).toBe(false);
    expect(game.mapSelectActive).toBe(true);
    expect(game.selectedMap).toBeNull();
  });

  it('does not reappear after a match win and reset', () => {
    const game = startGame();

    for (let i = 0; i < 11; i += 1) {
      game.ballY = 900;
      game.ballVY = 300;
      game.update(0.001, 400, 800);
      game.update(2, 400, 800);
    }
    expect(game.winner).toBe(1);

    game.onPointerDown(1, 200, 400, 400, 800); // taps the game-over state to restart

    expect(game.winner).toBeNull();
    expect(game.titleScreenActive).toBe(false);
  });
});

describe('Game map select', () => {
  // Button centers are ratios of height alone (see startGame's comment above),
  // so these hold for any canvas size: Earth's button sits at 0.43, Mars's at 0.57.
  const EARTH_BUTTON_Y_RATIO = 0.43;
  const MARS_BUTTON_Y_RATIO = 0.57;

  it('has no map selected while the map-select screen is up', () => {
    const game = new Game();
    game.update(0, 400, 800);
    game.onPointerDown(1, 200, 400, 400, 800); // dismiss the title screen

    expect(game.mapSelectActive).toBe(true);
    expect(game.selectedMap).toBeNull();
  });

  it('selects Earth and starts the serve countdown when its button is tapped', () => {
    const game = new Game();
    game.update(0, 400, 800);
    game.onPointerDown(1, 200, 400, 400, 800); // dismiss the title screen

    game.onPointerDown(1, 200, 800 * EARTH_BUTTON_Y_RATIO, 400, 800);
    game.onPointerUp(1);

    expect(game.mapSelectActive).toBe(false);
    expect(game.selectedMap).toBe('earth');

    game.update(2, 400, 800);
    expect(game.ballVX !== 0 || game.ballVY !== 0).toBe(true);
  });

  it('selects Mars and starts the serve countdown when its button is tapped', () => {
    const game = new Game();
    game.update(0, 400, 800);
    game.onPointerDown(1, 200, 400, 400, 800); // dismiss the title screen

    game.onPointerDown(1, 200, 800 * MARS_BUTTON_Y_RATIO, 400, 800);
    game.onPointerUp(1);

    expect(game.mapSelectActive).toBe(false);
    expect(game.selectedMap).toBe('mars');

    game.update(2, 400, 800);
    expect(game.ballVX !== 0 || game.ballVY !== 0).toBe(true);
  });

  it('keeps paddle 1 centered when the Earth button tap lands off-center', () => {
    const game = new Game();
    game.update(0, 400, 800);
    game.onPointerDown(1, 200, 400, 400, 800); // dismiss the title screen

    game.onPointerDown(1, 90, 800 * EARTH_BUTTON_Y_RATIO, 400, 800); // near left edge of Earth's button
    game.onPointerUp(1);

    expect(game.selectedMap).toBe('earth');
    expect(game.paddle1X).toBe(200);
  });

  it('keeps paddle 2 centered when the Mars button tap lands off-center', () => {
    const game = new Game();
    game.update(0, 400, 800);
    game.onPointerDown(1, 200, 400, 400, 800); // dismiss the title screen

    game.onPointerDown(1, 90, 800 * MARS_BUTTON_Y_RATIO, 400, 800); // near left edge of Mars's button
    game.onPointerUp(1);

    expect(game.selectedMap).toBe('mars');
    expect(game.paddle2X).toBe(200);
  });

  it('ignores taps that miss both map buttons, staying on the map-select screen', () => {
    const game = new Game();
    game.update(0, 400, 800);
    game.onPointerDown(1, 200, 400, 400, 800); // dismiss the title screen

    game.onPointerDown(1, 200, 400, 400, 800); // dead center, between the two buttons

    expect(game.mapSelectActive).toBe(true);
    expect(game.selectedMap).toBeNull();
  });

  it('does not move a paddle when a tap on the map-select screen misses both buttons', () => {
    const game = new Game();
    game.update(0, 400, 800);
    game.onPointerDown(1, 200, 400, 400, 800); // dismiss the title screen

    game.onPointerDown(2, 90, 400, 400, 800); // off-center tap, hits neither button

    expect(game.paddle1X).toBe(200);
    expect(game.paddle2X).toBe(200);
  });

  it('keeps the same map through restartMatch instead of returning to map-select', () => {
    const game = startGame(); // picks Earth
    expect(game.selectedMap).toBe('earth');

    for (let i = 0; i < 11; i += 1) {
      game.ballY = 900;
      game.ballVY = 300;
      game.update(0.001, 400, 800);
      game.update(2, 400, 800);
    }
    expect(game.winner).toBe(1);

    game.onPointerDown(1, 200, 400, 400, 800); // taps the game-over state to restart

    expect(game.winner).toBeNull();
    expect(game.mapSelectActive).toBe(false);
    expect(game.selectedMap).toBe('earth');
  });

  it('does not affect the ball launch speed, only which map was picked', () => {
    const earthGame = startGame(); // picks Earth
    const marsGame = new Game();
    marsGame.update(0, 400, 800);
    marsGame.onPointerDown(1, 200, 400, 400, 800);
    marsGame.onPointerDown(1, 200, 800 * MARS_BUTTON_Y_RATIO, 400, 800);
    marsGame.onPointerUp(1);
    marsGame.update(2, 400, 800);

    const earthSpeed = Math.hypot(earthGame.ballVX, earthGame.ballVY);
    const marsSpeed = Math.hypot(marsGame.ballVX, marsGame.ballVY);
    expect(marsSpeed).toBeCloseTo(earthSpeed);
  });
});

describe('Game backdrop', () => {
  it('advances backdropTime by dt on every update', () => {
    const game = new Game();
    game.update(0, 400, 800);
    expect(game.backdropTime).toBe(0);

    game.update(0.5, 400, 800);
    expect(game.backdropTime).toBeCloseTo(0.5);

    game.update(0.25, 400, 800);
    expect(game.backdropTime).toBeCloseTo(0.75);
  });

  it('keeps advancing after the match ends, without affecting the score', () => {
    const game = startGame();
    for (let i = 0; i < 11; i += 1) {
      game.ballY = 900;
      game.ballVY = 300;
      game.update(0.001, 400, 800);
      game.update(2, 400, 800);
    }
    expect(game.winner).toBe(1);

    const timeBefore = game.backdropTime;
    game.update(1, 400, 800);

    expect(game.backdropTime).toBeGreaterThan(timeBefore);
    expect(game.score1).toBe(11);
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
    const game = startGame();
    game.onPointerDown(1, 300, 700, 400, 800);
    expect(game.paddle2X).toBe(300);
  });

  it('clamps paddle position to the canvas width', () => {
    const game = startGame();
    game.onPointerDown(1, -1000, 50, 400, 800);
    expect(game.paddle1X).toBeCloseTo(56); // half the paddle width (0.28 * 400 / 2)

    game.onPointerDown(2, 10000, 50, 400, 800);
    expect(game.paddle1X).toBeCloseTo(344); // width - half the paddle width
  });

  it('tracks independent pointers for each paddle simultaneously', () => {
    const game = startGame();
    game.onPointerDown(1, 100, 50, 400, 800); // player 1, top half
    game.onPointerDown(2, 300, 750, 400, 800); // player 2, bottom half
    expect(game.paddle1X).toBe(100);
    expect(game.paddle2X).toBe(300);

    game.onPointerMove(1, 110, 400); // small delta, within the per-event step cap
    game.onPointerMove(2, 290, 400);
    expect(game.paddle1X).toBe(110);
    expect(game.paddle2X).toBe(290);
  });

  it('ignores pointermove for a pointer that never went down', () => {
    const game = new Game();
    game.onPointerMove(99, 150, 400);
    expect(game.paddle1X).toBe(0);
  });

  it('stops tracking a pointer after pointerup', () => {
    const game = startGame();
    game.onPointerDown(1, 100, 50, 400, 800);
    game.onPointerUp(1);
    game.onPointerMove(1, 350, 400);
    expect(game.paddle1X).toBe(100);
  });
});

describe('Game ball physics', () => {
  it('starts the ball at the center moving diagonally', () => {
    const game = startGame();
    expect(game.ballX).toBe(200);
    expect(game.ballY).toBe(400);
    expect(game.ballVX).not.toBe(0);
    expect(game.ballVY).not.toBe(0);
  });

  it('bounces off the left wall', () => {
    const game = startGame();
    game.ballX = 2;
    game.ballVX = -300;
    game.update(0.001, 400, 800);
    expect(game.ballVX).toBeGreaterThan(0);
    expect(game.ballX).toBeGreaterThanOrEqual(0);
  });

  it('bounces off the right wall', () => {
    const game = startGame();
    game.ballX = 398;
    game.ballVX = 300;
    game.update(0.001, 400, 800);
    expect(game.ballVX).toBeLessThan(0);
    expect(game.ballX).toBeLessThanOrEqual(400);
  });

  it('reflects off player 1 (top) paddle when moving up into it', () => {
    const game = startGame();
    game.paddle1X = 200;
    game.ballX = 200;
    game.ballY = 60; // just above the top paddle band (margin = 0.06 * 800 = 48)
    game.ballVX = 0;
    game.ballVY = -300;

    game.update(0.05, 400, 800);

    expect(game.ballVY).toBeGreaterThan(0); // rebounds downward
  });

  it('reflects off player 2 (bottom) paddle when moving down into it', () => {
    const game = startGame();
    game.paddle2X = 200;
    game.ballX = 200;
    game.ballY = 730; // just above the bottom paddle band (margin = 0.06 * 800 = 48 from bottom -> y=752)
    game.ballVX = 0;
    game.ballVY = 300;

    game.update(0.05, 400, 800);

    expect(game.ballVY).toBeLessThan(0); // rebounds upward
  });

  it('does not reflect off a paddle it misses horizontally', () => {
    const game = startGame();
    game.paddle1X = 50; // far from where the ball is
    game.ballX = 350;
    game.ballY = 55;
    game.ballVX = 0;
    game.ballVY = -300;

    game.update(0.05, 400, 800);

    expect(game.ballVY).toBeLessThan(0); // keeps moving up, no bounce
  });

  it('resets to center when the ball exits past the top edge', () => {
    const game = startGame();
    game.ballX = 200;
    game.ballY = -100;
    game.ballVY = -300;

    game.update(0.001, 400, 800);

    expect(game.ballX).toBe(200);
    expect(game.ballY).toBe(400);
  });

  it('resets to center when the ball exits past the bottom edge', () => {
    const game = startGame();
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
    const game = startGame();
    game.ballY = -100;
    game.ballVY = -300;

    game.update(0.001, 400, 800);

    expect(game.score2).toBe(1);
    expect(game.score1).toBe(0);
  });

  it('awards a point to the top player when the ball exits past the bottom edge', () => {
    const game = startGame();
    game.ballY = 900;
    game.ballVY = 300;

    game.update(0.001, 400, 800);

    expect(game.score1).toBe(1);
    expect(game.score2).toBe(0);
  });

  it('parks the ball at the center with zero velocity during the post-point serve delay', () => {
    const game = startGame();
    game.ballY = -100;
    game.ballVY = -300;

    game.update(0.001, 400, 800);

    expect(game.ballVX).toBe(0);
    expect(game.ballVY).toBe(0);
    expect(game.ballX).toBe(200);
    expect(game.ballY).toBe(400);
  });

  it('re-serves the ball with velocity once the serve delay elapses', () => {
    const game = startGame();
    game.ballY = -100;
    game.ballVY = -300;
    game.update(0.001, 400, 800); // scores the point and starts the serve delay

    game.update(2, 400, 800); // longer than the serve delay

    expect(game.ballVX !== 0 || game.ballVY !== 0).toBe(true);
  });

  it('declares a winner once a player reaches the winning score', () => {
    const game = startGame();

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
    const game = startGame();

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
    const game = startGame();

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

describe('Game win celebration', () => {
  it('starts the win celebration timer at zero and advances it once the match is won', () => {
    const game = startGame();
    for (let i = 0; i < 10; i += 1) {
      game.ballY = 900;
      game.ballVY = 300;
      game.update(0.001, 400, 800);
      game.update(2, 400, 800);
    }
    expect(game.winner).toBeNull();

    game.ballY = 900;
    game.ballVY = 300;
    game.update(0.001, 400, 800); // the winning point

    expect(game.winner).toBe(1);
    expect(game.winCelebrationElapsed).toBe(0);

    game.update(0.5, 400, 800);
    expect(game.winCelebrationElapsed).toBeCloseTo(0.5);

    game.update(0.5, 400, 800);
    expect(game.winCelebrationElapsed).toBeCloseTo(1);
  });

  it('resets the win celebration timer when the match restarts, without affecting score/winner logic', () => {
    const game = startGame();
    for (let i = 0; i < 11; i += 1) {
      game.ballY = 900;
      game.ballVY = 300;
      game.update(0.001, 400, 800);
      game.update(2, 400, 800);
    }
    expect(game.winner).toBe(1);
    expect(game.winCelebrationElapsed).toBeGreaterThan(0);

    game.onPointerDown(1, 200, 400, 400, 800);

    expect(game.winner).toBeNull();
    expect(game.score1).toBe(0);
    expect(game.score2).toBe(0);
    expect(game.winCelebrationElapsed).toBe(0);
  });
});

describe('Game power-ups', () => {
  it('registers all four power-ups via the extensible kind registry', () => {
    expect(POWER_UP_KINDS).toContain('freeze-paddle');
    expect(POWER_UP_KINDS).toContain('fast-ball');
    expect(POWER_UP_KINDS).toContain('giant-paddle');
    expect(POWER_UP_KINDS).toContain('multi-ball');
  });

  it('spawns a power-up on the field once the spawn interval elapses during an active rally', () => {
    const game = startGame(); // initializes and serves
    game.ballVX = 0;
    game.ballVY = 0; // freeze the ball so the rally never ends during the wait

    expect(game.activePowerUp).toBeNull();
    game.update(POWER_UP_SPAWN_INTERVAL_SECONDS, 400, 800);

    expect(game.activePowerUp).not.toBeNull();
    expect(POWER_UP_KINDS).toContain(game.activePowerUp!.kind);
  });

  it('does not spawn a power-up while the ball is off-screen during the post-point serve delay', () => {
    const game = startGame();
    game.ballY = -100;
    game.ballVY = -300;
    game.update(0.001, 400, 800); // scores the point and starts the serve delay

    game.update(POWER_UP_SPAWN_INTERVAL_SECONDS, 400, 800); // long enough to spawn if it were active

    expect(game.activePowerUp).toBeNull();
  });

  it('does not spawn a second power-up while one is already active', () => {
    const game = startGame();
    game.ballVX = 0;
    game.ballVY = 0;
    game.update(POWER_UP_SPAWN_INTERVAL_SECONDS, 400, 800);
    const firstPowerUp = game.activePowerUp;
    expect(firstPowerUp).not.toBeNull();

    game.update(POWER_UP_SPAWN_INTERVAL_SECONDS, 400, 800);

    expect(game.activePowerUp).toBe(firstPowerUp);
  });

  it('activates the Freeze effect on the opponent paddle and removes the icon when the ball collides with it', () => {
    const game = startGame();
    game.lastPaddleTouch = 1; // paddle 1 hit it last, so paddle 2 gets frozen
    game.activePowerUp = { id: 1, kind: 'freeze-paddle', x: game.ballX, y: game.ballY };

    game.update(0, 400, 800);

    expect(game.activePowerUp).toBeNull();
    expect(game.paddleSpeedMultiplier2).toBe(FREEZE_PADDLE_MULTIPLIER);
    expect(game.freezeRemaining2).toBe(FREEZE_PADDLE_DURATION_SECONDS);
    expect(game.paddleSpeedMultiplier1).toBe(1);
  });

  it('reduces how far a drag can move the frozen paddle in a single move event', () => {
    const game = startGame();
    game.onPointerDown(1, 200, 50, 400, 800); // registers the pointer as controlling paddle 1

    game.paddle1X = 0; // simulate the paddle sitting at the far left edge
    game.onPointerMove(1, 400, 400); // drag toward the far right edge, well beyond the step cap
    const paddle1XAfterNormal = game.paddle1X;

    game.paddle1X = 0;
    game.paddleSpeedMultiplier1 = FREEZE_PADDLE_MULTIPLIER;
    game.onPointerMove(1, 400, 400);
    const paddle1XAfterFrozen = game.paddle1X;

    expect(paddle1XAfterNormal).toBeCloseTo(400 * PADDLE_MOVE_STEP_RATIO);
    expect(paddle1XAfterFrozen).toBeCloseTo(400 * PADDLE_MOVE_STEP_RATIO * FREEZE_PADDLE_MULTIPLIER);
    expect(paddle1XAfterFrozen).toBeLessThan(paddle1XAfterNormal);
  });

  it('caps a single drag event to a small enough step that a full-width flick spans several pointermove events', () => {
    // Regression test for #53: PADDLE_MOVE_STEP_RATIO must be low enough to
    // actually bind during a real drag, otherwise the Freeze multiplier
    // scales a cap that was never the bottleneck and has no visible effect.
    const game = startGame();
    game.onPointerDown(1, 200, 50, 400, 800);

    game.paddle1X = 0;
    game.onPointerMove(1, 400, 400); // one drag event, all the way across the canvas
    expect(game.paddle1X).toBeLessThan(400 * 0.2); // far from snapping instantly to the target
  });

  it('takes a frozen paddle noticeably more drag events to cross the canvas than baseline', () => {
    const game = startGame();
    game.onPointerDown(1, 200, 50, 400, 800);

    // 340 sits within the paddle's reachable range (it is clamped to keep the
    // whole paddle on-canvas), so this is a real reachable target rather than
    // one that gets stuck short of it because of that separate clamp.
    const target = 340;
    const eventsToCross = (multiplier: number): number => {
      game.paddle1X = 0;
      game.paddleSpeedMultiplier1 = multiplier;
      let events = 0;
      while (game.paddle1X < target - 1e-6 && events < 1000) {
        game.onPointerMove(1, target, 400);
        events++;
      }
      return events;
    };

    const normalEvents = eventsToCross(1);
    const frozenEvents = eventsToCross(FREEZE_PADDLE_MULTIPLIER);

    // With a non-binding cap this gap is only a single event (imperceptible);
    // a real fix must make the difference clearly perceptible during play.
    expect(frozenEvents - normalEvents).toBeGreaterThanOrEqual(3);
  });

  it('does not clamp small, normal-speed drag deltas, so baseline dragging still tracks the finger 1:1', () => {
    const game = startGame();
    game.onPointerDown(1, 200, 50, 400, 800);

    game.onPointerMove(1, 210, 400); // a small, realistic per-event delta from continuous dragging
    expect(game.paddle1X).toBe(210);
  });

  it('reverts the Freeze effect automatically once its duration elapses', () => {
    const game = startGame();
    game.lastPaddleTouch = 2; // paddle 2 hit it last, so paddle 1 gets frozen
    game.activePowerUp = { id: 1, kind: 'freeze-paddle', x: game.ballX, y: game.ballY };
    game.ballVX = 0;
    game.ballVY = 0; // freeze the ball so the rally does not end during the wait

    game.update(0, 400, 800); // activates the freeze
    expect(game.paddleSpeedMultiplier1).toBe(FREEZE_PADDLE_MULTIPLIER);

    game.update(FREEZE_PADDLE_DURATION_SECONDS, 400, 800);

    expect(game.paddleSpeedMultiplier1).toBe(1);
    expect(game.freezeRemaining1).toBe(0);
  });

  it('leaves the Freeze icon uncollected if no paddle has touched the ball yet', () => {
    const game = startGame();
    expect(game.lastPaddleTouch).toBeNull();
    game.activePowerUp = { id: 1, kind: 'freeze-paddle', x: game.ballX, y: game.ballY };

    game.update(0, 400, 800);

    expect(game.activePowerUp).not.toBeNull();
    expect(game.paddleSpeedMultiplier1).toBe(1);
    expect(game.paddleSpeedMultiplier2).toBe(1);
    expect(game.freezeRemaining1).toBe(0);
    expect(game.freezeRemaining2).toBe(0);
  });

  it('lets each paddle keep an independent Freeze expiry (issue #25)', () => {
    const game = startGame();
    game.ballVX = 0;
    game.ballVY = 0; // freeze the ball so the rally does not end during the wait

    game.lastPaddleTouch = 1; // freezes paddle 2
    game.activateFreezePaddle();
    expect(game.paddleSpeedMultiplier2).toBe(FREEZE_PADDLE_MULTIPLIER);

    game.update(2, 400, 800); // 2s into paddle 2's 4s freeze
    game.lastPaddleTouch = 2; // freezes paddle 1
    game.activateFreezePaddle();
    expect(game.paddleSpeedMultiplier1).toBe(FREEZE_PADDLE_MULTIPLIER);

    game.update(5, 400, 800); // well past both paddles' 4s windows

    expect(game.paddleSpeedMultiplier1).toBe(1);
    expect(game.paddleSpeedMultiplier2).toBe(1);
  });

  it('activates the Fast Ball effect, multiplying the current ball speed, when the ball collides with it', () => {
    const game = startGame();
    game.ballVX = 100;
    game.ballVY = -200;
    game.activePowerUp = { id: 1, kind: 'fast-ball', x: game.ballX, y: game.ballY };

    game.update(0, 400, 800);

    expect(game.activePowerUp).toBeNull();
    expect(game.ballVX).toBeCloseTo(100 * FAST_BALL_MULTIPLIER);
    expect(game.ballVY).toBeCloseTo(-200 * FAST_BALL_MULTIPLIER);
  });

  it('keeps the Fast Ball speed boost through a paddle bounce', () => {
    const game = startGame();
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
    const game = startGame();

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

  it('still bounces off a paddle when a stacked Fast Ball speed would otherwise tunnel through it horizontally', () => {
    const game = startGame();

    // Reproduces issue #19: the ball starts dead-center in X on player 1's
    // paddle (band = [131.2, 268.8]) just below its Y band, with enough
    // horizontal speed (comparable to ~8 stacked Fast Ball pickups) that a
    // single 1/60s frame would carry it clean past the opposite edge under
    // an end-of-frame-only X check.
    game.paddle1X = 200;
    game.ballX = 200;
    game.ballY = 68.5;
    game.ballVX = 6000;
    game.ballVY = -2663.5;

    game.update(1 / 60, 400, 800);

    expect(game.ballVY).toBeGreaterThan(0); // rebounds downward instead of tunneling through
    expect(game.score2).toBe(0); // player 2 must not be awarded an undeserved point
  });

  it('does not register a paddle bounce when the X and Y bounding ranges overlap the band independently but the actual path passes to the side (issue #21)', () => {
    const game = startGame(800, 400);

    // Reproduces issue #21: at extreme stacked-Fast-Ball speed the ball's
    // whole-frame X range and whole-frame Y range each independently overlap
    // player 1's collision band (X = [288, 512], Y around the top margin),
    // but the true straight-line path from (0, 396) to (~666.7, 4) crosses
    // the paddle's Y-band at x =~ 626.5 -- well past the paddle's right edge
    // -- so it must NOT be treated as a bounce.
    game.paddle1X = 400;
    game.ballX = 0;
    game.ballY = 396;
    game.ballVX = 40000;
    game.ballVY = -23520;
    game.lastPaddleTouch = null;

    game.update(1 / 60, 800, 400);

    expect(game.lastPaddleTouch).toBeNull(); // no bounce registered
    expect(game.ballVY).toBeLessThan(0); // ball keeps travelling on its original diagonal, unreflected
    expect(game.score1).toBe(0);
    expect(game.score2).toBe(0);
  });

  it('still bounces off a paddle when a side-wall bounce and the paddle crossing both happen within the same frame (issue #23)', () => {
    const game = startGame(800, 400);

    // Reproduces issue #23: at extreme stacked-Fast-Ball speed the ball
    // crosses the left wall early in the frame (t =~ 0.95ms in), then -- per
    // true straight-line-with-reflection physics -- travels back across the
    // court for the rest of the frame, crossing player 1's collision band
    // (X =~ [581.6, 818.4]) on the way. The old single-Euler-step-then-clamp
    // implementation collapsed the ball's X to the wall for the whole frame
    // and never saw this second leg, letting the ball tunnel through a
    // correctly-positioned paddle.
    game.paddle1X = 700;
    game.ballX = 50;
    game.ballY = 380;
    game.ballVX = -46000;
    game.ballVY = -22000;
    game.lastPaddleTouch = null;

    game.update(1 / 60, 800, 400);

    expect(game.lastPaddleTouch).toBe(1); // bounce registered off player 1's paddle
    expect(game.ballVY).toBeGreaterThan(0); // rebounds downward instead of tunneling through
    expect(game.score2).toBe(0); // player 2 must not be awarded an undeserved point
  });

  it('ignores a power-up the ball has not reached yet', () => {
    const game = startGame();
    game.activePowerUp = { id: 1, kind: 'fast-ball', x: game.ballX + 1000, y: game.ballY + 1000 };
    const vx = game.ballVX;
    const vy = game.ballVY;

    game.update(0, 400, 800);

    expect(game.activePowerUp).not.toBeNull();
    expect(game.ballVX).toBe(vx);
    expect(game.ballVY).toBe(vy);
  });

  it('activates the Giant Paddle effect, widening the collecting paddle, when the ball collides with it', () => {
    const game = startGame();
    game.lastPaddleTouch = 1;
    game.activePowerUp = { id: 1, kind: 'giant-paddle', x: game.ballX, y: game.ballY };

    game.update(0, 400, 800);

    expect(game.activePowerUp).toBeNull();
    expect(game.paddleWidthMultiplier1).toBe(GIANT_PADDLE_MULTIPLIER);
    expect(game.giantPaddleRemaining1).toBe(GIANT_PADDLE_DURATION_SECONDS);
  });

  it('leaves the Giant Paddle icon uncollected if no paddle has touched the ball yet', () => {
    const game = startGame();
    expect(game.lastPaddleTouch).toBeNull();
    game.activePowerUp = { id: 1, kind: 'giant-paddle', x: game.ballX, y: game.ballY };

    game.update(0, 400, 800);

    expect(game.activePowerUp).not.toBeNull();
    expect(game.paddleWidthMultiplier1).toBe(1);
    expect(game.paddleWidthMultiplier2).toBe(1);
    expect(game.giantPaddleRemaining1).toBe(0);
    expect(game.giantPaddleRemaining2).toBe(0);
  });

  it('re-clamps a paddle sitting at the edge so it stays fully on-canvas when Giant Paddle activates', () => {
    const game = startGame();
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
    const game = startGame();

    game.onPointerDown(1, -1000, 50, 400, 800);
    const clampedNormal = game.paddle1X;

    game.paddleWidthMultiplier1 = GIANT_PADDLE_MULTIPLIER;
    game.onPointerDown(1, -1000, 50, 400, 800);
    const clampedGiant = game.paddle1X;

    expect(clampedGiant).toBeGreaterThan(clampedNormal);
  });

  it('reverts the Giant Paddle automatically once its duration elapses', () => {
    const game = startGame();
    game.lastPaddleTouch = 2;
    game.activePowerUp = { id: 1, kind: 'giant-paddle', x: game.ballX, y: game.ballY };
    game.ballVX = 0;
    game.ballVY = 0; // freeze the ball so the rally does not end during the wait

    game.update(0, 400, 800); // activates the effect
    expect(game.paddleWidthMultiplier2).toBe(GIANT_PADDLE_MULTIPLIER);

    game.update(GIANT_PADDLE_DURATION_SECONDS, 400, 800);

    expect(game.paddleWidthMultiplier2).toBe(1);
    expect(game.giantPaddleRemaining2).toBe(0);
  });

  it('lets each paddle keep an independent Giant Paddle expiry (issue #25)', () => {
    const game = startGame();
    game.ballVX = 0;
    game.ballVY = 0; // freeze the ball so the rally does not end during the wait

    game.lastPaddleTouch = 1;
    game.activateGiantPaddle();
    expect(game.paddleWidthMultiplier1).toBe(GIANT_PADDLE_MULTIPLIER);

    game.update(2, 400, 800); // 2s into paddle 1's 5s boost
    game.lastPaddleTouch = 2;
    game.activateGiantPaddle();
    expect(game.paddleWidthMultiplier2).toBe(GIANT_PADDLE_MULTIPLIER);

    game.update(6, 400, 800); // well past both paddles' 5s windows

    expect(game.paddleWidthMultiplier1).toBe(1);
    expect(game.paddleWidthMultiplier2).toBe(1);
  });

  it('activates the Multi-Ball effect, putting an extra ball into play, when the ball collides with it', () => {
    const game = startGame();
    game.activePowerUp = { id: 1, kind: 'multi-ball', x: game.ballX, y: game.ballY };

    game.update(0, 400, 800);

    expect(game.activePowerUp).toBeNull();
    expect(game.extraBalls).toHaveLength(1);
    expect(game.extraBalls[0].vx !== 0 || game.extraBalls[0].vy !== 0).toBe(true);
  });

  it('moves the extra ball independently and lets it score a point for whichever side it exits past', () => {
    const game = startGame();
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
    const game = startGame();
    game.extraBalls.push({ x: 200, y: 400, vx: 0, vy: 0, remaining: MULTI_BALL_DURATION_SECONDS });
    game.ballVX = 0;
    game.ballVY = 0; // freeze the primary ball so it doesn't score during the long wait

    game.update(MULTI_BALL_DURATION_SECONDS, 400, 800);

    expect(game.extraBalls).toHaveLength(0);
    expect(game.score1).toBe(0);
    expect(game.score2).toBe(0);
  });

  it('clears any extra balls once the primary ball ends the rally', () => {
    const game = startGame();
    game.extraBalls.push({ x: 200, y: 400, vx: 0, vy: 0, remaining: MULTI_BALL_DURATION_SECONDS });
    game.ballY = -100;
    game.ballVY = -300;

    game.update(0.001, 400, 800); // primary ball exits and scores

    expect(game.extraBalls).toHaveLength(0);
  });
});

describe('Game haptic events', () => {
  it('queues a paddle-hit event when the ball bounces off a paddle', () => {
    const game = startGame();
    game.paddle1X = 200;
    game.ballX = 200;
    game.ballY = 60;
    game.ballVX = 0;
    game.ballVY = -300;

    game.update(0.05, 400, 800);

    expect(game.consumeHapticEvents()).toEqual(['paddle-hit']);
  });

  it('queues a wall-bounce event when the ball bounces off a side wall', () => {
    const game = startGame();
    game.ballX = 395;
    game.ballY = 400;
    game.ballVX = 300;
    game.ballVY = 0;

    game.update(0.05, 400, 800);

    expect(game.consumeHapticEvents()).toEqual(['wall-bounce']);
  });

  it('queues a score event when a point is awarded', () => {
    const game = startGame();
    game.ballY = -100;
    game.ballVY = -300;

    game.update(0.001, 400, 800);

    expect(game.consumeHapticEvents()).toEqual(['score']);
  });

  it('queues a power-up event when a power-up is collected', () => {
    const game = startGame();
    game.lastPaddleTouch = 1;
    game.activePowerUp = { id: 1, kind: 'freeze-paddle', x: game.ballX, y: game.ballY };

    game.update(0, 400, 800);

    expect(game.consumeHapticEvents()).toEqual(['power-up']);
  });

  it('drains the queue on consumption, leaving it empty until the next event', () => {
    const game = startGame();
    game.ballY = -100;
    game.ballVY = -300;
    game.update(0.001, 400, 800);

    expect(game.consumeHapticEvents()).toEqual(['score']);
    expect(game.consumeHapticEvents()).toEqual([]);
  });
});

describe('Game screen shake', () => {
  it('triggers a screen shake when a power-up is collected', () => {
    const game = startGame();
    game.lastPaddleTouch = 1;
    game.activePowerUp = { id: 1, kind: 'freeze-paddle', x: game.ballX, y: game.ballY };

    game.update(0, 400, 800);

    expect(game.screenShakeRemaining).toBeGreaterThan(0);
  });

  it('triggers a screen shake on a paddle hit above the base launch speed', () => {
    const game = startGame();
    game.paddle1X = 200;
    game.ballX = 200;
    game.ballY = 60;
    game.ballVX = 0;
    game.ballVY = -600; // base launch speed on an 800px-tall canvas is 800 * 0.55 = 440

    game.update(0.05, 400, 800);

    expect(game.screenShakeRemaining).toBeGreaterThan(0);
  });

  it('does not trigger a screen shake on a normal-speed paddle hit', () => {
    const game = startGame();
    game.paddle1X = 200;
    game.ballX = 200;
    game.ballY = 60;
    game.ballVX = 0;
    game.ballVY = -300; // below the 440px/s base launch speed

    game.update(0.05, 400, 800);

    expect(game.screenShakeRemaining).toBe(0);
  });

  it('decays the shake to zero via dt and never lets it persist', () => {
    const game = startGame();
    game.lastPaddleTouch = 1;
    game.activePowerUp = { id: 1, kind: 'freeze-paddle', x: game.ballX, y: game.ballY };
    game.ballVX = 0;
    game.ballVY = 0; // freeze the ball so the rally does not end during the wait
    game.update(0, 400, 800); // triggers the shake
    expect(game.screenShakeRemaining).toBeGreaterThan(0);

    game.update(1, 400, 800); // far longer than the shake duration

    expect(game.screenShakeRemaining).toBe(0);
  });

  it('does not accumulate across overlapping triggers', () => {
    const game = startGame();
    game.lastPaddleTouch = 1;
    game.activePowerUp = { id: 1, kind: 'freeze-paddle', x: game.ballX, y: game.ballY };
    game.ballVX = 0;
    game.ballVY = 0; // freeze the ball so the rally does not end during the wait
    game.update(0, 400, 800); // first trigger
    const firstRemaining = game.screenShakeRemaining;

    game.update(0.01, 400, 800); // let it partially decay
    game.activePowerUp = { id: 2, kind: 'fast-ball', x: game.ballX, y: game.ballY };
    game.update(0, 400, 800); // second trigger before the first fully decays

    expect(game.screenShakeRemaining).toBe(firstRemaining);
  });
});

describe('Game pause (#70)', () => {
  // The pause button and the five overlay action buttons are all ratios of
  // width/height alone (see their *Ratio constants in game.ts), so these
  // hold for any canvas size at the default 400x800 used by startGame.
  const PAUSE_BUTTON_X = 352;
  const PAUSE_BUTTON_Y = 48;
  const RESUME_BUTTON_X = 200;
  const RESUME_BUTTON_Y = 240;
  const RESTART_BUTTON_Y = 516;
  const QUIT_BUTTON_Y = 608;

  it('does not pause when tapping the pause button coordinates before a match starts', () => {
    const game = new Game();
    game.update(0, 400, 800);

    game.onPointerDown(1, PAUSE_BUTTON_X, PAUSE_BUTTON_Y, 400, 800);

    expect(game.paused).toBe(false);
    expect(game.mapSelectActive).toBe(true); // the tap dismissed the title screen instead
  });

  it('pauses the match when the pause button is tapped during an active match', () => {
    const game = startGame();

    game.onPointerDown(1, PAUSE_BUTTON_X, PAUSE_BUTTON_Y, 400, 800);
    game.onPointerUp(1);

    expect(game.paused).toBe(true);
  });

  it('does not show/hit-test the pause button on the win screen, restarting the match instead', () => {
    const game = startGame();
    for (let i = 0; i < 11; i += 1) {
      game.ballY = 900;
      game.ballVY = 300;
      game.update(0.001, 400, 800);
      game.update(2, 400, 800);
    }
    expect(game.winner).toBe(1);

    game.onPointerDown(1, PAUSE_BUTTON_X, PAUSE_BUTTON_Y, 400, 800);

    expect(game.paused).toBe(false);
    expect(game.winner).toBeNull(); // the win screen's tap-to-restart handled it instead
  });

  it('freezes ball position and velocity while paused', () => {
    const game = startGame();
    const { ballX, ballY, ballVX, ballVY } = game;
    game.onPointerDown(1, PAUSE_BUTTON_X, PAUSE_BUTTON_Y, 400, 800);
    game.onPointerUp(1);

    game.update(1, 400, 800);

    expect(game.ballX).toBe(ballX);
    expect(game.ballY).toBe(ballY);
    expect(game.ballVX).toBe(ballVX);
    expect(game.ballVY).toBe(ballVY);
  });

  it('freezes the power-up spawn timer while paused', () => {
    const game = startGame();
    game.onPointerDown(1, PAUSE_BUTTON_X, PAUSE_BUTTON_Y, 400, 800);
    game.onPointerUp(1);

    game.update(POWER_UP_SPAWN_INTERVAL_SECONDS + 1, 400, 800); // would spawn one if unpaused

    expect(game.activePowerUp).toBeNull();
  });

  it('does not move a paddle while dragging a pointer that went down before the pause', () => {
    const game = startGame();
    game.onPointerDown(2, 50, 700, 400, 800); // starts dragging paddle 2
    const paddle2XBeforePause = game.paddle2X;
    game.onPointerDown(1, PAUSE_BUTTON_X, PAUSE_BUTTON_Y, 400, 800); // pauses with a second pointer
    game.onPointerUp(1);

    game.onPointerMove(2, 350, 400);

    expect(game.paddle2X).toBe(paddle2XBeforePause);
  });

  it('resumes exactly where the match left off (score, ball, power-ups unchanged) when Resume is tapped', () => {
    const game = startGame();
    game.lastPaddleTouch = 1;
    game.activePowerUp = { id: 1, kind: 'fast-ball', x: game.ballX, y: game.ballY };
    game.score1 = 3;
    game.score2 = 5;
    const { ballX, ballY, ballVX, ballVY } = game;
    game.onPointerDown(1, PAUSE_BUTTON_X, PAUSE_BUTTON_Y, 400, 800);
    game.onPointerUp(1);
    game.update(2, 400, 800); // frozen while paused

    game.onPointerDown(1, RESUME_BUTTON_X, RESUME_BUTTON_Y, 400, 800);
    game.onPointerUp(1);

    expect(game.paused).toBe(false);
    expect(game.score1).toBe(3);
    expect(game.score2).toBe(5);
    expect(game.ballX).toBe(ballX);
    expect(game.ballY).toBe(ballY);
    expect(game.ballVX).toBe(ballVX);
    expect(game.ballVY).toBe(ballVY);
    expect(game.activePowerUp).toEqual({ id: 1, kind: 'fast-ball', x: ballX, y: ballY });
  });

  it('resets score/ball/power-ups but keeps the selected map when Restart Match is tapped', () => {
    const game = startGame(); // picks Earth
    game.score1 = 3;
    game.score2 = 5;
    game.activePowerUp = { id: 1, kind: 'fast-ball', x: game.ballX, y: game.ballY };
    game.onPointerDown(1, PAUSE_BUTTON_X, PAUSE_BUTTON_Y, 400, 800);
    game.onPointerUp(1);

    game.onPointerDown(1, RESUME_BUTTON_X, RESTART_BUTTON_Y, 400, 800);
    game.onPointerUp(1);

    expect(game.paused).toBe(false);
    expect(game.score1).toBe(0);
    expect(game.score2).toBe(0);
    expect(game.activePowerUp).toBeNull();
    expect(game.selectedMap).toBe('earth');
    expect(game.mapSelectActive).toBe(false);
  });

  it('returns to the title screen, clearing the selected map, when Quit to Title is tapped', () => {
    const game = startGame(); // picks Earth
    game.score1 = 3;
    game.score2 = 5;
    game.onPointerDown(1, PAUSE_BUTTON_X, PAUSE_BUTTON_Y, 400, 800);
    game.onPointerUp(1);

    game.onPointerDown(1, RESUME_BUTTON_X, QUIT_BUTTON_Y, 400, 800);
    game.onPointerUp(1);

    expect(game.paused).toBe(false);
    expect(game.titleScreenActive).toBe(true);
    expect(game.mapSelectActive).toBe(false);
    expect(game.selectedMap).toBeNull();
    expect(game.score1).toBe(0);
    expect(game.score2).toBe(0);

    game.onPointerDown(1, 200, 400, 400, 800); // requires re-picking a map, same as a fresh title dismissal
    expect(game.mapSelectActive).toBe(true);
  });
});

describe('Game pause > Change Map and Settings (#71)', () => {
  const PAUSE_BUTTON_X = 352;
  const PAUSE_BUTTON_Y = 48;
  const RESUME_BUTTON_X = 200;
  const CHANGE_MAP_BUTTON_Y = 332;
  const SETTINGS_BUTTON_Y = 424;
  // Reuses the same button-center ratio as the "Game map select" describe
  // block above, since Pause > Change Map renders the exact same screen.
  const MARS_BUTTON_Y = 800 * 0.57;
  // The settings screen only ever stacks two buttons (sound toggle, back),
  // regardless of PAUSE_ACTIONS.length, so its centers differ from the main
  // pause overlay's.
  const SOUND_TOGGLE_BUTTON_Y = 378;
  const SETTINGS_BACK_BUTTON_Y = 470;

  function pause(game: Game): void {
    game.onPointerDown(1, PAUSE_BUTTON_X, PAUSE_BUTTON_Y, 400, 800);
    game.onPointerUp(1);
  }

  it('opens the map-select screen, still paused, when Change Map is tapped', () => {
    const game = startGame();
    pause(game);

    game.onPointerDown(1, RESUME_BUTTON_X, CHANGE_MAP_BUTTON_Y, 400, 800);
    game.onPointerUp(1);

    expect(game.paused).toBe(true);
    expect(game.pauseMapSelectActive).toBe(true);
  });

  it('applies the newly picked map without resetting score, ball, or power-ups, then returns to the pause overlay', () => {
    const game = startGame(); // picks Earth
    game.score1 = 3;
    game.score2 = 5;
    game.activePowerUp = { id: 1, kind: 'fast-ball', x: game.ballX, y: game.ballY };
    const { ballX, ballY, ballVX, ballVY } = game;
    pause(game);
    game.onPointerDown(1, RESUME_BUTTON_X, CHANGE_MAP_BUTTON_Y, 400, 800);
    game.onPointerUp(1);

    game.onPointerDown(1, 200, MARS_BUTTON_Y, 400, 800);
    game.onPointerUp(1);

    expect(game.selectedMap).toBe('mars');
    expect(game.pauseMapSelectActive).toBe(false);
    expect(game.paused).toBe(true); // back at the pause overlay, not resumed
    expect(game.score1).toBe(3);
    expect(game.score2).toBe(5);
    expect(game.ballX).toBe(ballX);
    expect(game.ballY).toBe(ballY);
    expect(game.ballVX).toBe(ballVX);
    expect(game.ballVY).toBe(ballVY);
    expect(game.activePowerUp).toEqual({ id: 1, kind: 'fast-ball', x: ballX, y: ballY });
  });

  it('keeps gameplay frozen while the pause map-select screen is up', () => {
    const game = startGame();
    pause(game);
    game.onPointerDown(1, RESUME_BUTTON_X, CHANGE_MAP_BUTTON_Y, 400, 800);
    game.onPointerUp(1);
    const { ballX, ballY } = game;

    game.update(2, 400, 800);

    expect(game.ballX).toBe(ballX);
    expect(game.ballY).toBe(ballY);
  });

  it('ignores a tap that misses both map buttons, staying on the pause map-select screen', () => {
    const game = startGame(); // picks Earth
    pause(game);
    game.onPointerDown(1, RESUME_BUTTON_X, CHANGE_MAP_BUTTON_Y, 400, 800);
    game.onPointerUp(1);

    game.onPointerDown(1, 200, 400, 400, 800); // dead center, between the two buttons

    expect(game.pauseMapSelectActive).toBe(true);
    expect(game.selectedMap).toBe('earth');
  });

  it('opens the settings screen, still paused, when Settings is tapped', () => {
    const game = startGame();
    pause(game);

    game.onPointerDown(1, RESUME_BUTTON_X, SETTINGS_BUTTON_Y, 400, 800);
    game.onPointerUp(1);

    expect(game.paused).toBe(true);
    expect(game.pauseSettingsActive).toBe(true);
  });

  it('defaults sound to enabled', () => {
    const game = new Game();
    expect(game.soundEnabled).toBe(true);
  });

  it('toggles soundEnabled when the sound button is tapped, without touching match state', () => {
    const game = startGame();
    game.score1 = 3;
    pause(game);
    game.onPointerDown(1, RESUME_BUTTON_X, SETTINGS_BUTTON_Y, 400, 800);
    game.onPointerUp(1);

    game.onPointerDown(1, RESUME_BUTTON_X, SOUND_TOGGLE_BUTTON_Y, 400, 800);
    game.onPointerUp(1);

    expect(game.soundEnabled).toBe(false);
    expect(game.pauseSettingsActive).toBe(true); // stays on the settings screen after toggling
    expect(game.score1).toBe(3);

    game.onPointerDown(1, RESUME_BUTTON_X, SOUND_TOGGLE_BUTTON_Y, 400, 800);
    game.onPointerUp(1);
    expect(game.soundEnabled).toBe(true);
  });

  it('returns to the pause overlay when Back is tapped on the settings screen', () => {
    const game = startGame();
    pause(game);
    game.onPointerDown(1, RESUME_BUTTON_X, SETTINGS_BUTTON_Y, 400, 800);
    game.onPointerUp(1);

    game.onPointerDown(1, RESUME_BUTTON_X, SETTINGS_BACK_BUTTON_Y, 400, 800);
    game.onPointerUp(1);

    expect(game.pauseSettingsActive).toBe(false);
    expect(game.paused).toBe(true);
  });

  it('keeps the sound preference through Resume, Restart Match, and Quit to Title', () => {
    const game = startGame();
    pause(game);
    game.onPointerDown(1, RESUME_BUTTON_X, SETTINGS_BUTTON_Y, 400, 800);
    game.onPointerUp(1);
    game.onPointerDown(1, RESUME_BUTTON_X, SOUND_TOGGLE_BUTTON_Y, 400, 800);
    game.onPointerUp(1);
    expect(game.soundEnabled).toBe(false);
    game.onPointerDown(1, RESUME_BUTTON_X, SETTINGS_BACK_BUTTON_Y, 400, 800);
    game.onPointerUp(1);

    game.onPointerDown(1, RESUME_BUTTON_X, 240, 400, 800); // taps Resume
    game.onPointerUp(1);

    expect(game.paused).toBe(false);
    expect(game.soundEnabled).toBe(false);

    pause(game);
    game.onPointerDown(1, RESUME_BUTTON_X, 516, 400, 800); // taps Restart Match
    game.onPointerUp(1);
    expect(game.soundEnabled).toBe(false);

    pause(game);
    game.onPointerDown(1, RESUME_BUTTON_X, 608, 400, 800); // taps Quit to Title
    game.onPointerUp(1);
    expect(game.soundEnabled).toBe(false);
  });
});

describe('Game menu button press feedback (#77)', () => {
  const PAUSE_BUTTON_X = 352;
  const PAUSE_BUTTON_Y = 48;
  const EARTH_BUTTON_Y = 800 * 0.43;

  it('arms a menu button on pointerdown without committing its action until release', () => {
    const game = new Game();
    game.update(0, 400, 800);
    game.onPointerDown(1, 200, 400, 400, 800); // dismiss the title screen
    game.onPointerUp(1);

    game.onPointerDown(1, 200, EARTH_BUTTON_Y, 400, 800); // press, don't release yet

    expect(game.pressedPointerId).toBe(1);
    expect(game.pressedButtonKey).toBe('map-select:0');
    expect(game.mapSelectActive).toBe(true); // action not yet committed
    expect(game.selectedMap).toBeNull();

    game.onPointerUp(1);

    expect(game.pressedPointerId).toBeNull();
    expect(game.pressedButtonKey).toBeNull();
    expect(game.mapSelectActive).toBe(false);
    expect(game.selectedMap).toBe('earth');
  });

  it('cancels the press without committing the action on pointercancel', () => {
    const game = new Game();
    game.update(0, 400, 800);
    game.onPointerDown(1, 200, 400, 400, 800);
    game.onPointerUp(1);

    game.onPointerDown(1, 200, EARTH_BUTTON_Y, 400, 800);
    game.onPointerCancel(1);

    expect(game.pressedButtonKey).toBeNull();
    expect(game.mapSelectActive).toBe(true);
    expect(game.selectedMap).toBeNull();
  });

  it('cancels the press when the pointer moves off the button before release', () => {
    const game = new Game();
    game.update(0, 400, 800);
    game.onPointerDown(1, 200, 400, 400, 800);
    game.onPointerUp(1);

    game.onPointerDown(1, 200, EARTH_BUTTON_Y, 400, 800);
    game.onPointerMove(1, 200, 400, 10); // well above the button's rect

    expect(game.pressedButtonKey).toBeNull();

    game.onPointerUp(1);

    expect(game.mapSelectActive).toBe(true); // never committed
    expect(game.selectedMap).toBeNull();
  });

  it('keeps the press armed while the pointer stays within the button', () => {
    const game = new Game();
    game.update(0, 400, 800);
    game.onPointerDown(1, 200, 400, 400, 800);
    game.onPointerUp(1);

    game.onPointerDown(1, 200, EARTH_BUTTON_Y, 400, 800);
    game.onPointerMove(1, 205, 400, EARTH_BUTTON_Y); // small jitter, still over the same button

    expect(game.pressedButtonKey).toBe('map-select:0');
  });

  it('tracks the pause icon as pressed while held, independently of paddle dragging by another pointer', () => {
    const game = startGame();
    const paddle1XBefore = game.paddle1X;

    game.onPointerDown(1, PAUSE_BUTTON_X, PAUSE_BUTTON_Y, 400, 800); // press, don't release yet

    expect(game.pressedButtonKey).toBe('pause-icon');
    expect(game.paused).toBe(false); // not yet committed

    game.onPointerDown(2, 100, 50, 400, 800); // a second pointer drags paddle 1
    game.onPointerMove(2, 150, 400);

    expect(game.paddle1X).not.toBe(paddle1XBefore);
    expect(game.pressedButtonKey).toBe('pause-icon'); // unaffected by the other pointer

    game.onPointerUp(1);
    expect(game.paused).toBe(true);
  });
});

describe('Menu button tap areas cover their full visible bounds (#78)', () => {
  // Every button rect below is read straight off the *Rect helpers in
  // game.ts (mapButtonRect, pauseOverlayButtonRect, pauseSettingsButtonRect,
  // pauseButtonRect) at the 400x800 canvas size used throughout this test
  // suite, so these coordinates are exactly the AABB shared by hit-testing
  // and rendering -- not approximations. Each button is tapped (down, then
  // up, per #77's press/commit model) at all four corners plus the
  // midpoints of its four edges, not just its center.
  function corners(rect: { x: number; y: number; w: number; h: number }): [number, number][] {
    const { x, y, w, h } = rect;
    return [
      [x, y], // top-left
      [x + w, y], // top-right
      [x, y + h], // bottom-left
      [x + w, y + h], // bottom-right
      [x + w / 2, y], // top-mid
      [x + w / 2, y + h], // bottom-mid
      [x, y + h / 2], // left-mid
      [x + w, y + h / 2], // right-mid
    ];
  }

  function tap(game: Game, x: number, y: number): void {
    game.onPointerDown(1, x, y, 400, 800);
    game.onPointerUp(1);
  }

  describe('map-select cards', () => {
    const EARTH_RECT = { x: 80, y: 304, w: 240, h: 80 };
    const MARS_RECT = { x: 80, y: 416, w: 240, h: 80 };

    it.each(corners(EARTH_RECT))('selects Earth when tapped at (%i, %i)', (x, y) => {
      const game = new Game();
      game.update(0, 400, 800);
      tap(game, 200, 400); // dismiss the title screen

      tap(game, x, y);

      expect(game.selectedMap).toBe('earth');
    });

    it.each(corners(MARS_RECT))('selects Mars when tapped at (%i, %i)', (x, y) => {
      const game = new Game();
      game.update(0, 400, 800);
      tap(game, 200, 400); // dismiss the title screen

      tap(game, x, y);

      expect(game.selectedMap).toBe('mars');
    });
  });

  describe('pause-overlay buttons', () => {
    const PAUSE_BUTTON_X = 352;
    const PAUSE_BUTTON_Y = 48;
    const RESUME_RECT = { x: 76, y: 206, w: 248, h: 68 };
    const MAP_RECT = { x: 76, y: 298, w: 248, h: 68 };
    const SETTINGS_RECT = { x: 76, y: 390, w: 248, h: 68 };
    const RESTART_RECT = { x: 76, y: 482, w: 248, h: 68 };
    const QUIT_RECT = { x: 76, y: 574, w: 248, h: 68 };

    function pause(game: Game): void {
      tap(game, PAUSE_BUTTON_X, PAUSE_BUTTON_Y);
    }

    it.each(corners(RESUME_RECT))('resumes when Resume is tapped at (%i, %i)', (x, y) => {
      const game = startGame();
      pause(game);

      tap(game, x, y);

      expect(game.paused).toBe(false);
    });

    it.each(corners(MAP_RECT))('opens Change Map when tapped at (%i, %i)', (x, y) => {
      const game = startGame();
      pause(game);

      tap(game, x, y);

      expect(game.pauseMapSelectActive).toBe(true);
    });

    it.each(corners(SETTINGS_RECT))('opens Settings when tapped at (%i, %i)', (x, y) => {
      const game = startGame();
      pause(game);

      tap(game, x, y);

      expect(game.pauseSettingsActive).toBe(true);
    });

    it.each(corners(RESTART_RECT))('restarts the match when Restart Match is tapped at (%i, %i)', (x, y) => {
      const game = startGame();
      game.score1 = 3;
      pause(game);

      tap(game, x, y);

      expect(game.paused).toBe(false);
      expect(game.score1).toBe(0);
    });

    it.each(corners(QUIT_RECT))('returns to the title screen when Quit to Title is tapped at (%i, %i)', (x, y) => {
      const game = startGame();
      pause(game);

      tap(game, x, y);

      expect(game.titleScreenActive).toBe(true);
    });
  });

  describe('pause-settings buttons', () => {
    const PAUSE_BUTTON_X = 352;
    const PAUSE_BUTTON_Y = 48;
    const SETTINGS_BUTTON_Y = 424;
    const SOUND_TOGGLE_RECT = { x: 76, y: 344, w: 248, h: 68 };
    const BACK_RECT = { x: 76, y: 436, w: 248, h: 68 };

    function openSettings(game: Game): void {
      tap(game, PAUSE_BUTTON_X, PAUSE_BUTTON_Y);
      tap(game, 200, SETTINGS_BUTTON_Y);
    }

    it.each(corners(SOUND_TOGGLE_RECT))('toggles sound when tapped at (%i, %i)', (x, y) => {
      const game = startGame();
      openSettings(game);

      tap(game, x, y);

      expect(game.soundEnabled).toBe(false);
    });

    it.each(corners(BACK_RECT))('returns to the pause overlay when Back is tapped at (%i, %i)', (x, y) => {
      const game = startGame();
      openSettings(game);

      tap(game, x, y);

      expect(game.pauseSettingsActive).toBe(false);
      expect(game.paused).toBe(true);
    });
  });

  describe('the in-match pause icon button', () => {
    const PAUSE_RECT = { x: 324, y: 20, w: 56, h: 56 };

    it.each(corners(PAUSE_RECT))('pauses the match when tapped at (%i, %i)', (x, y) => {
      const game = startGame();

      tap(game, x, y);

      expect(game.paused).toBe(true);
    });
  });
});
