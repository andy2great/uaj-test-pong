import type { HapticEventKind } from './game';

// Procedurally synthesized sound effects for game events, built with
// OscillatorNode/GainNode/noise buffers only -- no audio files, no network
// requests. Only this file (imported by main.ts) touches AudioContext, so
// src/game.ts stays free of Audio/DOM globals per CLAUDE.md.

let audioCtx: AudioContext | null = null;

// Must be called from inside a user-gesture handler (the first pointerdown)
// to satisfy mobile autoplay policies. Safe to call again on later gestures.
export function resumeAudio(): void {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === 'suspended') {
    void audioCtx.resume();
  }
}

function playTone(freq: number, duration: number, type: OscillatorType, peakGain: number, delay = 0): void {
  const ctx = audioCtx;
  if (!ctx) {
    return;
  }
  const start = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(peakGain, start + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

// Short burst of filtered white noise -- gives wall bounces a percussive
// "tock" that reads as distinct from the tonal paddle/score/power-up cues.
function playNoiseBurst(duration: number, peakGain: number, filterFreq: number): void {
  const ctx = audioCtx;
  if (!ctx) {
    return;
  }
  const start = ctx.currentTime;
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = Math.random() * 2 - 1;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(filterFreq, start);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(peakGain, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  noise.start(start);
  noise.stop(start + duration + 0.02);
}

const SOUND_PLAYERS: Record<HapticEventKind, () => void> = {
  'paddle-hit': () => playTone(440, 0.07, 'square', 0.18),
  'wall-bounce': () => playNoiseBurst(0.05, 0.2, 900),
  score: () => {
    playTone(523.25, 0.12, 'sine', 0.22);
    playTone(783.99, 0.16, 'sine', 0.22, 0.1);
  },
  'power-up': () => {
    playTone(392, 0.07, 'sawtooth', 0.16);
    playTone(587.33, 0.07, 'sawtooth', 0.16, 0.07);
    playTone(880, 0.1, 'sawtooth', 0.16, 0.14);
  },
};

// No-op until resumeAudio() has run (i.e. before the first user gesture),
// so nothing can play before mobile autoplay policies allow it.
export function playSound(kind: HapticEventKind): void {
  if (!audioCtx || audioCtx.state !== 'running') {
    return;
  }
  SOUND_PLAYERS[kind]();
}
