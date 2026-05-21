import mapboxgl from 'mapbox-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOverwatchStore } from '../store/overwatch-store';
import type { BaseData, UnitPosition } from '../store/overwatch-store';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Waypoint {
  sequence: number;
  latitude: number;
  longitude: number;
  altitude_ft?: number;
  name?: string;
  waypointType?: string;
}

interface MissionRoute {
  missionId: string;
  callsign: string;
  domain: string;
  waypoints: Waypoint[];
}

interface MissionTarget {
  targetId: string;
  targetName: string;
  latitude: number;
  longitude: number;
  desiredEffect: string;
  beNumber: string | null;
  targetCategory: string | null;
  priorityRank: number;
}

type LinkMode = 'OFF' | 'SELECTED' | 'ON';

// ─── Selected Entity Types ──────────────────────────────────────────────────

interface SelectedTrack {
  kind: 'track';
  missionId: string;
  callsign: string;
  domain: string;
  status: string;
  latitude: number;
  longitude: number;
  altitude_ft?: number;
  heading?: number;
  speed_kts?: number;
}

interface SelectedUnit {
  kind: 'unit';
  units: UnitPosition[];
  location: string;
}

interface SelectedBase {
  kind: 'base';
  base: BaseData;
}

interface SelectedTarget {
  kind: 'target';
  target: MissionTarget;
}

interface SelectedSatellite {
  kind: 'satellite';
  missionId: string;
  callsign: string;
  domain: string;
  status: string;
  latitude: number;
  longitude: number;
  altitude_ft?: number;
}

type SelectedEntity = SelectedTrack | SelectedUnit | SelectedBase | SelectedTarget | SelectedSatellite;

interface SpaceAllocationLink {
  id: string;
  status: string;
  allocatedCapability: string | null;
  rationale: string | null;
  riskLevel: string | null;
  spaceAsset: {
    id: string;
    name: string;
    constellation: string;
    capabilities: string[];
    operator: string | null;
    status: string;
    affiliation: string;
  } | null;
  spaceNeed: {
    id: string;
    capabilityType: string;
    role: string;
    missionCriticality: string;
    startTime: string;
    endTime: string;
    mission: {
      id: string;
      missionId: string;
      callsign: string | null;
      domain: string;
      missionType: string;
      status: string;
      affiliation: string;
      unitId: string | null;
      unit: { id: string; unitDesignation: string; unitName: string } | null;
    };
  };
}

/** Return the subset of allocations that should render as link lines on the map. */
function getVisibleLinks(
  mode: LinkMode,
  allocations: SpaceAllocationLink[],
  selected: SelectedEntity | null,
): SpaceAllocationLink[] {
  if (mode === 'OFF') return [];
  if (mode === 'ON') return allocations;

  // SELECTED — filter to links touching the selected entity
  if (!selected || (selected.kind !== 'satellite' && selected.kind !== 'track')) return [];

  const mid = selected.missionId;
  const callsign = selected.kind === 'satellite' ? selected.callsign : null;

  return allocations.filter(a =>
    a.spaceNeed.mission.id === mid ||
    a.spaceAsset?.id === mid ||
    (callsign && a.spaceAsset?.name === callsign),
  );
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DOMAIN_COLORS: Record<string, string> = {
  AIR: '#00d4ff',
  MARITIME: '#0090ff',
  LAND: '#22c55e',
  SPACE: '#a855f7',
};

const TRAIL_COLORS: Record<string, string> = {
  AIR: '#00ffd4',
  MARITIME: '#00ff90',
  LAND: '#4ade80',
  SPACE: '#c084fc',
};

const BASE_COLORS: Record<string, string> = {
  AIRBASE: '#f59e0b',    // amber
  NAVAL_BASE: '#3b82f6', // blue
  JOINT_BASE: '#10b981', // green
};

const BASE_SYMBOLS: Record<string, string> = {
  AIRBASE: '✦',
  NAVAL_BASE: '⚓',
  JOINT_BASE: '◆',
};

/** Sim-time window for breadcrumb trails (ms). Keeps ~1 hour of orbital history. */
const TRAIL_WINDOW_MS = 60 * 60 * 1000; // 1 sim-hour

/** Duration (ms) to interpolate between position updates (matches server emit interval) */
const INTERP_DURATION_MS = 2000;

const COVERAGE_COLORS: Record<string, string> = {
  SATCOM_WIDEBAND: '#3b82f6',
  SATCOM_PROTECTED: '#8b5cf6',
  GPS: '#10b981',
  PNT: '#10b981',
  OPIR: '#f97316',
  ISR: '#eab308',
};

// ─── XSS Escape Helper ──────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ─── SVG Icon Helpers ───────────────────────────────────────────────────────

/** Create an SVG element using DOM APIs (no innerHTML) */
function svgEl(tag: string, attrs: Record<string, string>, children?: SVGElement[]): SVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (children) children.forEach(c => el.appendChild(c));
  return el;
}

/** Build domain-specific SVG icon using safe DOM construction */
function makeDomainIcon(domain: string, color: string, size: number): HTMLDivElement {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = `width:${size}px;height:${size}px;cursor:pointer;`;

  const svg = svgEl('svg', { width: String(size), height: String(size), viewBox: '0 0 24 24', fill: 'none' });

  if (domain === 'AIR') {
    // Delta-wing fighter silhouette
    svg.appendChild(svgEl('path', { d: 'M12 3 L14 10 L22 13 L14 14 L16 21 L12 18 L8 21 L10 14 L2 13 L10 10 Z', fill: color, stroke: 'none' }));
  } else if (domain === 'MARITIME') {
    // Ship hull with superstructure
    svg.appendChild(svgEl('path', { d: 'M3 17 L5 12 L8 12 L8 8 L10 8 L10 10 L14 10 L14 8 L16 8 L16 12 L19 12 L21 17 Z', fill: color, stroke: 'none' }));
    svg.appendChild(svgEl('path', { d: 'M2 19 Q12 22 22 19', stroke: color, fill: 'none', 'stroke-width': '1.5', 'stroke-linecap': 'round' }));
  } else if (domain === 'LAND') {
    // Tank/ground vehicle silhouette
    svg.appendChild(svgEl('rect', { x: '4', y: '10', width: '16', height: '7', rx: '2', fill: color, stroke: 'none' }));
    svg.appendChild(svgEl('rect', { x: '7', y: '6', width: '10', height: '5', rx: '1', fill: color, stroke: 'none' }));
    svg.appendChild(svgEl('line', { x1: '15', y1: '8', x2: '22', y2: '5', stroke: color, 'stroke-width': '2', 'stroke-linecap': 'round' }));
    svg.appendChild(svgEl('circle', { cx: '7', cy: '18', r: '2', fill: color, stroke: 'none', opacity: '0.8' }));
    svg.appendChild(svgEl('circle', { cx: '12', cy: '18', r: '2', fill: color, stroke: 'none', opacity: '0.8' }));
    svg.appendChild(svgEl('circle', { cx: '17', cy: '18', r: '2', fill: color, stroke: 'none', opacity: '0.8' }));
  } else if (domain === 'SPACE') {
    // Satellite with solar panels
    svg.appendChild(svgEl('rect', { x: '10', y: '6', width: '4', height: '12', rx: '1', fill: color, stroke: 'none' }));
    svg.appendChild(svgEl('rect', { x: '2', y: '9', width: '7', height: '6', rx: '1', fill: color, stroke: 'none', opacity: '0.7' }));
    svg.appendChild(svgEl('rect', { x: '15', y: '9', width: '7', height: '6', rx: '1', fill: color, stroke: 'none', opacity: '0.7' }));
    svg.appendChild(svgEl('circle', { cx: '12', cy: '12', r: '1.5', fill: 'white' }));
  } else {
    // Fallback: filled circle
    svg.appendChild(svgEl('circle', { cx: '12', cy: '12', r: '8', fill: color }));
  }

  wrapper.appendChild(svg);
  return wrapper;
}

