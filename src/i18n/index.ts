import { useMemo } from 'react';
import { create } from 'zustand';
import { en } from './en';
import { tr } from './tr';

export type Lang = 'en' | 'tr';
export type Key = keyof typeof en;
export type Vars = Record<string, string | number>;

const LANG_KEY = 'cv-generator/lang';

const DICTS: Record<Lang, Record<Key, string>> = { en, tr };

const readStored = (): Lang | null => {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return v === 'en' || v === 'tr' ? v : null;
  } catch {
    return null;
  }
};

export const hasStoredLang = (): boolean => readStored() !== null;

/** Only preselects a button in the first-run picker; never switches the app on its own. */
export const suggestLang = (): Lang =>
  typeof navigator !== 'undefined' && /^tr\b/i.test(navigator.language || '') ? 'tr' : 'en';

interface LangState {
  lang: Lang;
  setLang: (l: Lang) => void;
}

export const useLangStore = create<LangState>((set) => ({
  lang: readStored() ?? 'en',
  setLang: (lang) => {
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {}
    document.documentElement.lang = lang;
    set({ lang });
  },
}));

export const getLang = (): Lang => useLangStore.getState().lang;
export const setLang = (l: Lang): void => useLangStore.getState().setLang(l);

const fill = (s: string, vars?: Vars): string =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;

const translate = (lang: Lang, key: Key, vars?: Vars): string => fill(DICTS[lang][key] ?? en[key], vars);

export type T = (key: Key, vars?: Vars) => string;

export const t: T = (key, vars) => translate(getLang(), key, vars);

export function useT(): T {
  const lang = useLangStore((s) => s.lang);
  return useMemo<T>(() => (key, vars) => translate(lang, key, vars), [lang]);
}

export const useLang = (): Lang => useLangStore((s) => s.lang);

if (typeof document !== 'undefined') document.documentElement.lang = readStored() ?? 'en';
