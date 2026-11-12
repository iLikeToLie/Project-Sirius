import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ellipsis, Expand, Eye, EyeOff, Maximize2, Minus, Plus, Shrink, SlidersHorizontal } from 'lucide-react';
import { activePair, applyInputEdit, zoneReceiver, type LinkPin } from '../../lib/activeLink';
import { buildingsActive, sensorPaths, withBuildings } from '../../lib/buildings';
import { coverageStepM, coverageZones } from '../../lib/coverage';
import { groundForCoverage } from '../../lib/coverageGround';
import { signalRange } from '../../lib/signalColour';
import { sampleGrid, type ScalarGrid } from '../../lib/contours';
import type { GroundAt } from '../../lib/elevation';
import { type LatLon, SG_REFERENCE, offsetLatLon, toLatLon, toLocalM } from '../../lib/geo';
import { addSensor, changeRole, createSensor, evaluatePairs, effectiveObjective, groundOf, pairLinkInputs, receiverSummary, removeSensor } from '../../lib/sensors';
import { assessAll, pairVerdict, usesAggregate, worstAssessedLink } from '../../lib/interference';
import { interferenceSources, interferenceZones, placementPlan, placementZones, referenceReceiver, streetBuildingM } from '../../lib/interferenceLayer';
import { multiFieldKey } from '../../lib/multiField';
import { sameZoneResult } from '../../lib/zones';
import { thresholdSlantRangeM } from '../../lib/thresholds';
import type { AppState, LinkInputs, MapScenario, Sensor } from '../../types';
import { useCoverageWorker, useMultiFieldWorker, useZoneWorker } from '../useFieldWorker';
import { isBoolean, oneOf, usePref } from '../usePref';
import { useKeyed, useStableValue } from './useStable';
import { statusTone } from '../ui';
import { CoverageLegend, type CoverageLayer, type CoverageStyle } from './CoverageLegend';
import { type DrawerSize, LinkBudgetDrawer } from './LinkBudgetDrawer';
import { LinkSettingsCard } from './LinkSettingsCard';
import { SelectedSensorCard } from './SelectedSensorCard';
import { SensorListCard } from './SensorListCard';
import { useMediaQuery } from './mediaQuery';
import { type Basemap, type MapLink, type MapView, SensorMap, type SensorMapHandle } from './SensorMap';
import type { BuildingTiles } from './useBuildingTiles';
import type { useElevationTiles } from './useElevationTiles';

type Elevation = ReturnType<typeof useElevationTiles>;