/** Attach hover popup + click-to-select to a marker element */
function attachHoverPopup(
  el: HTMLElement,
  marker: mapboxgl.Marker,
  popup: mapboxgl.Popup,
  map: mapboxgl.Map,
  onSelect?: () => void,
) {
  el.addEventListener('mouseenter', () => {
    popup.setLngLat(marker.getLngLat()).addTo(map);
  });
  el.addEventListener('mouseleave', () => {
    popup.remove();
  });
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    popup.remove();
    if (onSelect) onSelect();
  });
}

// ─── Component ───────────────────────────────────────────────────────────────

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || '';

export function MapView() {
  if (!MAPBOX_TOKEN) return <MapTokenMissing />;

  return <MapViewInner />;
}

function MapTokenMissing() {
  return (
    <div className="page-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
        <div style={{ fontSize: '24px', marginBottom: '8px' }}>⚠</div>
        <div style={{ fontWeight: 700, marginBottom: '4px' }}>Map Unavailable</div>
        <div style={{ fontSize: '12px' }}>VITE_MAPBOX_TOKEN is not configured.</div>
        <div style={{ fontSize: '12px' }}>Set it in the Railway dashboard and redeploy.</div>
      </div>
    </div>
  );
}

function MapViewInner() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const baseMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const targetMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const trailsRef = useRef<Map<string, { lon: number; lat: number; simMs: number }[]>>(new Map());
  const mapLoadedRef = useRef(false);

  // Interpolation state for smooth marker movement
  const interpRef = useRef<Map<string, { from: [number, number]; to: [number, number]; startMs: number }>>(new Map());
  const animFrameRef = useRef<number>(0);

  const { positions, activeScenarioId, simulation, bases, coverageWindows, unitPositions } = useOverwatchStore();

  // Pre-parse coverage window timestamps so the per-tick filter does numeric
  // compares instead of constructing Date objects N times every scrub.
  const parsedCoverageWindows = useMemo(
    () => coverageWindows.map(cw => ({
      cw,
      startMs: new Date(cw.start).getTime(),
      endMs: new Date(cw.end).getTime(),
    })),
    [coverageWindows],
  );
  const [activeDomains, setActiveDomains] = useState<Set<string>>(new Set(['AIR', 'MARITIME', 'LAND', 'SPACE']));
  const [affiliation, setAffiliation] = useState<'ALL' | 'FRIENDLY' | 'HOSTILE'>('ALL');
  const [routes, setRoutes] = useState<MissionRoute[]>([]);
  const [targets, setTargets] = useState<MissionTarget[]>([]);

  // Layer toggles
  const [showBases, setShowBases] = useState(true);
  const [showTargets, setShowTargets] = useState(true);
  const [showCoverage, setShowCoverage] = useState(false);
  const [showUnits, setShowUnits] = useState(true);
  const [showTracks, setShowTracks] = useState(true);
  const [layerMenuOpen, setLayerMenuOpen] = useState(false);
  const unitMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());

  // Entity selection + space links
  const [selectedEntity, setSelectedEntity] = useState<SelectedEntity | null>(null);
  const [linkMode, setLinkMode] = useState<LinkMode>('OFF');
  const [allocations, setAllocations] = useState<SpaceAllocationLink[]>([]);
  const [missionDetail, setMissionDetail] = useState<any>(null);

  // Keep a stable ref for onSelect so marker effects don't re-run
  const selectEntityRef = useRef(setSelectedEntity);
  selectEntityRef.current = setSelectedEntity;

  // ─── Initialize Map ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!mapContainerRef.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [125.0, 15.0],
      zoom: 4,
      pitch: 30,
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    map.addControl(new mapboxgl.ScaleControl(), 'bottom-left');

    map.on('load', () => {
      mapLoadedRef.current = true;
      initializeMapSources(map);
    });

    mapRef.current = map;

    return () => {
      mapLoadedRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ─── Smooth Marker Interpolation Loop ──────────────────────────────────────

  useEffect(() => {
    const animate = () => {
      const now = performance.now();
      interpRef.current.forEach((interp, missionId) => {
        // Skip completed interpolations — no work needed
        const elapsed = now - interp.startMs;
        if (elapsed >= INTERP_DURATION_MS) return;

        const marker = markersRef.current.get(missionId);
        if (!marker) return;

        const t = elapsed / INTERP_DURATION_MS;
        // Ease-out for natural deceleration
        const eased = 1 - (1 - t) * (1 - t);

        // Handle longitude wrapping (e.g., 179° → -179° should go via 181°)
        let fromLon = interp.from[0];
        let toLon = interp.to[0];
        if (Math.abs(toLon - fromLon) > 180) {
          if (toLon > fromLon) fromLon += 360;
          else toLon += 360;
        }

        const lon = fromLon + (toLon - fromLon) * eased;
        const lat = interp.from[1] + (interp.to[1] - interp.from[1]) * eased;

        // Normalize longitude back to [-180, 180]
        const normLon = ((lon + 180) % 360 + 360) % 360 - 180;
        marker.setLngLat([normLon, lat]);
      });
      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, []);

  // ─── Fetch Waypoints & Targets for Route Lines ──────────────────────────────

  useEffect(() => {
    if (!activeScenarioId) return;

    fetch(`/api/missions?scenarioId=${activeScenarioId}`)
      .then(res => res.json())
      .then(data => {
        if (data.success && Array.isArray(data.data)) {
          const missionRoutes: MissionRoute[] = data.data
            .filter((m: any) => m.waypoints?.length >= 2)
            .map((m: any) => ({
              missionId: m.id,
              callsign: m.callsign || m.missionId,
              domain: m.domain,
              waypoints: m.waypoints.sort((a: Waypoint, b: Waypoint) => a.sequence - b.sequence),
            }));
          setRoutes(missionRoutes);

          // Extract targets from missions
          const allTargets: MissionTarget[] = [];
          for (const m of data.data) {
            if (m.targets) {
              for (const t of m.targets) {
                if (t.latitude != null && t.longitude != null) {
                  allTargets.push({
                    targetId: t.targetId || t.id,
                    targetName: t.targetName || 'Unknown',
                    latitude: t.latitude,
                    longitude: t.longitude,
                    desiredEffect: t.desiredEffect || '',
                    beNumber: t.beNumber,
                    targetCategory: t.targetCategory,
                    priorityRank: t.priorityRank || 5,
                  });
                }
              }
            }
          }
          setTargets(allTargets);
        }
      })
      .catch(err => console.error('[MAP] Failed to fetch mission routes:', err));
  }, [activeScenarioId]);

  // ─── Fetch Space Allocations for Link Lines ─────────────────────────────────

  useEffect(() => {
    if (!activeScenarioId) return;
    fetch(`/api/space-assets/allocations?scenarioId=${activeScenarioId}`)
      .then(r => r.json())
      .then(data => {
        if (data.success && Array.isArray(data.data)) {
          setAllocations(data.data);
        }
      })
      .catch(err => console.error('[MAP] Failed to fetch allocations:', err));
  }, [activeScenarioId]);

  // ─── Fetch Mission Detail When Track/Satellite Selected ────────────────────

  useEffect(() => {
    if (!selectedEntity) { setMissionDetail(null); return; }
    if (selectedEntity.kind !== 'track' && selectedEntity.kind !== 'satellite') {
      setMissionDetail(null);
      return;
    }
    const missionId = selectedEntity.missionId;
    fetch(`/api/missions/${missionId}`)
      .then(r => r.json())
      .then(data => {
        if (data.success) setMissionDetail(data.data);
      })
      .catch(err => console.error('[MAP] Failed to fetch mission detail:', err));
  }, [selectedEntity]);

  // ─── Update Route Lines on Map ──────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current || routes.length === 0) return;

    routes.forEach(route => {
      const sourceId = `route-${route.missionId}`;
      const color = DOMAIN_COLORS[route.domain] || '#888';

      const coordinates = route.waypoints.map(wp => [wp.longitude, wp.latitude]);

      const geojson: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'LineString', coordinates },
          properties: {},
        }],
      };

      const source = map.getSource(sourceId) as mapboxgl.GeoJSONSource;
      if (source) {
        source.setData(geojson);
      } else {
        map.addSource(sourceId, { type: 'geojson', data: geojson });
        map.addLayer({
          id: `${sourceId}-line`,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': color,
            'line-width': 2,
            'line-opacity': 0.5,
            'line-dasharray': [4, 4],
          },
        });
      }

      // Waypoint dots (small circles at each waypoint)
      const dotsSourceId = `${sourceId}-dots`;
      const dotsGeojson: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: route.waypoints.map(wp => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [wp.longitude, wp.latitude] },
          properties: { name: wp.name || '', type: wp.waypointType || '' },
        })),
      };

      const dotsSource = map.getSource(dotsSourceId) as mapboxgl.GeoJSONSource;
      if (dotsSource) {
        dotsSource.setData(dotsGeojson);
      } else {
        map.addSource(dotsSourceId, { type: 'geojson', data: dotsGeojson });
        map.addLayer({
          id: `${dotsSourceId}-circles`,
          type: 'circle',
          source: dotsSourceId,
          paint: {
            'circle-radius': 3,
            'circle-color': color,
            'circle-opacity': 0.6,
            'circle-stroke-width': 1,
            'circle-stroke-color': 'rgba(255,255,255,0.4)',
          },
        });
      }
    });
  }, [routes]);

  // ─── Render Base Markers ────────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentBaseMarkers = baseMarkersRef.current;

    // Remove all existing base markers
    currentBaseMarkers.forEach(marker => marker.remove());
    currentBaseMarkers.clear();

    if (!showBases || bases.length === 0) return;

    bases.forEach((base: BaseData) => {
      const color = BASE_COLORS[base.baseType] || '#888';
      const symbol = BASE_SYMBOLS[base.baseType] || '●';
      const isOpfor = base.country === 'OPFOR';

      // Filter by affiliation
      if (affiliation === 'FRIENDLY' && isOpfor) return;
      if (affiliation === 'HOSTILE' && !isOpfor) return;

      const displayColor = isOpfor ? '#ef4444' : color;
      const el = document.createElement('div');
      el.style.cssText = `
        width: 28px; height: 28px;
        display: flex; align-items: center; justify-content: center;
        font-size: 18px; font-weight: bold;
        color: ${displayColor};
        background: rgba(0,0,0,0.6);
        border: 2px solid ${displayColor};
        border-radius: 4px;
        cursor: pointer;
      `;
      el.textContent = symbol;

      const unitsList = base.units.map(u =>
        `<div style="margin-left:8px;font-size:10px;">• ${esc(u.unitDesignation)} (${u.assetCount} assets)</div>`
      ).join('');
      const radarList = base.radarSensors.length > 0
        ? `<div style="margin-top:4px;font-size:10px;color:#f59e0b;">📡 ${base.radarSensors.map(esc).join(', ')}</div>`
        : '';

      const popup = new mapboxgl.Popup({ offset: 15, className: 'overwatch-popup', closeButton: false })
        .setHTML(`
          <div style="padding: 8px; font-family: var(--font-mono); font-size: 12px; max-width: 240px;">
            <div style="font-weight: 700; margin-bottom: 4px; color: ${displayColor};">
              ${symbol} ${esc(base.name)}
            </div>
            <div>Type: ${esc(base.baseType.replace('_', ' '))}</div>
            <div>Country: ${esc(base.country)}</div>
            ${base.icaoCode ? `<div>ICAO: ${esc(base.icaoCode)}</div>` : ''}
            <div style="margin-top:4px;">Units: ${base.unitCount} | Assets: ${base.totalAssets}</div>
            ${unitsList}
            ${radarList}
          </div>
        `);

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([base.longitude, base.latitude])
        .addTo(map);
      attachHoverPopup(el, marker, popup, map, () => {
        selectEntityRef.current(prev =>
          prev?.kind === 'base' && (prev as SelectedBase).base.id === base.id ? null : { kind: 'base', base }
        );
      });

      currentBaseMarkers.set(base.id, marker);
    });
  }, [bases, showBases, affiliation]);

  // ─── Render Target Markers ──────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentTargetMarkers = targetMarkersRef.current;

    // Remove all existing target markers
    currentTargetMarkers.forEach(marker => marker.remove());
    currentTargetMarkers.clear();

    if (!showTargets || targets.length === 0) return;

    targets.forEach(target => {
      // Crosshair icon via SVG
      const el = document.createElement('div');
      el.style.cssText = `width:20px;height:20px;cursor:pointer;`;
      const svg = svgEl('svg', { width: '20', height: '20', viewBox: '0 0 24 24', fill: 'none' });
      // Crosshair: circle + cross lines
      svg.appendChild(svgEl('circle', { cx: '12', cy: '12', r: '6', stroke: '#ef4444', 'stroke-width': '2', fill: 'rgba(239,68,68,0.15)' }));
      svg.appendChild(svgEl('line', { x1: '12', y1: '2', x2: '12', y2: '8', stroke: '#ef4444', 'stroke-width': '2' }));
      svg.appendChild(svgEl('line', { x1: '12', y1: '16', x2: '12', y2: '22', stroke: '#ef4444', 'stroke-width': '2' }));
      svg.appendChild(svgEl('line', { x1: '2', y1: '12', x2: '8', y2: '12', stroke: '#ef4444', 'stroke-width': '2' }));
      svg.appendChild(svgEl('line', { x1: '16', y1: '12', x2: '22', y2: '12', stroke: '#ef4444', 'stroke-width': '2' }));
      el.appendChild(svg);

      const popup = new mapboxgl.Popup({ offset: 15, className: 'overwatch-popup', closeButton: false })
        .setHTML(`
          <div style="padding: 8px; font-family: var(--font-mono); font-size: 12px;">
            <div style="font-weight: 700; margin-bottom: 4px; color: #ef4444;">
              ⊕ ${esc(target.targetName)}
            </div>
            ${target.beNumber ? `<div>BE#: ${esc(target.beNumber)}</div>` : ''}
            ${target.targetCategory ? `<div>Category: ${esc(target.targetCategory)}</div>` : ''}
            <div>Effect: ${esc(target.desiredEffect)}</div>
            <div>Priority: ${target.priorityRank}</div>
          </div>
        `);

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([target.longitude, target.latitude])
        .addTo(map);
      attachHoverPopup(el, marker, popup, map, () => {
        selectEntityRef.current(prev =>
          prev?.kind === 'target' && (prev as SelectedTarget).target.targetId === target.targetId ? null : { kind: 'target', target }
        );
      });

      currentTargetMarkers.set(target.targetId, marker);
    });
  }, [targets, showTargets]);

  // ─── Render Unit Position Markers (clustered by co-location) ───────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentUnitMarkers = unitMarkersRef.current;
    currentUnitMarkers.forEach(marker => marker.remove());
    currentUnitMarkers.clear();

    if (!showUnits || unitPositions.length === 0) return;

    // Group units by coordinates for cluster rendering
    const groups = new Map<string, UnitPosition[]>();
    for (const up of unitPositions) {
      // Filter by affiliation
      if (affiliation === 'FRIENDLY' && up.affiliation === 'HOSTILE') continue;
      if (affiliation === 'HOSTILE' && up.affiliation !== 'HOSTILE') continue;
      // Filter by domain
      if (!activeDomains.has(up.domain)) continue;

      const key = `${up.baseLat.toFixed(3)},${up.baseLon.toFixed(3)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(up);
    }

    groups.forEach((units, key) => {
      const first = units[0];
      const isOpfor = first.affiliation === 'HOSTILE';
      const totalAssets = units.reduce((s, u) => s + u.assetCount, 0);

      const borderColor = isOpfor ? '#ef4444' : '#3b82f6';
      const el = document.createElement('div');
      el.style.cssText = `
        width: 28px; height: 28px;
        display: flex; align-items: center; justify-content: center;
        font-size: 11px; font-weight: 700;
        color: #fff;
        background: ${isOpfor ? 'rgba(239, 68, 68, 0.8)' : 'rgba(59, 130, 246, 0.8)'};
        border: 2px solid ${borderColor};
        border-radius: 4px;
        cursor: pointer;
      `;
      el.textContent = String(totalAssets);

      const unitList = units.map(u =>
        `<div style="margin: 2px 0; font-size: 10px;">
          <span style="color: ${DOMAIN_COLORS[u.domain] || '#888'};">■</span>
          ${esc(u.unitDesignation)} — ${u.assetCount} assets
        </div>`
      ).join('');

      const popup = new mapboxgl.Popup({ offset: 15, className: 'overwatch-popup', closeButton: false })
        .setHTML(`
          <div style="padding: 8px; font-family: var(--font-mono); font-size: 12px; max-width: 260px;">
            <div style="font-weight: 700; margin-bottom: 4px; color: ${isOpfor ? '#ef4444' : '#60a5fa'};">
              ${esc(first.baseLocation || 'Unknown Location')}
            </div>
            <div style="color: var(--text-muted); font-size: 10px; margin-bottom: 4px;">
              ${units.length} unit${units.length > 1 ? 's' : ''} · ${totalAssets} assets
            </div>
            ${unitList}
          </div>
        `);

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([first.baseLon, first.baseLat])
        .addTo(map);
      const capturedUnits = [...units];
      attachHoverPopup(el, marker, popup, map, () => {
        selectEntityRef.current(prev =>
          prev?.kind === 'unit' && (prev as SelectedUnit).location === key ? null : { kind: 'unit', units: capturedUnits, location: key }
        );
      });

      currentUnitMarkers.set(key, marker);
    });
  }, [unitPositions, showUnits, affiliation, activeDomains]);

  // ─── Render Space Coverage Circles ──────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;

    const sourceId = 'coverage-circles';

    if (!showCoverage || coverageWindows.length === 0) {
      // Remove coverage layer if it exists
      if (map.getLayer(`${sourceId}-fill`)) map.removeLayer(`${sourceId}-fill`);
      if (map.getLayer(`${sourceId}-outline`)) map.removeLayer(`${sourceId}-outline`);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      return;
    }

    // Only render coverage windows whose AOS/LOS span the current sim time —
    // otherwise old/future windows accumulate and obscure the map. When sim
    // is idle (no simTime), hide all footprints rather than show stale data.
    const nowMs = simulation.simTime ? new Date(simulation.simTime).getTime() : null;
    if (nowMs == null) {
      if (map.getLayer(`${sourceId}-fill`)) map.removeLayer(`${sourceId}-fill`);
      if (map.getLayer(`${sourceId}-outline`)) map.removeLayer(`${sourceId}-outline`);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      return;
    }

    // Build GeoJSON circles from coverage windows
    const features: GeoJSON.Feature[] = parsedCoverageWindows
      .filter(({ cw }) => cw.lat != null && cw.lon != null)
      .filter(({ startMs, endMs }) => startMs <= nowMs && nowMs <= endMs)
      .map(({ cw }) => {
        const color = COVERAGE_COLORS[cw.capability] || '#6366f1';
        // Create a circle polygon (approximation with 32 points)
        const radiusDeg = 5; // ~5 degrees ≈ 550 km visual footprint
        const points: [number, number][] = [];
        for (let i = 0; i <= 32; i++) {
          const angle = (i / 32) * 2 * Math.PI;
          points.push([
            cw.lon + radiusDeg * Math.cos(angle),
            cw.lat + radiusDeg * Math.sin(angle) * 0.8, // Slightly flatten for projection
          ]);
        }

        return {
          type: 'Feature' as const,
          geometry: { type: 'Polygon' as const, coordinates: [points] },
          properties: {
            assetName: cw.assetName,
            capability: cw.capability,
            color,
          },
        };
      });

    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features,
    };

    const source = map.getSource(sourceId) as mapboxgl.GeoJSONSource;
    if (source) {
      source.setData(geojson);
    } else {
      map.addSource(sourceId, { type: 'geojson', data: geojson });
      map.addLayer({
        id: `${sourceId}-fill`,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.04,
        },
      });
      map.addLayer({
        id: `${sourceId}-outline`,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 1,
          'line-opacity': 0.18,
          'line-dasharray': [2, 2],
        },
      });
    }
  }, [parsedCoverageWindows, showCoverage, simulation.simTime]);

  // ─── Update Breadcrumb Trails ───────────────────────────────────────────────

  const updateTrails = useCallback(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;

    // If tracks are hidden, clear all trail layers
    if (!showTracks) {
      trailsRef.current.forEach((_trail, missionId) => {
        const sourceId = `trail-${missionId}`;
        const source = map.getSource(sourceId) as mapboxgl.GeoJSONSource;
        if (source) {
          source.setData({ type: 'FeatureCollection', features: [] });
        }
      });
      return;
    }

    positions.forEach((pos, missionId) => {
      if (!activeDomains.has(pos.domain)) return;

      // Guard against LLM hallucinations that output invalid MapBox coordinates
      const isValidCoord = typeof pos.latitude === 'number' && !isNaN(pos.latitude) && pos.latitude >= -90 && pos.latitude <= 90 &&
        typeof pos.longitude === 'number' && !isNaN(pos.longitude) && pos.longitude >= -180 && pos.longitude <= 180;

      if (!isValidCoord) return;

      // Accumulate trail points with sim-time timestamps. Fall back to the
      // current sim clock (NOT Date.now()) so we never mix wall-clock and
      // simulation time in the same comparison.
      const posTs = (pos as any).timestamp;
      const fallbackSimMs = simulation.simTime ? new Date(simulation.simTime).getTime() : null;
      const posSimMs = posTs ? new Date(posTs).getTime() : fallbackSimMs;
      if (posSimMs == null) return;
      let trail = trailsRef.current.get(missionId) || [];
      const lastPoint = trail[trail.length - 1];
      // Drop the trail if sim-time moved backward (user scrubbed back) — otherwise
      // the trail would render a phantom "future" tail attached to the new position.
      if (lastPoint && posSimMs < lastPoint.simMs) {
        trail = [];
      }
      const newLast = trail[trail.length - 1];
      if (!newLast || newLast.lon !== pos.longitude || newLast.lat !== pos.latitude) {
        trail.push({ lon: pos.longitude, lat: pos.latitude, simMs: posSimMs });
      }

      // Trim to sim-time window: use the newest point as reference so we're
      // always comparing within the same clock domain (sim time)
      if (trail.length > 1) {
        const newestMs = trail[trail.length - 1].simMs;
        const cutoff = newestMs - TRAIL_WINDOW_MS;
        const trimIdx = trail.findIndex(p => p.simMs >= cutoff);
        if (trimIdx > 0) trail.splice(0, trimIdx);
      }
      trailsRef.current.set(missionId, trail);

      if (trail.length < 2) return;

      const sourceId = `trail-${missionId}`;
      const color = TRAIL_COLORS[pos.domain] || '#888';
      const coordinates = trail.map(p => [p.lon, p.lat]);

      const geojson: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'LineString', coordinates },
          properties: {},
        }],
      };

      const source = map.getSource(sourceId) as mapboxgl.GeoJSONSource;
      if (source) {
        source.setData(geojson);
      } else {
        map.addSource(sourceId, { type: 'geojson', data: geojson });
        map.addLayer({
          id: `${sourceId}-line`,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': color,
            'line-width': 2.5,
            'line-opacity': 0.7,
            'line-blur': 1,
          },
        });
      }
    });
  }, [positions, activeDomains, showTracks, simulation.simTime]);

  // ─── Update Markers + Trails from Positions ─────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentMarkers = markersRef.current;
    const activeIds = new Set<string>();

    positions.forEach((pos, missionId) => {
      if (!activeDomains.has(pos.domain)) return;

      // Filter by affiliation
      if (affiliation !== 'ALL') {
        const posAffiliation = (pos as any).affiliation || 'FRIENDLY';
        if (posAffiliation !== affiliation) return;
      }

      // Guard against LLM hallucinations that output invalid MapBox coordinates
      const isValidCoord = typeof pos.latitude === 'number' && !isNaN(pos.latitude) && pos.latitude >= -90 && pos.latitude <= 90 &&
        typeof pos.longitude === 'number' && !isNaN(pos.longitude) && pos.longitude >= -180 && pos.longitude <= 180;

      if (!isValidCoord) {
        console.warn(`[MAP] Dropping invalid coordinate from stream -> ID: ${missionId}, Lat: ${pos.latitude}, Lng: ${pos.longitude}`);
        return;
      }

      activeIds.add(missionId);

      const color = DOMAIN_COLORS[pos.domain] || '#888';

      if (currentMarkers.has(missionId)) {
        // Only set up new interpolation if the TARGET position changed
        const existing = interpRef.current.get(missionId);
        if (!existing || existing.to[0] !== pos.longitude || existing.to[1] !== pos.latitude) {
          const marker = currentMarkers.get(missionId)!;
          const cur = marker.getLngLat();
          interpRef.current.set(missionId, {
            from: [cur.lng, cur.lat],
            to: [pos.longitude, pos.latitude],
            startMs: performance.now(),
          });
        }
      } else {
        const el = makeDomainIcon(pos.domain, color, 22);

        const popup = new mapboxgl.Popup({ offset: 15, className: 'overwatch-popup', closeButton: false })
          .setHTML(`
            <div style="padding: 8px; font-family: var(--font-mono); font-size: 12px;">
              <div style="font-weight: 700; margin-bottom: 4px; color: ${color};">
                ${esc(pos.callsign || missionId.slice(0, 8))}
              </div>
              <div>Domain: ${esc(pos.domain)}</div>
              <div>Status: ${esc(pos.status)}</div>
              ${pos.altitude_ft ? `<div>Alt: ${pos.altitude_ft.toLocaleString()} ft</div>` : ''}
              ${pos.heading != null ? `<div>Hdg: ${pos.heading.toFixed(0)}°</div>` : ''}
              ${pos.speed_kts ? `<div>Spd: ${pos.speed_kts} kts</div>` : ''}
            </div>
          `);

        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([pos.longitude, pos.latitude])
          .addTo(map);

        attachHoverPopup(el, marker, popup, map, () => {
          const entityKind = pos.domain === 'SPACE' ? 'satellite' : 'track';
          selectEntityRef.current(prev => {
            if (prev && (prev.kind === 'track' || prev.kind === 'satellite') && prev.missionId === missionId) return null;
            return {
              kind: entityKind,
              missionId,
              callsign: pos.callsign || missionId.slice(0, 8),
              domain: pos.domain,
              status: pos.status,
              latitude: pos.latitude,
              longitude: pos.longitude,
              altitude_ft: pos.altitude_ft,
              heading: pos.heading,
              speed_kts: pos.speed_kts,
            } as SelectedTrack | SelectedSatellite;
          });
        });

        currentMarkers.set(missionId, marker);
      }
    });

    // Remove markers no longer tracked
    currentMarkers.forEach((marker, id) => {
      if (!activeIds.has(id)) {
        marker.remove();
        currentMarkers.delete(id);
        interpRef.current.delete(id);
      }
    });

    // Update breadcrumb trails
    updateTrails();
  }, [positions, activeDomains, affiliation, updateTrails]);

  // ─── Space Dependency Link Lines ────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;

    const sourceId = 'space-links';

    // Determine which links to show
    const links = getVisibleLinks(linkMode, allocations, selectedEntity);

    // Build GeoJSON features
    const features: GeoJSON.Feature[] = [];
    const STATUS_LINE_COLORS: Record<string, string> = {
      FULFILLED: '#22c55e',
      DEGRADED: '#f59e0b',
      DENIED: '#ef4444',
      PENDING: '#64748b',
      CONTENTION: '#f59e0b',
    };

    // Build lookup maps for position resolution
    const posByCallsign = new Map<string, { lng: number; lat: number }>();
    const posById = new Map<string, { lng: number; lat: number }>();
    positions.forEach((p, mId) => {
      const coord = { lng: p.longitude, lat: p.latitude };
      posById.set(mId, coord);
      if (p.callsign) posByCallsign.set(p.callsign, coord);
    });

    for (const alloc of links) {
      if (!alloc.spaceAsset) continue;
      const mission = alloc.spaceNeed.mission;

      // Find satellite position by callsign match to asset name
      const satPos = posByCallsign.get(alloc.spaceAsset.name);
      if (!satPos) continue;

      // Find mission position, fallback to unit base
      let missionPos = posById.get(mission.id);
      if (!missionPos && mission.unitId) {
        const up = unitPositions.find(u => u.id === mission.unitId);
        if (up) missionPos = { lng: up.baseLon, lat: up.baseLat };
      }
      if (!missionPos) continue;

      const color = STATUS_LINE_COLORS[alloc.status] || '#64748b';
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [[satPos.lng, satPos.lat], [missionPos.lng, missionPos.lat]],
        },
        properties: {
          color,
          status: alloc.status,
          capability: alloc.spaceNeed.capabilityType,
          assetName: alloc.spaceAsset.name,
          missionCallsign: mission.callsign || mission.missionId,
        },
      });
    }

    const geojson: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };

    const source = map.getSource(sourceId) as mapboxgl.GeoJSONSource;
    if (source) {
      source.setData(geojson);
    } else if (features.length > 0) {
      map.addSource(sourceId, { type: 'geojson', data: geojson });
      map.addLayer({
        id: `${sourceId}-line`,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 1.5,
          'line-opacity': 0.7,
          'line-dasharray': [4, 3],
        },
      });
    }

    // Clean up when no features
    if (features.length === 0 && map.getLayer(`${sourceId}-line`)) {
      map.removeLayer(`${sourceId}-line`);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    }
  }, [linkMode, selectedEntity, allocations, positions, unitPositions]);

  // ─── Domain Toggle ──────────────────────────────────────────────────────────

  const toggleDomain = (domain: string) => {
    setActiveDomains(prev => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="page-content" style={{ display: 'flex', flexDirection: 'row', height: '100%', padding: 0, overflow: 'hidden' }}>
      {/* Map + overlays */}
      <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
        {/* Map Toolbar */}
        <div style={{
          position: 'absolute',
          top: '12px',
          left: '12px',
          zIndex: 10,
          display: 'flex',
          gap: '8px',
          alignItems: 'flex-start',
        }}>
          {/* Eyeball layer menu */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setLayerMenuOpen(!layerMenuOpen)}
              className="btn btn-sm btn-secondary"
              style={{
                padding: '6px 10px',
                fontSize: '14px',
                lineHeight: 1,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
              title="Layer visibility"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <span style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.05em' }}>LAYERS</span>
            </button>

            {layerMenuOpen && (
              <>
                {/* Backdrop to close menu */}
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 20 }}
                  onClick={() => setLayerMenuOpen(false)}
                />
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  marginTop: '4px',
                  background: 'rgba(10, 15, 30, 0.95)',
                  backdropFilter: 'blur(12px)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  padding: '8px 0',
                  minWidth: '180px',
                  zIndex: 21,
                }}>
                  {/* Domain toggles */}
                  <div style={{ padding: '4px 12px 6px', fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
                    DOMAINS
                  </div>
                  {(['AIR', 'MARITIME', 'LAND', 'SPACE'] as const).map(domain => (
                    <LayerMenuItem
                      key={domain}
                      label={domain}
                      active={activeDomains.has(domain)}
                      color={DOMAIN_COLORS[domain]}
                      onToggle={() => toggleDomain(domain)}
                    />
                  ))}

                  <div style={{ margin: '4px 12px', borderTop: '1px solid var(--border-subtle)' }} />

                  {/* Data layer toggles */}
                  <div style={{ padding: '4px 12px 6px', fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
                    OVERLAYS
                  </div>
                  <LayerMenuItem label="BASES" active={showBases} onToggle={() => setShowBases(!showBases)} />
                  <LayerMenuItem label="TARGETS" active={showTargets} onToggle={() => setShowTargets(!showTargets)} />
                  <LayerMenuItem label="UNITS" active={showUnits} onToggle={() => setShowUnits(!showUnits)} />
                  <LayerMenuItem label="COVERAGE" active={showCoverage} onToggle={() => setShowCoverage(!showCoverage)} />
                  <LayerMenuItem label="SPACE TRACKS" active={showTracks} onToggle={() => setShowTracks(!showTracks)} />

                  <div style={{ margin: '4px 12px', borderTop: '1px solid var(--border-subtle)' }} />

                  {/* Space dependency link toggles */}
                  <div style={{ padding: '4px 12px 6px', fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
                    LINKS
                  </div>
                  {(['OFF', 'SELECTED', 'ON'] as LinkMode[]).map(mode => (
                    <LinkModeItem key={mode} label={mode} active={linkMode === mode} onSelect={() => setLinkMode(mode)} />
                  ))}
                </div>
              </>
            )}
          </div>

          <select
            value={affiliation}
            onChange={e => setAffiliation(e.target.value as any)}
            style={{
              padding: '6px 10px',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '6px',
              color: 'var(--text-primary)',
              fontSize: '11px',
            }}
          >
            <option value="ALL">ALL FORCES</option>
            <option value="FRIENDLY">FRIENDLY</option>
            <option value="HOSTILE">HOSTILE</option>
          </select>
        </div>

        {/* Map Container */}
        <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

      {/* Map Legend */}
      <div style={{
        position: 'absolute',
        bottom: '40px',
        right: '12px',
        zIndex: 10,
        background: 'rgba(10, 15, 30, 0.9)',
        backdropFilter: 'blur(8px)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '8px',
        padding: '12px 16px',
        minWidth: '180px',
      }}>
        <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '8px', letterSpacing: '0.1em' }}>
          TRACKS
        </div>
        <LegendItem color="#00d4ff" label="AIR" symbol="circle" />
        <LegendItem color="#0090ff" label="MARITIME" symbol="circle" />
        <LegendItem color="#22c55e" label="LAND" symbol="circle" />
        <LegendItem color="#a855f7" label="SPACE" symbol="diamond" />
        <div style={{ margin: '8px 0', borderTop: '1px solid var(--border-subtle)' }} />
        <LegendItem color="" label="Planned Route" symbol="dashed" />
        <LegendItem color="" label="Track History" symbol="solid" />

        {showBases && (
          <>
            <div style={{ margin: '8px 0', borderTop: '1px solid var(--border-subtle)' }} />
            <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '6px', letterSpacing: '0.1em' }}>
              INFRASTRUCTURE
            </div>
            <LegendItem color="#f59e0b" label="Airbase ✦" symbol="text" />
            <LegendItem color="#3b82f6" label="Naval Base ⚓" symbol="text" />
            <LegendItem color="#10b981" label="Joint Base ◆" symbol="text" />
          </>
        )}

        {showUnits && unitPositions.length > 0 && (
          <>
            <div style={{ margin: '8px 0', borderTop: '1px solid var(--border-subtle)' }} />
            <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '6px', letterSpacing: '0.1em' }}>
              UNITS
            </div>
            <LegendItem color="#3b82f6" label="Friendly" symbol="circle" />
            <LegendItem color="#ef4444" label="Hostile" symbol="circle" />
          </>
        )}

        {showTargets && targets.length > 0 && (
          <>
            <div style={{ margin: '8px 0', borderTop: '1px solid var(--border-subtle)' }} />
            <LegendItem color="#ef4444" label="Target ✕" symbol="text" />
          </>
        )}

        {showCoverage && coverageWindows.length > 0 && (
          <>
            <div style={{ margin: '8px 0', borderTop: '1px solid var(--border-subtle)' }} />
            <LegendItem color="#6366f1" label="Sat Coverage" symbol="coverage" />
          </>
        )}

        {linkMode !== 'OFF' && (
          <>
            <div style={{ margin: '8px 0', borderTop: '1px solid var(--border-subtle)' }} />
            <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '6px', letterSpacing: '0.1em' }}>
              SPACE LINKS
            </div>
            <LegendItem color="#22c55e" label="Fulfilled" symbol="solid" />
            <LegendItem color="#f59e0b" label="Degraded" symbol="dashed" />
            <LegendItem color="#ef4444" label="Denied" symbol="dashed" />
          </>
        )}

        <div style={{ margin: '8px 0', borderTop: '1px solid var(--border-subtle)' }} />
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          {positions.size} tracks{bases.length > 0 ? ` | ${bases.length} bases` : ''}{unitPositions.length > 0 ? ` | ${unitPositions.length} units` : ''}
          {targets.length > 0 ? ` | ${targets.length} tgts` : ''}
        </div>
        {simulation.simTime && (
          <div style={{ fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: '4px' }}>
            {new Date(simulation.simTime).toUTCString().slice(0, 25)}
          </div>
        )}
      </div>
      </div>{/* end map wrapper */}

      {/* Entity Detail Slideout */}
      {selectedEntity && (
        <MapDetailPanel
          entity={selectedEntity}
          missionDetail={missionDetail}
          allocations={allocations}
          onClose={() => setSelectedEntity(null)}
        />
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function initializeMapSources(map: mapboxgl.Map) {
  // Pre-create empty sources for trails (added dynamically)
  // This ensures layers are ready when positions start arriving
  console.log('[MAP] Sources initialized');
}

function LayerMenuItem({ label, active, color, onToggle }: { label: string; active: boolean; color?: string; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        padding: '6px 12px',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontSize: '11px',
        fontWeight: 600,
        fontFamily: 'var(--font-mono)',
        letterSpacing: '0.05em',
        color: active ? (color || 'var(--text-primary)') : 'var(--text-muted)',
        textAlign: 'left',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
    >
      <span style={{
        width: '14px',
        height: '14px',
        borderRadius: '3px',
        border: `2px solid ${active ? (color || 'var(--accent-primary)') : 'var(--border-subtle)'}`,
        background: active ? (color || 'var(--accent-primary)') : 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '10px',
        color: '#fff',
        flexShrink: 0,
      }}>
        {active && '✓'}
      </span>
      {label}
    </button>
  );
}

function LegendItem({ color, label, symbol }: { color: string; label: string; symbol: string }) {
  const renderSymbol = () => {
    if (symbol === 'diamond') {
      return (
        <span style={{
          width: '8px', height: '8px', borderRadius: '2px',
          background: color, border: '2px solid rgba(255,255,255,0.5)',
          transform: 'rotate(45deg)', display: 'inline-block',
        }} />
      );
    }
    if (symbol === 'dashed') {
      return (
        <span style={{
          width: '18px', height: '2px',
          backgroundImage: 'repeating-linear-gradient(to right, var(--text-muted) 0px, var(--text-muted) 4px, transparent 4px, transparent 8px)',
          display: 'inline-block',
        }} />
      );
    }
    if (symbol === 'solid') {
      return (
        <span style={{
          width: '18px', height: '2px',
          background: color || 'var(--accent-success)',
          display: 'inline-block',
        }} />
      );
    }
    if (symbol === 'text') {
      return (
        <span style={{ fontSize: '11px', color, display: 'inline-block', width: '14px', textAlign: 'center' }}>
          {label.includes('✦') ? '✦' : label.includes('⚓') ? '⚓' : label.includes('◆') ? '◆' : label.includes('✕') ? '✕' : '●'}
        </span>
      );
    }
    if (symbol === 'coverage') {
      return (
        <span style={{
          width: '14px', height: '8px', borderRadius: '50%',
          border: `1px dashed ${color}`, background: `${color}15`,
          display: 'inline-block',
        }} />
      );
    }
    return (
      <span style={{
        width: '10px', height: '10px', borderRadius: '50%',
        background: color, border: '2px solid rgba(255,255,255,0.5)',
      }} />
    );
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
      {renderSymbol()}
      <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600 }}>{label}</span>
    </div>
  );
}

