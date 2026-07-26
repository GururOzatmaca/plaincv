import { useEffect, useState } from 'react';
import { EditorPage } from '@/pages/EditorPage';
import { useResumeStore } from '@/store/resumeStore';

/**
 * Storage is IndexedDB, i.e. ASYNCHRONOUS, so zustand paints the store's initial
 * state (the sample CV, default cyan) before the saved document arrives and swaps it
 * out ~100ms later. That flash showed a stranger's name and the wrong accent on every
 * reload. Nothing renders until hydration settles.
 *
 * The timeout is not cosmetic: zustand only flips hasHydrated and fires the finish
 * listeners on the success path - if getItem, migrate or merge throws, it lands in the
 * catch and neither ever happens (zustand/esm/middleware.mjs, hydrate()). Without a
 * fallback a storage fault would mean a permanently blank app instead of a flash.
 */
const HYDRATE_FALLBACK_MS = 1500;

export default function App() {
  const [ready, setReady] = useState(() => useResumeStore.persist.hasHydrated());

  useEffect(() => {
    if (ready) return;
    // hydration can land between the initial state and this effect
    if (useResumeStore.persist.hasHydrated()) {
      setReady(true);
      return;
    }
    const off = useResumeStore.persist.onFinishHydration(() => setReady(true));
    const t = setTimeout(() => setReady(true), HYDRATE_FALLBACK_MS);
    return () => {
      off();
      clearTimeout(t);
    };
  }, [ready]);

  // Deliberately empty, not a spinner: at this length a spinner is its own flash.
  if (!ready) return <div className="app-boot" aria-hidden="true" />;
  return <EditorPage />;
}
