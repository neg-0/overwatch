/**
 * Space Support Request (SSR) Generator
 *
 * Creates formal Space Support Requests for 10-20% of missions in a given ATO day.
 * SSRs are independent documents linked to missions by callsign/timing/location (text),
 * NOT by foreign keys. The knowledge graph later makes the connection to SpaceNeeds.
 */

import { SpaceCapabilityType, SSRStatus } from '../generated/prisma/client.js';
import prisma from '../db/prisma-client.js';

// ─── Lookup Tables ───────────────────────────────────────────────────────────

interface SubmitterInfo {
  submitter: string;
  submitterType: string;
  component: string;
}

const SUBMITTERS_BY_DOMAIN: Record<string, SubmitterInfo[]> = {
  AIR: [
    { submitter: '613th AOC', submitterType: 'AOC', component: 'AFCENT' },
    { submitter: '609th AOC', submitterType: 'AOC', component: 'AFCENT' },
    { submitter: '607th AOC', submitterType: 'AOC', component: 'PACAF' },
    { submitter: 'AFCENT A6', submitterType: 'COMPONENT', component: 'AFCENT' },
  ],
  MARITIME: [
    { submitter: 'NAVCENT N6', submitterType: 'CCMD', component: 'NAVCENT' },
    { submitter: 'CTF-50 COMM', submitterType: 'TF', component: 'NAVCENT' },
    { submitter: 'C5F N6', submitterType: 'COMPONENT', component: 'NAVCENT' },
  ],
  LAND: [
    { submitter: '1st Space Bde', submitterType: 'SPACE_BDE', component: 'ARCENT' },
    { submitter: 'ARCENT G6', submitterType: 'COMPONENT', component: 'ARCENT' },
    { submitter: 'V Corps Signal', submitterType: 'SIGNAL', component: 'ARCENT' },
  ],
  SPACE: [
    { submitter: '18th SDS', submitterType: 'SDS', component: 'USSPACECOM' },
    { submitter: 'CSpOC', submitterType: 'SPOC', component: 'USSPACECOM' },
  ],
};

/** Maps mission types to plausible space capability requests */
const CAPABILITY_BY_MISSION_TYPE: Record<string, SpaceCapabilityType[]> = {
  SEAD:    [SpaceCapabilityType.EW_SPACE, SpaceCapabilityType.SIGINT_SPACE],
  DEAD:    [SpaceCapabilityType.EW_SPACE, SpaceCapabilityType.ISR_SPACE],
  STRIKE:  [SpaceCapabilityType.OPIR, SpaceCapabilityType.GPS_MILITARY],
  OCA:     [SpaceCapabilityType.GPS_MILITARY, SpaceCapabilityType.LINK16],
  DCA:     [SpaceCapabilityType.LINK16, SpaceCapabilityType.GPS],
  CAS:     [SpaceCapabilityType.SATCOM_TACTICAL, SpaceCapabilityType.GPS_MILITARY],
  ISR:     [SpaceCapabilityType.ISR_SPACE, SpaceCapabilityType.DATALINK],
  TANKER:  [SpaceCapabilityType.SATCOM, SpaceCapabilityType.GPS],
  C2:      [SpaceCapabilityType.SATCOM_PROTECTED, SpaceCapabilityType.SATCOM_WIDEBAND],
  ASW:     [SpaceCapabilityType.SATCOM_TACTICAL, SpaceCapabilityType.ISR_SPACE],
  PATROL:  [SpaceCapabilityType.SATCOM, SpaceCapabilityType.PNT],
  RECON:   [SpaceCapabilityType.ISR_SPACE, SpaceCapabilityType.SIGINT_SPACE],
  AIRLIFT: [SpaceCapabilityType.SATCOM_WIDEBAND, SpaceCapabilityType.GPS],
  DEFAULT: [SpaceCapabilityType.SATCOM, SpaceCapabilityType.GPS, SpaceCapabilityType.PNT],
};