// ─── Link Mode Radio Button ─────────────────────────────────────────────────

function LinkModeItem({ label, active, onSelect }: { label: string; active: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        padding: '6px 12px',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontSize: '11px',
        fontWeight: 600,
        fontFamily: 'var(--font-mono)',
        letterSpacing: '0.05em',
        color: active ? 'var(--accent-primary)' : 'var(--text-muted)',
        textAlign: 'left',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
    >
      <span style={{
        width: '14px',
        height: '14px',
        borderRadius: '50%',
        border: `2px solid ${active ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}>
        {active && (
          <span style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: 'var(--accent-primary)',
          }} />
        )}
      </span>
      {label}
    </button>
  );
}

// ─── Map Detail Panel (Slideout) ─────────────────────────────────────────────

const ALLOC_STATUS_COLORS: Record<string, string> = {
  FULFILLED: '#22c55e',
  DEGRADED: '#f59e0b',
  DENIED: '#ef4444',
  PENDING: '#64748b',
  CONTENTION: '#f59e0b',
};

interface MapDetailPanelProps {
  entity: SelectedEntity;
  missionDetail: any;
  allocations: SpaceAllocationLink[];
  onClose: () => void;
}

function MapDetailPanel({ entity, missionDetail, allocations, onClose }: MapDetailPanelProps) {
  return (
    <div className="map-detail-panel">
      <div className="map-detail-panel__header">
        <div style={{ flex: 1, minWidth: 0 }}>
          {entity.kind === 'track' && <TrackHeader entity={entity} />}
          {entity.kind === 'satellite' && <SatelliteHeader entity={entity} />}
          {entity.kind === 'unit' && <UnitHeader entity={entity} />}
          {entity.kind === 'base' && <BaseHeader entity={entity} />}
          {entity.kind === 'target' && <TargetHeader entity={entity} />}
        </div>
        <button onClick={onClose} style={{ marginLeft: 'auto', fontSize: '18px', lineHeight: 1, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px 6px', flexShrink: 0 }}>×</button>
      </div>

      <div className="map-detail-panel__body">
        {entity.kind === 'track' && <TrackBody entity={entity} missionDetail={missionDetail} />}
        {entity.kind === 'satellite' && <SatelliteBody entity={entity} missionDetail={missionDetail} allocations={allocations} />}
        {entity.kind === 'unit' && <UnitBody entity={entity} />}
        {entity.kind === 'base' && <BaseBody entity={entity} />}
        {entity.kind === 'target' && <TargetBody entity={entity} />}
      </div>
    </div>
  );
}

// ─── Panel Sub-Components ────────────────────────────────────────────────────

function TrackHeader({ entity }: { entity: SelectedTrack }) {
  const color = DOMAIN_COLORS[entity.domain] || '#888';
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ background: color + '22', border: `1px solid ${color}`, color, borderRadius: '4px', padding: '2px 6px', fontSize: '10px', fontWeight: 700 }}>
          {entity.domain}
        </span>
        <span style={{ fontWeight: 700, color: 'var(--text-bright)', fontSize: '14px' }}>{entity.callsign}</span>
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '2px' }}>{entity.missionId.slice(0, 12)}</div>
    </>
  );
}

function TrackBody({ entity, missionDetail }: { entity: SelectedTrack; missionDetail: any }) {
  return (
    <>
      <div className="map-detail-section">
        <div className="map-detail-section__title">POSITION</div>
        <div className="map-detail-grid">
          <span className="map-detail-label">Status</span>
          <span className="map-detail-value">{entity.status}</span>
          {entity.altitude_ft != null && <>
            <span className="map-detail-label">Altitude</span>
            <span className="map-detail-value">{entity.altitude_ft.toLocaleString()} ft</span>
          </>}
          {entity.heading != null && <>
            <span className="map-detail-label">Heading</span>
            <span className="map-detail-value">{entity.heading.toFixed(0)}°</span>
          </>}
          {entity.speed_kts != null && <>
            <span className="map-detail-label">Speed</span>
            <span className="map-detail-value">{entity.speed_kts} kts</span>
          </>}
          <span className="map-detail-label">Lat</span>
          <span className="map-detail-value">{entity.latitude.toFixed(4)}°</span>
          <span className="map-detail-label">Lon</span>
          <span className="map-detail-value">{entity.longitude.toFixed(4)}°</span>
        </div>
      </div>

      {missionDetail && (
        <>
          <div className="map-detail-section">
            <div className="map-detail-section__title">MISSION</div>
            <div className="map-detail-grid">
              <span className="map-detail-label">Type</span>
              <span className="map-detail-value">{missionDetail.missionType}</span>
              <span className="map-detail-label">Platform</span>
              <span className="map-detail-value">{missionDetail.platformType} x{missionDetail.platformCount}</span>
              {missionDetail.unit && <>
                <span className="map-detail-label">Unit</span>
                <span className="map-detail-value">{missionDetail.unit.unitDesignation}</span>
              </>}
            </div>
          </div>

          {missionDetail.spaceNeeds?.length > 0 && (
            <div className="map-detail-section">
              <div className="map-detail-section__title">SPACE DEPENDENCIES ({missionDetail.spaceNeeds.length})</div>
              {missionDetail.spaceNeeds.map((sn: any) => {
                const statusColor = sn.fulfilled ? '#22c55e' : '#ef4444';
                return (
                  <div key={sn.id} className="map-detail-dep" style={{ borderLeftColor: statusColor }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontWeight: 600, fontSize: '12px', color: 'var(--text-bright)' }}>{sn.capabilityType}</span>
                      <span style={{ fontSize: '9px', fontWeight: 700, padding: '1px 4px', borderRadius: '3px', background: '#64748b22', color: '#94a3b8' }}>
                        {sn.role}
                      </span>
                    </div>
                    <div style={{ fontSize: '11px', marginTop: '2px' }}>
                      {sn.spaceAsset
                        ? <span style={{ color: '#22c55e' }}>→ {sn.spaceAsset.name}</span>
                        : <span style={{ color: '#ef4444' }}>Unallocated</span>
                      }
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {missionDetail.targets?.length > 0 && (
            <div className="map-detail-section">
              <div className="map-detail-section__title">TARGETS ({missionDetail.targets.length})</div>
              {missionDetail.targets.map((t: any) => (
                <div key={t.id} className="map-detail-dep-item">
                  <div style={{ fontWeight: 600, color: 'var(--text-bright)', fontSize: '12px' }}>
                    {t.targetName}
                    {t.priorityRank && <span style={{ color: 'var(--text-muted)', marginLeft: '6px', fontWeight: 400 }}>P{t.priorityRank}</span>}
                  </div>
                  <div style={{ color: '#ef4444', fontSize: '11px' }}>{t.desiredEffect}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {!missionDetail && (
        <div style={{ color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center', padding: '20px' }}>
          Loading mission detail...
        </div>
      )}
    </>
  );
}

function SatelliteHeader({ entity }: { entity: SelectedSatellite }) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ background: '#a855f722', border: '1px solid #a855f7', color: '#a855f7', borderRadius: '4px', padding: '2px 6px', fontSize: '10px', fontWeight: 700 }}>
          SAT
        </span>
        <span style={{ fontWeight: 700, color: 'var(--text-bright)', fontSize: '14px' }}>{entity.callsign}</span>
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '2px' }}>{entity.status}</div>
    </>
  );
}

function SatelliteBody({ entity, missionDetail, allocations }: { entity: SelectedSatellite; missionDetail: any; allocations: SpaceAllocationLink[] }) {
  // Find allocations where this satellite is the asset
  const satAllocations = allocations.filter(a => a.spaceAsset?.name === entity.callsign);

  return (
    <>
      <div className="map-detail-section">
        <div className="map-detail-section__title">POSITION</div>
        <div className="map-detail-grid">
          <span className="map-detail-label">Status</span>
          <span className="map-detail-value">{entity.status}</span>
          <span className="map-detail-label">Lat</span>
          <span className="map-detail-value">{entity.latitude.toFixed(4)}°</span>
          <span className="map-detail-label">Lon</span>
          <span className="map-detail-value">{entity.longitude.toFixed(4)}°</span>
          {entity.altitude_ft != null && <>
            <span className="map-detail-label">Altitude</span>
            <span className="map-detail-value">{entity.altitude_ft.toLocaleString()} km</span>
          </>}
        </div>
      </div>

      {missionDetail?.spaceNeeds?.length > 0 && (
        <div className="map-detail-section">
          <div className="map-detail-section__title">CAPABILITIES</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {[...new Set(missionDetail.spaceNeeds.map((sn: any) => sn.capabilityType))].map((cap: any) => (
              <span key={cap} style={{ fontSize: '10px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px', background: '#a855f722', color: '#c084fc' }}>
                {cap}
              </span>
            ))}
          </div>
        </div>
      )}

      {satAllocations.length > 0 && (
        <div className="map-detail-section">
          <div className="map-detail-section__title">SUPPORTING ({satAllocations.length} missions)</div>
          {satAllocations.map(alloc => {
            const mission = alloc.spaceNeed.mission;
            const statusColor = ALLOC_STATUS_COLORS[alloc.status] || '#64748b';
            return (
              <div key={alloc.id} className="map-detail-dep" style={{ borderLeftColor: statusColor }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontWeight: 600, fontSize: '12px', color: 'var(--text-bright)' }}>
                    {mission.callsign || mission.missionId}
                  </span>
                  <span style={{ fontSize: '9px', fontWeight: 700, padding: '1px 4px', borderRadius: '3px', background: statusColor + '22', color: statusColor }}>
                    {alloc.status}
                  </span>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  {alloc.spaceNeed.capabilityType} · {mission.domain} · {mission.missionType}
                </div>
                {alloc.spaceNeed.missionCriticality === 'CRITICAL' && (
                  <div style={{ fontSize: '10px', color: '#ef4444', marginTop: '2px' }}>CRITICAL dependency</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {satAllocations.length === 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center', padding: '20px' }}>
          No active allocations for this satellite.
        </div>
      )}
    </>
  );
}

function UnitHeader({ entity }: { entity: SelectedUnit }) {
  const first = entity.units[0];
  const isOpfor = first.affiliation === 'HOSTILE';
  const totalAssets = entity.units.reduce((s, u) => s + u.assetCount, 0);
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{
          background: isOpfor ? '#ef444422' : '#3b82f622',
          border: `1px solid ${isOpfor ? '#ef4444' : '#3b82f6'}`,
          color: isOpfor ? '#ef4444' : '#60a5fa',
          borderRadius: '4px', padding: '2px 6px', fontSize: '10px', fontWeight: 700,
        }}>
          {isOpfor ? 'OPFOR' : 'BLUFOR'}
        </span>
        <span style={{ fontWeight: 700, color: 'var(--text-bright)', fontSize: '14px' }}>
          {entity.units.length} Unit{entity.units.length > 1 ? 's' : ''}
        </span>
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '2px' }}>
        {first.baseLocation || 'Unknown Location'} · {totalAssets} assets
      </div>
    </>
  );
}

function UnitBody({ entity }: { entity: SelectedUnit }) {
  return (
    <>
      {entity.units.map(u => (
        <div key={u.id} className="map-detail-section">
          <div className="map-detail-section__title">{u.unitDesignation}</div>
          <div className="map-detail-grid">
            <span className="map-detail-label">Name</span>
            <span className="map-detail-value">{u.unitName}</span>
            <span className="map-detail-label">Service</span>
            <span className="map-detail-value">{u.serviceBranch}</span>
            <span className="map-detail-label">Domain</span>
            <span className="map-detail-value" style={{ color: DOMAIN_COLORS[u.domain] || 'inherit' }}>{u.domain}</span>
            <span className="map-detail-label">Assets</span>
            <span className="map-detail-value">{u.assetCount}</span>
            <span className="map-detail-label">Location</span>
            <span className="map-detail-value">{u.baseLocation}</span>
          </div>
        </div>
      ))}
    </>
  );
}

function BaseHeader({ entity }: { entity: SelectedBase }) {
  const b = entity.base;
  const color = BASE_COLORS[b.baseType] || '#10b981';
  const symbol = BASE_SYMBOLS[b.baseType] || '◆';
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '16px', color }}>{symbol}</span>
        <span style={{ fontWeight: 700, color: 'var(--text-bright)', fontSize: '14px' }}>{b.name}</span>
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '2px' }}>
        {b.baseType.replace('_', ' ')} · {b.country}
      </div>
    </>
  );
}

function BaseBody({ entity }: { entity: SelectedBase }) {
  const b = entity.base;
  return (
    <>
      <div className="map-detail-section">
        <div className="map-detail-section__title">DETAILS</div>
        <div className="map-detail-grid">
          <span className="map-detail-label">Type</span>
          <span className="map-detail-value">{b.baseType.replace('_', ' ')}</span>
          <span className="map-detail-label">Country</span>
          <span className="map-detail-value">{b.country}</span>
          {b.icaoCode && <>
            <span className="map-detail-label">ICAO</span>
            <span className="map-detail-value">{b.icaoCode}</span>
          </>}
          <span className="map-detail-label">Lat</span>
          <span className="map-detail-value">{b.latitude.toFixed(4)}°</span>
          <span className="map-detail-label">Lon</span>
          <span className="map-detail-value">{b.longitude.toFixed(4)}°</span>
          <span className="map-detail-label">Units</span>
          <span className="map-detail-value">{b.unitCount}</span>
          <span className="map-detail-label">Assets</span>
          <span className="map-detail-value">{b.totalAssets}</span>
        </div>
      </div>

      {b.units.length > 0 && (
        <div className="map-detail-section">
          <div className="map-detail-section__title">ASSIGNED UNITS ({b.units.length})</div>
          {b.units.map((u, i) => (
            <div key={i} className="map-detail-dep-item">
              <div style={{ fontWeight: 600, color: 'var(--text-bright)', fontSize: '12px' }}>
                {u.unitDesignation}
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                {u.assetCount} assets
              </div>
            </div>
          ))}
        </div>
      )}

      {b.radarSensors.length > 0 && (
        <div className="map-detail-section">
          <div className="map-detail-section__title">SENSORS</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {b.radarSensors.map((r, i) => (
              <span key={i} style={{ fontSize: '10px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px', background: '#f59e0b22', color: '#f59e0b' }}>
                {r}
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function TargetHeader({ entity }: { entity: SelectedTarget }) {
  const t = entity.target;
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ background: '#ef444422', border: '1px solid #ef4444', color: '#ef4444', borderRadius: '4px', padding: '2px 6px', fontSize: '10px', fontWeight: 700 }}>
          TGT
        </span>
        <span style={{ fontWeight: 700, color: 'var(--text-bright)', fontSize: '14px' }}>{t.targetName}</span>
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '2px' }}>{t.targetId}</div>
    </>
  );
}

function TargetBody({ entity }: { entity: SelectedTarget }) {
  const t = entity.target;
  return (
    <div className="map-detail-section">
      <div className="map-detail-section__title">TARGET DETAILS</div>
      <div className="map-detail-grid">
        <span className="map-detail-label">Name</span>
        <span className="map-detail-value">{t.targetName}</span>
        <span className="map-detail-label">ID</span>
        <span className="map-detail-value">{t.targetId}</span>
        {t.beNumber && <>
          <span className="map-detail-label">BE#</span>
          <span className="map-detail-value">{t.beNumber}</span>
        </>}
        {t.targetCategory && <>
          <span className="map-detail-label">Category</span>
          <span className="map-detail-value">{t.targetCategory}</span>
        </>}
        <span className="map-detail-label">Effect</span>
        <span className="map-detail-value" style={{ color: '#ef4444' }}>{t.desiredEffect}</span>
        <span className="map-detail-label">Priority</span>
        <span className="map-detail-value">P{t.priorityRank}</span>
        <span className="map-detail-label">Lat</span>
        <span className="map-detail-value">{t.latitude.toFixed(4)}°</span>
        <span className="map-detail-label">Lon</span>
        <span className="map-detail-value">{t.longitude.toFixed(4)}°</span>
      </div>
    </div>
  );
}
