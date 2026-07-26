import { get, set } from 'idb-keyval';
import { ResumeSchema, type Resume } from '@/schema/resume';
import { normalizePersistedDoc } from '@/schema/factory';
import { sampleResume } from '@/schema/sample';

export const STORE_KEY = 'cv-generator/doc';

export const PERSIST_VERSION = 8;

export interface Library {
  library: Record<string, Resume>;
  activeId: string;
}

export type RecoveryState = null | { kind: 'unreadable'; backupKey: string };

let recovery: RecoveryState = null;
export const getRecovery = (): RecoveryState => recovery;

function backup(suffix: string, payload: unknown): string {
  const key = `${STORE_KEY}.bak.${suffix}`;
  try {

    void set(key, JSON.stringify(payload)).catch(() => {});
  } catch {}
  return key;
}

export function noteUnreadable(raw: string): void {
  recovery = { kind: 'unreadable', backupKey: backup('unparseable', raw) };
}

const readDoc = (raw: unknown): Resume | null => {
  const parsed = ResumeSchema.safeParse(normalizePersistedDoc(raw));
  return parsed.success ? parsed.data : null;
};

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

  const doc = readDoc(r.doc);
  return doc ? { lib: { library: { [doc.id]: doc }, activeId: doc.id }, dropped: 0 } : null;
}

const seedLibrary = (): Library => ({ library: { [sampleResume.id]: sampleResume }, activeId: sampleResume.id });

function applyV6(lib: Library): void {
  for (const doc of Object.values(lib.library)) {
    if (doc.theme.skillStyle === 'badge') doc.theme.skillStyle = 'plain';
  }
}

function applyV7(lib: Library): void {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  for (const doc of Object.values(lib.library)) {
    const t = doc.theme;
    t.nameScale = r2(t.headingScale * 1.15);
    t.headingScale = r2(Math.max(t.headingScale * 0.6, 1));
  }
}

function applyV8(lib: Library): void {
  for (const doc of Object.values(lib.library)) {
    const t = doc.theme;
    t.blockSpacing = t.density;
    t.rowSpacing = t.density;
  }
}

export function migratePersisted(persisted: unknown, fromVersion: number): Library {
  const key = backup(`v${fromVersion}`, persisted);
  const read = readLibrary(persisted);

  if (read && fromVersion < 6) applyV6(read.lib);
  if (read && fromVersion < 7) applyV7(read.lib);
  if (read && fromVersion < 8) applyV8(read.lib);
  if (read && !read.dropped) return read.lib;
  recovery = { kind: 'unreadable', backupKey: key };
  return read ? read.lib : seedLibrary();
}

export function mergePersisted(persisted: unknown, fallback: Library): Library {
  if (persisted == null) return fallback;
  const read = readLibrary(persisted);
  if (read && !read.dropped) return read.lib;
  recovery = { kind: 'unreadable', backupKey: backup('corrupt', persisted) };
  return read ? read.lib : fallback;
}

export async function readBackup(key: string): Promise<string | null> {
  try {
    const v = await get(key);
    return typeof v === 'string' ? v : v === undefined ? null : JSON.stringify(v);
  } catch {
    return null;
  }
}

export async function restoreBackup(key: string): Promise<Resume | null> {
  const text = await readBackup(key);
  if (!text) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }

  const inner = (data as { state?: unknown }).state ?? data;
  const read = readLibrary(inner);
  if (read) return read.lib.library[read.lib.activeId] ?? null;
  return readDoc((inner as { doc?: unknown })?.doc ?? inner);
}
