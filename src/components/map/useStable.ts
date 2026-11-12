import { useRef } from 'react';

/** Keeps the previous value while `same` says the new one is equivalent, so memo and effect dependencies hold. */
export function useStableValue<T>(value: T, same: (previous: T, next: T) => boolean): T {
  const ref = useRef(value);
  if (ref.current !== value && !same(ref.current, value)) ref.current = value;
  return ref.current;
}

/** Returns the first value seen for each key: heavy objects are rebuilt only when their key changes. */
export function useKeyed<T>(key: string | null, make: () => T): T {
  const ref = useRef<{ key: string | null; value: T } | null>(null);
  if (!ref.current || ref.current.key !== key) ref.current = { key, value: make() };
  return ref.current.value;
}
