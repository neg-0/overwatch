/**
 * aco-parser.ts — Extracts structured airspace geospatial data from ACO prose
 *
 * POC1 AIRGAP PATTERN:
 *   LLM generates ACO prose → stored as PlanningDocument → THIS PARSER reads
 *   the prose text and extracts coordinate-bearing structures → writes to
 *   AirspaceStructure model → MapView renders from the model.
 *
 *   The LLM NEVER writes directly to AirspaceStructure. This parser is the
 *   only bridge between prose documents and structured map data.
 */

import prisma from '../db/prisma-client.js';

// ─── Coordinate Parsing ──────────────────────────────────────────────────────

/**
 * Parses military coordinate format: "22°15.00'N, 131°20.00'E" → { lat, lon }
 * Also handles: "22°15.00'S, 131°20.00'W"
 */
function parseDMSCoord(coordStr: string): { lat: number; lon: number } | null {
  // Pattern: degrees°minutes'N/S, degrees°minutes'E/W
  const re = /(\d+)[°]\s*(\d+(?:\.\d+)?)['\u2019]?\s*([NS]),?\s*(\d+)[°]\s*(\d+(?:\.\d+)?)['\u2019]?\s*([EW])/;
  const match = coordStr.match(re);
  if (!match) return null;

  let lat = parseFloat(match[1]) + parseFloat(match[2]) / 60;
  let lon = parseFloat(match[4]) + parseFloat(match[5]) / 60;
  if (match[3] === 'S') lat = -lat;
  if (match[6] === 'W') lon = -lon;

  return { lat, lon };
}

/**
 * Extracts all DMS coordinates from a text block.
 */
function extractAllCoords(text: string): Array<{ lat: number; lon: number }> {
  const re = /\d+[°]\s*\d+(?:\.\d+)?['\u2019]?\s*[NS],?\s*\d+[°]\s*\d+(?:\.\d+)?['\u2019]?\s*[EW]/g;
  const coords: Array<{ lat: number; lon: number }> = [];
  let match;
  while ((match = re.exec(text)) !== null) {
    const parsed = parseDMSCoord(match[0]);
    if (parsed) coords.push(parsed);
  }
  return coords;
}

/**
 * Parses altitude blocks like "Surface to FL350" or "FL200–FL300"
 */
function parseAltitudeBlock(text: string): { low: number | null; high: number | null } {
  const flPattern = /FL(\d+)/gi;
  const surfaceHigh = /Surface to FL(\d+)/i;
  const surfMatch = text.match(surfaceHigh);
  if (surfMatch) {
    return { low: 0, high: parseInt(surfMatch[1]) * 100 }; // FL350 → 35000 ft
  }
  const flMatches = [...text.matchAll(flPattern)];
  if (flMatches.length >= 2) {
    return {
      low: parseInt(flMatches[0][1]) * 100,
      high: parseInt(flMatches[1][1]) * 100,
    };
  }
  return { low: null, high: null };
}

/**
 * Parses radius from text like "30 NM radius" or "60 NM"
 */
function parseRadius(text: string): number | null {
  const match = text.match(/(\d+)\s*NM/i);
  return match ? parseInt(match[1]) : null;
}

// ─── Section Parsers ─────────────────────────────────────────────────────────

interface ParsedStructure {
  structureType: string;
  name: string;
  coords: Array<{ lat: number; lon: number }>;
  centerLat?: number;
  centerLon?: number;
  radiusNm?: number;
  altLow: number | null;
  altHigh: number | null;
}

/**
 * Splits ACO text into numbered sections and parses each.
 */
