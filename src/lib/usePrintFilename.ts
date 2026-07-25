import { useEffect } from 'react';
import { useResumeStore } from '@/store/resumeStore';
import { slugify } from './download';

/**
 * The browser names the PDF after document.title, which is the app name. Swap in
 * the person's name for the duration of the print, then put it back. Covers
 * Ctrl/Cmd+P too, which never goes through the Download button.
 */
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
