const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ABSOLUTE = /^https?:\/\/\S+$/i;
const DOMAIN = /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i;
const PHONE = /^\+?[\d][\d\s().-]{6,}$/;

export function toHref(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (EMAIL.test(s)) return `mailto:${s}`;
  if (ABSOLUTE.test(s)) return s;
  if (DOMAIN.test(s)) return `https://${s}`;
  if (PHONE.test(s)) return `tel:${s.replace(/[\s().-]/g, '')}`;
  return null;
}