function parseACOText(text: string): ParsedStructure[] {
  const structures: ParsedStructure[] = [];

  // Split by major section headers (numbered: "2. RESTRICTED OPERATING ZONES")
  const sectionPattern = /\n\d+\.\s+([A-Z][A-Z\s()]+)\n/g;
  const sections: Array<{ title: string; start: number; end: number }> = [];
  let match;
  while ((match = sectionPattern.exec(text)) !== null) {
    if (sections.length > 0) {
      sections[sections.length - 1].end = match.index;
    }
    sections.push({ title: match[1].trim(), start: match.index, end: text.length });
  }

  for (const section of sections) {
    const content = text.slice(section.start, section.end);

    if (section.title.includes('RESTRICTED OPERATING ZONES') || section.title.includes('ROZ')) {
      structures.push(...parseROZSection(content));
    } else if (section.title.includes('AIR REFUELING')) {
      structures.push(...parseARTSection(content));
    } else if (section.title.includes('COMBAT AIR PATROL') || section.title.includes('CAP')) {
      structures.push(...parseCAPSection(content));
    } else if (section.title.includes('TRANSIT CORRIDORS')) {
      structures.push(...parseCorridorSection(content));
    } else if (section.title.includes('KILL BOX')) {
      structures.push(...parseKillBoxSection(content));
    } else if (section.title.includes('HIGH DENSITY') || section.title.includes('HIDACZ')) {
      structures.push(...parseHIDACZSection(content));
    } else if (section.title.includes('MINIMUM RISK ROUTES') || section.title.includes('MRR')) {
      structures.push(...parseMRRSection(content));
    }
  }

  return structures;
}

function parseROZSection(text: string): ParsedStructure[] {
  const structures: ParsedStructure[] = [];
  // Split by ROZ sub-entries: "ROZ-01 "NAME""
  const entries = text.split(/(?=ROZ-\d+)/);
  for (const entry of entries) {
    const nameMatch = entry.match(/ROZ-\d+\s+"([^"]+)"/);
    if (!nameMatch) continue;
    const coords = extractAllCoords(entry);
    const alt = parseAltitudeBlock(entry);
    if (coords.length >= 3) {
      structures.push({
        structureType: 'ROZ',
        name: nameMatch[1],
        coords,
        altLow: alt.low,
        altHigh: alt.high,
      });
    }
  }
  return structures;
}

function parseARTSection(text: string): ParsedStructure[] {
  const structures: ParsedStructure[] = [];
  const entries = text.split(/(?=AR-\d+)/);
  for (const entry of entries) {
    const nameMatch = entry.match(/AR-\d+\s+(\w+(?:\s+\w+)?)/);
    if (!nameMatch) continue;
    const coords = extractAllCoords(entry);
    const alt = parseAltitudeBlock(entry);
    const lengthMatch = entry.match(/(\d+)\s*NM\s*length/i);
    if (coords.length >= 1) {
      structures.push({
        structureType: 'ART',
        name: `AR ${nameMatch[1]}`,
        coords,
        centerLat: coords[0].lat,
        centerLon: coords[0].lon,
        radiusNm: lengthMatch ? parseInt(lengthMatch[1]) / 2 : undefined,
        altLow: alt.low,
        altHigh: alt.high,
      });
    }
  }
  return structures;
}

function parseCAPSection(text: string): ParsedStructure[] {
  const structures: ParsedStructure[] = [];
  const entries = text.split(/(?=CAP-[A-Z]+)/);
  for (const entry of entries) {
    const nameMatch = entry.match(/CAP-([A-Z]+)\s*\(([^)]+)\)/);
    if (!nameMatch) continue;
    const coords = extractAllCoords(entry);
    const radius = parseRadius(entry);
    const alt = parseAltitudeBlock(entry);
    if (coords.length >= 1) {
      structures.push({
        structureType: 'CAP',
        name: `CAP-${nameMatch[1]} (${nameMatch[2]})`,
        coords,
        centerLat: coords[0].lat,
        centerLon: coords[0].lon,
        radiusNm: radius || 30,
        altLow: alt.low,
        altHigh: alt.high,
      });
    }
  }
  return structures;
}

function parseCorridorSection(text: string): ParsedStructure[] {
  const structures: ParsedStructure[] = [];
  const entries = text.split(/(?=CORRIDOR-\d+)/);
  for (const entry of entries) {
    const nameMatch = entry.match(/CORRIDOR-\d+\s+"([^"]+)"/);
    if (!nameMatch) continue;
    const coords = extractAllCoords(entry);
    const alt = parseAltitudeBlock(entry);
    if (coords.length >= 2) {
      structures.push({
        structureType: 'CORRIDOR',
        name: nameMatch[1],
        coords,
        altLow: alt.low,
        altHigh: alt.high,
      });
    }
  }
  return structures;
}

