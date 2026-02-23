import { config } from '../config.js';
import prisma from '../db/prisma-client.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface UDLElset {
  idElset: string;
  satNo: number;
  epoch: string;
  line1: string;
  line2: string;
  meanMotion: number;
  eccentricity: number;
  inclination: number;
  raan: number;
  argOfPerigee: number;
  meanAnomaly: number;
  period: number;
  apogee: number;
  perigee: number;
  semiMajorAxis: number;
  source: string;
  algorithm: string;
  dataMode: string;
}

// ─── In-Memory Cache ─────────────────────────────────────────────────────────

const TLE_CACHE = new Map<string, { data: UDLElset; fetchedAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function getCacheKey(satNo: number, epochDate: string): string {
  return `${satNo}:${epochDate}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getBasicAuth(): string {
  const { username, password } = config.udl;
  return Buffer.from(`${username}:${password}`).toString('base64');
}

function isConfigured(): boolean {
  return !!(config.udl.username && config.udl.password);
}

async function udlGet<T>(path: string): Promise<T | null> {
  if (!isConfigured()) {
    console.warn('[UDL] Credentials not configured, skipping API call');
    return null;
  }

  const url = `${config.udl.baseUrl}${path}`;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Basic ${getBasicAuth()}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[UDL] ${res.status} ${res.statusText} for ${path}: ${body.slice(0, 200)}`);
      return null;
    }

    return await res.json() as T;
  } catch (err) {
    console.error(`[UDL] Fetch error for ${path}:`, err);
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch the most recent ELSET for a satellite.
 */
export async function fetchCurrentElset(satNo: number): Promise<UDLElset | null> {
  const cacheKey = getCacheKey(satNo, 'current');
  const cached = TLE_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const results = await udlGet<UDLElset[]>(`/elset/current?satNo=${satNo}`);
  if (!results || results.length === 0) return null;

  const elset = results[0];
  TLE_CACHE.set(cacheKey, { data: elset, fetchedAt: Date.now() });
  return elset;
}

/**
 * Fetch the ELSET closest to (but not after) a given date.
 * Uses the history endpoint for past dates, current for near-present.
 */
export async function fetchElsetAtEpoch(satNo: number, targetDate: Date): Promise<UDLElset | null> {
  const now = new Date();
  const hoursAgo = (now.getTime() - targetDate.getTime()) / (1000 * 60 * 60);

  // If the target is within the last 24 hours, just use current
  if (hoursAgo < 24) {
    return fetchCurrentElset(satNo);
  }

  const dateStr = targetDate.toISOString().split('T')[0]; // YYYY-MM-DD for cache key
  const cacheKey = getCacheKey(satNo, dateStr);
  const cached = TLE_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  // Build a 2-day window around the target date
  const windowStart = new Date(targetDate.getTime() - 24 * 60 * 60 * 1000);
  const windowEnd = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000);
  const startStr = windowStart.toISOString();
  const endStr = windowEnd.toISOString();

  // Try history endpoint with the epoch window
  const results = await udlGet<UDLElset[]>(
    `/elset/history?satNo=${satNo}&epoch=${encodeURIComponent(startStr)}/${encodeURIComponent(endStr)}&orderBy=epoch%20desc&limit=1`,
  );

  if (results && results.length > 0) {
    const elset = results[0];
    TLE_CACHE.set(cacheKey, { data: elset, fetchedAt: Date.now() });
    return elset;
  }

  // Fallback: try current if history returned nothing
  console.warn(`[UDL] No historical ELSET found for sat ${satNo} near ${dateStr}, falling back to current`);
  return fetchCurrentElset(satNo);
}

/**
 * Refresh TLEs for all space assets in a scenario.
 * Fetches epoch-appropriate TLEs from UDL and updates the database.
 */
export async function refreshTLEsForScenario(scenarioId: string): Promise<number> {
  if (!isConfigured()) {
    console.log('[UDL] Credentials not configured, skipping TLE refresh');
    return 0;
  }

  const scenario = await prisma.scenario.findUnique({
    where: { id: scenarioId },
    select: { startDate: true },
  });
  if (!scenario) {
    console.error(`[UDL] Scenario ${scenarioId} not found`);
    return 0;
  }

  const spaceAssets = await prisma.spaceAsset.findMany({
    where: { scenarioId },
    select: { id: true, name: true, noradId: true },
  });

  const targetDate = new Date(scenario.startDate);
  console.log(`[UDL] Refreshing TLEs for ${spaceAssets.length} space assets (epoch target: ${targetDate.toISOString()})`);

  let updated = 0;
  let skippedNoNorad = 0;

  for (const asset of spaceAssets) {
    if (!asset.noradId) {
      skippedNoNorad++;
      continue;
    }

    const satNo = parseInt(asset.noradId, 10);
    if (isNaN(satNo)) {
      console.warn(`[UDL]   ⚠  ${asset.name} — invalid NORAD ID "${asset.noradId}"`);
      continue;
    }

    try {
      const elset = await fetchElsetAtEpoch(satNo, targetDate);
      if (!elset) {
        console.warn(`[UDL]   ⚠  ${asset.name} (${satNo}) — no ELSET found`);
        continue;
      }

      await prisma.spaceAsset.update({
        where: { id: asset.id },
        data: {
          tleLine1: elset.line1,
          tleLine2: elset.line2,
          inclination: elset.inclination,
          eccentricity: elset.eccentricity,
          periodMin: elset.period,
          apogeeKm: elset.apogee,
          perigeeKm: elset.perigee,
        },
      });

      console.log(`[UDL]   ✅ ${asset.name} (${satNo}) — epoch ${elset.epoch} from ${elset.source}`);
      updated++;
    } catch (err) {
      console.error(`[UDL]   ❌ ${asset.name} (${satNo}) — error:`, err);
    }
  }

  if (skippedNoNorad > 0) {
    console.log(`[UDL]   ⏭  ${skippedNoNorad} assets skipped (no NORAD ID)`);
  }
  console.log(`[UDL] TLE refresh complete: ${updated}/${spaceAssets.length} updated`);
  return updated;
}
