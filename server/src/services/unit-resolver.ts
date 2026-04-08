/**
 * unit-resolver.ts — Doctrine-driven mission-to-unit assignment
 *
 * Per joint planning doctrine, the ATO specifies platformType per mission
 * and the OPLAN establishes the ORBAT (units with assets). This module
 * infers unit assignments by matching mission platformType against the
 * ORBAT's Unit → Asset → AssetType chain, respecting domain and affiliation.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** A unit entry with its platform capabilities and current load */
interface UnitEntry {
  unitId: string;
  domain: string;
  affiliation: string;
  assetCount: number;
  assignedMissionCount: number;
}

/** Pre-built index for O(1) platform → unit lookup */
export interface UnitIndex {
  /** Exact platform name → unit entries */
  byPlatform: Map<string, UnitEntry[]>;
  /** All normalized platform names for fuzzy matching */
  allPlatformNames: string[];
}

/** Shape of a unit pre-fetched with assets and asset types */
type UnitWithAssets = {
  id: string;
  domain: string;
  affiliation: string;
  assets: Array<{
    assetType: {
      name: string;
    };
  }>;
};

// ─── Index Builder ────────────────────────────────────────────────────────────

/**
 * Build a lookup index from pre-fetched units (with assets + assetTypes).
 * Call once per order generation batch, not per mission.
 */
export function buildUnitIndex(units: UnitWithAssets[]): UnitIndex {
  const byPlatform = new Map<string, UnitEntry[]>();

  for (const unit of units) {
    // Group assets by platform type to get counts
    const platformCounts = new Map<string, number>();
    for (const asset of unit.assets) {
      const name = asset.assetType.name;
      platformCounts.set(name, (platformCounts.get(name) || 0) + 1);
    }

    // Create an entry per platform this unit operates
    for (const [platformName, count] of platformCounts) {
      const key = normalizePlatform(platformName);
      const entry: UnitEntry = {
        unitId: unit.id,
        domain: unit.domain,
        affiliation: unit.affiliation,
        assetCount: count,
        assignedMissionCount: 0,
      };

      const existing = byPlatform.get(key);
      if (existing) {
        existing.push(entry);
      } else {
        byPlatform.set(key, [entry]);
      }
    }
  }

  const allPlatformNames = Array.from(byPlatform.keys());

  return { byPlatform, allPlatformNames };
}

// ─── Resolver ─────────────────────────────────────────────────────────────────

/**
 * Resolve the best-fit unit for a mission based on platform type, domain,
 * and affiliation. Returns unitId or null if no match found.
 *
 * Increments assignedMissionCount on the chosen unit so subsequent calls
 * in the same batch distribute load across units.
 */
export function resolveUnitForMission(
  platformType: string,
  domain: string,
  affiliation: string,
  index: UnitIndex,
): string | null {
  // Try exact match first
  let candidates = index.byPlatform.get(normalizePlatform(platformType));

  // Fuzzy match: check if LLM platformType starts with a catalog name or vice versa
  if (!candidates) {
    const normalized = normalizePlatform(platformType);
    for (const catalogName of index.allPlatformNames) {
      if (normalized.startsWith(catalogName) || catalogName.startsWith(normalized)) {
        candidates = index.byPlatform.get(catalogName);
        if (candidates) break;
      }
    }
  }

  if (!candidates || candidates.length === 0) return null;

  // Filter by domain and affiliation
  const filtered = candidates.filter(
    c => c.domain === domain && c.affiliation === affiliation,
  );

  if (filtered.length === 0) return null;

  // Pick unit with most remaining capacity
  filtered.sort((a, b) => {
    const aRemaining = a.assetCount - a.assignedMissionCount;
    const bRemaining = b.assetCount - b.assignedMissionCount;
    return bRemaining - aRemaining; // highest remaining first
  });

  const chosen = filtered[0];
  chosen.assignedMissionCount++;
  return chosen.unitId;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Normalize platform name for consistent matching */
function normalizePlatform(name: string): string {
  return name.trim().toLowerCase();
}
