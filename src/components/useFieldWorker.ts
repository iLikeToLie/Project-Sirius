import { useEffect, useRef, useState } from 'react';
import { computeZones, type ZoneRequest, type ZoneResult } from '../lib/zones';

/**
 * Evaluates range zones off the main thread. Requests are coalesced to one per frame and only
 * the latest job's result is applied; the last finished result stays on screen (flagged as
 * refining) until the newer one arrives. `key` identifies the request: the grid itself is too
 * large to serialize for comparison.
 */
export function useZoneWorker(request: Omit<ZoneRequest, 'jobId'> | null, key: string) {
  const [result, setResult] = useState<ZoneResult | null>(null);
  const [latestJob, setLatestJob] = useState(0);
  const workerRef = useRef<Worker | null>(null);
  const jobRef = useRef(0);
  const requestRef = useRef(request);
  requestRef.current = request;

  useEffect(() => {
    if (typeof Worker === 'undefined') return undefined;
    const worker = new Worker(new URL('../workers/fieldWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<ZoneResult>) => {
      if (event.data.jobId === jobRef.current) setResult(event.data);
    };
    worker.onerror = () => { workerRef.current = null; };
    workerRef.current = worker;
    return () => { worker.terminate(); workerRef.current = null; };
  }, []);

  useEffect(() => {
    if (!requestRef.current) {
      jobRef.current += 1;
      setResult(null);
      return undefined;
    }
    const frame = requestAnimationFrame(() => {
      const current = requestRef.current;
      if (!current) return;
      const jobId = ++jobRef.current;
      setLatestJob(jobId);
      if (workerRef.current) workerRef.current.postMessage({ ...current, jobId });
      else setResult(computeZones({ ...current, jobId }));
    });
    return () => cancelAnimationFrame(frame);
  }, [key]);

  return { result, refining: request !== null && (!result || result.jobId !== latestJob) };
}
