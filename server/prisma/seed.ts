import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ─── Deterministic IDs for cross-referencing ─────────────────────────────────

const IDS = {
  scenario: '00000000-0000-4000-8000-000000000001',
  units: {
    f35Wing: '00000000-0000-4000-8000-000000000010',
    carrierGrp: '00000000-0000-4000-8000-000000000011',
    maritimeP: '00000000-0000-4000-8000-000000000012',
    spaceWing: '00000000-0000-4000-8000-000000000013',
  },
  assetTypes: {
    f35a: '00000000-0000-4000-8000-000000000020',
    fa18e: '00000000-0000-4000-8000-000000000021',
    p8a: '00000000-0000-4000-8000-000000000022',
    ddg: '00000000-0000-4000-8000-000000000023',
    gps3: '00000000-0000-4000-8000-000000000024',
    wgs: '00000000-0000-4000-8000-000000000025',
  },
  orders: {
    ato: '00000000-0000-4000-8000-000000000030',
    mto: '00000000-0000-4000-8000-000000000031',
    sto: '00000000-0000-4000-8000-000000000032',
  },
  packages: {
    strike: '00000000-0000-4000-8000-000000000040',
    dca: '00000000-0000-4000-8000-000000000041',
    marIsr: '00000000-0000-4000-8000-000000000042',
    space: '00000000-0000-4000-8000-000000000043',
  },
  missions: {
    viper11: '00000000-0000-4000-8000-000000000050',
    viper12: '00000000-0000-4000-8000-000000000051',
    eagle01: '00000000-0000-4000-8000-000000000052',
    triton01: '00000000-0000-4000-8000-000000000053',
    trident1: '00000000-0000-4000-8000-000000000054',
    guardian1: '00000000-0000-4000-8000-000000000055',
  },
  spaceAssets: {
    gps3sv01: '00000000-0000-4000-8000-000000000060',
    wgs9: '00000000-0000-4000-8000-000000000061',
    sbirs5: '00000000-0000-4000-8000-000000000062',
    muos5: '00000000-0000-4000-8000-000000000063',
  },
};

// Scenario starts "today" at 0600Z and runs 7 days
const scenarioStart = new Date();
scenarioStart.setUTCHours(6, 0, 0, 0);
const scenarioEnd = new Date(scenarioStart.getTime() + 7 * 24 * 3600000);

// TOT windows relative to scenario start (Day 1, various hours)
const totBase = new Date(scenarioStart.getTime() + 2 * 3600000); // +2h = 0800Z (first missions launch early)

