/**
 * Unit tests for inject-locator.ts — entity-reference coordinate resolver.
 *
 * Tests the findBestEntityMatch function in isolation (pure logic, no DB).
 * Integration tests cover the full locateInjects pipeline with seeded data.
 */
import { describe, expect, it } from 'vitest';
import { findBestEntityMatch } from '../../services/inject-locator.js';

// ─── Entity Location Fixtures ────────────────────────────────────────────────

const ENTITIES = [
  { name: 'Kadena Air Base', lat: 26.35, lon: 127.77, type: 'Base' as const },
  { name: 'Yokosuka Naval Base', lat: 35.28, lon: 139.65, type: 'Base' as const },
  { name: 'Misawa Air Base', lat: 40.70, lon: 141.37, type: 'Base' as const },
  { name: '18th Wing', lat: 26.35, lon: 127.77, type: 'Unit' as const },
  { name: 'CSG-5', lat: 35.28, lon: 139.65, type: 'Unit' as const },
  { name: 'CVW-5', lat: 35.28, lon: 139.65, type: 'Unit' as const },
  { name: 'DESRON-15', lat: 35.28, lon: 139.65, type: 'Unit' as const },
  { name: 'Mainland Airbase Alpha', lat: 25.0, lon: 121.5, type: 'Base' as const },
  { name: 'Kadena', lat: 26.35, lon: 127.77, type: 'Base' as const },
];

// ═══════════════════════════════════════════════════════════════════════════════
// ENTITY MATCHING
// ═══════════════════════════════════════════════════════════════════════════════

describe('findBestEntityMatch', () => {
  it('matches exact base name in inject description', () => {
    const match = findBestEntityMatch(
      'Radar system failure at Kadena Air Base affecting 18th Wing ATO execution',
      ENTITIES,
    );
    expect(match).not.toBeNull();
    expect(match!.name).toBe('Kadena Air Base');
    expect(match!.lat).toBe(26.35);
  });

  it('prefers longer match over shorter substring', () => {
    // "Kadena Air Base" (15 chars) should beat "Kadena" (6 chars)
    const match = findBestEntityMatch(
      'Emergency landing at Kadena Air Base',
      ENTITIES,
    );
    expect(match).not.toBeNull();
    expect(match!.name).toBe('Kadena Air Base');
  });

  it('matches unit designations', () => {
    const match = findBestEntityMatch(
      'CSG-5 reports submarine contact east of Okinawa',
      ENTITIES,
    );
    expect(match).not.toBeNull();
    expect(match!.name).toBe('CSG-5');
    expect(match!.lat).toBe(35.28);
  });

  it('returns null when no entity matches', () => {
    const match = findBestEntityMatch(
      'Weather forecast shows clear skies',
      ENTITIES,
    );
    expect(match).toBeNull();
  });

  it('is case-insensitive', () => {
    const match = findBestEntityMatch(
      'KADENA AIR BASE reports FOD incident',
      ENTITIES,
    );
    expect(match).not.toBeNull();
    expect(match!.name).toBe('Kadena Air Base');
  });

  it('matches from inject fromEntity/toEntity fields joined as text', () => {
    // Simulates how the locator joins all text fields
    const combinedText = [
      'Runway closure',           // title
      'Runway damaged',           // description
      'Operations impacted',      // impact
      'INDOPACOM J2',             // fromEntity
      'Misawa Air Base OPS',      // toEntity — should match this
    ].join(' ');

    const match = findBestEntityMatch(combinedText, ENTITIES);
    expect(match).not.toBeNull();
    expect(match!.name).toBe('Misawa Air Base');
  });

  it('handles OPFOR base matching', () => {
    const match = findBestEntityMatch(
      'SIGINT detected increased activity at Mainland Airbase Alpha',
      ENTITIES,
    );
    expect(match).not.toBeNull();
    expect(match!.name).toBe('Mainland Airbase Alpha');
    expect(match!.lat).toBe(25.0);
  });

  it('handles multiple entity mentions — picks longest', () => {
    // "Yokosuka Naval Base" (19 chars) is longer than "CSG-5" (5 chars)
    const match = findBestEntityMatch(
      'CSG-5 departed Yokosuka Naval Base heading south',
      ENTITIES,
    );
    expect(match).not.toBeNull();
    expect(match!.name).toBe('Yokosuka Naval Base');
  });
});
