export function debouncedSave<T>(save: (value: T) => void, delayMs = 400) {
  let pending: { value: T; timer: ReturnType<typeof setTimeout> } | undefined;

  const flush = () => {
    if (!pending) return;
    const { value, timer } = pending;
    pending = undefined;
    clearTimeout(timer);
    save(value);
  };

  const schedule = (value: T) => {
    if (pending) clearTimeout(pending.timer);
    pending = { value, timer: setTimeout(flush, delayMs) };
  };

  return { schedule, flush };
}
