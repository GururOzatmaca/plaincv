import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { temporal } from 'zundo';
import { get, set, del } from 'idb-keyval';
import { ResumeSchema, type Resume } from '@/schema/resume';
import { sampleResume } from '@/schema/sample';
import { blankResume, uid } from '@/schema/factory';
import { STORE_KEY, PERSIST_VERSION, migratePersisted, mergePersisted, noteUnreadable, type Library } from './migrations';

// IndexedDB-backed storage for zustand/persist (local-first, no backend).
// Writes are debounced so rapid changes (slider/color drags) don't thrash IndexedDB.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pending: { name: string; value: string } | null = null;

/**
 * Documents this tab deleted. A write merges the stored library back in (see
 * mergeIntoStored), so without a tombstone a delete would be resurrected by the
 * very next save.
 */
const tombstones = new Set<string>();
export const markDeleted = (id: string): void => void tombstones.add(id);

/**
 * Synchronous crash pad. IndexedDB writes cannot complete while the page is
 * unloading (measured: an edit followed by a reload inside 300ms was lost even
 * with the pagehide flush), so the pending value is also dropped into
 * localStorage, which IS synchronous. Read back and cleared on the next load.
 */
const PAD_KEY = `${STORE_KEY}.pad`;
const writePad = (value: string) => {
  try {
    localStorage.setItem(PAD_KEY, value);
  } catch {
    // private mode / quota: the pad is best-effort by definition
  }
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
/**
 * The pad exists ONLY to cover a write that did not reach IndexedDB. The moment one
 * does, it is stale and must go: it is written on every visibilitychange->hidden,
 * i.e. every tab switch, and getItem prefers it unconditionally. Leaving it behind
 * meant switching tabs once and then editing for half an hour ended with the reload
 * restoring the half-hour-old snapshot (measured: three later edits reached
 * IndexedDB, the pad still won, all three were lost).
 */
const clearPad = () => {
  try {
    localStorage.removeItem(PAD_KEY);
  } catch {
    // private mode: there was nothing to clear
  }
};

/** Other tabs write the same single key; tell them to re-read after we save. */
const channel: BroadcastChannel | null =
  typeof BroadcastChannel === 'function' ? new BroadcastChannel(STORE_KEY) : null;
const TAB_ID = uid();

/**
 * Fold our document into whatever is CURRENTLY stored rather than over the top of
 * it. Two tabs each hold their own copy of the whole library, so a blind write from
 * the older tab reverted the newer tab's edits (measured: tab 1's name change was
 * silently rolled back by tab 2's next save).
 */
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
    return value; // unreadable previous payload: our own write is the better copy
  }
}

const persistNow = async (name: string, value: string) => {
  try {
    await set(name, await mergeIntoStored(name, value));
    clearPad(); // the write landed, so any crash pad for it is now stale
    channel?.postMessage({ from: TAB_ID });
  } catch {
    // quota exceeded / storage evicted / private mode. Swallowed on purpose: an
    // unhandled rejection here reaches ErrorBoundary's `unhandledrejection`
    // listener and replaces the whole editor with the crash screen on the user's
    // FIRST edit. The pad below is what actually keeps their work.
    writePad(value);
  }
};

// Flush the pending debounced write immediately so an edit followed by a reload/
// close within the 300ms window is not lost.
const flushSave = () => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  if (pending) {
    writePad(pending.value); // synchronous, so it survives the unload
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
    // The pad is only ever written with a value that had not reached IndexedDB, so
    // when it exists it is the newer of the two.
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
    // createJSONStorage parses this; a throw there aborts hydration before merge()
    // runs, so the corrupt payload would be replaced with no warning and no backup.
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
    } catch {
      // nothing useful to do; never let this crash the app
    }
  },
};

/** What the document switcher needs; never the documents themselves. */
export interface DocSummary {
  id: string;
  name: string;
  fullName: string;
}

