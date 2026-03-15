/**
 * Unit tests for aco-parser.ts — POC1 airgap pattern parser.
 *
 * Tests coordinate parsing (DMS), altitude block extraction, radius parsing,
 * full ACO section parsing (ROZ, ART, CAP, corridors, MRR), and edge cases.
 *
 * Pure logic — no database required.
 */
import { describe, expect, it } from 'vitest';
import {
  extractAllCoords,
  parseACOText,
  parseAltitudeBlock,
  parseDMSCoord,
  parseRadius,
} from '../../services/aco-parser.js';

// ═══════════════════════════════════════════════════════════════════════════════
// DMS COORDINATE PARSING
// ═══════════════════════════════════════════════════════════════════════════════

describe('parseDMSCoord', () => {
  it('parses North/East coordinate', () => {
    const result = parseDMSCoord("22°15.00'N, 131°20.00'E");
    expect(result).not.toBeNull();
    expect(result!.lat).toBeCloseTo(22.25, 2);
    expect(result!.lon).toBeCloseTo(131.333, 2);
  });

  it('parses South/West coordinate', () => {
    const result = parseDMSCoord("34°30.00'S, 58°22.50'W");
    expect(result).not.toBeNull();
    expect(result!.lat).toBeCloseTo(-34.5, 2);
    expect(result!.lon).toBeCloseTo(-58.375, 2);
  });

  it('handles zero minutes', () => {
    const result = parseDMSCoord("0°0.00'N, 0°0.00'E");
    expect(result).not.toBeNull();
    expect(result!.lat).toBe(0);
    expect(result!.lon).toBe(0);
  });

  it('returns null for invalid input', () => {
    expect(parseDMSCoord('not a coordinate')).toBeNull();
    expect(parseDMSCoord('26.35, 127.77')).toBeNull(); // decimal format, not DMS
  });

  it('handles smart quotes in minutes', () => {
    const result = parseDMSCoord("22°15.00\u2019N, 131°20.00\u2019E");
    expect(result).not.toBeNull();
    expect(result!.lat).toBeCloseTo(22.25, 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXTRACT ALL COORDINATES
// ═══════════════════════════════════════════════════════════════════════════════

describe('extractAllCoords', () => {
  it('extracts multiple coordinates from text block', () => {
    const text = `
      Corner A: 22°15.00'N, 131°20.00'E
      Corner B: 22°45.00'N, 131°50.00'E
      Corner C: 22°00.00'N, 132°00.00'E
    `;
    const coords = extractAllCoords(text);
    expect(coords).toHaveLength(3);
    expect(coords[0].lat).toBeCloseTo(22.25, 2);
    expect(coords[2].lon).toBeCloseTo(132.0, 2);
  });

  it('returns empty array for text with no coordinates', () => {
    expect(extractAllCoords('No coordinates here')).toHaveLength(0);
  });

  it('handles coordinates embedded in prose', () => {
    const text = `The ROZ extends from 22°15.00'N, 131°20.00'E to 23°00.00'N, 132°00.00'E and is effective from 0600Z.`;
    const coords = extractAllCoords(text);
    expect(coords).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ALTITUDE BLOCK PARSING
// ═══════════════════════════════════════════════════════════════════════════════

describe('parseAltitudeBlock', () => {
  it('parses "Surface to FLxxx"', () => {
    const result = parseAltitudeBlock('Surface to FL350');
    expect(result.low).toBe(0);
    expect(result.high).toBe(35000);
  });

  it('parses "FLxxx–FLxxx" range', () => {
    const result = parseAltitudeBlock('FL200–FL300');
    expect(result.low).toBe(20000);
    expect(result.high).toBe(30000);
  });

  it('returns nulls for text without altitude info', () => {
    const result = parseAltitudeBlock('No altitude information here');
    expect(result.low).toBeNull();
    expect(result.high).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RADIUS PARSING
// ═══════════════════════════════════════════════════════════════════════════════

describe('parseRadius', () => {
  it('parses "30 NM radius"', () => {
    expect(parseRadius('30 NM radius')).toBe(30);
  });

  it('parses "60NM"', () => {
    expect(parseRadius('60NM')).toBe(60);
  });

  it('returns null for text without radius', () => {
    expect(parseRadius('no radius info')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FULL ACO DOCUMENT PARSING
// ═══════════════════════════════════════════════════════════════════════════════

describe('parseACOText', () => {
  it('extracts ROZ structures from correctly formatted ACO text', () => {
    const acoText = `
AIRSPACE CONTROL ORDER – PACIFIC DEFENDER 26-1
Authorizing Commander: CFACC/613 AOC
Effective Period: 130600ZMAR26 – 140600ZMAR26

1. GENERAL
This ACO establishes airspace control measures for ATO Day 1.

2. RESTRICTED OPERATING ZONES (ROZ)

ROZ-01 "TAROKA SHOAL"
Corners:
  22°15.00'N, 131°20.00'E
  22°45.00'N, 131°50.00'E
  22°00.00'N, 132°00.00'E
  21°45.00'N, 131°10.00'E
Altitude: Surface to FL350
Effective: 130600Z – 140600Z

ROZ-02 "BASHI CHANNEL"
Corners:
  20°30.00'N, 121°00.00'E
  21°00.00'N, 121°30.00'E
  20°45.00'N, 122°00.00'E
Altitude: Surface to FL250
Effective: 130600Z – 140600Z

3. AIR REFUELING TRACKS
No ART defined in this period.
`;
    const structures = parseACOText(acoText);
    const rozStructures = structures.filter(s => s.structureType === 'ROZ');
    expect(rozStructures).toHaveLength(2);

    const taroka = rozStructures.find(s => s.name === 'TAROKA SHOAL');
    expect(taroka).toBeDefined();
    expect(taroka!.coords).toHaveLength(4);
    expect(taroka!.altHigh).toBe(35000);
    expect(taroka!.altLow).toBe(0);

    const bashi = rozStructures.find(s => s.name === 'BASHI CHANNEL');
    expect(bashi).toBeDefined();
    expect(bashi!.coords).toHaveLength(3);
    expect(bashi!.altHigh).toBe(25000);
  });

  it('extracts CAP stations from ACO text', () => {
    const acoText = `
1. GENERAL
General information.

2. COMBAT AIR PATROL (CAP) STATIONS

CAP-ALPHA (Defensive)
Center: 25°00.00'N, 125°00.00'E
30 NM radius
Altitude: FL200–FL350

CAP-BRAVO (Offensive)
Center: 22°00.00'N, 130°00.00'E
40 NM radius
Altitude: FL250–FL400

3. TRANSIT CORRIDORS
None.
`;
    const structures = parseACOText(acoText);
    const caps = structures.filter(s => s.structureType === 'CAP');
    expect(caps).toHaveLength(2);

    const alpha = caps.find(s => s.name.includes('ALPHA'));
    expect(alpha).toBeDefined();
    expect(alpha!.centerLat).toBeCloseTo(25.0, 1);
    expect(alpha!.centerLon).toBeCloseTo(125.0, 1);
    expect(alpha!.radiusNm).toBe(30);
  });

  it('extracts corridors from ACO text', () => {
    const acoText = `
1. GENERAL
General information.

2. TRANSIT CORRIDORS

CORRIDOR-01 "KADENA EAST"
Entry: 26°30.00'N, 128°00.00'E
Exit: 24°00.00'N, 130°00.00'E
Altitude: FL250–FL350
Width: 20 NM

3. KILL BOXES
None.
`;
    const structures = parseACOText(acoText);
    const corridors = structures.filter(s => s.structureType === 'CORRIDOR');
    expect(corridors).toHaveLength(1);
    expect(corridors[0].name).toBe('KADENA EAST');
    expect(corridors[0].coords).toHaveLength(2);
  });

  it('extracts MRR routes from ACO text', () => {
    const acoText = `
1. GENERAL
General information.

2. MINIMUM RISK ROUTES (MRR)

MRR-A "NORTHERN INGRESS"
Waypoints:
  28°00.00'N, 126°00.00'E
  26°00.00'N, 128°00.00'E
  24°00.00'N, 130°00.00'E
Altitude: FL200–FL250

3. RESTRICTED OPERATING ZONES
None.
`;
    const structures = parseACOText(acoText);
    const mrrs = structures.filter(s => s.structureType === 'MRR');
    expect(mrrs).toHaveLength(1);
    expect(mrrs[0].name).toBe('NORTHERN INGRESS');
    expect(mrrs[0].coords).toHaveLength(3);
  });

  it('returns empty array for text with no airspace structures', () => {
    const structures = parseACOText('This is just a regular memo with no airspace data.');
    expect(structures).toHaveLength(0);
  });

  it('handles multiple section types in a single document', () => {
    const acoText = `
1. GENERAL
General information.

2. RESTRICTED OPERATING ZONES (ROZ)

ROZ-01 "SOUTH BASIN"
Corners:
  20°15.00'N, 121°20.00'E
  20°45.00'N, 121°50.00'E
  20°00.00'N, 122°00.00'E
Altitude: Surface to FL250

3. COMBAT AIR PATROL (CAP) STATIONS

CAP-DELTA (Escort)
Center: 24°00.00'N, 126°00.00'E
25 NM radius
Altitude: FL200–FL350

4. TRANSIT CORRIDORS

CORRIDOR-01 "WEST LANE"
Entry: 26°00.00'N, 128°00.00'E
Exit: 24°00.00'N, 130°00.00'E
Altitude: FL250–FL350
`;
    const structures = parseACOText(acoText);
    expect(structures.filter(s => s.structureType === 'ROZ')).toHaveLength(1);
    expect(structures.filter(s => s.structureType === 'CAP')).toHaveLength(1);
    expect(structures.filter(s => s.structureType === 'CORRIDOR')).toHaveLength(1);
    expect(structures.length).toBe(3);
  });
});
