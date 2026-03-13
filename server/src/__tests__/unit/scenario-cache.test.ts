/**
 * Unit tests for ScenarioCache — in-memory cache for offline mode.
 */
import { GenerationStatus } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';

// We import the class via the module-level singleton. Since ScenarioCache
// is a plain class with no external deps, we can test directly.
import { scenarioCache, type CachedScenario } from '../../services/scenario-cache.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCachedScenario(overrides: Partial<CachedScenario> = {}): CachedScenario {
  const now = new Date();
  return {
    id: overrides.id ?? 'scn-1',
    name: overrides.name ?? 'Test Scenario',
    theater: 'INDOPACOM',
    adversary: 'PRC',
    description: 'Test scenario',
    startDate: new Date(now.getTime() - 3600000),
    endDate: new Date(now.getTime() + 86400000),
    classification: 'UNCLASSIFIED',
    compressionRatio: 720,
    generationStatus: GenerationStatus.COMPLETE,
    generationStep: null,
    generationProgress: 100,
    generationError: null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    strategies: [],
    planningDocs: [],
    taskingOrders: [],
    units: [],
    spaceAssets: [],
    scenarioInjects: [],
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ScenarioCache', () => {
  beforeEach(() => {
    // Clean up the singleton between tests
    for (const s of scenarioCache.getAll()) {
      scenarioCache.delete(s.id);
    }
  });

  describe('set() + get()', () => {
    it('stores and retrieves a scenario by id', () => {
      const scenario = makeCachedScenario({ id: 'scn-set-get' });
      scenarioCache.set('scn-set-get', scenario);

      const retrieved = scenarioCache.get('scn-set-get');
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe('scn-set-get');
      expect(retrieved!.name).toBe('Test Scenario');
    });

    it('returns undefined for missing key', () => {
      expect(scenarioCache.get('nonexistent')).toBeUndefined();
    });

    it('overwrites existing entry with same id', () => {
      scenarioCache.set('scn-1', makeCachedScenario({ name: 'Original' }));
      scenarioCache.set('scn-1', makeCachedScenario({ name: 'Updated' }));

      expect(scenarioCache.get('scn-1')!.name).toBe('Updated');
    });
  });

  describe('getAll()', () => {
    it('returns empty array when cache is empty', () => {
      expect(scenarioCache.getAll()).toEqual([]);
    });

    it('returns all entries sorted by createdAt descending', () => {
      const now = Date.now();
      scenarioCache.set('old', makeCachedScenario({
        id: 'old',
        name: 'Old',
        createdAt: new Date(now - 3600000),
      }));
      scenarioCache.set('new', makeCachedScenario({
        id: 'new',
        name: 'New',
        createdAt: new Date(now),
      }));
      scenarioCache.set('mid', makeCachedScenario({
        id: 'mid',
        name: 'Mid',
        createdAt: new Date(now - 1800000),
      }));

      const all = scenarioCache.getAll();
      expect(all).toHaveLength(3);
      expect(all[0].id).toBe('new');
      expect(all[1].id).toBe('mid');
      expect(all[2].id).toBe('old');
    });
  });

  describe('delete()', () => {
    it('removes an existing entry and returns true', () => {
      scenarioCache.set('scn-del', makeCachedScenario({ id: 'scn-del' }));
      expect(scenarioCache.delete('scn-del')).toBe(true);
      expect(scenarioCache.get('scn-del')).toBeUndefined();
    });

    it('returns false for a nonexistent key', () => {
      expect(scenarioCache.delete('nope')).toBe(false);
    });
  });

  describe('has()', () => {
    it('returns true for existing entry', () => {
      scenarioCache.set('scn-has', makeCachedScenario({ id: 'scn-has' }));
      expect(scenarioCache.has('scn-has')).toBe(true);
    });

    it('returns false for missing entry', () => {
      expect(scenarioCache.has('missing')).toBe(false);
    });
  });

  describe('update()', () => {
    it('merges partial fields into existing entry', () => {
      scenarioCache.set('scn-upd', makeCachedScenario({
        id: 'scn-upd',
        name: 'Before',
        generationProgress: 50,
      }));

      const updated = scenarioCache.update('scn-upd', {
        name: 'After',
        generationProgress: 100,
        generationStatus: GenerationStatus.COMPLETE,
      });

      expect(updated).toBeDefined();
      expect(updated!.name).toBe('After');
      expect(updated!.generationProgress).toBe(100);
      expect(updated!.generationStatus).toBe(GenerationStatus.COMPLETE);
      // Untouched fields preserved
      expect(updated!.theater).toBe('INDOPACOM');
    });

    it('updates updatedAt timestamp', () => {
      const oldDate = new Date('2025-01-01');
      scenarioCache.set('scn-ts', makeCachedScenario({
        id: 'scn-ts',
        updatedAt: oldDate,
      }));

      const before = Date.now();
      const updated = scenarioCache.update('scn-ts', { name: 'Refreshed' });
      const after = Date.now();

      expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(updated!.updatedAt.getTime()).toBeLessThanOrEqual(after);
    });

    it('returns undefined for nonexistent key', () => {
      expect(scenarioCache.update('nope', { name: 'x' })).toBeUndefined();
    });

    it('is reflected in subsequent get() calls', () => {
      scenarioCache.set('scn-reflect', makeCachedScenario({ id: 'scn-reflect', name: 'V1' }));
      scenarioCache.update('scn-reflect', { name: 'V2' });
      expect(scenarioCache.get('scn-reflect')!.name).toBe('V2');
    });
  });
});