/** Link length as the range rings show it: metres below 1 km, else km. */
const formatDistance = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`);
const isDrawerSize = (v: unknown): v is DrawerSize => v === null || v === 'max' || (typeof v === 'number' && Number.isFinite(v) && v >= 120);

/** Building tile zoom whose (max-pooled) pixels are no coarser than about one grid cell. */
const buildingZoomFor = (g: ScalarGrid) => { const cell = Math.max(g.dx, g.dy); return cell < 7 ? 15 : cell < 14 ? 14 : 13; };

/** Elevation tile zoom whose pixels are no coarser than one zone grid cell. */
function zoomForCell(cellM: number, lat: number) {
  const metresPerPixelZ0 = 156_543.03 * Math.cos((lat * Math.PI) / 180);
  return Math.min(14, Math.max(10, Math.ceil(Math.log2(metresPerPixelZ0 / cellM))));
}

export function MapWorkspace({ state, setState, elevation, buildings, pin, setPin }: { state: AppState; setState: React.Dispatch<React.SetStateAction<AppState>>; elevation: Elevation; buildings: BuildingTiles; pin: LinkPin | null; setPin: (pin: LinkPin | null) => void }) {
  const handle = useRef<SensorMapHandle | null>(null);
  const [view, setView] = useState<MapView | null>(null);
  const [draft, setDraft] = useState<Record<string, LatLon>>({});
  const [showSettings, setShowSettings] = useState(false);
  // View preferences are remembered on this device; scenario data stays in the app state.
  const [hidePanels, setHidePanels] = usePref('hidePanels', false, isBoolean);
  const [showAll, setShowAll] = usePref('showAllBands', false, isBoolean);
  const [coverageStyle, setCoverageStyle] = usePref<CoverageStyle>('coverageStyle', 'gradient', oneOf('gradient', 'bands'));
  const [coverageLayer, setCoverageLayer] = usePref<CoverageLayer>('coverageLayer', 'range', oneOf('range', 'interference', 'placement'));
  const [basemapNotice, setBasemapNotice] = useState(false);
  const [basemap, setBasemap] = usePref<Basemap>('basemap', 'onemap', oneOf('onemap', 'plain', 'light'));
  const [drawerOpen, setDrawerOpen] = usePref('drawerOpen', false, isBoolean);
  // Drawer height in px once dragged, 'max' to fill the workspace, null for the default.
  const [drawerSize, setDrawerSize] = usePref<DrawerSize>('drawerSize', null, isDrawerSize);
  const root = useRef<HTMLDivElement | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  // Narrow screens fold the secondary map controls into a "More" popover so the toolbar never overflows.
  const compactBar = useMediaQuery('(max-width: 1360px)');
  const phoneBar = useMediaQuery('(max-width: 640px)');
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!moreOpen) return;
    const close = (event: Event) => { if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMoreOpen(false); moreRef.current?.querySelector<HTMLElement>('.more-toggle')?.focus(); } };
    document.addEventListener('pointerdown', close); document.addEventListener('focusin', close); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('focusin', close); document.removeEventListener('keydown', key); };
  }, [moreOpen]);
  const { map } = state;

  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement !== null && document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  // Without the Fullscreen API (iOS Safari) the workspace covers the window instead; Escape leaves it.
  useEffect(() => {
    if (!fullscreen || document.fullscreenElement) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);
  // F toggles full screen unless the user is typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key.toLowerCase() !== 'f' || e.ctrlKey || e.metaKey || e.altKey || t?.closest('input, select, textarea, [contenteditable]')) return;
      e.preventDefault(); toggleFullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const toggleFullscreen = () => {
    if (!document.fullscreenEnabled) setFullscreen((f) => !f);
    else if (document.fullscreenElement) void document.exitFullscreen();
    else void root.current?.requestFullscreen();
  };
  const withBuildingsOn = buildingsActive(map);
  const groundAt: GroundAt = useMemo(() => withBuildings(elevation.groundAt, withBuildingsOn ? buildings.buildingAt : undefined), [elevation.groundAt, buildings.buildingAt, withBuildingsOn]);
  const dragging = Object.keys(draft).length > 0;

  const sensors = useMemo(() => map.sensors.map((s) => (draft[s.id] ? { ...s, ...draft[s.id] } : s)), [map.sensors, draft]);
  useEffect(() => { if (withBuildingsOn) buildings.ensurePaths(sensorPaths(sensors)); }, [sensors, withBuildingsOn, buildings.ensurePaths]);
  /** Loads the building tiles a ray grid reads (in effects: loading sets state). */
  const ensureBuildingsFor = (g: ScalarGrid | undefined) => {
    if (!g) return;
    buildings.ensureBox(toLatLon({ xM: g.x0, yM: g.y0 }), toLatLon({ xM: g.x0 + g.cols * g.dx, yM: g.y0 + g.rows * g.dy }), buildingZoomFor(g));
  };
  /** Building heights on the same nodes as a ground grid, from the tile zoom that matches its cell; undefined when off. */
  const buildingGrid = (g: ScalarGrid) => {
    if (!withBuildingsOn) return undefined;
    const sample = buildings.samplerAt(buildingZoomFor(g));
    return sampleGrid({ minX: g.x0, maxX: g.x0 + g.cols * g.dx, minY: g.y0, maxY: g.y0 + g.rows * g.dy }, g.cols, g.rows, (xM, yM) => sample(toLatLon({ xM, yM })));
  };
  const liveMap: MapScenario = useMemo(() => ({ ...map, sensors }), [map, sensors]);
  const pairs = useMemo(() => evaluatePairs(liveMap, state.inputs, groundAt), [liveMap, state.inputs, groundAt]);
  const assessments = useMemo(() => assessAll(liveMap, pairs), [liveMap, pairs]);
  const selected = sensors.find((s) => s.id === map.selectedId) ?? null;

  useEffect(() => {
    if (!showSettings) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setShowSettings(false); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [showSettings]);

  useEffect(() => { if (map.useTerrainElevation) elevation.ensure(sensors); }, [sensors, map.useTerrainElevation, elevation.ensure]);

  const setMap = (update: (current: MapScenario) => MapScenario) => setState((current) => ({ ...current, map: update(current.map) }));
  const updateSensor = (id: string, patch: Partial<Sensor>) => setMap((m) => ({ ...m, sensors: m.sensors.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  const select = (id: string) => setMap((m) => ({ ...m, selectedId: id }));
  const setShared = <K extends keyof LinkInputs>(key: K, value: LinkInputs[K]) => setState((current) => ({ ...current, inputs: { ...current.inputs, [key]: value } }));

  const editInput = <K extends keyof LinkInputs>(key: K, value: LinkInputs[K]): string | undefined => {
    const shown = activePair(state.map, groundAt, state.inputs, pin);
    const held = shown ? { rxId: shown.rx.id, txId: shown.tx.id, scope: pin?.scope } : null;
    const edited = applyInputEdit(state, key, value, groundAt, held);
    if (!edited.ok) return edited.reason;
    setPin(held);
    setState(edited.state);
    return undefined;
  };

  // Stable callbacks and state for the memoised drawer, so panning or a worker result does not re-render it.
  const drawerHandlers = useRef({ editInput, select, setPin });
  drawerHandlers.current = { editInput, select, setPin };
  const drawerEdit = useCallback(<K extends keyof LinkInputs>(key: K, value: LinkInputs[K]) => drawerHandlers.current.editInput(key, value), []);
  const drawerPin = useCallback((p: LinkPin | null) => { if (p) drawerHandlers.current.select(p.rxId); drawerHandlers.current.setPin(p); }, []);
  const drawerState = useMemo(() => ({ ...state, map: liveMap }), [state, liveMap]);

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

  // Zones belong to the selected transmitter, or the selected receiver's strongest desired transmitter.
  const zoneTx = useMemo(() => (selected?.role === 'tx' ? selected : selected ? activePair(liveMap, groundAt, state.inputs, pin)?.tx : sensors.find(s => s.role === 'tx') ?? null), [selected, liveMap, groundAt, state.inputs, pin]);
  const zone = useMemo(() => (zoneTx ? zoneReceiver(liveMap, zoneTx.id, groundAt) : null), [zoneTx, liveMap, groundAt]);
  const referenceRx = referenceReceiver(liveMap, selected, zone?.rx ?? null);
  const placement = useMemo(() => selected?.role === 'tx' ? placementPlan(liveMap, state.inputs, selected, groundAt, pairs) : null,
    [selected, liveMap, state.inputs, groundAt, pairs]);
  const linkedRxIds = zoneTx ? pairs.filter((p) => p.txId === zoneTx.id && p.intended).map((p) => p.rxId) : [];

  // The ground grid depends on the view, tile data and the zoom the transmitter's latitude picks, not on
  // names, thresholds or other edits, so it is sampled only when those change.
  const hasZone = zoneTx !== null && zone !== null;
  const zoneGrid = useMemo(() => {
    // Only the Range layer uses this grid; sampling ground over the view is costly, so skip it otherwise.
    if (coverageLayer !== 'range' || !hasZone || !view || view.width === 0) return null;
    // Local metres from the fixed Singapore reference, so results stay placed if Tx moves meanwhile.
    const sw = toLocalM(view.southWest);
    const ne = toLocalM(view.northEast);
    const pixelsPerCell = dragging ? 14 : 3;
    const cols = Math.max(16, Math.ceil(view.width / pixelsPerCell));
    const rows = Math.max(10, Math.ceil(view.height / pixelsPerCell));
    const cellM = Math.max((ne.xM - sw.xM) / cols, (ne.yM - sw.yM) / rows);
    const z = zoomForCell(cellM, zoneTx!.lat);
    const sampler = elevation.samplerAt(z);
    const ground = sampleGrid({ minX: sw.xM, maxX: ne.xM, minY: sw.yM, maxY: ne.yM }, cols, rows, (xM, yM) => {
      if (!map.useTerrainElevation) return 0;
      return sampler(toLatLon({ xM, yM })) ?? NaN;
    });
    return { z, cols, rows, ground };
  }, [coverageLayer, hasZone, zoneTx?.lat, view, dragging, map.useTerrainElevation, elevation.samplerAt]);

  const zoneRequest = useMemo(() => {
    if (!zoneGrid || !zoneTx || !zone || !view) return null;
    const { z, cols, rows, ground } = zoneGrid;
    const txLocal = toLocalM(zoneTx);
    const { inputs } = pairLinkInputs(map, state.inputs, zoneTx, zone.rx, 1);
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
        state.inputs.otherLossDb, inputs.frequencyGhz, inputs.otherLossDb, view.southWest.lat, view.southWest.lon, view.northEast.lat, view.northEast.lon, cols, rows, map.useTerrainElevation, elevation.version, withBuildingsOn, withBuildingsOn && buildings.version, zoneTx.mount, zone.rx.mount].join('|'),
    };
  }, [zoneGrid, zoneTx, zone, view, map.useTerrainElevation, map.rejectionModel, elevation.version, state.inputs, groundAt, withBuildingsOn, buildings.version]);

  useEffect(() => {
    if (zoneRequest && view && map.useTerrainElevation) elevation.ensureBox(view.southWest, view.northEast, zoneRequest.z);
  }, [zoneRequest?.key]);

  const terrain = map.propagationModel === 'terrain';
  // Ray ground and building grids follow the view grid and the transmitter position only.
  const txX = zoneRequest?.request.tx.xM, txY = zoneRequest?.request.tx.yM;
  const rayGround = useMemo(() => {
    if (!terrain || !zoneGrid || txX === undefined || txY === undefined) return null;
    // The rays start at the transmitter, which may be off-screen when zoomed in: give them ground that reaches it.
    const sampler = elevation.samplerAt(zoneGrid.z);
    return groundForCoverage(zoneGrid.ground, { xM: txX, yM: txY }, (xM, yM) => (map.useTerrainElevation ? sampler(toLatLon({ xM, yM })) ?? NaN : 0));
  }, [terrain, zoneGrid, txX, txY, map.useTerrainElevation, elevation.samplerAt]);
  const rayBuildings = useMemo(() => rayGround ? buildingGrid(rayGround) : undefined, [rayGround, withBuildingsOn, buildings.samplerAt]);
  const coverageRequest = useMemo(() => {
    if (!terrain || !zoneRequest || !zoneTx || !zone || !rayGround) return null;
    const req = zoneRequest.request, g = req.ground;
    const maxView = Math.max(...[[g.x0, g.y0], [g.x0 + g.cols * g.dx, g.y0 + g.rows * g.dy]].map(([x,y]) => Math.hypot(x - req.tx.xM, y - req.tx.yM)));
    const maxRangeM = Math.max(30, Math.min(90000, maxView, req.slant.sensitivityM * 2));
    return { tx: { lat: zoneTx.lat, lon: zoneTx.lon, elevationM: groundOf(zoneTx, groundAt, map.useTerrainElevation) === null ? NaN : req.tx.elevationM }, rxAglM: zone.rx.aglM, inputs: pairLinkInputs(map, state.inputs, zoneTx, zone.rx, 1).inputs, maxRangeM, radials: dragging ? 180 : 720, stepM: coverageStepM(maxRangeM, !!rayBuildings), ground: { origin: SG_REFERENCE, grid: rayGround },
      buildings: rayBuildings && { grid: rayBuildings, rxOnRoof: zone.rx.mount === 'roof', txOwnM: streetBuildingM(zoneTx, groundAt) } };
  }, [terrain, zoneRequest, zoneTx, zone, rayGround, rayBuildings, dragging, groundAt, map.useTerrainElevation, state.inputs]);
  useEffect(() => ensureBuildingsFor(coverageRequest?.buildings?.grid), [coverageRequest?.buildings?.grid]);
  useEffect(() => {
    const grid = coverageRequest?.ground.grid;
    if (!grid || !coverageRequest || !zoneRequest || !map.useTerrainElevation) return;
    const sw = toLatLon({ xM: grid.x0, yM: grid.y0 }), ne = toLatLon({ xM: grid.x0 + grid.cols * grid.dx, yM: grid.y0 + grid.rows * grid.dy });
    elevation.ensureBox(sw, ne, zoneRequest.z);
  }, [coverageRequest?.ground.grid]);
  // The request key covers only what changes the fields (positions, heights, power budget, frequency, model, tiles),
  // so a rename, a selection or a threshold edit reclassifies the existing result instead of recomputing it.
  const multiAnchor = coverageLayer === 'placement' ? placement && selected : coverageLayer === 'interference' ? referenceRx : null;
  const multiSources = multiAnchor && view && view.width > 0 ? coverageLayer === 'placement' ? placement!.sources : interferenceSources(liveMap, state.inputs, referenceRx!, groundAt) : null;
  const multiKey = multiAnchor && multiSources ? multiFieldKey({ layer: coverageLayer, sources: multiSources, victimCount: placement?.victims.length, mode: map.propagationModel, rxAglM: multiAnchor.aglM, rxOnRoof: multiAnchor.mount === 'roof',
    radials: dragging ? 180 : 360, view, dragging, elevationVersion: elevation.version, buildingsVersion: withBuildingsOn && buildings.version, terrain: map.useTerrainElevation }) + `|${multiAnchor.lat}` : null;
  const multiRequest = useKeyed(multiKey, () => {
    if (!multiAnchor || !multiSources || !view) return null;
    const anchor = multiAnchor, sources = multiSources;
    const sw = toLocalM(view.southWest), ne = toLocalM(view.northEast);
    const cols = Math.max(16, Math.ceil(view.width / (dragging ? 14 : 3)));
    const rows = Math.max(10, Math.ceil(view.height / (dragging ? 14 : 3)));
    const z = zoomForCell(Math.max((ne.xM - sw.xM) / cols, (ne.yM - sw.yM) / rows), anchor.lat);
    const sampler = elevation.samplerAt(z);
    const sample = (xM: number, yM: number) => map.useTerrainElevation ? sampler(toLatLon({ xM, yM })) ?? NaN : 0;
    const raster = sampleGrid({ minX: sw.xM, maxX: ne.xM, minY: sw.yM, maxY: ne.yM }, cols, rows, sample);
    // Include off-screen sources and their paths in one shared ray ground grid.
    const extent = sources.reduce((g, source) => groundForCoverage(g, toLocalM(source), sample), raster);
    const rayGround = extent === raster ? raster : sampleGrid({ minX: extent.x0, maxX: extent.x0 + extent.cols * extent.dx, minY: extent.y0, maxY: extent.y0 + extent.rows * extent.dy }, extent.cols, extent.rows, sample);
    const rayBuildings = map.propagationModel === 'terrain' ? buildingGrid(rayGround) : undefined;
    return { z, key: multiKey!, request: { raster, rayGround, rayBuildings, rxOnRoof: anchor.mount === 'roof', origin: SG_REFERENCE, mode: map.propagationModel, rxAglM: anchor.aglM, sources, radials: dragging ? 180 : 360 } };
  });
  useEffect(() => {
    if (!multiRequest || !map.useTerrainElevation) return;
    const g = multiRequest.request.rayGround;
    elevation.ensureBox(toLatLon({ xM: g.x0, yM: g.y0 }), toLatLon({ xM: g.x0 + g.cols * g.dx, yM: g.y0 + g.rows * g.dy }), multiRequest.z);
  }, [multiRequest, map.useTerrainElevation, elevation.ensureBox]);
  useEffect(() => ensureBuildingsFor(multiRequest?.request.rayBuildings), [multiRequest?.request.rayBuildings]);
  const multi = useMultiFieldWorker(multiRequest?.request ?? null, multiRequest?.key ?? coverageLayer);
  const free = useZoneWorker(coverageLayer === 'range' && !terrain ? zoneRequest?.request ?? null : null, `${coverageLayer}|${terrain}|${zoneRequest?.key}`);
  const coverage = useCoverageWorker(coverageLayer === 'range' ? coverageRequest : null, `${coverageLayer}|${terrain}|${zoneRequest?.key}`);
  // Band edges are only drawn without the gradient; skip tracing them otherwise.
  const bands = coverageLayer === 'placement' || coverageStyle !== 'gradient';
  // Reclassifying after a rename or a threshold edit often paints the same map; keep the old result then so the map is not repainted.
  const zoneResult = useStableValue(useMemo(() => coverageLayer !== 'range'
    ? multi.result && multiRequest && multi.resultKey === multiRequest.key
      ? coverageLayer === 'placement' ? placement ? placementZones(placement, multiRequest.request.raster, multi.result, bands) : null
        : referenceRx ? interferenceZones(liveMap, referenceRx, multiRequest.request.raster, multi.result, bands) : null : null
    : terrain ? coverage.result && coverageRequest && zoneRequest ? coverageZones(coverage.result, coverageRequest, zoneRequest.request.ground, bands) : null : free.result,
  [coverageLayer, placement, multi.result, multi.resultKey, multiRequest, referenceRx, liveMap, terrain, coverage.result, coverageRequest, zoneRequest, free.result, bands]), sameZoneResult);
  const refining = coverageLayer !== 'range' ? multi.refining : terrain ? coverage.refining : free.refining;
  const objective = coverageLayer === 'interference' ? 'avoidance' : zone ? effectiveObjective(liveMap, zone.rx) : map.defaultObjective;
  // Rings are free-space reference ranges, so they would mislead once terrain diffraction is on.
  // Keyed on the ranges rather than the whole request, so panning does not rebuild the ring labels.
  const slant = zoneRequest?.request.slant;
  const rings = useMemo(() => coverageLayer === 'range' && zoneTx && slant && !terrain ? (['sensitivity', 'required', 'interference'] as const).flatMap(id => {
    const range = slant[`${id}M`];
    if (!Number.isFinite(range)) return [];
    return [{ id, label: `${id} ${range >= 1000 ? (range / 1000).toFixed(2) + ' km' : range.toFixed(0) + ' m'}`, points: Array.from({ length: 129 }, (_, i) => offsetLatLon(zoneTx, Math.sin(i * 2 * Math.PI / 128) * range, Math.cos(i * 2 * Math.PI / 128) * range)) }];
  }) : [], [zoneTx, slant?.sensitivityM, slant?.requiredM, slant?.interferenceM, terrain, coverageLayer]);
  useEffect(() => {
    if (!map.useTerrainElevation || !terrain) return;
    for (const p of pairs) {
      const a = sensors.find(s => s.id === p.txId)!, b = sensors.find(s => s.id === p.rxId)!;
      elevation.ensureBox({ lat: Math.min(a.lat, b.lat), lon: Math.min(a.lon, b.lon) }, { lat: Math.max(a.lat, b.lat), lon: Math.max(a.lon, b.lon) }, 14);
    }
  }, [sensors, terrain, map.useTerrainElevation, elevation.ensureBox]);
  // The gradient span is two numbers; keying on them keeps the map layer from repainting when only names or selection change.
  const rangeSpec = coverageLayer !== 'placement' && zoneResult?.powerDbm && coverageStyle === 'gradient' ? coverageLayer === 'interference' && referenceRx ? signalRange(referenceRx, 'avoidance', false) : zone ? signalRange(zone.rx, objective, showAll) : undefined : undefined;
  const rangeLo = rangeSpec?.lo, rangeHi = rangeSpec?.hi;
  const zones = useMemo(() => {
    if (!zoneResult) return null;
    const { bounds } = zoneResult;
    const at = (xM: number, yM: number) => toLatLon({ xM, yM });
    const lines = (segments: [number, number, number, number][]) => segments.map(([x1, y1, x2, y2]) => [at(x1, y1), at(x2, y2)]);
    return {
      result: zoneResult,
      totalInterference: coverageLayer === 'interference',
      placement: coverageLayer === 'placement',
      objective, showAll,
      // Without a range the map paints the threshold bands and their outlines instead of the gradient.
      range: rangeLo !== undefined && rangeHi !== undefined ? { lo: rangeLo, hi: rangeHi } : undefined,
      corners: [at(bounds.minX, bounds.maxY), at(bounds.maxX, bounds.maxY), at(bounds.maxX, bounds.minY), at(bounds.minX, bounds.minY)] as [LatLon, LatLon, LatLon, LatLon],
      outlines: { sensitivity: lines(zoneResult.outlines.sensitivity), required: lines(zoneResult.outlines.required), interference: lines(zoneResult.outlines.interference) },
    };
  }, [zoneResult, objective, showAll, rangeLo, rangeHi, coverageLayer]);

  // Memoised so map sources and the signal overlay only update when the links change, not on every pan.
  const links = useMemo<MapLink[]>(() => {
    const byId = new Map(sensors.map((s) => [s.id, s]));
    return pairs
      .filter((p) => {
        if (p.intended) return true;
        const a = assessments.get(p.rxId)!;
        const verdict = pairVerdict(p, byId.get(p.rxId)!, a.marginDb);
        return verdict === 'Possible interference' || verdict === 'Marginal interference' ||
          (a.aggregate && a.status !== 'Below interference threshold' && a.contributors.some(c => c.txId === p.txId && c.share >= 0.1));
      })
      .map((p) => ({
        from: byId.get(p.txId)!, to: byId.get(p.rxId)!,
        kind: p.intended ? 'intended' : 'interference',
        tone: statusTone(p.intended ? assessments.get(p.rxId)!.links.find(l => l.txId === p.txId)!.status : (() => {
          const a = assessments.get(p.rxId)!;
          const verdict = pairVerdict(p, byId.get(p.rxId)!, a.marginDb);
          return verdict === 'Below interference threshold' ? a.status : verdict;
        })()),
        emphasis: !selected || p.txId === selected.id || p.rxId === selected.id,
        label: p.intended ? formatDistance(p.distanceM) : undefined,
      }));
  }, [pairs, assessments, sensors, selected]);
  const tones = useMemo<Record<string, string>>(() => Object.fromEntries(sensors.map((s) => {
    if (s.role === 'tx') return [s.id, 'tx'];
    const summary = receiverSummary(pairs, s.id);
    const a = assessments.get(s.id)!;
    const link = worstAssessedLink(a, summary.links);
    const status = a.links.find(l => l.txId === link?.txId)?.status;
    return [s.id, a.status === 'Possible interference' || status === 'Interfered link' || status === 'No link' ? 'danger' : a.status === 'Marginal interference' ? 'warning' : status ? statusTone(status) : a.unknownPaths ? 'neutral' : 'safe'];
  })), [sensors, pairs, assessments]);

  const modelControl = (
        <label className="tool-group select-group"><span className="tool-label">Model</span>
          <select value={map.propagationModel} onChange={e => setMap(m => ({ ...m, propagationModel: e.target.value as MapScenario['propagationModel'] }))}><option value="terrain">Terrain diffraction</option><option value="free-space">Free space</option></select>
        </label>
  );
  const secondaryControls = (
    <>
        <label className="tool-group switch-group" title="Use ground elevation from the terrain data; off assumes flat ground">
          <input type="checkbox" aria-label="Use terrain elevation" checked={map.useTerrainElevation} onChange={(event) => setMap((m) => ({ ...m, useTerrainElevation: event.target.checked }))} />
          <span>Terrain elevation</span>
        </label>
        <label className="tool-group switch-group" title={terrain ? 'Building heights block paths; antennas on a roof count their height from it' : 'Buildings need the Terrain diffraction model'}>
          <input type="checkbox" aria-label="Buildings" checked={map.buildings && terrain} disabled={!terrain} onChange={(event) => setMap((m) => ({ ...m, buildings: event.target.checked }))} />
          <span>Buildings</span>
        </label>
        <label className="tool-group select-group" title="Light vector map, OneMap street map, or plain terrain"><span className="tool-label">Map</span>
          <select aria-label="Basemap" value={basemap} onChange={e => { setBasemap(e.target.value as Basemap); setBasemapNotice(false); }}><option value="light">Light</option><option value="onemap">OneMap</option><option value="plain">Plain terrain</option></select>
        </label>
        <button type="button" className="tool tool-group" aria-pressed={hidePanels} onClick={() => setHidePanels(!hidePanels)}>{hidePanels ? <Eye size={14} /> : <EyeOff size={14} />}{hidePanels ? 'Show panels' : 'Hide panels'}</button>
    </>
  );

  return (
    <div
      ref={root}
      className={`map-workspace${dragging ? ' dragging-sensor' : ''}${hidePanels ? ' panels-hidden' : ''}${drawerOpen ? ' drawer-open' : ''}${drawerOpen && drawerSize !== null ? ' drawer-sized' : ''}${drawerOpen && drawerSize === 'max' ? ' drawer-max' : ''}${fullscreen ? ' map-fullscreen' : ''}`}
      style={typeof drawerSize === 'number' ? { '--drawer-h': `${drawerSize}px` } as React.CSSProperties : undefined}
    >
      <SensorMap
        sensors={sensors} selectedId={map.selectedId} tones={tones} links={links} zones={zones} rings={rings} basemap={basemap} buildings={withBuildingsOn} onBasemapFallback={() => { setBasemap('onemap'); setBasemapNotice(true); }} frequencyGhz={state.inputs.frequencyGhz} handleRef={handle}
        onSelect={select}
        onDrag={(id, at) => setDraft((d) => ({ ...d, [id]: at }))}
        onDragEnd={(id, at) => { updateSensor(id, at); setDraft((d) => { const { [id]: _done, ...rest } = d; return rest; }); }}
        onNudge={(id, dx, dy) => { const s = map.sensors.find((x) => x.id === id); if (s) updateSensor(id, offsetLatLon(s, dx, dy)); }}
        onView={setView}
      />

      <div className="map-toolbar" role="toolbar" aria-label="Map">
        <div className="tool-group">
          <button type="button" className="tool icon-only" aria-label="Fit all sensors" title="Fit all sensors" onClick={() => handle.current?.fitSensors()}><Maximize2 size={15} /></button>
          <button type="button" className="tool icon-only" aria-label="Zoom in" title="Zoom in" onClick={() => handle.current?.zoomBy(1)}><Plus size={15} /></button>
          <button type="button" className="tool icon-only" aria-label="Zoom out" title="Zoom out" onClick={() => handle.current?.zoomBy(-1)}><Minus size={15} /></button>
          <button type="button" className="tool icon-only" aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} aria-pressed={fullscreen} title={fullscreen ? 'Exit full screen (Esc or F)' : 'Full screen (F)'} onClick={toggleFullscreen}>{fullscreen ? <Shrink size={15} /> : <Expand size={15} />}</button>
        </div>
        <div className="tool-group" role="group" aria-label="Default objective">
          <span className="tool-label">Objective</span>
          {(['desired', 'avoidance'] as const).map(o => <button key={o} type="button" className={`tool${map.defaultObjective === o ? ' active' : ''}`} aria-pressed={map.defaultObjective === o} title={o === 'desired' ? 'Receivers should hear their intended transmitter' : 'Receivers should stay isolated from transmitters'} onClick={() => setMap(m => ({ ...m, defaultObjective: o }))}>{o === 'desired' ? 'Desired' : 'Avoidance'}</button>)}
        </div>
        {!phoneBar && modelControl}
        {!compactBar && secondaryControls}
        <button type="button" className={`tool tool-group${showSettings ? ' active' : ''}`} aria-pressed={showSettings} onClick={() => setShowSettings(!showSettings)}><SlidersHorizontal size={14} /> Link settings</button>
        {(compactBar || phoneBar) && (
          <div className="more-menu" ref={moreRef}>
            <button type="button" className={`tool tool-group more-toggle${moreOpen ? ' active' : ''}`} aria-expanded={moreOpen} aria-haspopup="true" aria-controls="map-more" onClick={() => setMoreOpen(o => !o)}><Ellipsis size={14} /> More</button>
            {moreOpen && <div id="map-more" className="more-popover" role="group" aria-label="More map controls">
              {phoneBar && modelControl}
              {secondaryControls}
            </div>}
          </div>
        )}
        {basemapNotice && <span role="status" className="map-notice">Light map unavailable. Switched to OneMap.</span>}
        {elevation.status === 'offline' && <span className="map-notice" role="status">Elevation tiles unavailable: terrain predictions are unknown.</span>}
        {withBuildingsOn && buildings.status === 'offline' && <span className="map-notice" role="status">Some building tiles failed to load: those buildings are missing.</span>}
        {withBuildingsOn && buildings.status === 'loading' && <span className="refining" role="status">Loading buildings…</span>}
        {refining && <span className="refining" role="status">Refining coverage…</span>}
      </div>

      <CoverageLegend objective={objective} showAll={showAll} onShowAll={setShowAll} terrain={terrain} range={zones?.range} coverageStyle={coverageStyle} onCoverageStyle={setCoverageStyle} coverageLayer={coverageLayer} onCoverageLayer={setCoverageLayer} referenceName={referenceRx?.name} aggregate={referenceRx ? usesAggregate(liveMap, referenceRx) : false} placementName={selected?.role === 'tx' ? selected.name : undefined} victimNames={placement?.victims.map(v => v.rx.name)} servedNames={placement?.served.map(s => s.name)} />
      <SensorListCard
        sensors={sensors} pairs={pairs} assessments={assessments} selectedId={map.selectedId} onSelect={select} onAdd={addAtCentre}
        onRemove={(id) => setMap((m) => ({ ...m, sensors: removeSensor(m.sensors, id), selectedId: m.selectedId === id ? null : m.selectedId, zonesForRxId: m.zonesForRxId === id ? 'auto' : m.zonesForRxId }))}
      />

      <LinkBudgetDrawer state={drawerState} pairs={pairs} assessments={assessments} groundAt={groundAt} onEdit={drawerEdit} open={drawerOpen} onToggle={setDrawerOpen} pin={pin} onPin={drawerPin} size={drawerSize} onResize={setDrawerSize} />

      {showSettings && <LinkSettingsCard inputs={state.inputs} onChange={setShared} map={map} setMap={setMap} />}

      {selected && (
        <SelectedSensorCard
          sensor={selected} map={liveMap} pairs={pairs} assessments={assessments} groundAt={groundAt} defaultFrequencyGhz={state.inputs.frequencyGhz}
          zoneInfo={zoneTx && zone ? { txName: zoneTx.name, rxName: zone.rx.name, reason: zone.reason, aglM: zone.rx.aglM, linkedRxIds } : null}
          onChange={(patch) => { updateSensor(selected.id, patch); return undefined; }}
          onRoleChange={(role) => setMap((m) => ({ ...m, sensors: changeRole(m.sensors, selected.id, role) }))}
          onZonesFor={(rxId) => setMap((m) => ({ ...m, zonesForRxId: rxId }))}
        />
      )}
    </div>
  );
}
