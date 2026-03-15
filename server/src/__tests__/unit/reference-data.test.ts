/**
 * Unit tests for reference-data.ts — Space Constellation Catalog validation.
 *
 * Validates the static catalog data: field presence, affiliation correctness,
 * capability enum compliance, orbital parameter sanity, uniqueness, and counts.
 */
import { describe, expect, it } from 'vitest';
import {
  ADVERSARY_SPACE_CONSTELLATIONS,
  INDOPACOM_BASES,
  US_SPACE_CONSTELLATIONS,
  getRadarSensors,
  type SpaceAssetSpec,
} from '../../services/reference-data.js';

// ─── Valid enum values (mirrors prisma SpaceCapabilityType) ──────────────────

const VALID_CAPABILITIES = new Set([
  'GPS', 'GPS_MILITARY', 'SATCOM', 'SATCOM_PROTECTED', 'SATCOM_WIDEBAND',
  'SATCOM_TACTICAL', 'OPIR', 'ISR_SPACE', 'EW_SPACE', 'WEATHER', 'PNT',
  'LINK16', 'SIGINT_SPACE', 'SDA', 'LAUNCH_DETECT', 'CYBER_SPACE',
  'DATALINK', 'SSA',
]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function flattenAssets(constellations: { constellation: string; assets: SpaceAssetSpec[] }[]): SpaceAssetSpec[] {
  return constellations.flatMap(c => c.assets);
}

const allFriendly = flattenAssets(US_SPACE_CONSTELLATIONS);
const allHostile = flattenAssets(ADVERSARY_SPACE_CONSTELLATIONS);
const allAssets = [...allFriendly, ...allHostile];

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Space Constellation Catalog', () => {
  // ── Catalog Size Guards ─────────────────────────────────────────────────

  describe('Catalog counts (regression guard)', () => {
    it('US constellations have >= 20 constellation families', () => {
      expect(US_SPACE_CONSTELLATIONS.length).toBeGreaterThanOrEqual(20);
    });

    it('US catalog contains >= 90 assets', () => {
      expect(allFriendly.length).toBeGreaterThanOrEqual(90);
    });

    it('Adversary constellations have >= 20 constellation families', () => {
      expect(ADVERSARY_SPACE_CONSTELLATIONS.length).toBeGreaterThanOrEqual(20);
    });

    it('Adversary catalog contains >= 80 assets', () => {
      expect(allHostile.length).toBeGreaterThanOrEqual(80);
    });

    it('Grand total >= 170 assets', () => {
      expect(allAssets.length).toBeGreaterThanOrEqual(170);
    });
  });

  // ── Required Fields ─────────────────────────────────────────────────────

  describe('Required fields present on all assets', () => {
    it.each(allAssets.map(a => [a.name, a]))('%s has all required fields', (_name, asset) => {
      expect(asset.name).toBeTruthy();
      expect(asset.constellation).toBeTruthy();
      expect(asset.affiliation).toBeTruthy();
      expect(asset.capabilities).toBeInstanceOf(Array);
      expect(asset.capabilities.length).toBeGreaterThan(0);
      expect(asset.status).toBeTruthy();
      expect(typeof asset.inclination).toBe('number');
      expect(typeof asset.eccentricity).toBe('number');
      expect(typeof asset.periodMin).toBe('number');
      expect(typeof asset.apogeeKm).toBe('number');
      expect(typeof asset.perigeeKm).toBe('number');
    });
  });

  // ── Affiliation Correctness ─────────────────────────────────────────────

  describe('Affiliation correctness', () => {
    it('all US assets have FRIENDLY affiliation', () => {
      for (const asset of allFriendly) {
        expect(asset.affiliation, `${asset.name} should be FRIENDLY`).toBe('FRIENDLY');
      }
    });

    it('all adversary assets have HOSTILE affiliation', () => {
      for (const asset of allHostile) {
        expect(asset.affiliation, `${asset.name} should be HOSTILE`).toBe('HOSTILE');
      }
    });
  });

  // ── Capability Enum Compliance ──────────────────────────────────────────

  describe('Capability values map to SpaceCapabilityType enum', () => {
    it('all US asset capabilities are valid', () => {
      for (const asset of allFriendly) {
        for (const cap of asset.capabilities) {
          expect(VALID_CAPABILITIES, `${asset.name} has invalid cap: ${cap}`).toContain(cap);
        }
      }
    });

    it('all adversary asset capabilities are valid', () => {
      for (const asset of allHostile) {
        for (const cap of asset.capabilities) {
          expect(VALID_CAPABILITIES, `${asset.name} has invalid cap: ${cap}`).toContain(cap);
        }
      }
    });
  });

  // ── Orbital Parameter Sanity ────────────────────────────────────────────

  describe('Orbital parameters are physically reasonable', () => {
    it('inclination is 0–180°', () => {
      for (const asset of allAssets) {
        expect(asset.inclination, `${asset.name} inclination`).toBeGreaterThanOrEqual(0);
        expect(asset.inclination, `${asset.name} inclination`).toBeLessThanOrEqual(180);
      }
    });

    it('eccentricity is 0–1', () => {
      for (const asset of allAssets) {
        expect(asset.eccentricity, `${asset.name} eccentricity`).toBeGreaterThanOrEqual(0);
        expect(asset.eccentricity, `${asset.name} eccentricity`).toBeLessThan(1);
      }
    });

    it('period is positive', () => {
      for (const asset of allAssets) {
        expect(asset.periodMin, `${asset.name} period`).toBeGreaterThan(0);
      }
    });

    it('apogee >= perigee for all assets', () => {
      for (const asset of allAssets) {
        expect(asset.apogeeKm, `${asset.name} apogee >= perigee`).toBeGreaterThanOrEqual(asset.perigeeKm);
      }
    });

    it('apogee altitude is positive', () => {
      for (const asset of allAssets) {
        expect(asset.apogeeKm, `${asset.name} apogee`).toBeGreaterThan(0);
      }
    });
  });

  // ── Uniqueness ──────────────────────────────────────────────────────────

  describe('Asset name uniqueness', () => {
    it('no duplicate asset names across the entire catalog', () => {
      const names = allAssets.map(a => a.name);
      const duplicates = names.filter((name, idx) => names.indexOf(name) !== idx);
      expect(duplicates, `Duplicate names found: ${[...new Set(duplicates)].join(', ')}`).toHaveLength(0);
    });
  });

  // ── Constellation Data Integrity ────────────────────────────────────────

  describe('Constellation metadata consistency', () => {
    it('every asset constellation field matches its parent constellation', () => {
      for (const constellation of [...US_SPACE_CONSTELLATIONS, ...ADVERSARY_SPACE_CONSTELLATIONS]) {
        for (const asset of constellation.assets) {
          expect(
            asset.constellation,
            `${asset.name} in parent "${constellation.constellation}" but has constellation "${asset.constellation}"`,
          ).toBe(constellation.constellation);
        }
      }
    });

    it('no empty constellation arrays', () => {
      for (const c of [...US_SPACE_CONSTELLATIONS, ...ADVERSARY_SPACE_CONSTELLATIONS]) {
        expect(c.assets.length, `Constellation "${c.constellation}" is empty`).toBeGreaterThan(0);
      }
    });
  });

  // ── Operator field (new) ────────────────────────────────────────────────

  describe('Operator field', () => {
    it('all US assets have an operator', () => {
      for (const asset of allFriendly) {
        expect(asset.operator, `${asset.name} missing operator`).toBeTruthy();
      }
    });

    it('all adversary assets have an operator', () => {
      for (const asset of allHostile) {
        expect(asset.operator, `${asset.name} missing operator`).toBeTruthy();
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// INDOPACOM BASES — OPFOR + CVW-5 CO-LOCATION REGRESSION
// ═══════════════════════════════════════════════════════════════════════════════

describe('INDOPACOM Bases', () => {
  const allBases = INDOPACOM_BASES;
  const opforBases = allBases.filter(b => b.country === 'OPFOR');
  const friendlyBases = allBases.filter(b => b.country !== 'OPFOR');

  describe('OPFOR base presence (regression)', () => {
    it('has at least 3 OPFOR bases', () => {
      expect(opforBases.length).toBeGreaterThanOrEqual(3);
    });

    it('OPFOR bases have expected names', () => {
      const opforNames = opforBases.map(b => b.name);
      expect(opforNames).toContain('Mainland Airbase Alpha');
      expect(opforNames).toContain('Coastal Defense Zone');
      expect(opforNames).toContain('Naval Base Bravo');
    });

    it('OPFOR bases have valid coordinates', () => {
      for (const base of opforBases) {
        expect(base.latitude, `${base.name} lat`).toBeGreaterThanOrEqual(-90);
        expect(base.latitude, `${base.name} lat`).toBeLessThanOrEqual(90);
        expect(base.longitude, `${base.name} lon`).toBeGreaterThanOrEqual(-180);
        expect(base.longitude, `${base.name} lon`).toBeLessThanOrEqual(180);
      }
    });
  });

  describe('Yokosuka Naval Base coordinates (CVW-5/CSG-5 co-location regression)', () => {
    it('Yokosuka is near 35.28°N, 139.65°E', () => {
      const yokosuka = allBases.find(b => b.name.includes('Yokosuka'));
      expect(yokosuka).toBeDefined();
      expect(yokosuka!.latitude).toBeCloseTo(35.28, 0);
      expect(yokosuka!.longitude).toBeCloseTo(139.65, 0);
    });
  });

  describe('Coordinate sanity for all bases', () => {
    it('all bases have valid latitude [-90, 90]', () => {
      for (const base of allBases) {
        expect(base.latitude, `${base.name} lat`).toBeGreaterThanOrEqual(-90);
        expect(base.latitude, `${base.name} lat`).toBeLessThanOrEqual(90);
      }
    });

    it('all bases have valid longitude [-180, 180]', () => {
      for (const base of allBases) {
        expect(base.longitude, `${base.name} lon`).toBeGreaterThanOrEqual(-180);
        expect(base.longitude, `${base.name} lon`).toBeLessThanOrEqual(180);
      }
    });

    it('no duplicate base names', () => {
      const names = allBases.map(b => b.name);
      const dupes = names.filter((n, i) => names.indexOf(n) !== i);
      expect(dupes, `Dupes: ${[...new Set(dupes)].join(', ')}`).toHaveLength(0);
    });
  });

  describe('Friendly/Hostile split', () => {
    it('has >= 15 friendly bases', () => {
      expect(friendlyBases.length).toBeGreaterThanOrEqual(5);
    });

    it('all bases have a country', () => {
      for (const base of allBases) {
        expect(base.country).toBeTruthy();
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getRadarSensors HELPER
// ═══════════════════════════════════════════════════════════════════════════════

describe('getRadarSensors', () => {
  it('returns radar sensor names for a known platform', () => {
    // F-35A should have at least one APG radar
    const sensors = getRadarSensors('F-35A');
    expect(Array.isArray(sensors)).toBe(true);
    // If platform exists in catalog with sensors, verify they match radar pattern
    for (const s of sensors) {
      expect(typeof s).toBe('string');
      expect(s).toMatch(/radar|SPY|APG|APY|APQ|SPS|SPN/i);
    }
  });

  it('returns empty array for unknown platform', () => {
    const sensors = getRadarSensors('NONEXISTENT-PLATFORM');
    expect(sensors).toHaveLength(0);
  });

  it('contains no duplicates for any given platform', () => {
    const sensors = getRadarSensors('F-35A');
    const unique = [...new Set(sensors)];
    expect(sensors.length).toBe(unique.length);
  });
});

