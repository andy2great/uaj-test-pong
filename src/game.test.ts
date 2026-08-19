import { describe, expect, it } from 'vitest';
import { Game, clamp } from './game';

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

describe('Game', () => {
  it('counts taps in the score', () => {
    const game = new Game();
    game.onTap(0, 0);
    game.onTap(10, 10);
    expect(game.score).toBe(2);
  });

  it('updates without throwing', () => {
    const game = new Game();
    game.update(0.016);
    expect(game.score).toBe(0);
  });
});
