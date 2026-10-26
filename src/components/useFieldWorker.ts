import { useEffect, useRef, useState } from 'react';
import { computeCoverage, type CoverageRequest, type CoverageResult } from '../lib/coverage';
import { computeZones, type ZoneRequest, type ZoneResult } from '../lib/zones';
import type { FieldRequest } from '../workers/fieldWorker';

/** One running request plus one replaceable pending request; stale jobs never paint. */
function useFieldWorker<T extends ZoneResult | CoverageResult>(request: Omit<FieldRequest, 'jobId'> | null, key: string) {
  const [result, setResult] = useState<T | null>(null);
  const [refining, setRefining] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const jobRef = useRef(0), busy = useRef(false);
  const pending = useRef<FieldRequest | null>(null);
  const requestRef = useRef(request); requestRef.current = request;
  const dispatch = useRef<(req: FieldRequest) => void>(() => {});
  dispatch.current = req => {
    if (workerRef.current) { busy.current = true; workerRef.current.postMessage(req); }
    else {
      const out = req.kind === 'coverage' ? computeCoverage(req) : computeZones(req);
      if (out.jobId === jobRef.current) { setResult(out as T); setRefining(false); }
    }
  };
  useEffect(() => {
    if (typeof Worker === 'undefined') return;
    const worker = new Worker(new URL('../workers/fieldWorker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<T>) => {
      busy.current = false;
      if (event.data.jobId === jobRef.current) { setResult(event.data); setRefining(false); }
      const next = pending.current; pending.current = null;
      if (next && next.jobId === jobRef.current) dispatch.current(next);
    };
    worker.onerror = () => {
      worker.terminate(); workerRef.current = null; busy.current = false;
      const next = pending.current; pending.current = null;
      if (next) dispatch.current(next);
    };
    return () => { worker.terminate(); workerRef.current = null; busy.current = false; pending.current = null; };
  }, []);
  useEffect(() => {
    const jobId = ++jobRef.current;
    pending.current = null;
    if (!requestRef.current) { setResult(null); setRefining(false); return; }
    setRefining(true);
    const frame = requestAnimationFrame(() => {
      const req = { ...requestRef.current, jobId } as FieldRequest;
      if (busy.current) pending.current = req;
      else dispatch.current(req);
    });
    return () => cancelAnimationFrame(frame);
  }, [key]);
  return { result, refining };
}
export function useZoneWorker(request: Omit<ZoneRequest, 'jobId'> | null, key: string) {
  return useFieldWorker<ZoneResult>(request ? { ...request, kind: 'zones' } : null, key);
}
export function useCoverageWorker(request: Omit<CoverageRequest, 'jobId'> | null, key: string) {
  return useFieldWorker<CoverageResult>(request ? { ...request, kind: 'coverage' } : null, key);
}
