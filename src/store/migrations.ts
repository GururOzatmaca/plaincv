import { get, set } from 'idb-keyval';
import { ResumeSchema, type Resume } from '@/schema/resume';
import { normalizePersistedDoc } from '@/schema/factory';
import { sampleResume } from '@/schema/sample';

// Key name predates the library and is kept deliberately: renaming it would orphan
// every existing user's only copy of their CV.
export const STORE_KEY = 'cv-generator/doc';
// v3: bullets became {id, runs} (were Line[]).
// v4: skills items became {id, label?, values[]} (were string[]); retired template
// ids remapped. normalizePersistedDoc backfills all of it and is idempotent.
// v5: one document became a library - {doc} -> {library: {<id>: doc}, activeId}.
export const PERSIST_VERSION = 5;

/**
 * Every document plus which one is being edited.
 *
 * Deliberately ONE IndexedDB key holding all documents rather than a key per
 * document plus an index. IndexedDB is the only copy of a user's CVs (no account,
 * no server), and a single key makes each save atomic: there is no window in which
 * the index names a document that was never written. The cost is rewriting every
 * document on each debounced save, which at CV sizes is a few hundred KB.
 */
export interface Library {
  library: Record<string, Resume>;
  activeId: string;
}

/** Why the loaded doc is not the one that was saved. Read by the UI to warn. */
export type RecoveryState = null | { kind: 'unreadable'; backupKey: string };

let recovery: RecoveryState = null;
export const getRecovery = (): RecoveryState => recovery;

/**
 * Snapshot a payload we are about to replace or could not read. IndexedDB is the
 * only copy of a user's CV (no account, no server), so nothing here may be the
 * last thing that touches it. Fire-and-forget: a failed backup must not block load.
 */
function backup(suffix: string, payload: unknown): string {
  const key = `${STORE_KEY}.bak.${suffix}`;
  try {
    // .catch is load-bearing: an IndexedDB quota rejection is async, so without it the
    // rejection escapes this try/catch as `unhandledrejection` and ErrorBoundary turns
    // a failed backup into a full-screen crash on the load path.
    void set(key, JSON.stringify(payload)).catch(() => {});
  } catch {
    // JSON.stringify on an unserializable payload; nothing useful to do here
  }
  return key;
}

/**
 * The stored text could not even be JSON-parsed, so hydration never reaches
 * mergePersisted and nothing else would ever warn. Back the bytes up and flag the
 * recovery banner before the app quietly shows the sample CV instead.
 */
export function noteUnreadable(raw: string): void {
  recovery = { kind: 'unreadable', backupKey: backup('unparseable', raw) };
}

const readDoc = (raw: unknown): Resume | null => {
  const parsed = ResumeSchema.safeParse(normalizePersistedDoc(raw));
  return parsed.success ? parsed.data : null;
};

/**
 * Any persisted shape -> a library. Reads both the v5 library and the single
 * `{doc}` of every earlier version, so one function covers load and migration.
 * `dropped` counts documents that failed validation: losing one of five silently
 * would be worse than losing all five, because nothing would warn.
 */
function readLibrary(raw: unknown): { lib: Library; dropped: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { library?: unknown; activeId?: unknown; doc?: unknown };

  if (r.library && typeof r.library === 'object') {
    const out: Record<string, Resume> = {};
    let dropped = 0;
    for (const [id, entry] of Object.entries(r.library as Record<string, unknown>)) {
      const doc = readDoc(entry);
      if (doc) out[id] = doc;
      else dropped++;
    }
    const ids = Object.keys(out);
    if (!ids.length) return null;
    const activeId = typeof r.activeId === 'string' && out[r.activeId] ? r.activeId : ids[0];
    return { lib: { library: out, activeId }, dropped };
  }

  // v4 and older: the whole payload was a single document.
  const doc = readDoc(r.doc);
  return doc ? { lib: { library: { [doc.id]: doc }, activeId: doc.id }, dropped: 0 } : null;
}

const seedLibrary = (): Library => ({ library: { [sampleResume.id]: sampleResume }, activeId: sampleResume.id });

/**
 * Version chain. Older payloads fall through to the same reader, which validates.
 * Never returns the seed without first backing up what was there, so a bad
 * migration is recoverable instead of fatal.
 */
export function migratePersisted(persisted: unknown, fromVersion: number): Library {
  const key = backup(`v${fromVersion}`, persisted);
  const read = readLibrary(persisted);
  if (read && !read.dropped) return read.lib;
  recovery = { kind: 'unreadable', backupKey: key };
  return read ? read.lib : seedLibrary();
}

/**
 * Runs for payloads already at the current version. Same contract as the
 * migration path: validate, and if it fails, keep a copy before falling back.
 */
export function mergePersisted(persisted: unknown, fallback: Library): Library {
  if (persisted == null) return fallback;
  const read = readLibrary(persisted);
  if (read && !read.dropped) return read.lib;
  recovery = { kind: 'unreadable', backupKey: backup('corrupt', persisted) };
  return read ? read.lib : fallback;
}

/** Raw backup text, so the user can save it even when it cannot be parsed. */
export async function readBackup(key: string): Promise<string | null> {
  try {
    const v = await get(key);
    return typeof v === 'string' ? v : v === undefined ? null : JSON.stringify(v);
  } catch {
    return null;
  }
}

/** Best-effort recovery. Accepts every backup shape: v5 library, `{doc}`, bare doc. */
export async function restoreBackup(key: string): Promise<Resume | null> {
  const text = await readBackup(key);
  if (!text) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  // A backup is `{state: {...}, version}` from zustand, or an older bare payload.
  const inner = (data as { state?: unknown }).state ?? data;
  const read = readLibrary(inner);
  if (read) return read.lib.library[read.lib.activeId] ?? null;
  return readDoc((inner as { doc?: unknown })?.doc ?? inner);
}