function parseKillBoxSection(text: string): ParsedStructure[] {
  const structures: ParsedStructure[] = [];
  const entries = text.split(/(?=KILLBOX-[A-Z0-9]+)/);
  for (const entry of entries) {
    const nameMatch = entry.match(/KILLBOX-([A-Z0-9]+)\s+"([^"]+)"/);
    if (!nameMatch) continue;
    const alt = parseAltitudeBlock(entry);
    // Kill boxes use GARS references — no explicit corner coords
    // We can't place them without a GARS decoder, so store as name-only with empty coords
    const garsMatch = entry.match(/GARS[:\s]*(\d+)/);
    structures.push({
      structureType: 'KILLBOX',
      name: `${nameMatch[1]} - ${nameMatch[2]}`,
      coords: [], // GARS grid — would need GARS-to-latlon converter
      altLow: alt.low,
      altHigh: alt.high,
    });
  }
  return structures;
}

function parseHIDACZSection(text: string): ParsedStructure[] {
  const structures: ParsedStructure[] = [];
  const entries = text.split(/(?=HIDACZ-[A-Z]+)/);
  for (const entry of entries) {
    const nameMatch = entry.match(/HIDACZ-(\w+)\s+"([^"]+)"/);
    if (!nameMatch) continue;
    const coords = extractAllCoords(entry);
    const radius = parseRadius(entry);
    const alt = parseAltitudeBlock(entry);
    if (coords.length >= 1) {
      structures.push({
        structureType: 'HIDACZ',
        name: `${nameMatch[1]} - ${nameMatch[2]}`,
        coords,
        centerLat: coords[0].lat,
        centerLon: coords[0].lon,
        radiusNm: radius || 40,
        altLow: alt.low,
        altHigh: alt.high,
      });
    }
  }
  return structures;
}

function parseMRRSection(text: string): ParsedStructure[] {
  const structures: ParsedStructure[] = [];
  const entries = text.split(/(?=MRR-[A-Z])/);
  for (const entry of entries) {
    const nameMatch = entry.match(/MRR-([A-Z])\s+"([^"]+)"/);
    if (!nameMatch) continue;
    const coords = extractAllCoords(entry);
    const alt = parseAltitudeBlock(entry);
    if (coords.length >= 2) {
      structures.push({
        structureType: 'MRR',
        name: nameMatch[2],
        coords,
        altLow: alt.low,
        altHigh: alt.high,
      });
    }
  }
  return structures;
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

/**
 * Parses an ACO PlanningDocument and creates AirspaceStructure records.
 * Called AFTER the ACO document is generated and stored.
 *
 * AIRGAP: This function reads from PlanningDocument.content (LLM prose)
 * and writes to AirspaceStructure (structured map data). The LLM never
 * writes to AirspaceStructure directly.
 */
export async function parseACOToStructures(
  scenarioId: string,
  acoDocId: string,
): Promise<number> {
  // Read the ACO prose from the planning document
  const doc = await prisma.planningDocument.findUnique({
    where: { id: acoDocId },
    select: { content: true },
  });

  if (!doc?.content) {
    console.warn(`[ACO-PARSER] No content found for document ${acoDocId}`);
    return 0;
  }

  // Parse structures from the prose
  const structures = parseACOText(doc.content);

  if (structures.length === 0) {
    console.log('[ACO-PARSER] No airspace structures found in ACO document');
    return 0;
  }

  // Delete existing structures for this scenario (idempotent re-parse)
  await prisma.airspaceStructure.deleteMany({ where: { scenarioId } });

  // Write structured data to DB
  let created = 0;
  for (const s of structures) {
    try {
      await prisma.airspaceStructure.create({
        data: {
          scenarioId,
          structureType: s.structureType,
          name: s.name,
          coordinatesJson: s.coords,
          centerLat: s.centerLat ?? null,
          centerLon: s.centerLon ?? null,
          radiusNm: s.radiusNm ?? null,
          altitudeLow: s.altLow,
          altitudeHigh: s.altHigh,
          sourceDocId: acoDocId,
        },
      });
      created++;
    } catch (err) {
      console.warn(`[ACO-PARSER] Failed to create structure ${s.name}:`, err);
    }
  }

  console.log(`[ACO-PARSER] Created ${created} airspace structures from ACO document`);
  return created;
}

// Export parsing utilities for unit testing
export {
  parseDMSCoord,
  extractAllCoords,
  parseAltitudeBlock,
  parseRadius,
  parseACOText,
};
