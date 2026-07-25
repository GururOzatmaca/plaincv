import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { temporal } from 'zundo';
import { get, set, del } from 'idb-keyval';
import { ResumeSchema, type Resume } from '@/schema/resume';
import { sampleResume } from '@/schema/sample';
import { blankResume, uid } from '@/schema/factory';
import { STORE_KEY, PERSIST_VERSION, migratePersisted, mergePersisted, type Library } from './migrations';

// IndexedDB-backed storage for zustand/persist (local-first, no backend).
// Writes are debounced so rapid changes (slider/color drags) don't thrash IndexedDB.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pending: { name: string; value: string } | null = null;
// Flush the pending debounced write immediately so an edit followed by a reload/
// close within the 300ms window is not lost. Fire-and-forget: the browser lets the
// IndexedDB write proceed as the page unloads.
const flushSave = () => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  if (pending) {
    void set(pending.name, pending.value);
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
  getItem: async (name) => (await get(name)) ?? null,
  setItem: (name, value) => {
    pending = { name, value };
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      pending = null;
      void set(name, value);
    }, 300);
  },
  removeItem: async (name) => {
    await del(name);
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

export const useResumeStore = create<ResumeStore>()(
  persist(
    temporal(
      immer((setState, getState) => ({
        doc: sampleResume,
        library: { [sampleResume.id]: sampleResume },
        activeId: sampleResume.id,

        setDoc: (doc) => {
          const parsed = ResumeSchema.safeParse(doc);
          if (parsed.success) setState({ doc: parsed.data });
        },
        update: (recipe) =>
          setState((state) => {
            recipe(state.doc);
          }),
        reset: (kind) => setState({ doc: kind === 'blank' ? blankResume() : sampleResume }),

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