/** Maps capability to realistic C2/PACE communication plans */
const PACE_BY_CAPABILITY: Record<string, { primary: string; alternate: string; contingency: string; emergency: string }> = {
  SATCOM:           { primary: 'SIPRNET Chat / WGS Ch 4',     alternate: 'MUOS UHF 311.0 MHz',        contingency: 'UHF SATCOM 293.5 MHz',    emergency: 'HF 8992 kHz / TACAMO' },
  SATCOM_PROTECTED: { primary: 'AEHF SHF Ch 7 / SIPRNET',    alternate: 'AEHF EHF backup link',      contingency: 'WGS SHF fallback',         emergency: 'HF 11175 kHz / TACAMO' },
  SATCOM_WIDEBAND:  { primary: 'WGS Ka Ch 12 / STEP IP',     alternate: 'WGS SHF backup',            contingency: 'Commercial SATCOM Ku',     emergency: 'UHF SATCOM 243.0 MHz' },
  SATCOM_TACTICAL:  { primary: 'MUOS WCDMA / SIPRNET',       alternate: 'MUOS legacy UHF',           contingency: 'UHF LOS 375.2 MHz',        emergency: 'HF 8992 kHz' },
  OPIR:             { primary: 'SBX-1 datalink / SIPRNET',    alternate: 'SBIRS GEO relay',           contingency: 'DSP backup feed',           emergency: 'STU-III voice / 8992 kHz' },
  GPS:              { primary: 'GPS III L5 / SIPRNET',        alternate: 'GPS L1 C/A backup',         contingency: 'TACAN / INS revert',        emergency: 'VHF 121.5 MHz / voice' },
  GPS_MILITARY:     { primary: 'GPS III M-code / SIPRNET',    alternate: 'GPS PPS Y-code',            contingency: 'TACAN / INS revert',        emergency: 'HF 11175 kHz' },
  PNT:              { primary: 'GPS III L5 / SIPRNET',        alternate: 'GPS L2C backup',            contingency: 'Celestial nav / INS',       emergency: 'HF 8992 kHz' },
  ISR_SPACE:        { primary: 'JWICS / NSANET relay',        alternate: 'SIPRNET imagery feed',      contingency: 'Tactical datalink',         emergency: 'STU-III voice' },
  EW_SPACE:         { primary: 'SIPRNET / 16th AF link',      alternate: 'JWICS backup',              contingency: 'UHF SATCOM 293.5 MHz',     emergency: 'HF 11175 kHz' },
  SIGINT_SPACE:     { primary: 'JWICS / NSA relay',           alternate: 'SIPRNET feed',              contingency: 'Tactical SIGINT link',      emergency: 'STU-III voice' },
  LINK16:           { primary: 'Link 16 JTIDS Net 1',        alternate: 'Link 16 Net 7 backup',      contingency: 'UHF voice 290.6 MHz',       emergency: 'HF 8992 kHz' },
  DATALINK:         { primary: 'CDL wideband / SIPRNET',      alternate: 'Tactical CDL narrowband',   contingency: 'UHF SATCOM relay',          emergency: 'HF voice' },
  LAUNCH_DETECT:    { primary: 'SBIRS GEO relay / SIPRNET',   alternate: 'DSP backup constellation',  contingency: 'Ground radar feed',         emergency: 'STU-III / TACAMO' },
  SDA:              { primary: 'CSpOC feed / SIPRNET',        alternate: 'GEODSS backup',             contingency: 'Allied SSA network',        emergency: 'HF 11175 kHz' },
  WEATHER:          { primary: 'DMSP feed / SIPRNET',         alternate: 'Commercial weather sat',    contingency: 'Ground station relay',      emergency: 'HF voice' },
  SSA:              { primary: 'Space Fence relay / SIPRNET',  alternate: 'GEODSS optical',           contingency: 'Allied radar feed',          emergency: 'STU-III voice' },
  CYBER_SPACE:      { primary: 'DODIN / SIPRNET',             alternate: 'JWICS backup',              contingency: 'Tactical mesh network',     emergency: 'HF voice / TACAMO' },
};

/** Maps capability to preferred system name */
const SYSTEM_BY_CAPABILITY: Record<string, string> = {
  SATCOM:           'WGS',
  SATCOM_PROTECTED: 'AEHF',
  SATCOM_WIDEBAND:  'WGS',
  SATCOM_TACTICAL:  'MUOS',
  OPIR:             'SBIRS',
  GPS:              'GPS III',
  GPS_MILITARY:     'GPS III',
  PNT:              'GPS III',
  ISR_SPACE:        'GSSAP',
  EW_SPACE:         'Nemesis',
  SIGINT_SPACE:     'Orion',
  LINK16:           'MIDS-JTRS',
  DATALINK:         'CDL',
  LAUNCH_DETECT:    'SBIRS',
  SDA:              'Space Fence',
  WEATHER:          'DMSP',
  SSA:              'Space Fence',
  CYBER_SPACE:      'DODIN-S',
};

