import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { temporal } from 'zundo';
import { get, set, del } from 'idb-keyval';
import { ResumeSchema, type Resume } from '@/schema/resume';
import { sampleResume } from '@/schema/sample';
import { blankResume, uid } from '@/schema/factory';
import { STORE_KEY, PERSIST_VERSION, migratePersisted, mergePersisted, noteUnreadable, type Library } from './migrations';

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pending: { name: string; value: string } | null = null;

const tombstones = new Set<string>();
export const markDeleted = (id: string): void => void tombstones.add(id);

const PAD_KEY = `${STORE_KEY}.pad`;
const writePad = (value: string) => {
  try {
    localStorage.setItem(PAD_KEY, value);
  } catch {}
};
const readPad = (): string | null => {
  try {
    const v = localStorage.getItem(PAD_KEY);
    if (v !== null) localStorage.removeItem(PAD_KEY);
    return v;
  } catch {
    return null;
  }
};

const clearPad = () => {
  try {
    localStorage.removeItem(PAD_KEY);
  } catch {}
};

const channel: BroadcastChannel | null =
  typeof BroadcastChannel === 'function' ? new BroadcastChannel(STORE_KEY) : null;
const TAB_ID = uid();

async function mergeIntoStored(name: string, value: string): Promise<string> {
  try {
    const next = JSON.parse(value) as { state?: { library?: Record<string, unknown>; activeId?: string } };
    const prevRaw = await get(name);
    if (typeof prevRaw !== 'string' || !next.state?.library) return value;
    const prev = JSON.parse(prevRaw) as { state?: { library?: Record<string, unknown> } };
    if (!prev.state?.library) return value;
    const merged: Record<string, unknown> = {};
    for (const [key, entry] of [
      ...Object.entries(prev.state.library),
      ...Object.entries(next.state.library),
    ]) {
      // Keying by the doc's own id keeps a stale key from smuggling a deleted
      // doc past the tombstones, which deletes by id.
      const id = (entry as { id?: unknown })?.id;
      merged[typeof id === 'string' ? id : key] = entry;
    }
    for (const id of tombstones) delete merged[id];
    next.state.library = merged;
    return JSON.stringify(next);
  } catch {
    return value;
  }
}

const persistNow = async (name: string, value: string) => {
  try {
    await set(name, await mergeIntoStored(name, value));
    clearPad();
    channel?.postMessage({ from: TAB_ID });
  } catch {

    writePad(value);
  }
};

const flushSave = () => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  if (pending) {
    writePad(pending.value);
    void persistNow(pending.name, pending.value);
    pending = null;
  }
};
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushSave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave();
  });
}
const idbStorage: StateStorage = {
  getItem: async (name) => {

    const pad = readPad();
    if (pad !== null) return pad;
    let raw: unknown;
    try {
      raw = await get(name);
    } catch {
      return null;
    }
    if (raw == null) return null;
    if (typeof raw !== 'string') return null;

    try {
      JSON.parse(raw);
    } catch {
      noteUnreadable(raw);
      return null;
    }
    return raw;
  },
  setItem: (name, value) => {
    pending = { name, value };
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      pending = null;
      void persistNow(name, value);
    }, 300);
  },
  removeItem: async (name) => {
    try {
      await del(name);
    } catch {}
  },
};

export interface DocSummary {
  id: string;
  name: string;
  fullName: string;
}

interface ResumeStore extends Library {

  doc: Resume;

  setDoc: (doc: Resume) => void;

  update: (recipe: (doc: Resume) => void) => void;

  reset: (kind: 'blank' | 'sample') => void;

  switchDoc: (id: string) => void;

  addDoc: (kind: 'blank' | 'sample') => string;

  duplicateDoc: () => string;

  renameDoc: (name: string, id?: string) => void;

  deleteDoc: (id: string) => void;
}

const clearHistory = () => useResumeStore.temporal.getState().clear();

const withFreshId = (doc: Resume, name: string): Resume => ({ ...doc, id: uid(), name });

function adoptDoc(state: { doc: Resume; library: Record<string, Resume>; activeId: string }, doc: Resume): void {
  delete state.library[state.activeId];
  delete state.library[state.doc.id];
  state.library[doc.id] = doc;
  state.doc = doc;
  state.activeId = doc.id;
}

