import { useEffect, useRef, useState } from 'react';
import { useDialog } from '@/lib/useDialog';
import { useT, useLang, type Key, type Lang } from '@/i18n';
import './video.css';

/** One clip per entry point; every asset is named after it. */
export type VideoClip = 'ai-flow' | 'li-flow';

const COPY: Record<VideoClip, { title: Key; sub: Key }> = {
  'ai-flow': { title: 'video.title', sub: 'video.sub' },
  'li-flow': { title: 'video.li.title', sub: 'video.li.sub' },
};

// A language's own name is never translated, so these stay literal, as in Shortcuts.
const CAPTIONS: { id: Lang; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'tr', label: 'Türkçe' },
];

export function VideoDialog({
  open,
  clip,
  onClose,
}: {
  open: boolean;
  clip: VideoClip;
  onClose: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const cardRef = useDialog(open, onClose);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(false);

  /**
   * Safari and Chrome both refuse unmuted autoplay unless they credit the opening click as
   * a gesture, and that credit is not reliable from an effect. Falling back to muted keeps
   * the clip moving; the button below buys the sound back with one click.
   */
  useEffect(() => {
    if (!open) return;
    const v = videoRef.current;
    if (!v) return;
    setMuted(false);
    v.muted = false;
    v.play().catch(() => {
      v.muted = true;
      setMuted(true);
      v.play().catch(() => {});
    });
    // `clip` belongs here: the element is keyed by it, so a clip change swaps in a fresh video
    // that this effect has to start over again.
  }, [open, clip]);

  if (!open) return null;

  const unmute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = false;
    setMuted(false);
    v.play().catch(() => {});
  };

  return (
    <div className="vid-overlay" onClick={onClose}>
      <div
        ref={cardRef}
        className="vid-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="vid-title"
      >
        <button className="vid-x" type="button" onClick={onClose} aria-label={t('video.close')}>
          ×
        </button>
        <h2 className="vid-title" id="vid-title">
          {t(COPY[clip].title)}
        </h2>
        <p className="vid-sub">{t(COPY[clip].sub)}</p>
        <div className="vid-frame">
          <video
            ref={videoRef}
            key={clip}
            className="vid-el"
            controls
            playsInline
            preload="auto"
            poster={`/media/${clip}.jpg`}
          >
            <source src={`/media/${clip}.mp4`} type="video/mp4" />
            {CAPTIONS.map((c) => (
              <track
                key={c.id}
                kind="captions"
                src={`/media/${clip}.${c.id}.vtt`}
                srcLang={c.id}
                label={c.label}
                default={c.id === lang}
              />
            ))}
            {t('video.unsupported')}
          </video>
          {muted && (
            <button className="vid-unmute" type="button" onClick={unmute}>
              {t('video.unmute')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
