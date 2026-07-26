// Success chime. Played from a click-initiated flow so autoplay policy allows it.
// Asset: SoundShelfStudio via Pixabay, Pixabay Content License. See CREDITS.md.
const MUTE_KEY = 'cv-generator/mute';

let chime: HTMLAudioElement | null = null;

export function isMuted(): boolean {
  try {
    // Someone who asked the OS for less motion is unlikely to want a surprise
    // noise either; treat that as an opt-out unless they say otherwise.
    const saved = localStorage.getItem(MUTE_KEY);
    if (saved !== null) return saved === '1';
  } catch {
    // private mode: fall through
  }
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function setMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // private mode: the choice just will not survive a reload
  }
}

// Peak volume. 0.85 was loud enough to be startling in a quiet room, which is the
// room most people write a CV in. This is a confirmation, not an alert.
const PEAK = 0.34;
const FADE_IN_MS = 70;
// The success splash auto-closes ~1600ms after the import and the chime starts at
// ~300ms, so the sound is faded out to land with the splash instead of continuing
// over an editor the user is already looking at again.
const FADE_OUT_AT_MS = 950;
const FADE_OUT_MS = 260;

let ramp: ReturnType<typeof setInterval> | null = null;
let fadeOutAt: ReturnType<typeof setTimeout> | null = null;

/** Linear volume ramp. No WebAudio graph for one sound; a timer is enough here. */
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
    void el.play();
    // fade in so the attack is not a click
    rampTo(el, PEAK, FADE_IN_MS);
    fadeOutAt = setTimeout(() => {
      rampTo(el, 0, FADE_OUT_MS, () => el.pause());
    }, FADE_OUT_AT_MS);
  } catch {
    // audio unavailable; silent failure is fine
  }
}
