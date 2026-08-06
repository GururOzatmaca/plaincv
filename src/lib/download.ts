export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Letters NFKD will not take apart. Turkish dotless i is the one that bit: it has no
 * decomposition, so it came out the far side of the normaliser intact, failed the a-z test
 * and turned into a separator. "Şıla Çiftçi" filed itself as "s-la-ciftci".
 */
const FOLD: Record<string, string> = {
  ı: 'i',
  İ: 'I',
  ß: 'ss',
  ẞ: 'SS',
  ø: 'o',
  Ø: 'O',
  ł: 'l',
  Ł: 'L',
  đ: 'd',
  Đ: 'D',
  æ: 'ae',
  Æ: 'AE',
  œ: 'oe',
  Œ: 'OE',
};

const toAscii = (s: string): string =>
  s
    .replace(/[ıİßẞøØłŁđĐæÆœŒ]/g, (c) => FOLD[c] ?? c)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');

/**
 * What the CV is called when it lands in Downloads. The name as typed, its capitals kept,
 * its accents folded to ASCII so a job portal that still speaks latin-1 cannot mangle it.
 */
export function cvFileName(fullName: string, fallback = 'My CV'): string {
  const name = toAscii(fullName)
    // Everything a filesystem argues about becomes a space, including / \ : * ? " < > |
    .replace(/[^A-Za-z0-9'’ -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .trim();
  return name ? `${name} CV` : fallback;
}

export function slugify(s: string, fallback = 'my-cv'): string {
  const out = toAscii(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return out || fallback;
}
