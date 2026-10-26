import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minus, Plus, SlidersHorizontal } from 'lucide-react';
import { activePair, applyInputEdit, zoneReceiver } from '../../lib/activeLink';
import { coverageZones } from '../../lib/coverage';
import { sampleGrid } from '../../lib/contours';
import type { GroundAt } from '../../lib/elevation';
import { type LatLon, SG_REFERENCE, offsetLatLon, toLatLon, toLocalM } from '../../lib/geo';
import { addSensor, changeRole, createSensor, evaluatePairs, effectiveObjective, groundOf, pairInputs, receiverSummary, removeSensor, resolveIntendedTx } from '../../lib/sensors';
import { thresholdSlantRangeM } from '../../lib/thresholds';
import type { AppState, LinkInputs, MapScenario, Sensor } from '../../types';
import { useCoverageWorker, useZoneWorker } from '../useFieldWorker';
import { statusTone } from '../ui';
import { CoverageLegend } from './CoverageLegend';
import { LinkBudgetDrawer } from './LinkBudgetDrawer';
import { LinkSettingsCard } from './LinkSettingsCard';
import { SelectedSensorCard } from './SelectedSensorCard';
import { SensorListCard } from './SensorListCard';
import { type MapLink, type MapView, SensorMap, type SensorMapHandle } from './SensorMap';
import type { useElevationTiles } from './useElevationTiles';

type Elevation = ReturnType<typeof useElevationTiles>;

/** Elevation tile zoom whose pixels are no coarser than one zone grid cell. */
function zoomForCell(cellM: number, lat: number) {
  const metresPerPixelZ0 = 156_543.03 * Math.cos((lat * Math.PI) / 180);
  return Math.min(14, Math.max(10, Math.ceil(Math.log2(metresPerPixelZ0 / cellM))));
}

