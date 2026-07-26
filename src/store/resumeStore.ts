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
    const merged: Record<string, unknown> = { ...prev.state.library, ...next.state.library };
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
          if (parsed.success) setState((state) => void adoptDoc(state, parsed.data));
        },
        update: (recipe) =>
          setState((state) => {
            recipe(state.doc);
          }),
        reset: (kind) =>
          setState((state) => void adoptDoc(state, kind === 'blank' ? blankResume() : withFreshId(sampleResume, 'Sample CV'))),

        switchDoc: (id) => {
          const s = getState();
          if (id === s.activeId || !s.library[id]) return;
          setState((state) => {

            state.library[state.activeId] = state.doc;
            state.doc = state.library[id];
            state.activeId = id;
          });
          clearHistory();
        },

        addDoc: (kind) => {
          const doc = kind === 'blank' ? blankResume() : withFreshId(sampleResume, 'Sample CV');
          setState((state) => {
            state.library[state.activeId] = state.doc;
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
            state.library[state.activeId] = state.doc;
            state.library[copy.id] = copy;
            state.doc = copy;
            state.activeId = copy.id;
          });
          clearHistory();
          return copy.id;
        },

        renameDoc: (name, id) =>
          setState((state) => {
            const target = id ?? state.activeId;
            if (target === state.activeId) state.doc.name = name;
            if (state.library[target]) state.library[target].name = name;
          }),

        deleteDoc: (id) => {
          const s = getState();
          if (!s.library[id]) return;
          markDeleted(id);
          const wasActive = id === s.activeId;
          setState((state) => {
            if (!wasActive) state.library[state.activeId] = state.doc;
            delete state.library[id];
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
        library: { ...state.library, [state.activeId]: state.doc },
        activeId: state.activeId,
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

export const docSummaries = (library: Record<string, Resume>, doc: Resume, activeId: string): DocSummary[] =>
  Object.values({ ...library, [activeId]: doc }).map((d) => ({
    id: d.id,
    name: d.name,
    fullName: d.header.fullName,
  }));
