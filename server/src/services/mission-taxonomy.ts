/**
 * Mission taxonomy — canonical mission-type vocabulary.
 *
 * Mission types (`mission.missionType`) and procedure/comm `applicableTo` tokens are
 * both free-text and LLM-generated. To link them reliably they must resolve to a
 * single shared vocabulary. This module is the one place that vocabulary lives.
 *
 * Used by:
 * - knowledge-graph.ts — to build MISSION_TYPE nodes and their edges
 * - doc-ingest.ts — to normalize applicableTo before persisting SPINS/CommPlan rows
 */

/** Canonical mission-type tokens. OTHER is the catch-all for unrecognized input. */
export const CANONICAL_MISSION_TYPES = [
  'OCA',     // Offensive Counter-Air
  'DCA',     // Defensive Counter-Air
  'SEAD',    // Suppression/Destruction of Enemy Air Defenses
  'STRIKE',  // Strike / attack / interdiction of fixed targets
  'CAS',     // Close Air Support
  'AI',      // Air Interdiction
  'ISR',     // Intelligence, Surveillance, Reconnaissance
  'EW',      // Electronic Warfare / Electronic Attack
  'TANKER',  // Air refueling
  'C2',      // Command & Control / AEW / battle management
  'ESCORT',  // Fighter escort
  'CAP',     // Combat Air Patrol
  'CSAR',    // Combat Search & Rescue / personnel recovery
  'AIRLIFT', // Airlift / mobility / transport
  'OTHER',
] as const;

export type CanonicalMissionType = (typeof CANONICAL_MISSION_TYPES)[number];

/** Special applicableTo token meaning "every mission type". */
export const ALL_TOKEN = 'ALL';

/**
 * Keyword → canonical token rules, evaluated in order. The first rule whose
 * keyword appears in the (uppercased) input contributes its canonical token.
 * Multiple rules can match a compound string like "ESCORT/OCA" → [ESCORT, OCA].
 *
 * Order matters only for readability; all matching rules are applied.
 */
const KEYWORD_RULES: { match: string[]; type: CanonicalMissionType }[] = [
  { match: ['SEAD', 'DEAD', 'SUPPRESS', 'ENEMY AIR DEFENS'], type: 'SEAD' },
  { match: ['OCA', 'OFFENSIVE COUNTER'], type: 'OCA' },
  { match: ['DCA', 'DEFENSIVE COUNTER'], type: 'DCA' },
  { match: ['CSAR', 'SEARCH AND RESCUE', 'SEARCH & RESCUE', 'PERSONNEL RECOVERY'], type: 'CSAR' },
  { match: ['CLOSE AIR SUPPORT', 'CAS'], type: 'CAS' },
  { match: ['AIR INTERDICTION', 'INTERDICT'], type: 'AI' },
  { match: ['STRIKE', 'ATTACK', 'BOMBING'], type: 'STRIKE' },
  { match: ['ISR', 'INTELLIGENCE', 'SURVEILLANCE', 'RECON', 'RECCE'], type: 'ISR' },
  { match: ['TANKER', 'REFUEL', 'AAR', 'AIR REFUEL'], type: 'TANKER' },
  { match: ['ELECTRONIC WARFARE', 'ELECTRONIC ATTACK', 'EW', 'EA'], type: 'EW' },
  { match: ['ESCORT'], type: 'ESCORT' },
  { match: ['COMBAT AIR PATROL', 'CAP'], type: 'CAP' },
  { match: ['AIRLIFT', 'TRANSPORT', 'MOBILITY', 'AIRDROP'], type: 'AIRLIFT' },
  { match: ['C2', 'COMMAND AND CONTROL', 'COMMAND & CONTROL', 'AWACS', 'AEW', 'BATTLE MANAGEMENT'], type: 'C2' },
];

/** True when `haystack` contains `needle` as a whole token or substring (uppercased input). */
function contains(haystack: string, needle: string): boolean {
  // Short alpha-numeric tokens (SEAD, OCA, EW, AI, C2) must match on a word
  // boundary so "EW" doesn't match inside "CREW" and "AI" not inside "AIRLIFT".
  if (/^[A-Z0-9]{2,5}$/.test(needle)) {
    return new RegExp(`(^|[^A-Z0-9])${needle}([^A-Z0-9]|$)`).test(haystack);
  }
  return haystack.includes(needle);
}

/**
 * Resolve a free-text mission type into one or more canonical tokens.
 * Compound strings like "OCA/Strike" yield multiple tokens. Returns ['OTHER']
 * when nothing is recognized so a mission is never silently dropped.
 */
export function canonicalMissionTypes(raw: string | null | undefined): CanonicalMissionType[] {
  if (!raw || !raw.trim()) return ['OTHER'];
  const upper = raw.toUpperCase();

  const found: CanonicalMissionType[] = [];
  for (const rule of KEYWORD_RULES) {
    if (rule.match.some(kw => contains(upper, kw)) && !found.includes(rule.type)) {
      found.push(rule.type);
    }
  }

  return found.length > 0 ? found : ['OTHER'];
}

/** Primary canonical type — the first match, for display/grouping where a single value is needed. */
export function canonicalMissionType(raw: string | null | undefined): CanonicalMissionType {
  return canonicalMissionTypes(raw)[0];
}

/**
 * Normalize an LLM-produced `applicableTo` array into canonical tokens.
 * - canonicalizes each entry against the shared vocabulary
 * - preserves the ALL token verbatim
 * - if ALL is present, collapses the whole list to ['ALL'] (kills redundant
 *   combos like ["SEAD","OCA","ALL"])
 * - drops entries that resolve only to OTHER (unrecognized noise)
 * - dedupes
 */
export function normalizeApplicableTo(raw: string[] | null | undefined): string[] {
  if (!raw || raw.length === 0) return [];

  const tokens = new Set<string>();
  for (const entry of raw) {
    if (!entry || !entry.trim()) continue;
    if (entry.trim().toUpperCase() === ALL_TOKEN) return [ALL_TOKEN];
    for (const t of canonicalMissionTypes(entry)) {
      if (t !== 'OTHER') tokens.add(t);
    }
  }

  return [...tokens];
}