/** Maps capability to comm band */
const BAND_BY_CAPABILITY: Record<string, string> = {
  SATCOM:           'SHF',
  SATCOM_PROTECTED: 'EHF',
  SATCOM_WIDEBAND:  'Ka',
  SATCOM_TACTICAL:  'UHF',
  OPIR:             'IR',
  GPS:              'L-BAND',
  GPS_MILITARY:     'L-BAND',
  PNT:              'L-BAND',
  ISR_SPACE:        'X-BAND',
  LINK16:           'UHF',
};

/** Controlling authority by capability type */
const AUTHORITY_BY_CAPABILITY: Record<string, string> = {
  SATCOM:           '614th AOC/CSD',
  SATCOM_PROTECTED: '614th AOC/CSD',
  SATCOM_WIDEBAND:  '614th AOC/CSD',
  SATCOM_TACTICAL:  '614th AOC/CSD',
  OPIR:             'NORAD/USNORTHCOM J3',
  GPS:              '2nd SOPS',
  GPS_MILITARY:     '2nd SOPS',
  PNT:              '2nd SOPS',
  ISR_SPACE:        'NRO MOC',
  EW_SPACE:         '16th AF / 68th CW',
  SIGINT_SPACE:     'NRO MOC',
  LINK16:           'JAOC / 613th AOC',
  DATALINK:         'JAOC / 613th AOC',
  LAUNCH_DETECT:    'NORAD/USNORTHCOM J3',
  SDA:              'CSpOC / 18th SDS',
  WEATHER:          '2nd WXS',
  SSA:              'CSpOC / 18th SDS',
  CYBER_SPACE:      'JFHQ-DODIN',
};

/** Status rationale templates */
const DEGRADED_RATIONALES = [
  'Primary asset in maintenance window; backup constellation providing reduced bandwidth',
  'Orbital geometry limits coverage to 60% of requested window; partial fill authorized',
  'Antenna 2 offline on primary asset; single-string backup active',
  'Solar interference degrading signal; operating at reduced gain',
  'Competing priority from national tasking; time-sharing arrangement in effect',
  'Asset repositioning in progress; intermittent coverage during maneuver',
];

const DENIED_RATIONALES = [
  'All assets committed to higher-priority national tasking; no capacity available',
  'Coverage gap — no asset in constellation has LOS to requested area during window',
  'Asset constellation degraded below minimum threshold; capability unavailable',
  'Adversary jamming detected in band; capability denied to prevent exploitation',
  'Requested system offline for emergency maintenance; no backup available',
];

// ─── Generator ───────────────────────────────────────────────────────────────

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generate Space Support Requests for ~10-20% of missions on a given ATO day.
 * Idempotent: deletes existing SSRs for the scenario+day before inserting.
 */