async function main() {
  console.log('🌊 Seeding WESTPAC GUARDIAN 2026...\n');

  // Clean existing data
  await prisma.positionUpdate.deleteMany();
  await prisma.spaceCoverageWindow.deleteMany();
  await prisma.spaceNeed.deleteMany();
  await prisma.supportRequirement.deleteMany();
  await prisma.missionTarget.deleteMany();
  await prisma.timeWindow.deleteMany();
  await prisma.waypoint.deleteMany();
  await prisma.mission.deleteMany();
  await prisma.missionPackage.deleteMany();
  await prisma.taskingOrder.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.assetType.deleteMany();
  await prisma.unit.deleteMany();
  await prisma.spaceAsset.deleteMany();
  await prisma.priorityEntry.deleteMany();
  await prisma.planningDocument.deleteMany();
  await prisma.strategyDocument.deleteMany();
  await prisma.simulationState.deleteMany();
  await prisma.leadershipDecision.deleteMany();
  await prisma.scenario.deleteMany();

  // ─── Scenario ────────────────────────────────────────────────────────────────

  await prisma.scenario.create({
    data: {
      id: IDS.scenario,
      name: 'WESTPAC GUARDIAN 2026',
      description: 'Joint multi-domain operations in the Western Pacific to deter aggression and maintain freedom of navigation in the South China Sea.',
      theater: 'WESTPAC / South China Sea',
      adversary: 'REDLAND',
      startDate: scenarioStart,
      endDate: scenarioEnd,
      classification: 'SECRET',
    },
  });
  console.log('  ✅ Scenario created');

  // ─── Strategy Documents ──────────────────────────────────────────────────────

  await prisma.strategyDocument.createMany({
    data: [
      {
        scenarioId: IDS.scenario,
        title: 'WESTPAC Campaign Plan',
        docType: 'CAMPAIGN_PLAN',
        content: 'MISSION: Conduct joint multi-domain operations to deter REDLAND aggression in the South China Sea AOR. Maintain freedom of navigation and overflight. Protect allied forces and civilian commerce.\n\nPHASE I (D+1-3): Establish air superiority over contested waters. Deploy maritime patrol assets for ISR.\nPHASE II (D+3-5): Conduct strike operations against identified threats. Maintain continuous maritime domain awareness.\nPHASE III (D+5-7): Consolidate gains, transition to sustained presence operations.',
        authorityLevel: 'COMBATANT COMMANDER',
        effectiveDate: scenarioStart,
      },
      {
        scenarioId: IDS.scenario,
        title: 'JFC Operational Guidance',
        docType: 'JFC_GUIDANCE',
        content: 'COMMANDER\'S INTENT: Rapidly establish multi-domain superiority to deny adversary freedom of action while minimizing escalation risk.\n\nPRIORITIES:\n1. Air superiority over Scarborough Shoal and Spratly Islands\n2. Maritime domain awareness across all chokepoints\n3. Space-based ISR and SATCOM continuity\n4. Cyber defense of C2 networks',
        authorityLevel: 'JOINT FORCE COMMANDER',
        effectiveDate: scenarioStart,
      },
    ],
  });
  console.log('  ✅ Strategy documents created');

  // ─── Planning Documents ──────────────────────────────────────────────────────

  const planDoc = await prisma.planningDocument.create({
    data: {
      scenarioId: IDS.scenario,
      title: 'Joint Integrated Prioritized Target List (JIPTL)',
      docType: 'JIPTL',
      content: 'Priority target nominations for WESTPAC GUARDIAN 2026. All targets vetted through joint targeting cycle.',
      effectiveDate: scenarioStart,
    },
  });

  await prisma.priorityEntry.createMany({
    data: [
      {
        planningDocId: planDoc.id,
        rank: 1,
        targetId: 'TGT-SCS-001',
        effect: 'NEUTRALIZE',
        description: 'REDLAND SAM Battery — Fiery Cross Reef',
        justification: 'Primary threat to air operations over southern SCS. Removal enables Phase II strike operations.',
      },
      {
        planningDocId: planDoc.id,
        rank: 2,
        targetId: 'TGT-SCS-002',
        effect: 'SUPPRESS',
        description: 'REDLAND Naval Base — Subi Reef',
        justification: 'Staging area for PLAN surface combatants. Suppression degrades adversary maritime offensive capability.',
      },
      {
        planningDocId: planDoc.id,
        rank: 3,
        targetId: 'TGT-SCS-003',
        effect: 'DENY',
        description: 'REDLAND EW Station — Mischief Reef',
        justification: 'Electronic warfare capability threatening allied C2 and GPS signals across the AOR.',
      },
    ],
  });
  console.log('  ✅ Planning documents + priorities created');

  // ─── Units ───────────────────────────────────────────────────────────────────

  await prisma.unit.createMany({
    data: [
      {
        id: IDS.units.f35Wing,
        scenarioId: IDS.scenario,
        unitName: '388th Fighter Wing',
        unitDesignation: '388 FW',
        serviceBranch: 'USAF',
        domain: 'AIR',
        baseLocation: 'Kadena AB, Okinawa',
        baseLat: 26.3516,
        baseLon: 127.7698,
      },
      {
        id: IDS.units.carrierGrp,
        scenarioId: IDS.scenario,
        unitName: 'Carrier Strike Group 9 (CVN-76 Reagan)',
        unitDesignation: 'CSG-9',
        serviceBranch: 'USN',
        domain: 'MARITIME',
        baseLocation: 'Philippine Sea Operating Area',
        baseLat: 15.5,
        baseLon: 121.0,
      },
      {
        id: IDS.units.maritimeP,
        scenarioId: IDS.scenario,
        unitName: '36th Expeditionary Wing - Maritime Patrol',
        unitDesignation: '36 EW/MP',
        serviceBranch: 'USN',
        domain: 'AIR',
        baseLocation: 'Andersen AFB, Guam',
        baseLat: 13.584,
        baseLon: 144.924,
      },
      {
        id: IDS.units.spaceWing,
        scenarioId: IDS.scenario,
        unitName: '21st Space Wing',
        unitDesignation: '21 SW',
        serviceBranch: 'USSF',
        domain: 'SPACE',
        baseLocation: 'Peterson SFB, Colorado',
        baseLat: 38.823,
        baseLon: -104.7,
      },
    ],
  });
  console.log('  ✅ 4 units created');

  // ─── Asset Types ─────────────────────────────────────────────────────────────

  await prisma.assetType.createMany({
    data: [
      { id: IDS.assetTypes.f35a, name: 'F-35A Lightning II', domain: 'AIR', category: 'FIGHTER', milsymbolCode: 'SFAPMF----' },
      { id: IDS.assetTypes.fa18e, name: 'F/A-18E Super Hornet', domain: 'AIR', category: 'FIGHTER', milsymbolCode: 'SFAPMF----' },
      { id: IDS.assetTypes.p8a, name: 'P-8A Poseidon', domain: 'AIR', category: 'MARITIME_PATROL', milsymbolCode: 'SFAPMR----' },
      { id: IDS.assetTypes.ddg, name: 'DDG Arleigh Burke', domain: 'MARITIME', category: 'DESTROYER', milsymbolCode: 'SFSPCLDD--' },
      { id: IDS.assetTypes.gps3, name: 'GPS III SV', domain: 'SPACE', category: 'NAVIGATION', milsymbolCode: 'SFPPT-----' },
      { id: IDS.assetTypes.wgs, name: 'WGS Satellite', domain: 'SPACE', category: 'COMMUNICATIONS', milsymbolCode: 'SFPPT-----' },
    ],
  });
  console.log('  ✅ 6 asset types created');

  // ─── Assets ──────────────────────────────────────────────────────────────────

  await prisma.asset.createMany({
    data: [
      // F-35s at Kadena
      { unitId: IDS.units.f35Wing, assetTypeId: IDS.assetTypes.f35a, tailNumber: 'AF-17-5230', name: 'Viper 1', status: 'OPERATIONAL' },
      { unitId: IDS.units.f35Wing, assetTypeId: IDS.assetTypes.f35a, tailNumber: 'AF-17-5231', name: 'Viper 2', status: 'OPERATIONAL' },
      { unitId: IDS.units.f35Wing, assetTypeId: IDS.assetTypes.f35a, tailNumber: 'AF-17-5232', name: 'Viper 3', status: 'OPERATIONAL' },
      { unitId: IDS.units.f35Wing, assetTypeId: IDS.assetTypes.f35a, tailNumber: 'AF-18-5240', name: 'Viper 4', status: 'MAINTENANCE' },
      // F/A-18Es on carrier
      { unitId: IDS.units.carrierGrp, assetTypeId: IDS.assetTypes.fa18e, tailNumber: 'NE-300', name: 'Eagle 1', status: 'OPERATIONAL' },
      { unitId: IDS.units.carrierGrp, assetTypeId: IDS.assetTypes.fa18e, tailNumber: 'NE-301', name: 'Eagle 2', status: 'OPERATIONAL' },
      // DDGs in CSG
      { unitId: IDS.units.carrierGrp, assetTypeId: IDS.assetTypes.ddg, name: 'USS Halsey (DDG-97)', status: 'OPERATIONAL' },
      { unitId: IDS.units.carrierGrp, assetTypeId: IDS.assetTypes.ddg, name: 'USS Shoup (DDG-86)', status: 'OPERATIONAL' },
      { unitId: IDS.units.carrierGrp, assetTypeId: IDS.assetTypes.ddg, name: 'USS Chafee (DDG-90)', status: 'OPERATIONAL' },
      // P-8s at Guam
      { unitId: IDS.units.maritimeP, assetTypeId: IDS.assetTypes.p8a, tailNumber: '169333', name: 'Triton 1', status: 'OPERATIONAL' },
      { unitId: IDS.units.maritimeP, assetTypeId: IDS.assetTypes.p8a, tailNumber: '169334', name: 'Triton 2', status: 'OPERATIONAL' },
      // Space - represented as assets but tracked separately via SpaceAsset
      { unitId: IDS.units.spaceWing, assetTypeId: IDS.assetTypes.gps3, name: 'GPS III SV01', status: 'OPERATIONAL' },
    ],
  });
  console.log('  ✅ 12 assets created');

  // ─── Tasking Orders ──────────────────────────────────────────────────────────

  await prisma.taskingOrder.createMany({
    data: [
      {
        id: IDS.orders.ato,
        scenarioId: IDS.scenario,
        orderType: 'ATO',
        orderId: 'ATO-2026-001A',
        issuingAuthority: 'PACAF/CC',
        effectiveStart: scenarioStart,
        effectiveEnd: new Date(scenarioStart.getTime() + 24 * 3600000),
        classification: 'SECRET',
        atoDayNumber: 1,
      },
      {
        id: IDS.orders.mto,
        scenarioId: IDS.scenario,
        orderType: 'MTO',
        orderId: 'MTO-2026-001A',
        issuingAuthority: 'PACFLT/CC',
        effectiveStart: scenarioStart,
        effectiveEnd: new Date(scenarioStart.getTime() + 24 * 3600000),
        classification: 'SECRET',
        atoDayNumber: 1,
      },
      {
        id: IDS.orders.sto,
        scenarioId: IDS.scenario,
        orderType: 'STO',
        orderId: 'STO-2026-001A',
        issuingAuthority: 'SPACECOM/CC',
        effectiveStart: scenarioStart,
        effectiveEnd: new Date(scenarioStart.getTime() + 24 * 3600000),
        classification: 'SECRET',
        atoDayNumber: 1,
      },
    ],
  });
  console.log('  ✅ 3 tasking orders created (ATO, MTO, STO)');

  // ─── Mission Packages ────────────────────────────────────────────────────────

  await prisma.missionPackage.createMany({
    data: [
      {
        id: IDS.packages.strike,
        taskingOrderId: IDS.orders.ato,
        packageId: 'PKGA01',
        priorityRank: 1,
        missionType: 'STRIKE',
        effectDesired: 'NEUTRALIZE enemy air defenses on Fiery Cross Reef',
      },
      {
        id: IDS.packages.dca,
        taskingOrderId: IDS.orders.ato,
        packageId: 'PKGA02',
        priorityRank: 2,
        missionType: 'DCA',
        effectDesired: 'DEFEND fleet air defense zone NE of Scarborough Shoal',
      },
      {
        id: IDS.packages.marIsr,
        taskingOrderId: IDS.orders.mto,
        packageId: 'PKGM01',
        priorityRank: 1,
        missionType: 'MARITIME_ISR',
        effectDesired: 'DETECT and TRACK adversary surface combatants in SCS',
      },
      {
        id: IDS.packages.space,
        taskingOrderId: IDS.orders.sto,
        packageId: 'PKGS01',
        priorityRank: 1,
        missionType: 'SPACE_COVERAGE',
        effectDesired: 'Maintain GPS/SATCOM coverage over AOR',
      },
    ],
  });
  console.log('  ✅ 4 mission packages created');

  // ─── Missions ────────────────────────────────────────────────────────────────

  await prisma.mission.createMany({
    data: [
      {
        id: IDS.missions.viper11,
        packageId: IDS.packages.strike,
        missionId: 'MSN4001',
        callsign: 'VIPER 11',
        domain: 'AIR',
        unitId: IDS.units.f35Wing,
        platformType: 'F-35A',
        platformCount: 2,
        missionType: 'SEAD/DEAD',
        status: 'PLANNED',
        affiliation: 'FRIENDLY',
      },
      {
        id: IDS.missions.viper12,
        packageId: IDS.packages.strike,
        missionId: 'MSN4002',
        callsign: 'VIPER 12',
        domain: 'AIR',
        unitId: IDS.units.f35Wing,
        platformType: 'F-35A',
        platformCount: 2,
        missionType: 'STRIKE',
        status: 'PLANNED',
        affiliation: 'FRIENDLY',
      },
      {
        id: IDS.missions.eagle01,
        packageId: IDS.packages.dca,
        missionId: 'MSN4003',
        callsign: 'EAGLE 01',
        domain: 'AIR',
        unitId: IDS.units.carrierGrp,
        platformType: 'F/A-18E',
        platformCount: 2,
        missionType: 'DCA/CAP',
        status: 'PLANNED',
        affiliation: 'FRIENDLY',
      },
      {
        id: IDS.missions.triton01,
        packageId: IDS.packages.marIsr,
        missionId: 'MSN5001',
        callsign: 'TRITON 01',
        domain: 'AIR',
        unitId: IDS.units.maritimeP,
        platformType: 'P-8A',
        platformCount: 1,
        missionType: 'MARITIME_PATROL',
        status: 'PLANNED',
        affiliation: 'FRIENDLY',
      },
      {
        id: IDS.missions.trident1,
        packageId: IDS.packages.marIsr,
        missionId: 'MSN5002',
        callsign: 'TRIDENT 01',
        domain: 'MARITIME',
        unitId: IDS.units.carrierGrp,
        platformType: 'DDG',
        platformCount: 1,
        missionType: 'SURFACE_PATROL',
        status: 'PLANNED',
        affiliation: 'FRIENDLY',
      },
      {
        id: IDS.missions.guardian1,
        packageId: IDS.packages.space,
        missionId: 'MSN6001',
        callsign: 'GUARDIAN 01',
        domain: 'SPACE',
        unitId: IDS.units.spaceWing,
        platformType: 'GPS-III',
        platformCount: 1,
        missionType: 'SPACE_COVERAGE',
        status: 'PLANNED',
        affiliation: 'FRIENDLY',
      },
    ],
  });
  console.log('  ✅ 6 missions created');

  // ─── Waypoints ───────────────────────────────────────────────────────────────

  // VIPER 11: Kadena → IP over SCS → Fiery Cross Reef → Egress → Kadena
  await prisma.waypoint.createMany({
    data: [
      { missionId: IDS.missions.viper11, waypointType: 'DEP', sequence: 1, latitude: 26.3516, longitude: 127.7698, altitude_ft: 0, speed_kts: 0, name: 'Kadena AB' },
      { missionId: IDS.missions.viper11, waypointType: 'CP', sequence: 2, latitude: 20.0, longitude: 122.0, altitude_ft: 35000, speed_kts: 480, name: 'CP ALPHA' },
      { missionId: IDS.missions.viper11, waypointType: 'IP', sequence: 3, latitude: 11.5, longitude: 113.0, altitude_ft: 30000, speed_kts: 520, name: 'IP BRAVO' },
      { missionId: IDS.missions.viper11, waypointType: 'TGT', sequence: 4, latitude: 9.55, longitude: 112.89, altitude_ft: 25000, speed_kts: 540, name: 'Fiery Cross' },
      { missionId: IDS.missions.viper11, waypointType: 'EGR', sequence: 5, latitude: 12.0, longitude: 116.0, altitude_ft: 35000, speed_kts: 480, name: 'EGR CHARLIE' },
      { missionId: IDS.missions.viper11, waypointType: 'REC', sequence: 6, latitude: 26.3516, longitude: 127.7698, altitude_ft: 0, speed_kts: 0, name: 'Kadena AB' },
    ],
  });

  // VIPER 12: Same package, offset route
  await prisma.waypoint.createMany({
    data: [
      { missionId: IDS.missions.viper12, waypointType: 'DEP', sequence: 1, latitude: 26.3516, longitude: 127.7698, altitude_ft: 0, speed_kts: 0, name: 'Kadena AB' },
      { missionId: IDS.missions.viper12, waypointType: 'CP', sequence: 2, latitude: 19.0, longitude: 121.0, altitude_ft: 35000, speed_kts: 480, name: 'CP DELTA' },
      { missionId: IDS.missions.viper12, waypointType: 'IP', sequence: 3, latitude: 11.0, longitude: 114.0, altitude_ft: 28000, speed_kts: 520, name: 'IP ECHO' },
      { missionId: IDS.missions.viper12, waypointType: 'TGT', sequence: 4, latitude: 9.55, longitude: 112.89, altitude_ft: 22000, speed_kts: 540, name: 'Fiery Cross' },
      { missionId: IDS.missions.viper12, waypointType: 'EGR', sequence: 5, latitude: 13.0, longitude: 117.0, altitude_ft: 35000, speed_kts: 480, name: 'EGR FOXTROT' },
      { missionId: IDS.missions.viper12, waypointType: 'REC', sequence: 6, latitude: 26.3516, longitude: 127.7698, altitude_ft: 0, speed_kts: 0, name: 'Kadena AB' },
    ],
  });

  // EAGLE 01: Carrier → CAP station NE of Scarborough
  await prisma.waypoint.createMany({
    data: [
      { missionId: IDS.missions.eagle01, waypointType: 'DEP', sequence: 1, latitude: 15.5, longitude: 121.0, altitude_ft: 0, speed_kts: 0, name: 'CVN-76' },
      { missionId: IDS.missions.eagle01, waypointType: 'CAP', sequence: 2, latitude: 16.0, longitude: 118.5, altitude_ft: 25000, speed_kts: 420, name: 'CAP STATION' },
      { missionId: IDS.missions.eagle01, waypointType: 'ORBIT', sequence: 3, latitude: 16.2, longitude: 118.0, altitude_ft: 25000, speed_kts: 350, name: 'ORBIT GOLF' },
      { missionId: IDS.missions.eagle01, waypointType: 'REC', sequence: 4, latitude: 15.5, longitude: 121.0, altitude_ft: 0, speed_kts: 0, name: 'CVN-76' },
    ],
  });

  // TRITON 01: Guam → Maritime patrol pattern over SCS
  await prisma.waypoint.createMany({
    data: [
      { missionId: IDS.missions.triton01, waypointType: 'DEP', sequence: 1, latitude: 13.584, longitude: 144.924, altitude_ft: 0, speed_kts: 0, name: 'Andersen AFB' },
      { missionId: IDS.missions.triton01, waypointType: 'PATROL', sequence: 2, latitude: 12.0, longitude: 118.0, altitude_ft: 25000, speed_kts: 490, name: 'PATROL ALPHA' },
      { missionId: IDS.missions.triton01, waypointType: 'PATROL', sequence: 3, latitude: 10.0, longitude: 114.0, altitude_ft: 5000, speed_kts: 250, name: 'PATROL BRAVO' },
      { missionId: IDS.missions.triton01, waypointType: 'PATROL', sequence: 4, latitude: 14.0, longitude: 116.0, altitude_ft: 5000, speed_kts: 250, name: 'PATROL CHARLIE' },
      { missionId: IDS.missions.triton01, waypointType: 'REC', sequence: 5, latitude: 13.584, longitude: 144.924, altitude_ft: 0, speed_kts: 0, name: 'Andersen AFB' },
    ],
  });

  // TRIDENT 01: DDG patrol in SCS
  await prisma.waypoint.createMany({
    data: [
      { missionId: IDS.missions.trident1, waypointType: 'DEP', sequence: 1, latitude: 15.5, longitude: 121.0, altitude_ft: 0, speed_kts: 0, name: 'CSG-9 Position' },
      { missionId: IDS.missions.trident1, waypointType: 'PATROL', sequence: 2, latitude: 14.5, longitude: 117.0, altitude_ft: 0, speed_kts: 18, name: 'WAYPOINT HOTEL' },
      { missionId: IDS.missions.trident1, waypointType: 'PATROL', sequence: 3, latitude: 11.0, longitude: 114.0, altitude_ft: 0, speed_kts: 18, name: 'WAYPOINT INDIA' },
      { missionId: IDS.missions.trident1, waypointType: 'REC', sequence: 4, latitude: 15.5, longitude: 121.0, altitude_ft: 0, speed_kts: 0, name: 'CSG-9 Position' },
    ],
  });
  console.log('  ✅ ~25 waypoints created across 5 missions');

  // ─── Time Windows (TOT) for mission status progression ───────────────────────

  await prisma.timeWindow.createMany({
    data: [
      // TRITON 01 — Patrol departs earliest (long range), TOT at +2h
      { missionId: IDS.missions.triton01, windowType: 'TOT', startTime: totBase },
      { missionId: IDS.missions.triton01, windowType: 'COVERAGE', startTime: totBase, endTime: new Date(totBase.getTime() + 12 * 3600000) },
      // TRIDENT 01 — DDG patrol, TOT at +3h
      { missionId: IDS.missions.trident1, windowType: 'TOT', startTime: new Date(totBase.getTime() + 1 * 3600000) },
      // EAGLE 01 — CAP station, TOT at +4h
      { missionId: IDS.missions.eagle01, windowType: 'TOT', startTime: new Date(totBase.getTime() + 2 * 3600000) },
      { missionId: IDS.missions.eagle01, windowType: 'ONSTA', startTime: new Date(totBase.getTime() + 2 * 3600000), endTime: new Date(totBase.getTime() + 6 * 3600000) },
      // VIPER 11 — SEAD strike, TOT at +6h
      { missionId: IDS.missions.viper11, windowType: 'TOT', startTime: new Date(totBase.getTime() + 4 * 3600000), endTime: new Date(totBase.getTime() + 4.25 * 3600000) },
      // VIPER 12 — Follow-on strike, TOT at +6.5h
      { missionId: IDS.missions.viper12, windowType: 'TOT', startTime: new Date(totBase.getTime() + 4.5 * 3600000), endTime: new Date(totBase.getTime() + 4.75 * 3600000) },
      // GUARDIAN 01 — Space coverage, TOT at +1h
      { missionId: IDS.missions.guardian1, windowType: 'TOT', startTime: new Date(scenarioStart.getTime() + 1 * 3600000) },
    ],
  });
  console.log('  ✅ 8 time windows created');

  // ─── Mission Targets ─────────────────────────────────────────────────────────

  await prisma.missionTarget.createMany({
    data: [
      {
        missionId: IDS.missions.viper11,
        targetId: 'TGT-SCS-001',
        beNumber: 'BE-1234-001',
        targetName: 'REDLAND SAM Battery — Fiery Cross Reef',
        latitude: 9.55,
        longitude: 112.89,
        targetCategory: 'AIR_DEFENSE',
        priorityRank: 1,
        desiredEffect: 'NEUTRALIZE',
        collateralConcern: 'LOW — military installation, no civilian infrastructure within 5km',
      },
      {
        missionId: IDS.missions.viper12,
        targetId: 'TGT-SCS-002',
        beNumber: 'BE-1234-002',
        targetName: 'REDLAND C2 Node — Fiery Cross Reef',
        latitude: 9.56,
        longitude: 112.90,
        targetCategory: 'COMMAND_CONTROL',
        priorityRank: 2,
        desiredEffect: 'DESTROY',
        collateralConcern: 'LOW — adjacent to SAM battery',
      },
      {
        missionId: IDS.missions.trident1,
        targetId: 'TGT-SCS-004',
        beNumber: 'BE-5678-001',
        targetName: 'REDLAND Patrol Vessel — Scarborough Shoal',
        latitude: 15.19,
        longitude: 117.76,
        targetCategory: 'NAVAL',
        priorityRank: 3,
        desiredEffect: 'TRACK',
      },
    ],
  });
  console.log('  ✅ 3 mission targets created');

  // ─── Space Assets ────────────────────────────────────────────────────────────

  await prisma.spaceAsset.createMany({
    data: [
      {
        id: IDS.spaceAssets.gps3sv01,
        scenarioId: IDS.scenario,
        name: 'GPS III SV01 (Vespucci)',
        constellation: 'GPS-III',
        noradId: '44506',
        tleLine1: '1 44506U 19056A   26042.50000000  .00000020  00000-0  00000+0 0  9993',
        tleLine2: '2 44506  55.0052 170.2851 0009273 234.5678  85.4322 2.00556670 46123',
        capabilities: ['GPS', 'PNT'],
        status: 'OPERATIONAL',
        inclination: 55.0,
        eccentricity: 0.001,
        periodMin: 718,
        apogeeKm: 20200,
        perigeeKm: 20180,
      },
      {
        id: IDS.spaceAssets.wgs9,
        scenarioId: IDS.scenario,
        name: 'WGS-9',
        constellation: 'WGS',
        noradId: '42075',
        tleLine1: '1 42075U 17018A   26042.50000000  .00000010  00000-0  00000+0 0  9995',
        tleLine2: '2 42075   0.0500 275.1234 0002345 123.4567 236.5433 1.00270700 31987',
        capabilities: ['SATCOM'],
        status: 'OPERATIONAL',
        inclination: 0.05,
        eccentricity: 0.0002,
        periodMin: 1436,
        apogeeKm: 35790,
        perigeeKm: 35780,
      },
      {
        id: IDS.spaceAssets.sbirs5,
        scenarioId: IDS.scenario,
        name: 'SBIRS GEO-5',
        constellation: 'SBIRS',
        noradId: '49508',
        tleLine1: '1 49508U 21063A   26042.50000000  .00000005  00000-0  00000+0 0  9991',
        tleLine2: '2 49508   0.0400 180.5678 0001234  45.6789 314.3211 1.00270800 16543',
        capabilities: ['OPIR'],
        status: 'OPERATIONAL',
        inclination: 0.04,
        eccentricity: 0.0001,
        periodMin: 1436,
        apogeeKm: 35790,
        perigeeKm: 35785,
      },
      {
        id: IDS.spaceAssets.muos5,
        scenarioId: IDS.scenario,
        name: 'MUOS-5',
        constellation: 'MUOS',
        noradId: '41622',
        tleLine1: '1 41622U 16041A   26042.50000000  .00000008  00000-0  00000+0 0  9997',
        tleLine2: '2 41622   5.0012  90.3456 0003456 178.9012 181.0988 1.00271000 35012',
        capabilities: ['SATCOM'],
        status: 'OPERATIONAL',
        inclination: 5.0,
        eccentricity: 0.0003,
        periodMin: 1436,
        apogeeKm: 35800,
        perigeeKm: 35770,
      },
    ],
  });
  console.log('  ✅ 4 space assets created');

  // ─── Space Coverage Windows ──────────────────────────────────────────────────

  await prisma.spaceCoverageWindow.createMany({
    data: [
      // GPS III over SCS — near continuous
      {
        spaceAssetId: IDS.spaceAssets.gps3sv01,
        startTime: scenarioStart,
        endTime: new Date(scenarioStart.getTime() + 6 * 3600000),
        maxElevation: 72.5,
        maxElevationTime: new Date(scenarioStart.getTime() + 3 * 3600000),
        centerLat: 12.0,
        centerLon: 115.0,
        swathWidthKm: 2200,
        capabilityType: 'GPS',
      },
      {
        spaceAssetId: IDS.spaceAssets.gps3sv01,
        startTime: new Date(scenarioStart.getTime() + 8 * 3600000),
        endTime: new Date(scenarioStart.getTime() + 18 * 3600000),
        maxElevation: 65.0,
        maxElevationTime: new Date(scenarioStart.getTime() + 13 * 3600000),
        centerLat: 14.0,
        centerLon: 118.0,
        swathWidthKm: 2000,
        capabilityType: 'GPS',
      },
      // WGS-9 SATCOM — GEO, continuous
      {
        spaceAssetId: IDS.spaceAssets.wgs9,
        startTime: scenarioStart,
        endTime: scenarioEnd,
        maxElevation: 85.0,
        maxElevationTime: new Date(scenarioStart.getTime() + 12 * 3600000),
        centerLat: 10.0,
        centerLon: 120.0,
        swathWidthKm: 4000,
        capabilityType: 'SATCOM',
      },
      // SBIRS OPIR — GEO
      {
        spaceAssetId: IDS.spaceAssets.sbirs5,
        startTime: scenarioStart,
        endTime: scenarioEnd,
        maxElevation: 80.0,
        maxElevationTime: new Date(scenarioStart.getTime() + 12 * 3600000),
        centerLat: 15.0,
        centerLon: 115.0,
        swathWidthKm: 5000,
        capabilityType: 'OPIR',
      },
      // MUOS SATCOM coverage
      {
        spaceAssetId: IDS.spaceAssets.muos5,
        startTime: scenarioStart,
        endTime: scenarioEnd,
        maxElevation: 70.0,
        maxElevationTime: new Date(scenarioStart.getTime() + 12 * 3600000),
        centerLat: 20.0,
        centerLon: 130.0,
        swathWidthKm: 3500,
        capabilityType: 'SATCOM',
      },
      // GPS gap window (coverage drops)
      {
        spaceAssetId: IDS.spaceAssets.gps3sv01,
        startTime: new Date(scenarioStart.getTime() + 20 * 3600000),
        endTime: new Date(scenarioStart.getTime() + 24 * 3600000),
        maxElevation: 30.0,
        maxElevationTime: new Date(scenarioStart.getTime() + 22 * 3600000),
        centerLat: 8.0,
        centerLon: 112.0,
        swathWidthKm: 1200,
        capabilityType: 'GPS',
      },
    ],
  });
  console.log('  ✅ 6 space coverage windows created');

  // ─── Space Needs ─────────────────────────────────────────────────────────────

  await prisma.spaceNeed.createMany({
    data: [
      {
        missionId: IDS.missions.viper11,
        spaceAssetId: IDS.spaceAssets.gps3sv01,
        capabilityType: 'GPS',
        priority: 1,
        startTime: new Date(totBase.getTime() - 2 * 3600000),
        endTime: new Date(totBase.getTime() + 1 * 3600000),
        coverageLat: 9.55,
        coverageLon: 112.89,
        coverageRadiusKm: 100,
        fulfilled: true,
      },
      {
        missionId: IDS.missions.viper11,
        spaceAssetId: IDS.spaceAssets.wgs9,
        capabilityType: 'SATCOM',
        priority: 1,
        startTime: new Date(totBase.getTime() - 3 * 3600000),
        endTime: new Date(totBase.getTime() + 2 * 3600000),
        coverageLat: 9.55,
        coverageLon: 112.89,
        coverageRadiusKm: 200,
        fulfilled: true,
      },
      {
        missionId: IDS.missions.eagle01,
        spaceAssetId: IDS.spaceAssets.gps3sv01,
        capabilityType: 'GPS',
        priority: 2,
        startTime: new Date(scenarioStart.getTime() + 7 * 3600000),
        endTime: new Date(scenarioStart.getTime() + 13 * 3600000),
        coverageLat: 16.0,
        coverageLon: 118.5,
        coverageRadiusKm: 150,
        fulfilled: true,
      },
      {
        missionId: IDS.missions.triton01,
        capabilityType: 'SATCOM',
        priority: 2,
        startTime: new Date(scenarioStart.getTime() + 6 * 3600000),
        endTime: new Date(scenarioStart.getTime() + 18 * 3600000),
        coverageLat: 12.0,
        coverageLon: 116.0,
        coverageRadiusKm: 300,
        fulfilled: false,
      },
    ],
  });
  console.log('  ✅ 4 space needs created');

  // ─── Summary ─────────────────────────────────────────────────────────────────

  const counts = {
    scenarios: await prisma.scenario.count(),
    units: await prisma.unit.count(),
    assets: await prisma.asset.count(),
    orders: await prisma.taskingOrder.count(),
    packages: await prisma.missionPackage.count(),
    missions: await prisma.mission.count(),
    waypoints: await prisma.waypoint.count(),
    timeWindows: await prisma.timeWindow.count(),
    targets: await prisma.missionTarget.count(),
    spaceAssets: await prisma.spaceAsset.count(),
    coverageWindows: await prisma.spaceCoverageWindow.count(),
    spaceNeeds: await prisma.spaceNeed.count(),
  };

  console.log('\n📊 Seed complete:');
  console.log(`   Scenarios: ${counts.scenarios} | Units: ${counts.units} | Assets: ${counts.assets}`);
  console.log(`   Orders: ${counts.orders} | Packages: ${counts.packages} | Missions: ${counts.missions}`);
  console.log(`   Waypoints: ${counts.waypoints} | Time Windows: ${counts.timeWindows} | Targets: ${counts.targets}`);
  console.log(`   Space Assets: ${counts.spaceAssets} | Coverage Windows: ${counts.coverageWindows} | Space Needs: ${counts.spaceNeeds}`);
  console.log('\n🚀 Ready for simulation!\n');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

// Export IDS and helpers for tests
export { IDS, scenarioEnd, scenarioStart, totBase };

