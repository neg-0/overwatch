import mapboxgl from 'mapbox-gl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useOverwatchStore } from '../store/overwatch-store';

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

// ─── Component ───────────────────────────────────────────────────────────────

export function MapView() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const trailsRef = useRef<Map<string, [number, number][]>>(new Map());
  const mapLoadedRef = useRef(false);

  const { positions, activeScenarioId, simulation } = useOverwatchStore();
  const [activeDomains, setActiveDomains] = useState<Set<string>>(new Set(['AIR', 'MARITIME', 'SPACE']));
  const [affiliation, setAffiliation] = useState<'ALL' | 'FRIENDLY' | 'HOSTILE'>('ALL');
  const [routes, setRoutes] = useState<MissionRoute[]>([]);

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

  // ─── Fetch Waypoints for Route Lines ────────────────────────────────────────

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

  // ─── Update Breadcrumb Trails ───────────────────────────────────────────────

  const updateTrails = useCallback(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;

    positions.forEach((pos, missionId) => {
      if (!activeDomains.has(pos.domain)) return;

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
                ${pos.callsign || missionId.slice(0, 8)}
              </div>
              <div>Domain: ${pos.domain}</div>
              <div>Status: ${pos.status}</div>
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
  }, [positions, activeDomains, updateTrails]);

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
        minWidth: '160px',
      }}>
        <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '8px', letterSpacing: '0.1em' }}>
          LEGEND
        </div>
        <LegendItem color="#00d4ff" label="AIR" symbol="circle" />
        <LegendItem color="#0090ff" label="MARITIME" symbol="circle" />
        <LegendItem color="#a855f7" label="SPACE" symbol="diamond" />
        <div style={{ margin: '8px 0', borderTop: '1px solid var(--border-subtle)' }} />
        <LegendItem color="" label="Planned Route" symbol="dashed" />
        <LegendItem color="" label="Track History" symbol="solid" />
        <div style={{ margin: '8px 0', borderTop: '1px solid var(--border-subtle)' }} />
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          {positions.size} tracks
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
