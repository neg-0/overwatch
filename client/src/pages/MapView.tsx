import mapboxgl from 'mapbox-gl';
import { useCallback, useEffect, useRef, useState } from 'react';
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

// ─── Constants ───────────────────────────────────────────────────────────────

const DOMAIN_COLORS: Record<string, string> = {
  AIR: '#00d4ff',
  MARITIME: '#0090ff',
  SPACE: '#a855f7',
};

const TRAIL_COLORS: Record<string, string> = {
  AIR: '#00ffd4',
  MARITIME: '#00ff90',
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

// ─── Component ───────────────────────────────────────────────────────────────

export function MapView() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const baseMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const targetMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const trailsRef = useRef<Map<string, [number, number][]>>(new Map());
  const mapLoadedRef = useRef(false);

  const { positions, activeScenarioId, simulation, bases, coverageWindows, unitPositions } = useOverwatchStore();
  const [activeDomains, setActiveDomains] = useState<Set<string>>(new Set(['AIR', 'MARITIME', 'SPACE']));
  const [affiliation, setAffiliation] = useState<'ALL' | 'FRIENDLY' | 'HOSTILE'>('ALL');
  const [routes, setRoutes] = useState<MissionRoute[]>([]);
  const [targets, setTargets] = useState<MissionTarget[]>([]);

  // Layer toggles
  const [showBases, setShowBases] = useState(true);
  const [showTargets, setShowTargets] = useState(true);
  const [showCoverage, setShowCoverage] = useState(false);
  const [showUnits, setShowUnits] = useState(true);
  const unitMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());

  // ─── Initialize Map ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!mapContainerRef.current) return;

    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || '';

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

      const el = document.createElement('div');
      el.style.cssText = `
        width: 24px; height: 24px;
        display: flex; align-items: center; justify-content: center;
        font-size: 16px;
        cursor: pointer;
        filter: drop-shadow(0 0 4px ${isOpfor ? '#ef4444' : color}80);
        ${isOpfor ? 'color: #ef4444;' : `color: ${color};`}
      `;
      el.textContent = symbol;

      const unitsList = base.units.map(u =>
        `<div style="margin-left:8px;font-size:10px;">• ${esc(u.unitDesignation)} (${u.assetCount} assets)</div>`
      ).join('');
      const radarList = base.radarSensors.length > 0
        ? `<div style="margin-top:4px;font-size:10px;color:#f59e0b;">🔵 ${base.radarSensors.map(esc).join(', ')}</div>`
        : '';

      const popup = new mapboxgl.Popup({ offset: 15, className: 'overwatch-popup' })
        .setHTML(`
          <div style="padding: 8px; font-family: var(--font-mono); font-size: 12px; max-width: 240px;">
            <div style="font-weight: 700; margin-bottom: 4px; color: ${isOpfor ? '#ef4444' : color};">
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
        .setPopup(popup)
        .addTo(map);

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
      const el = document.createElement('div');
      el.style.cssText = `
        width: 16px; height: 16px;
        display: flex; align-items: center; justify-content: center;
        font-size: 14px; font-weight: bold;
        color: #ef4444;
        cursor: pointer;
        filter: drop-shadow(0 0 6px #ef444480);
      `;
      el.textContent = '✕';

      const popup = new mapboxgl.Popup({ offset: 15, className: 'overwatch-popup' })
        .setHTML(`
          <div style="padding: 8px; font-family: var(--font-mono); font-size: 12px;">
            <div style="font-weight: 700; margin-bottom: 4px; color: #ef4444;">
              ✕ ${esc(target.targetName)}
            </div>
            ${target.beNumber ? `<div>BE#: ${esc(target.beNumber)}</div>` : ''}
            ${target.targetCategory ? `<div>Category: ${esc(target.targetCategory)}</div>` : ''}
            <div>Effect: ${esc(target.desiredEffect)}</div>
            <div>Priority: ${target.priorityRank}</div>
          </div>
        `);

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([target.longitude, target.latitude])
        .setPopup(popup)
        .addTo(map);

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

      const el = document.createElement('div');
      el.style.cssText = `
        width: 28px; height: 28px;
        display: flex; align-items: center; justify-content: center;
        font-size: 10px; font-weight: 700;
        color: ${isOpfor ? '#fff' : '#fff'};
        background: ${isOpfor ? 'rgba(239, 68, 68, 0.7)' : 'rgba(59, 130, 246, 0.7)'};
        border: 2px solid ${isOpfor ? '#ef4444' : '#3b82f6'};
        border-radius: 50%;
        cursor: pointer;
        box-shadow: 0 0 8px ${isOpfor ? '#ef444480' : '#3b82f680'};
      `;
      el.textContent = String(totalAssets);

      const unitList = units.map(u =>
        `<div style="margin: 2px 0; font-size: 10px;">
          <span style="color: ${DOMAIN_COLORS[u.domain] || '#888'};">■</span>
          ${esc(u.unitDesignation)} — ${u.assetCount} assets
        </div>`
      ).join('');

      const popup = new mapboxgl.Popup({ offset: 15, className: 'overwatch-popup' })
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
        .setPopup(popup)
        .addTo(map);

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

    // Build GeoJSON circles from coverage windows
    const features: GeoJSON.Feature[] = coverageWindows
      .filter(cw => cw.lat != null && cw.lon != null)
      .map(cw => {
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
          'fill-opacity': 0.08,
        },
      });
      map.addLayer({
        id: `${sourceId}-outline`,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 1,
          'line-opacity': 0.3,
          'line-dasharray': [2, 2],
        },
      });
    }
  }, [coverageWindows, showCoverage]);

  // ─── Update Breadcrumb Trails ───────────────────────────────────────────────

  const updateTrails = useCallback(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;

    positions.forEach((pos, missionId) => {
      if (!activeDomains.has(pos.domain)) return;

      // Guard against LLM hallucinations that output invalid MapBox coordinates
      const isValidCoord = typeof pos.latitude === 'number' && !isNaN(pos.latitude) && pos.latitude >= -90 && pos.latitude <= 90 &&
        typeof pos.longitude === 'number' && !isNaN(pos.longitude) && pos.longitude >= -180 && pos.longitude <= 180;

      if (!isValidCoord) return;

      // Accumulate trail points
      const trail = trailsRef.current.get(missionId) || [];
      const lastPoint = trail[trail.length - 1];
      if (!lastPoint || lastPoint[0] !== pos.longitude || lastPoint[1] !== pos.latitude) {
        trail.push([pos.longitude, pos.latitude]);
        trailsRef.current.set(missionId, trail);
      }

      if (trail.length < 2) return;

      const sourceId = `trail-${missionId}`;
      const color = TRAIL_COLORS[pos.domain] || '#888';

      const geojson: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: trail },
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
  }, [positions, activeDomains]);

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
        currentMarkers.get(missionId)!.setLngLat([pos.longitude, pos.latitude]);
      } else {
        const el = document.createElement('div');
        const isSpace = pos.domain === 'SPACE';
        el.style.cssText = `
          width: ${isSpace ? '10px' : '12px'};
          height: ${isSpace ? '10px' : '12px'};
          border-radius: ${isSpace ? '2px' : '50%'};
          background: ${color};
          border: 2px solid rgba(255,255,255,0.8);
          box-shadow: 0 0 8px ${color}80;
          cursor: pointer;
          ${isSpace ? 'transform: rotate(45deg);' : ''}
        `;

        const popup = new mapboxgl.Popup({ offset: 15, className: 'overwatch-popup' })
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
          .setPopup(popup)
          .addTo(map);

        currentMarkers.set(missionId, marker);
      }
    });

    // Remove markers no longer tracked
    currentMarkers.forEach((marker, id) => {
      if (!activeIds.has(id)) {
        marker.remove();
        currentMarkers.delete(id);
      }
    });

    // Update breadcrumb trails
    updateTrails();
  }, [positions, activeDomains, affiliation, updateTrails]);

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
    <div className="page-content" style={{ position: 'relative', height: '100%', padding: 0 }}>
      {/* Map Toolbar */}
      <div style={{
        position: 'absolute',
        top: '12px',
        left: '12px',
        zIndex: 10,
        display: 'flex',
        gap: '8px',
        flexWrap: 'wrap',
      }}>
        {['AIR', 'MARITIME', 'SPACE'].map(domain => (
          <button
            key={domain}
            onClick={() => toggleDomain(domain)}
            className={`btn btn-sm ${activeDomains.has(domain) ? 'btn-primary' : 'btn-secondary'}`}
            style={{
              padding: '6px 12px',
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.05em',
            }}
          >
            {domain}
          </button>
        ))}

        <span style={{ width: '1px', background: 'var(--border-subtle)', margin: '0 4px' }} />

        {/* Layer toggles */}
        <button
          onClick={() => setShowBases(!showBases)}
          className={`btn btn-sm ${showBases ? 'btn-primary' : 'btn-secondary'}`}
          style={{ padding: '6px 12px', fontSize: '11px', fontWeight: 600 }}
        >
          BASES
        </button>
        <button
          onClick={() => setShowTargets(!showTargets)}
          className={`btn btn-sm ${showTargets ? 'btn-primary' : 'btn-secondary'}`}
          style={{ padding: '6px 12px', fontSize: '11px', fontWeight: 600 }}
        >
          TARGETS
        </button>
        <button
          onClick={() => setShowUnits(!showUnits)}
          className={`btn btn-sm ${showUnits ? 'btn-primary' : 'btn-secondary'}`}
          style={{ padding: '6px 12px', fontSize: '11px', fontWeight: 600 }}
        >
          UNITS
        </button>
        <button
          onClick={() => setShowCoverage(!showCoverage)}
          className={`btn btn-sm ${showCoverage ? 'btn-primary' : 'btn-secondary'}`}
          style={{ padding: '6px 12px', fontSize: '11px', fontWeight: 600 }}
        >
          COVERAGE
        </button>

        <span style={{ width: '1px', background: 'var(--border-subtle)', margin: '0 4px' }} />

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
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function initializeMapSources(map: mapboxgl.Map) {
  // Pre-create empty sources for trails (added dynamically)
  // This ensures layers are ready when positions start arriving
  console.log('[MAP] Sources initialized');
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
          background: 'var(--accent-success)',
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
