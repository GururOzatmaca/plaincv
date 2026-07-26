import { useEffect, useState } from 'react';
import { useResumeStore } from '@/store/resumeStore';
import { getRecovery, readBackup, restoreBackup, type RecoveryState } from '@/store/migrations';
import { downloadText } from '@/lib/download';

export function RecoveryBanner() {
  const setDoc = useResumeStore((s) => s.setDoc);
  const [rec, setRec] = useState<RecoveryState>(getRecovery());
  const [dismissed, setDismissed] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (useResumeStore.persist.hasHydrated()) {
      setRec(getRecovery());
      return;
    }
    return useResumeStore.persist.onFinishHydration(() => setRec(getRecovery()));
  }, []);

  if (!rec || dismissed) return null;

  const restore = async () => {
    const doc = await restoreBackup(rec.backupKey);
    if (doc) {
      setDoc(doc);
      setDismissed(true);
    } else {
      setFailed(true);
    }
  };

  const save = async () => {
    const text = await readBackup(rec.backupKey);
    if (text) downloadText('cv-backup.json', text);
  };

  return (
    <div className="no-print rec-bar" role="alert">
      <span className="rec-msg">
        {failed
          ? "That backup couldn't be opened. Download it and we can look at it."
          : "Couldn't read your saved CV, so the sample is showing. A copy was kept."}
      </span>
      {!failed && (
        <button className="rec-btn primary" type="button" onClick={restore}>
          Restore it
        </button>
      )}
      <button className="rec-btn" type="button" onClick={save}>
        Download backup
      </button>
      <button className="rec-btn" type="button" onClick={() => setDismissed(true)}>
        Dismiss
      </button>
    </div>
  );
}