interface ResumeStore extends Library {
  /**
   * The live, editable document. Held separately from `library` on purpose: undo
   * history snapshots this and only this, so a 100-step history stays the size of
   * one CV instead of the whole library. `library[activeId]` is refreshed from it
   * on switch and at every save (see persist.partialize below), so the two can
   * never disagree in storage.
   */
  doc: Resume;
  /** Replace the whole document (validates first; ignores invalid input). */
  setDoc: (doc: Resume) => void;
  /** Mutate the document with an immer draft. */
  update: (recipe: (doc: Resume) => void) => void;
  /** Start over, in place. Undoable like any other edit, so it is never a dead end. */
  reset: (kind: 'blank' | 'sample') => void;

  /** Switch which document is being edited. Not undoable (see clearHistory). */
  switchDoc: (id: string) => void;
  /** Add a document and switch to it. Returns its id. */
  addDoc: (kind: 'blank' | 'sample') => string;
  /** Copy the active document under a new name and switch to it. Returns its id. */
  duplicateDoc: () => string;
  /** Rename a document (defaults to the active one). */
  renameDoc: (name: string, id?: string) => void;
  /** Remove a document. Deleting the last one leaves a fresh blank behind. */
  deleteDoc: (id: string) => void;
}

/**
 * Undo history is per-document. Crossing a switch would let Ctrl+Z pull content
 * from a CV the user is no longer looking at, so the history is dropped instead.
 */
const clearHistory = () => useResumeStore.temporal.getState().clear();

const withFreshId = (doc: Resume, name: string): Resume => ({ ...doc, id: uid(), name });

/**
 * Replace the live document IN PLACE, keeping `activeId` and the library key equal
 * to `doc.id`.
 *
 * Import and "start over" used to assign `doc` alone. The library key then still
 * named the old id while the switcher listed rows by `doc.id`, so the document you
 * had just imported could not be selected (`library[row.id]` was undefined) and its
 * delete was a silent no-op: an orphan you could neither open nor remove.
 */
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
            // park the live document before leaving it, else edits since the last
            // save would be lost by loading over the top of them
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
          markDeleted(id); // else the cross-tab merge on the next save resurrects it
          const wasActive = id === s.activeId;
          setState((state) => {
            if (!wasActive) state.library[state.activeId] = state.doc;
            delete state.library[id];
            if (!wasActive) return;
            // deleting the one you are editing must land somewhere: the next
            // document, or a fresh blank if that was the last one
            const next = Object.keys(state.library)[0];
            const doc = next ? state.library[next] : blankResume();
            state.library[doc.id] = doc;
            state.doc = doc;
            state.activeId = doc.id;
          });
          if (wasActive) clearHistory();
        },
      })),
      // Track only the document; undo/redo restores doc, never the library or the
      // action fns. RAM only (history not persisted), capped so memory stays bounded.
      { limit: 100, partialize: (state) => ({ doc: state.doc }) },
    ),
    {
      name: STORE_KEY,
      version: PERSIST_VERSION,
      migrate: (persisted, fromVersion) => migratePersisted(persisted, fromVersion),
      storage: createJSONStorage(() => idbStorage),
      // Fold the live document into the library at write time. This is the single
      // point where the two are reconciled, so no edit path can forget to do it.
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

/**
 * Another tab saved. Re-read so the two views converge instead of silently
 * diverging until one of them overwrites the other. Skipped while a field is being
 * edited here, because re-hydrating would rewrite the contentEditable under the
 * caret; the next save from this tab merges rather than clobbers, so nothing is lost
 * by waiting.
 */
channel?.addEventListener('message', (e: MessageEvent<{ from?: string }>) => {
  if (e.data?.from === TAB_ID) return;
  const el = document.activeElement as HTMLElement | null;
  if (el?.isContentEditable || el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA') return;
  void useResumeStore.persist.rehydrate();
});

/**
 * Switcher rows, insertion-ordered so the list does not jump as names change.
 *
 * NOT a zustand selector: it builds a new array every call, and zustand v5 compares
 * selector results with Object.is, so passing this to useResumeStore would re-render
 * forever. Callers memoise it on `library`/`doc`/`activeId`, which are all stable
 * references between unrelated updates.
 */
export const docSummaries = (library: Record<string, Resume>, doc: Resume, activeId: string): DocSummary[] =>
  Object.values({ ...library, [activeId]: doc }).map((d) => ({
    id: d.id,
    name: d.name,
    fullName: d.header.fullName,
  }));
