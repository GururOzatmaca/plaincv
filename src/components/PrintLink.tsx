import { toHref } from '@/lib/autolink';

/**
 * Print-only twin of an editable string, rendered as a real anchor so email,
 * phone and profile URLs are clickable in the exported PDF. The editable span
 * cannot itself be wrapped in an <a> (clicking it would navigate instead of
 * placing the caret), so the two swap places between screen and print via CSS.
 * Same characters in both, so extracted text is unchanged.
 */
export function PrintLink({ value, className }: { value: string; className?: string }) {
  const href = toHref(value);
  if (!href) return null;
  return (
    <a className={`cv-printlink${className ? ` ${className}` : ''}`} href={href}>
      {value}
    </a>
  );
}

/** True when `value` will be replaced by an anchor in print. */
export const willLink = (value: string): boolean => toHref(value) !== null;
