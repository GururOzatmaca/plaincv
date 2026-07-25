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

export function playSuccess(): void {
  if (isMuted()) return;
  try {
    if (!chime) {
      chime = new Audio('/sounds/chime.mp3');
      chime.preload = 'auto';
    }
    chime.currentTime = 0;
    chime.volume = 0.85;
    void chime.play();
  } catch {
    // audio unavailable; silent failure is fine
  }
}
