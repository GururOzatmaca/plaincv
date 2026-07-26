import { useEffect } from 'react';
import { useResumeStore } from '@/store/resumeStore';
import { slugify } from './download';

export function usePrintFilename(): void {
  const fullName = useResumeStore((s) => s.doc.header.fullName);
  useEffect(() => {
    const appTitle = 'CV Generator';
    const before = () => {
      document.title = fullName.trim() ? `${slugify(fullName)}-cv` : 'my-cv';
    };
    const after = () => {
      document.title = appTitle;
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, [fullName]);
}
