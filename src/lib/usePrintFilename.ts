import { useEffect } from 'react';
import { useResumeStore } from '@/store/resumeStore';
import { cvFileName } from './download';

export function usePrintFilename(): void {
  const fullName = useResumeStore((s) => s.doc.header.fullName);
  useEffect(() => {
    const appTitle = 'PlainCV';
    const before = () => {
      document.title = cvFileName(fullName);
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
