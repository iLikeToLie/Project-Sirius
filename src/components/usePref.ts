import { useEffect, useState } from 'react';

const PREFIX = 'friis-rf:pref:';

/**
 * A view preference remembered on this device (coverage style, drawer size…). Scenario data does not
 * belong here. Storage can be blocked or empty, so every access falls back to the default.
 */
export function usePref<T>(key: string, fallback: T, valid: (value: unknown) => value is T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(PREFIX + key);
      const parsed: unknown = raw === null ? undefined : JSON.parse(raw);
      return valid(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try { window.localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  }, [key, value]);
  return [value, setValue] as const;
}

export const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';
export const oneOf = <T extends string>(...options: T[]) => (v: unknown): v is T => typeof v === 'string' && (options as string[]).includes(v);