export async function generateSSRs(scenarioId: string, atoDayNumber: number): Promise<number> {
  // 1. Query missions for this ATO day
  const orders = await prisma.taskingOrder.findMany({
    where: { scenarioId, atoDayNumber },
    include: {
      missionPackages: {
        include: {
          missions: {
            where: { affiliation: 'FRIENDLY' },
            include: {
              timeWindows: true,
              waypoints: { take: 1, orderBy: { sequence: 'asc' } },
              targets: { take: 1 },
            },
          },
        },
      },
    },
  });

  // Flatten to all FRIENDLY missions for this day
  const allMissions = orders.flatMap(o =>
    o.missionPackages.flatMap(pkg => pkg.missions)
  );

  if (allMissions.length === 0) {
    console.log(`[SSR] No missions found for Day ${atoDayNumber} — skipping SSR generation`);
    return 0;
  }

  // 2. Select 10-20% of missions
  const selectionRate = Math.random() * 0.1 + 0.1; // 0.10 – 0.20
  const count = Math.max(1, Math.round(allMissions.length * selectionRate));
  const shuffled = [...allMissions].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, count);

  // 3. Query available space assets for assignment
  const spaceAssets = await prisma.spaceAsset.findMany({
    where: { scenarioId, affiliation: 'FRIENDLY' },
    select: { id: true, name: true, constellation: true, capabilities: true, status: true },
  });

  // 4. Delete existing SSRs for this day (idempotency)
  await prisma.spaceSupportRequest.deleteMany({
    where: { scenarioId, atoDayNumber },
  });

  // 5. Build SSR records
  const ssrData = selected.map(mission => {
    const domain = mission.domain || 'AIR';
    const submitterInfo = pickRandom(SUBMITTERS_BY_DOMAIN[domain] || SUBMITTERS_BY_DOMAIN.AIR);

    // Pick capability based on mission type
    const msnType = (mission.missionType || '').toUpperCase().replace(/[/\s]/g, '');
    const capOptions = CAPABILITY_BY_MISSION_TYPE[msnType]
      || CAPABILITY_BY_MISSION_TYPE[msnType.split('/')[0]]
      || CAPABILITY_BY_MISSION_TYPE.DEFAULT;
    const capability = pickRandom(capOptions);
    const capKey = capability as string;

    // Timing from time windows or mission defaults
    const tw = mission.timeWindows?.[0];
    const startTime = tw?.startTime || mission.createdAt;
    const endTime = tw?.endTime || new Date(new Date(startTime).getTime() + 4 * 3600_000);

    // Location from waypoints or targets
    const wp = mission.waypoints?.[0];
    const tgt = mission.targets?.[0];
    const coverageLat = wp?.latitude ?? tgt?.latitude ?? null;
    const coverageLon = wp?.longitude ?? tgt?.longitude ?? null;

    // Find a matching asset
    const matchingAssets = spaceAssets.filter(a =>
      a.capabilities.includes(capability) && a.status === 'OPERATIONAL'
    );
    const degradedAssets = spaceAssets.filter(a =>
      a.capabilities.includes(capability) && a.status === 'DEGRADED'
    );

    // Determine status — weighted: 70% fulfilled, 20% degraded, 10% denied
    const roll = Math.random();
    let status: SSRStatus;
    let statusRationale: string | null = null;
    let assetAssigned: string | null = null;
    let constellationAssigned: string | null = null;

    if (roll < 0.70 && matchingAssets.length > 0) {
      status = SSRStatus.FULFILLED;
      const asset = pickRandom(matchingAssets);
      assetAssigned = asset.name;
      constellationAssigned = asset.constellation;
    } else if (roll < 0.90 && (matchingAssets.length > 0 || degradedAssets.length > 0)) {
      status = SSRStatus.DEGRADED;
      const pool = degradedAssets.length > 0 ? degradedAssets : matchingAssets;
      const asset = pickRandom(pool);
      assetAssigned = asset.name;
      constellationAssigned = asset.constellation;
      statusRationale = pickRandom(DEGRADED_RATIONALES);
    } else {
      status = SSRStatus.DENIED;
      statusRationale = pickRandom(DENIED_RATIONALES);
    }

    // C2 PACE plan
    const pace = PACE_BY_CAPABILITY[capKey] || PACE_BY_CAPABILITY.SATCOM;

    // Operation area from mission context
    const callsign = mission.callsign || mission.missionId || 'UNKNOWN';
    const operationArea = mission.targets?.[0]
      ? `AO ${callsign.split(' ')[0]}`
      : 'CENTCOM AOR';

    return {
      scenarioId,
      atoDayNumber,
      submitter: submitterInfo.submitter,
      submitterType: submitterInfo.submitterType,
      component: submitterInfo.component,
      callsignSupported: callsign,
      missionDescription: `${mission.missionType || 'MISSION'} — ${mission.platformType || 'multi-role'} x${mission.platformCount || 1}`,
      operationArea,
      coverageLat,
      coverageLon,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      capabilityRequested: capability,
      bandRequested: BAND_BY_CAPABILITY[capKey] || null,
      systemPreferred: SYSTEM_BY_CAPABILITY[capKey] || null,
      controllingAuthority: AUTHORITY_BY_CAPABILITY[capKey] || '614th AOC/CSD',
      primaryComm: pace.primary,
      alternateComm: pace.alternate,
      contingencyComm: pace.contingency,
      emergencyComm: pace.emergency,
      assetAssigned,
      constellationAssigned,
      status,
      statusRationale,
    };
  });

  // 6. Bulk insert
  const result = await prisma.spaceSupportRequest.createMany({ data: ssrData });

  console.log(`[SSR] Generated ${result.count} SSRs for Day ${atoDayNumber} (from ${allMissions.length} missions, ${(selectionRate * 100).toFixed(0)}% rate)`);
  return result.count;
}
