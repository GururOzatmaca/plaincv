/** Save text as a file. The only durable backup path in an app with no account. */
export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking synchronously cancels the download in Firefox.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "Backend Engineer CV" -> "backend-engineer-cv". Empty input -> fallback. */
export function slugify(s: string, fallback = 'my-cv'): string {
  const out = s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return out || fallback;
}
