import { useEffect, useState } from 'react';
import { EditorPage } from '@/pages/EditorPage';
import { useResumeStore } from '@/store/resumeStore';

const HYDRATE_FALLBACK_MS = 1500;

export default function App() {
  const [ready, setReady] = useState(() => useResumeStore.persist.hasHydrated());

  useEffect(() => {
    if (ready) return;

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

  if (!ready) return <div className="app-boot" aria-hidden="true" />;
  return <EditorPage />;
}
