import { setLang, suggestLang, type Lang } from '@/i18n';
import './langgate.css';

const LANGS: { id: Lang; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'tr', label: 'Türkçe' },
];

/**
 * First run only. Its copy is bilingual on purpose: at this point nothing has been chosen,
 * so showing it in one language would already be answering the question.
 */
export function LangGate({ onPick }: { onPick: () => void }) {
  const suggested = suggestLang();

  const pick = (l: Lang) => {
    setLang(l);
    onPick();
  };

  return (
    <div className="lg-overlay">
      <div className="lg-card" role="dialog" aria-modal="true" aria-labelledby="lg-title">
        <span className="lg-logo grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-semibold text-white">
          CV
        </span>
        <h1 className="lg-title" id="lg-title">
          Language · Dil
        </h1>
        <p className="lg-sub">Choose your language · Dilinizi seçin</p>
        <div className="lg-actions">
          {LANGS.map((l) => (
            <button
              key={l.id}
              type="button"
              className={`lg-btn${l.id === suggested ? ' lg-btn-primary' : ''}`}
              autoFocus={l.id === suggested}
              onClick={() => pick(l.id)}
            >
              {l.label}
            </button>
          ))}
        </div>
        <p className="lg-note">You can change this any time in Help · Yardım bölümünden değiştirebilirsiniz</p>
      </div>
    </div>
  );
}
