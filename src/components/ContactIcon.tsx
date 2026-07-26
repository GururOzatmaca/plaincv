export type ContactKind = 'email' | 'phone' | 'location' | 'linkedin' | 'github' | 'link';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const PHONE = /^\+?[\d][\d\s().-]{5,}$/;
const LINKEDIN = /(^|\/\/|\s)(www\.)?linkedin\.com\//i;

const LINKEDIN_SHORT = /^in\/[\w-]+$/i;
const GITHUB = /(^|\/\/|\s)(www\.)?github\.(com|io)\b/i;
const URLISH = /^(https?:\/\/|www\.)|^[\w-]+(\.[\w-]+)+(\/|$)/i;

export function detectContactKind(value: string): ContactKind | null {
  const v = value.trim();
  if (!v) return null;
  if (EMAIL.test(v)) return 'email';
  if (LINKEDIN.test(v) || LINKEDIN_SHORT.test(v)) return 'linkedin';
  if (GITHUB.test(v)) return 'github';
  if (PHONE.test(v)) return 'phone';
  if (URLISH.test(v)) return 'link';

  if (/^[^\d@]+,[^\d@]+$/.test(v)) return 'location';
  return null;
}

export function ContactIcon({ kind }: { kind: ContactKind }) {
  return (
    <svg className="cv-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {kind === 'email' && (
        <>
          <rect x="1.6" y="3.4" width="12.8" height="9.2" rx="1.4" />
          <path d="M2.2 4.4 8 8.9l5.8-4.5" />
        </>
      )}
      {kind === 'phone' && (
        <path d="M4.1 2.2h2.2l1.1 2.7-1.5 1.1a7.4 7.4 0 0 0 3.1 3.1l1.1-1.5 2.7 1.1v2.2a1.4 1.4 0 0 1-1.5 1.4A10.4 10.4 0 0 1 2.7 3.7 1.4 1.4 0 0 1 4.1 2.2Z" />
      )}
      {kind === 'location' && (
        <>
          <path d="M8 14.2S13 9.9 13 6.6A5 5 0 0 0 3 6.6C3 9.9 8 14.2 8 14.2Z" />
          <circle cx="8" cy="6.5" r="1.8" />
        </>
      )}

      {kind === 'linkedin' && (
        <>
          <rect x="1.8" y="1.8" width="12.4" height="12.4" rx="2" />
          <path d="M5 6.9v4.3" />
          <path d="M5 4.7v.1" />
          <path d="M8 11.2V6.9m0 1.5a2 2 0 0 1 3.4 1.4v1.4" />
        </>
      )}

      {kind === 'github' && (
        <>
          <circle cx="4.6" cy="3.6" r="1.8" />
          <circle cx="4.6" cy="12.4" r="1.8" />
          <circle cx="11.4" cy="6.2" r="1.8" />
          <path d="M4.6 5.4v5.2" />
          <path d="M9.6 7.3a4.4 4.4 0 0 1-3.6 3.2" />
        </>
      )}
      {kind === 'link' && (
        <>
          <circle cx="8" cy="8" r="6.2" />
          <path d="M1.8 8h12.4" />
          <path d="M8 1.8a9.6 9.6 0 0 1 0 12.4 9.6 9.6 0 0 1 0-12.4Z" />
        </>
      )}
    </svg>
  );
}
