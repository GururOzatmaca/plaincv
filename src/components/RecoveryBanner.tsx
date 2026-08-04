import { useEffect, useState } from 'react';
import { useResumeStore } from '@/store/resumeStore';
import { getRecovery, readBackup, restoreBackup, type RecoveryState } from '@/store/migrations';
import { downloadText } from '@/lib/download';
import { useT } from '@/i18n';

export function RecoveryBanner({ onOpen }: { onOpen?: (open: boolean) => void }) {
  const t = useT();
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

  const open = Boolean(rec) && !dismissed;
  // The stage reserves room for the floating header only when no banner is there to do it.
  useEffect(() => {
    onOpen?.(open);
  }, [open, onOpen]);

  if (!rec || !open) return null;

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
      <span className="rec-msg">{failed ? t('rec.failed') : t('rec.msg')}</span>
      {!failed && (
        <button className="rec-btn primary" type="button" onClick={restore}>
          {t('rec.restore')}
        </button>
      )}
      <button className="rec-btn" type="button" onClick={save}>
        {t('rec.download')}
      </button>
      <button className="rec-btn" type="button" onClick={() => setDismissed(true)}>
        {t('rec.dismiss')}
      </button>
    </div>
  );
}
