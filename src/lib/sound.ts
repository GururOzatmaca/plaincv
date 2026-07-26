const MUTE_KEY = 'cv-generator/mute';

let chime: HTMLAudioElement | null = null;

export function isMuted(): boolean {
  try {

    const saved = localStorage.getItem(MUTE_KEY);
    if (saved !== null) return saved === '1';
  } catch {}
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function setMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {}
}

const PEAK = 0.34;
const FADE_IN_MS = 70;

const FADE_OUT_AT_MS = 950;
const FADE_OUT_MS = 260;

let ramp: ReturnType<typeof setInterval> | null = null;
let fadeOutAt: ReturnType<typeof setTimeout> | null = null;

function rampTo(el: HTMLAudioElement, target: number, ms: number, onDone?: () => void): void {
  if (ramp) clearInterval(ramp);
  const from = el.volume;
  const started = performance.now();
  ramp = setInterval(() => {
    const t = Math.min(1, (performance.now() - started) / ms);
    el.volume = Math.max(0, Math.min(1, from + (target - from) * t));
    if (t >= 1) {
      if (ramp) clearInterval(ramp);
      ramp = null;
      onDone?.();
    }
  }, 16);
}

export function playSuccess(): void {
  if (isMuted()) return;
  try {
    if (!chime) {
      chime = new Audio('/sounds/chime.mp3');
      chime.preload = 'auto';
    }
    const el = chime;
    if (fadeOutAt) clearTimeout(fadeOutAt);
    el.currentTime = 0;
    el.volume = 0;

    void el.play().catch(() => {});

    rampTo(el, PEAK, FADE_IN_MS);
    fadeOutAt = setTimeout(() => {
      rampTo(el, 0, FADE_OUT_MS, () => el.pause());
    }, FADE_OUT_AT_MS);
  } catch {}
}