export function MapWorkspace({ state, setState, elevation }: { state: AppState; setState: React.Dispatch<React.SetStateAction<AppState>>; elevation: Elevation }) {
  const handle = useRef<SensorMapHandle | null>(null);
  const [view, setView] = useState<MapView | null>(null);
  const [draft, setDraft] = useState<Record<string, LatLon>>({});
  const [showSettings, setShowSettings] = useState(false);
  const [hidePanels, setHidePanels] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const { map } = state;
  const groundAt: GroundAt = elevation.groundAt;
  const dragging = Object.keys(draft).length > 0;

  const sensors = useMemo(() => map.sensors.map((s) => (draft[s.id] ? { ...s, ...draft[s.id] } : s)), [map.sensors, draft]);
  const liveMap: MapScenario = useMemo(() => ({ ...map, sensors }), [map, sensors]);
  const pairs = useMemo(() => evaluatePairs(liveMap, state.inputs, groundAt), [liveMap, state.inputs, groundAt]);
  const selected = sensors.find((s) => s.id === map.selectedId) ?? null;

  useEffect(() => { if (map.useTerrainElevation) elevation.ensure(sensors); }, [sensors, map.useTerrainElevation, elevation.ensure]);

  const setMap = (update: (current: MapScenario) => MapScenario) => setState((current) => ({ ...current, map: update(current.map) }));
  const updateSensor = (id: string, patch: Partial<Sensor>) => setMap((m) => ({ ...m, sensors: m.sensors.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  const select = (id: string) => setMap((m) => ({ ...m, selectedId: id }));
  const setShared = <K extends keyof LinkInputs>(key: K, value: LinkInputs[K]) => setState((current) => ({ ...current, inputs: { ...current.inputs, [key]: value } }));

  const editInput = <K extends keyof LinkInputs>(key: K, value: LinkInputs[K]): string | undefined => {
    const edited = applyInputEdit(state, key, value, groundAt);
    if (!edited.ok) return edited.reason;
    setState(edited.state);
    return undefined;
  };

  const addAtCentre = () => setMap((m) => {
    const centre = view?.center ?? m.sensors[0] ?? { lat: 1.3521, lon: 103.8198 };
    // Step outward from the centre so a new sensor never lands on top of another one.
    const metresPerPixel = view ? (toLocalM(view.northEast).xM - toLocalM(view.southWest).xM) / view.width : 1;
    let at: LatLon = { lat: centre.lat, lon: centre.lon };
    for (let k = 1; m.sensors.some((s) => Math.hypot(toLocalM(s).xM - toLocalM(at).xM, toLocalM(s).yM - toLocalM(at).yM) < 40 * metresPerPixel); k += 1) {
      at = offsetLatLon(centre, Math.cos(k * 2.4) * 60 * metresPerPixel * Math.sqrt(k), Math.sin(k * 2.4) * 60 * metresPerPixel * Math.sqrt(k));
    }
    const role = m.sensors.some((s) => s.role === 'tx') ? 'rx' : 'tx';
    const sensor = createSensor(m.sensors, role, at, state.inputs);
    const next = addSensor(m.sensors, sensor);
    return next === m.sensors ? m : { ...m, sensors: next, selectedId: sensor.id };
  });

  // Zones belong to the selected transmitter, or the selected receiver's intended transmitter.
  const zoneTx = useMemo(() => (selected?.role === 'tx' ? selected : selected ? resolveIntendedTx(liveMap, selected, groundAt) ?? activePair(liveMap, groundAt)?.tx : sensors.find(s => s.role === 'tx') ?? null), [selected, liveMap, groundAt]);
  const zone = useMemo(() => (zoneTx ? zoneReceiver(liveMap, zoneTx.id, groundAt) : null), [zoneTx, liveMap, groundAt]);
  const linkedRxIds = zoneTx ? pairs.filter((p) => p.txId === zoneTx.id && p.intended).map((p) => p.rxId) : [];

  const zoneRequest = useMemo(() => {
    if (!zoneTx || !zone || !view || view.width === 0) return null;
    // Local metres from the fixed Singapore reference, so results stay placed if Tx moves meanwhile.
    const sw = toLocalM(view.southWest);
    const ne = toLocalM(view.northEast);
    const txLocal = toLocalM(zoneTx);
    const pixelsPerCell = dragging ? 14 : 5;
    const cols = Math.max(16, Math.ceil(view.width / pixelsPerCell));
    const rows = Math.max(10, Math.ceil(view.height / pixelsPerCell));
    const cellM = Math.max((ne.xM - sw.xM) / cols, (ne.yM - sw.yM) / rows);
    const z = zoomForCell(cellM, zoneTx.lat);
    const sampler = elevation.samplerAt(z);
    const ground = sampleGrid({ minX: sw.xM, maxX: ne.xM, minY: sw.yM, maxY: ne.yM }, cols, rows, (xM, yM) => {
      if (!map.useTerrainElevation) return 0;
      return sampler(toLatLon({ xM, yM })) ?? NaN;
    });
    const inputs = pairInputs(state.inputs, zoneTx, zone.rx, 1);
    return {
      z,
      request: {
        ground,
        tx: { xM: txLocal.xM, yM: txLocal.yM, elevationM: (groundOf(zoneTx, groundAt, map.useTerrainElevation) ?? 0) + zoneTx.aglM },
        rxAglM: zone.rx.aglM,
        slant: {
          sensitivityM: thresholdSlantRangeM(inputs, zone.rx.sensitivityDbm),
          requiredM: thresholdSlantRangeM(inputs, zone.rx.sensitivityDbm + zone.rx.fadeMarginTargetDb),
          interferenceM: thresholdSlantRangeM(inputs, zone.rx.interferenceThresholdDbm),
        },
      },
      key: [zoneTx.id, zoneTx.lat, zoneTx.lon, zoneTx.aglM, zoneTx.powerDbm, zoneTx.gainDbi, zoneTx.cableLossDb, zone.rx.id, zone.rx.aglM, zone.rx.gainDbi, zone.rx.cableLossDb,
        zone.rx.sensitivityDbm, zone.rx.fadeMarginTargetDb, zone.rx.interferenceThresholdDbm, state.inputs.frequencyGhz, state.inputs.polarizationLossDb, state.inputs.obstructionLossDb,
        state.inputs.otherLossDb, view.southWest.lat, view.southWest.lon, view.northEast.lat, view.northEast.lon, cols, rows, map.useTerrainElevation, elevation.version].join('|'),
    };
  }, [zoneTx, zone, view, dragging, map.useTerrainElevation, elevation.samplerAt, elevation.version, state.inputs, groundAt]);

  useEffect(() => {
    if (zoneRequest && view && map.useTerrainElevation) elevation.ensureBox(view.southWest, view.northEast, zoneRequest.z);
  }, [zoneRequest?.key]);

  const terrain = map.propagationModel === 'terrain';
  const coverageRequest = useMemo(() => {
    if (!terrain || !zoneRequest || !zoneTx || !zone) return null;
    const req = zoneRequest.request, g = req.ground;
    const maxView = Math.max(...[[g.x0, g.y0], [g.x0 + g.cols * g.dx, g.y0 + g.rows * g.dy]].map(([x,y]) => Math.hypot(x - req.tx.xM, y - req.tx.yM)));
    const maxRangeM = Math.max(30, Math.min(90000, maxView, req.slant.sensitivityM));
    return { tx: { lat: zoneTx.lat, lon: zoneTx.lon, elevationM: groundOf(zoneTx, groundAt, map.useTerrainElevation) === null ? NaN : req.tx.elevationM }, rxAglM: zone.rx.aglM, inputs: pairInputs(state.inputs, zoneTx, zone.rx, 1), maxRangeM, radials: dragging ? 180 : 720, stepM: Math.max(30, maxRangeM / 400), ground: { origin: SG_REFERENCE, grid: g } };
  }, [terrain, zoneRequest, zoneTx, zone, dragging, groundAt, map.useTerrainElevation, state.inputs]);
  const free = useZoneWorker(!terrain ? zoneRequest?.request ?? null : null, `${terrain}|${zoneRequest?.key}`);
  const coverage = useCoverageWorker(coverageRequest, `${terrain}|${zoneRequest?.key}`);
  const zoneResult = useMemo(() => terrain ? coverage.result && coverageRequest && zoneRequest ? coverageZones(coverage.result, coverageRequest, zoneRequest.request.ground) : null : free.result, [terrain, coverage.result, coverageRequest, zoneRequest, free.result]);
  const refining = terrain ? coverage.refining : free.refining;
  const objective = zone ? effectiveObjective(liveMap, zone.rx) : map.defaultObjective;
  const rings = useMemo(() => zoneTx && zoneRequest ? (['sensitivity', 'required', 'interference'] as const).flatMap(id => {
    const range = zoneRequest.request.slant[`${id}M`];
    if (!Number.isFinite(range)) return [];
    return [{ id, label: `${id} ${range >= 1000 ? (range / 1000).toFixed(2) + ' km' : range.toFixed(0) + ' m'}`, points: Array.from({ length: 129 }, (_, i) => offsetLatLon(zoneTx, Math.sin(i * 2 * Math.PI / 128) * range, Math.cos(i * 2 * Math.PI / 128) * range)) }];
  }) : [], [zoneTx, zoneRequest]);
  useEffect(() => {
    if (!map.useTerrainElevation || !terrain) return;
    for (const p of pairs) {
      const a = sensors.find(s => s.id === p.txId)!, b = sensors.find(s => s.id === p.rxId)!;
      elevation.ensureBox({ lat: Math.min(a.lat, b.lat), lon: Math.min(a.lon, b.lon) }, { lat: Math.max(a.lat, b.lat), lon: Math.max(a.lon, b.lon) }, 14);
    }
  }, [sensors, terrain, map.useTerrainElevation, elevation.ensureBox]);
  const zones = useMemo(() => {
    if (!zoneResult) return null;
    const { bounds } = zoneResult;
    const at = (xM: number, yM: number) => toLatLon({ xM, yM });
    const lines = (segments: [number, number, number, number][]) => segments.map(([x1, y1, x2, y2]) => [at(x1, y1), at(x2, y2)]);
    return {
      result: zoneResult,
      objective, showAll,
      corners: [at(bounds.minX, bounds.maxY), at(bounds.maxX, bounds.maxY), at(bounds.maxX, bounds.minY), at(bounds.minX, bounds.minY)] as [LatLon, LatLon, LatLon, LatLon],
      outlines: { sensitivity: lines(zoneResult.outlines.sensitivity), required: lines(zoneResult.outlines.required), interference: lines(zoneResult.outlines.interference) },
    };
  }, [zoneResult, objective, showAll]);

  const byId = new Map(sensors.map((s) => [s.id, s]));
  const links: MapLink[] = pairs
    .filter((p) => p.intended || p.result.status === 'Possible interference')
    .map((p) => ({
      from: byId.get(p.txId)!, to: byId.get(p.rxId)!,
      kind: p.intended ? 'intended' : 'interference',
      tone: statusTone(p.result.status),
      emphasis: !selected || p.txId === selected.id || p.rxId === selected.id,
    }));
  const tones: Record<string, string> = Object.fromEntries(sensors.map((s) => {
    if (s.role === 'tx') return [s.id, 'tx'];
    const summary = receiverSummary(pairs, s.id);
    return [s.id, summary.interferersAbove ? 'danger' : summary.link ? statusTone(summary.link.result.status) : 'neutral'];
  }));

  return (
    <div className={`map-workspace${dragging ? ' dragging-sensor' : ''}${hidePanels ? ' panels-hidden' : ''}`}>
      <SensorMap
        sensors={sensors} selectedId={map.selectedId} tones={tones} links={links} zones={zones} rings={rings} frequencyGhz={state.inputs.frequencyGhz} handleRef={handle}
        onSelect={select}
        onDrag={(id, at) => setDraft((d) => ({ ...d, [id]: at }))}
        onDragEnd={(id, at) => { updateSensor(id, at); setDraft((d) => { const { [id]: _done, ...rest } = d; return rest; }); }}
        onNudge={(id, dx, dy) => { const s = map.sensors.find((x) => x.id === id); if (s) updateSensor(id, offsetLatLon(s, dx, dy)); }}
        onView={setView}
      />

      <div className="map-toolbar" role="toolbar" aria-label="Map">
        <button type="button" className="ghost" onClick={() => handle.current?.fitSensors()}><Maximize2 size={15} /> Fit all sensors</button>
        <button type="button" className="ghost icon-only" aria-label="Zoom in" onClick={() => handle.current?.zoomBy(1)}><Plus size={15} /></button>
        <button type="button" className="ghost icon-only" aria-label="Zoom out" onClick={() => handle.current?.zoomBy(-1)}><Minus size={15} /></button>
        <button type="button" className={`ghost ${showSettings ? 'is-on' : ''}`} aria-pressed={showSettings} onClick={() => setShowSettings(!showSettings)}><SlidersHorizontal size={15} /> Link settings</button>
        <div className="segmented objective-default" role="group" aria-label="Default objective"><span>Default objective</span>{(['desired', 'avoidance'] as const).map(o => <button key={o} type="button" aria-pressed={map.defaultObjective === o} className={map.defaultObjective === o ? 'active' : ''} onClick={() => setMap(m => ({ ...m, defaultObjective: o }))}>{o === 'desired' ? 'Desired' : 'Avoidance'}</button>)}</div>
        <label className="model-control">Model <select value={map.propagationModel} onChange={e => setMap(m => ({ ...m, propagationModel: e.target.value as MapScenario['propagationModel'] }))}><option value="terrain">Terrain diffraction</option><option value="free-space">Free space</option></select></label>
        <button type="button" className="ghost" aria-pressed={hidePanels} onClick={() => setHidePanels(!hidePanels)}>{hidePanels ? 'Show panels' : 'Hide panels'}</button>
        <label className="switch">
          <input type="checkbox" checked={map.useTerrainElevation} onChange={(event) => setMap((m) => ({ ...m, useTerrainElevation: event.target.checked }))} />
          <span>Use terrain elevation</span>
        </label>
        {elevation.status === 'offline' && <span className="map-notice" role="status">Elevation tiles unavailable: terrain predictions are unknown.</span>}
        {refining && <span className="refining" role="status">Refining coverage…</span>}
      </div>

      <CoverageLegend objective={objective} showAll={showAll} onShowAll={setShowAll} terrain={terrain} />
      <SensorListCard
        sensors={sensors} pairs={pairs} selectedId={map.selectedId} onSelect={select} onAdd={addAtCentre}
        onRemove={(id) => setMap((m) => ({ ...m, sensors: removeSensor(m.sensors, id), selectedId: m.selectedId === id ? null : m.selectedId, zonesForRxId: m.zonesForRxId === id ? 'auto' : m.zonesForRxId }))}
      />

      <LinkBudgetDrawer state={{ ...state, map: liveMap }} groundAt={groundAt} onEdit={editInput} />

      {showSettings && <LinkSettingsCard inputs={state.inputs} onChange={setShared} />}

      {selected && (
        <SelectedSensorCard
          sensor={selected} map={liveMap} pairs={pairs} groundAt={groundAt}
          zoneInfo={zoneTx && zone ? { txName: zoneTx.name, rxName: zone.rx.name, reason: zone.reason, aglM: zone.rx.aglM, linkedRxIds } : null}
          onChange={(patch) => { updateSensor(selected.id, patch); return undefined; }}
          onRoleChange={(role) => setMap((m) => ({ ...m, sensors: changeRole(m.sensors, selected.id, role) }))}
          onZonesFor={(rxId) => setMap((m) => ({ ...m, zonesForRxId: rxId }))}
        />
      )}
    </div>
  );
}
