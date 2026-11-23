import { useCallback, useEffect, useRef, useState } from 'react';

/** Publish a burst of tile cache updates together before the next paint. */
export function useTileVersion() {
  const [version, setVersion] = useState(0);
  const frame = useRef<number | null>(null);
  const disposed = useRef(false);

  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, []);

  const tileArrived = useCallback(() => {
    if (disposed.current || frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setVersion((v) => v + 1);
    });
  }, []);

  return { version, tileArrived };
}
