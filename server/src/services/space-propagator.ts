import * as satellite from 'satellite.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SpacePosition {
  latitude: number;
  longitude: number;
  altitude_km: number;
  velocity_km_s?: number;
}

// ─── SGP4 Propagation ────────────────────────────────────────────────────────

/**
 * Propagate a satellite position from TLE at a given date using SGP4.
 * Returns geodetic lat/lon/alt or null if propagation fails.
 */
export function propagateFromTLE(
  tleLine1: string,
  tleLine2: string,
  datetime: Date,
): SpacePosition | null {
  try {
    const satrec = satellite.twoline2satrec(tleLine1, tleLine2);

    const posVel = satellite.propagate(satrec, datetime);
    if (!posVel.position || typeof posVel.position === 'boolean') return null;

    const gmst = satellite.gstime(datetime);
    const geo = satellite.eciToGeodetic(posVel.position, gmst);

    const latitude = satellite.degreesLat(geo.latitude);
    const longitude = satellite.degreesLong(geo.longitude);
    const altitude_km = geo.height;

    // SGP4 can produce NaN for invalid or very stale TLEs
    if (isNaN(latitude) || isNaN(longitude) || isNaN(altitude_km)) return null;

    let velocity_km_s: number | undefined;
    if (posVel.velocity && typeof posVel.velocity !== 'boolean') {
      velocity_km_s = Math.sqrt(
        posVel.velocity.x ** 2 +
        posVel.velocity.y ** 2 +
        posVel.velocity.z ** 2,
      );
    }

    return { latitude, longitude, altitude_km, velocity_km_s };
  } catch (err) {
    console.error('[SPACE] SGP4 propagation failed:', err);
    return null;
  }
}

/**
 * Approximate sub-satellite point for GEO satellites without TLE data.
 * Uses inclination and period to estimate a near-stationary position.
 */
export function approximateGeoPosition(
  inclination: number,
  periodMin: number,
  eccentricity: number,
  datetime: Date,
  baseLon = 120.0, // Default sub-satellite longitude for WESTPAC coverage
): SpacePosition {
  const isGeo = periodMin > 1400 && periodMin < 1500;

  // Kepler's third law: a = (mu * T^2 / (4 * pi^2))^(1/3)
  const mu = 398600.4418; // km^3/s^2 - Earth gravitational parameter
  const periodSec = periodMin * 60;
  const semiMajorAxis = Math.pow((mu * periodSec * periodSec) / (4 * Math.PI * Math.PI), 1/3);
  const altKm = isGeo ? 35786 : semiMajorAxis - 6371; // subtract Earth radius

  // Use satellite's actual orbital period instead of Earth's daily rotation
  const elapsedMs = datetime.getTime();
  const periodMs = periodMin * 60 * 1000;
  const orbitalAngle = (elapsedMs / periodMs) * 2 * Math.PI;
  let lat = inclination * Math.sin(orbitalAngle);
  let lon = baseLon + (eccentricity * 360 * Math.cos(orbitalAngle));

  // Handle orbits that cross the poles (e.g., Sun-Synchronous Orbits with inclination > 90)
  // Normalize longitude to [-180, 180]
  lon = ((lon + 180) % 360 + 360) % 360 - 180;

  // Normalize latitude to [-270, 270) to catch polar crossings
  lat = ((lat + 270) % 360 + 360) % 360 - 270;
  if (lat > 90) {
    // Crossed North Pole: lat goes back down, longitude flips 180 degrees
    lat = 180 - lat;
    lon = lon > 0 ? lon - 180 : lon + 180;
  } else if (lat < -90) {
    // Crossed South Pole: lat comes back up, longitude flips 180 degrees
    lat = -180 - lat;
    lon = lon > 0 ? lon - 180 : lon + 180;
  }

  return {
    latitude: Math.max(-90, Math.min(90, lat)),
    longitude: lon,
    altitude_km: isGeo ? 35786 : altKm,
  };
}
