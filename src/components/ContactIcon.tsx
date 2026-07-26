/**
 * Icons for the header contact line.
 *
 * Inline SVG, `aria-hidden`, and never a glyph: an icon FONT (or an emoji) lands in the
 * PDF's text layer, where an ATS reads it as a word joined to the address next to it,
 * and one character outside the bundled latin subset makes Chrome embed a whole fallback
 * font (which `npm run ats-check` fails on). A path draws nothing into the text layer,
 * so the extracted contact line is byte-identical with icons on or off.
 *
 * `detectContactKind` is a guess about a plain string, so it is only ever a default:
 * every contact carries an optional `icon` that overrides it, including 'none'.
 */
export type ContactKind = 'email' | 'phone' | 'location' | 'linkedin' | 'github' | 'link';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// +90 533 198 38 53, (555) 123-4567, 05331983853. At least six digits, nothing but
// dial punctuation around them, so a house number in an address does not qualify.
const PHONE = /^\+?[\d][\d\s().-]{5,}$/;
const LINKEDIN = /(^|\/\/|\s)(www\.)?linkedin\.com\//i;
// `in/gurur-...` is how LinkedIn's own share text writes it, and it is what people paste.
const LINKEDIN_SHORT = /^in\/[\w-]+$/i;
const GITHUB = /(^|\/\/|\s)(www\.)?github\.(com|io)\b/i;
const URLISH = /^(https?:\/\/|www\.)|^[\w-]+(\.[\w-]+)+(\/|$)/i;

/** Best guess for a contact string, or null when nothing fits. */
export function detectContactKind(value: string): ContactKind | null {
  const v = value.trim();
  if (!v) return null;
  if (EMAIL.test(v)) return 'email';
  if (LINKEDIN.test(v) || LINKEDIN_SHORT.test(v)) return 'linkedin';
  if (GITHUB.test(v)) return 'github';
  if (PHONE.test(v)) return 'phone';
  if (URLISH.test(v)) return 'link';
  // "Bornova, İzmir, Turkey" / "San Francisco, CA": words and separators, no digits. A
  // bare single word is left alone - it is as likely to be a handle as a city.
  if (/^[^\d@]+,[^\d@]+$/.test(v)) return 'location';
  return null;
}

/**
 * 16x16 viewBox, `currentColor`, stroke 1.6. Sized in em by .cv-contact-ico so the icon
 * follows the contact line's font size at every zoom and every template.
 */
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
      {/* Brand marks drawn as plain geometry: the "in" is two strokes inside the badge
          rather than type, so no font is involved and nothing reaches the text layer. */}
      {kind === 'linkedin' && (
        <>
          <rect x="1.8" y="1.8" width="12.4" height="12.4" rx="2" />
          <path d="M5 6.9v4.3" />
          <path d="M5 4.7v.1" />
          <path d="M8 11.2V6.9m0 1.5a2 2 0 0 1 3.4 1.4v1.4" />
        </>
      )}
      {/* Git branch, not the octocat: a recognisable mark for a code host that survives
          being drawn at ~8px, which a silhouette does not. */}
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
