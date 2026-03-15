/**
 * inject-locator.ts — Derives geospatial coordinates for MSEL injects
 *
 * POC1 AIRGAP PATTERN:
 *   LLM generates inject descriptions → stored as ScenarioInject → THIS locator
 *   reads inject text, resolves entity references (base names, unit designations,
 *   space asset names), and writes lat/lon back to the inject record.
 *
 *   The LLM NEVER writes coordinates to ScenarioInject.latitude/longitude.
 *   This locator is the only bridge between prose inject descriptions and
 *   geospatial map placement.
 */

import prisma from '../db/prisma-client.js';

interface EntityLocation {
  name: string;
  lat: number;
  lon: number;
  type: 'Base' | 'Unit' | 'SpaceAsset';
}

/**
 * Locates inject coordinates by matching entity references in the inject
 * description against known bases, units, and space assets.
 *
 * Called AFTER all MSEL injects are generated and stored.
 */
export async function locateInjects(scenarioId: string): Promise<number> {
  // Load all injects that lack coordinates
  const injects = await prisma.scenarioInject.findMany({
    where: {
      scenarioId,
      latitude: null,
    },
  });

  if (injects.length === 0) return 0;

  // Build entity location index from existing DB records
  const entityLocations = await buildEntityIndex(scenarioId);
  if (entityLocations.length === 0) {
    console.log('[INJECT-LOCATOR] No entity locations found for scenario');
    return 0;
  }

  let updated = 0;

  for (const inject of injects) {
    // Combine all text fields for entity matching
    const searchText = [
      inject.title,
      inject.description,
      inject.impact,
      inject.fromEntity,
      inject.toEntity,
    ].filter(Boolean).join(' ');

    // Find the best matching entity
    const match = findBestEntityMatch(searchText, entityLocations);

    if (match) {
      try {
        await prisma.scenarioInject.update({
          where: { id: inject.id },
          data: {
            latitude: match.lat,
            longitude: match.lon,
          },
        });
        updated++;
      } catch (err) {
        console.warn(`[INJECT-LOCATOR] Failed to update inject ${inject.id}:`, err);
      }
    }
  }

  console.log(`[INJECT-LOCATOR] Located ${updated}/${injects.length} injects`);
  return updated;
}

/**
 * Builds an index of all geolocatable entities for a scenario.
 */
async function buildEntityIndex(scenarioId: string): Promise<EntityLocation[]> {
  const locations: EntityLocation[] = [];

  // Bases
  const bases = await prisma.base.findMany({
    where: { scenarioId },
    select: { name: true, latitude: true, longitude: true },
  });
  for (const base of bases) {
    locations.push({ name: base.name, lat: base.latitude, lon: base.longitude, type: 'Base' });
  }

  // Units (with their base coordinates)
  const units = await prisma.unit.findMany({
    where: { scenarioId },
    select: { unitName: true, unitDesignation: true, baseLocation: true, baseLat: true, baseLon: true },
  });
  for (const unit of units) {
    if (unit.baseLat != null && unit.baseLon != null) {
      locations.push({ name: unit.unitName, lat: unit.baseLat, lon: unit.baseLon, type: 'Unit' });
      if (unit.unitDesignation) {
        locations.push({ name: unit.unitDesignation, lat: unit.baseLat, lon: unit.baseLon, type: 'Unit' });
      }
      if (unit.baseLocation) {
        locations.push({ name: unit.baseLocation, lat: unit.baseLat, lon: unit.baseLon, type: 'Unit' });
      }
    }
  }

  // Space assets (use scenario center as fallback — space assets don't have fixed ground positions)
  // Space injects are typically about degradation, so we skip them for now

  return locations;
}

/**
 * Finds the entity whose name best matches text in the inject description.
 * Uses case-insensitive substring matching, preferring longer matches.
 */
function findBestEntityMatch(
  text: string,
  entities: EntityLocation[],
): EntityLocation | null {
  const textLower = text.toLowerCase();
  let bestMatch: EntityLocation | null = null;
  let bestLength = 0;

  for (const entity of entities) {
    const entityLower = entity.name.toLowerCase();
    if (textLower.includes(entityLower) && entityLower.length > bestLength) {
      bestMatch = entity;
      bestLength = entityLower.length;
    }
  }

  return bestMatch;
}

// Export for testing
export { buildEntityIndex, findBestEntityMatch };