export const useResumeStore = create<ResumeStore>()(
  persist(
    temporal(
      immer((setState, getState) => ({
        doc: sampleResume,
        library: { [sampleResume.id]: sampleResume },
        activeId: sampleResume.id,

        setDoc: (doc) => {
          const parsed = ResumeSchema.safeParse(doc);
          if (!parsed.success) return;
          setState((state) => void adoptDoc(state, parsed.data));
          // Undoing past an adoption would restore a doc the library no longer
          // keys, which is how phantom twins appear in the switcher.
          clearHistory();
        },
        update: (recipe) =>
          setState((state) => {
            recipe(state.doc);
          }),
        reset: (kind) => {
          setState((state) => void adoptDoc(state, kind === 'blank' ? blankResume() : withFreshId(sampleResume, 'Sample CV')));
          clearHistory();
        },

        switchDoc: (id) => {
          const s = getState();
          if (id === s.activeId || !s.library[id]) return;
          setState((state) => {

            state.library[state.doc.id] = state.doc;
            state.doc = state.library[id];
            state.activeId = id;
          });
          clearHistory();
        },

        addDoc: (kind) => {
          const doc = kind === 'blank' ? blankResume() : withFreshId(sampleResume, 'Sample CV');
          setState((state) => {
            state.library[state.doc.id] = state.doc;
            state.library[doc.id] = doc;
            state.doc = doc;
            state.activeId = doc.id;
          });
          clearHistory();
          return doc.id;
        },

        duplicateDoc: () => {
          const copy = withFreshId(getState().doc, `${getState().doc.name} copy`);
          setState((state) => {
            state.library[state.doc.id] = state.doc;
            state.library[copy.id] = copy;
            state.doc = copy;
            state.activeId = copy.id;
          });
          clearHistory();
          return copy.id;
        },

        renameDoc: (name, id) =>
          setState((state) => {
            const target = id ?? state.doc.id;
            if (target === state.doc.id) state.doc.name = name;
            if (state.library[target]) state.library[target].name = name;
          }),

        deleteDoc: (id) => {
          const s = getState();
          const keys = Object.keys(s.library).filter((k) => k === id || s.library[k].id === id);
          if (!keys.length && s.doc.id !== id) return;
          markDeleted(id);
          const wasActive = id === s.activeId || s.doc.id === id;
          setState((state) => {
            if (!wasActive) state.library[state.doc.id] = state.doc;
            for (const k of keys) delete state.library[k];
            if (!wasActive) return;

            const next = Object.keys(state.library)[0];
            const doc = next ? state.library[next] : blankResume();
            state.library[doc.id] = doc;
            state.doc = doc;
            state.activeId = doc.id;
          });
          if (wasActive) clearHistory();
        },
      })),

      { limit: 100, partialize: (state) => ({ doc: state.doc }) },
    ),
    {
      name: STORE_KEY,
      version: PERSIST_VERSION,
      migrate: (persisted, fromVersion) => migratePersisted(persisted, fromVersion),
      storage: createJSONStorage(() => idbStorage),

      partialize: (state) => ({
        library: { ...state.library, [state.doc.id]: state.doc },
        activeId: state.doc.id,
      }),
      merge: (persisted, current) => {
        const lib = mergePersisted(persisted, { library: current.library, activeId: current.activeId });
        return { ...current, ...lib, doc: lib.library[lib.activeId] };
      },
    },
  ),
);

channel?.addEventListener('message', (e: MessageEvent<{ from?: string }>) => {
  if (e.data?.from === TAB_ID) return;
  const el = document.activeElement as HTMLElement | null;
  if (el?.isContentEditable || el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA') return;
  void useResumeStore.persist.rehydrate();
});

const byId = (library: Record<string, Resume>): Record<string, Resume> => {
  const out: Record<string, Resume> = {};
  for (const d of Object.values(library)) out[d.id] = d;
  return out;
};

export const docSummaries = (library: Record<string, Resume>, doc: Resume): DocSummary[] =>
  Object.values({ ...byId(library), [doc.id]: doc }).map((d) => ({
    id: d.id,
    name: d.name,
    fullName: d.header.fullName,
  }));
