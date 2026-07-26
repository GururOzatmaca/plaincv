import { toHref } from '@/lib/autolink';

export function PrintLink({ value, className }: { value: string; className?: string }) {
  const href = toHref(value);
  if (!href) return null;
  return (
    <a className={`cv-printlink${className ? ` ${className}` : ''}`} href={href}>
      {value}
    </a>
  );
}

export const willLink = (value: string): boolean => toHref(value) !== null;
