/**
 * reference-data.ts — Centralized theater-scoped reference catalog
 *
 * POC #1 Phase 2: This module is the single source of truth for all reference
 * data used during scenario generation. Each scenario gets its own mutable copies
 * of bases and space assets (for tracking changes during simulation), but the
 * catalog definitions live here.
 *
 * The rich comms/sensor/link data on each platform enables the knowledge graph
 * to build dependency chains:  "F-35A → needs MADL → provided by E-2D"
 *                               "DDG → needs EHF SATCOM → provided by AEHF-4"
 */

import { SpaceCapabilityType } from '@prisma/client';
import prisma from '../db/prisma-client.js';

// ─── Type Definitions ────────────────────────────────────────────────────────

export interface PlatformSpec {
  name: string;
  domain: 'AIR' | 'MARITIME' | 'LAND' | 'SPACE';
  category: string;
  milsymbolCode: string;
  commsSystems: CommSystem[];
  gpsType: 'M-CODE' | 'SAASM' | 'STANDARD';
  dataLinks: string[];
  sensors?: string[];          // e.g. ['AN/APG-81', 'AN/AAQ-37 DAS']
  weapons?: string[];          // e.g. ['AIM-120D', 'GBU-31 JDAM']
  maxRange_nm?: number;        // combat radius
  maxSpeed_kts?: number;
  crew?: number;
}

export interface CommSystem {
  band: 'EHF' | 'SHF' | 'UHF' | 'Ku' | 'Ka' | 'L' | 'S';
  system: string;              // e.g. 'AEHF', 'WGS', 'MUOS', 'LEGACY_UHF'
  role: 'primary' | 'secondary' | 'backup' | 'protected';
  dataRate_kbps?: number;      // approximate throughput
  antijam?: boolean;           // jam-resistant capability
}

export interface BaseSpec {
  name: string;
  baseType: 'AIRBASE' | 'NAVAL_BASE' | 'JOINT_BASE';
  latitude: number;
  longitude: number;
  country: string;
  icaoCode: string | null;
  runwayLength_ft?: number;     // for airbases
  maxAircraftParking?: number;  // ramp capacity
  fuelCapacity_gal?: number;
  hasHardenedShelters?: boolean;
}

export interface SpaceAssetSpec {
  name: string;
  constellation: string;
  affiliation: 'FRIENDLY' | 'HOSTILE' | 'NEUTRAL';
  capabilities: SpaceCapabilityType[];
  status: string;
  noradId?: string;    // NORAD catalog number for TLE lookup (public satellites)
  inclination: number;
  eccentricity: number;
  periodMin: number;
  apogeeKm: number;
  perigeeKm: number;
  bandwidthProvided?: string[];
  coverageRegion?: string;
  operator?: string;
}

export interface BlueUnitSpec {
  unitName: string;
  unitDesignation: string;
  serviceBranch: string;
  domain: 'AIR' | 'MARITIME';
  baseLocation: string;
  baseLat: number;
  baseLon: number;
  platformName: string;       // must match a PlatformSpec.name
  assetCount: number;
}

export interface RedUnitSpec {
  unitName: string;
  unitDesignation: string;
  serviceBranch: string;
  domain: 'AIR' | 'LAND' | 'MARITIME';
  baseLocation: string;
  baseLat: number;
  baseLon: number;
}

// ─── Platform Catalog ────────────────────────────────────────────────────────
// Comprehensive comms/sensor/weapons data enables knowledge graph link building:
//   platform → needs comms band → provided by satellite constellation
//   platform → has data link → interoperates with other platforms

export const PLATFORM_CATALOG: PlatformSpec[] = [
  // ── Air Platforms ──────────────────────────────────────────────────────────
  {
    name: 'F-35A', domain: 'AIR', category: 'Fighter',
    milsymbolCode: 'SFAPMF----*****',
    commsSystems: [
      { band: 'UHF', system: 'MUOS', role: 'backup', dataRate_kbps: 384, antijam: true },
    ],
    gpsType: 'M-CODE', dataLinks: ['LINK16', 'MADL'],
    sensors: ['AN/APG-81 AESA', 'AN/AAQ-37 DAS', 'AN/AAQ-40 EOTS'],
    weapons: ['AIM-120D AMRAAM', 'AIM-9X', 'GBU-31 JDAM', 'GBU-39 SDB', 'JSM'],
    maxRange_nm: 669, maxSpeed_kts: 1200, crew: 1,
  },
  {
    name: 'F-16C', domain: 'AIR', category: 'Fighter',
    milsymbolCode: 'SFAPMF----*****',
    commsSystems: [
      { band: 'UHF', system: 'MUOS', role: 'primary', dataRate_kbps: 384, antijam: true },
    ],
    gpsType: 'SAASM', dataLinks: ['LINK16'],
    sensors: ['AN/APG-68(V)9', 'LANTIRN/Sniper ATP'],
    weapons: ['AIM-120C', 'AIM-9X', 'GBU-31 JDAM', 'AGM-88 HARM'],
    maxRange_nm: 500, maxSpeed_kts: 1320, crew: 1,
  },
  {
    name: 'F/A-18E', domain: 'AIR', category: 'Fighter',
    milsymbolCode: 'SFAPMF----*****',
    commsSystems: [
      { band: 'UHF', system: 'MUOS', role: 'primary', dataRate_kbps: 384, antijam: true },
    ],
    gpsType: 'SAASM', dataLinks: ['LINK16', 'LINK4A'],
    sensors: ['AN/APG-79 AESA', 'ATFLIR'],
    weapons: ['AIM-120D AMRAAM', 'AIM-9X', 'AGM-84 Harpoon', 'GBU-31 JDAM', 'AGM-154 JSOW'],
    maxRange_nm: 449, maxSpeed_kts: 1190, crew: 1,
  },
  {
    name: 'B-2A', domain: 'AIR', category: 'Bomber',
    milsymbolCode: 'SFAPMB----*****',
    commsSystems: [
      { band: 'EHF', system: 'AEHF', role: 'primary', dataRate_kbps: 8000, antijam: true },
      { band: 'SHF', system: 'WGS', role: 'backup', dataRate_kbps: 50000 },
    ],
    gpsType: 'M-CODE', dataLinks: ['LINK16'],
    sensors: ['AN/APQ-181 AESA'],
    weapons: ['GBU-57 MOP', 'B61-12', 'GBU-31 JDAM', 'AGM-158 JASSM-ER'],
    maxRange_nm: 6000, maxSpeed_kts: 628, crew: 2,
  },
  {
    name: 'KC-135R', domain: 'AIR', category: 'Tanker',
    milsymbolCode: 'SFAPMKR---*****',
    commsSystems: [
      { band: 'UHF', system: 'LEGACY_UHF', role: 'primary', dataRate_kbps: 64 },
    ],
    gpsType: 'STANDARD', dataLinks: ['LINK16'],
    sensors: [],
    weapons: [],
    maxRange_nm: 1500, maxSpeed_kts: 530, crew: 3,
  },
  {
    name: 'E-3G', domain: 'AIR', category: 'AWACS',
    milsymbolCode: 'SFAPME----*****',
    commsSystems: [
      { band: 'SHF', system: 'WGS', role: 'primary', dataRate_kbps: 50000 },
      { band: 'UHF', system: 'LEGACY_UHF', role: 'backup', dataRate_kbps: 64 },
    ],
    gpsType: 'STANDARD', dataLinks: ['LINK16', 'JTIDS'],
    sensors: ['AN/APY-2 Radar'],
    weapons: [],
    maxRange_nm: 4600, maxSpeed_kts: 530, crew: 19,
  },
  {
    name: 'RC-135V', domain: 'AIR', category: 'ISR',
    milsymbolCode: 'SFAPMR----*****',
    commsSystems: [
      { band: 'SHF', system: 'WGS', role: 'primary', dataRate_kbps: 50000 },
      { band: 'EHF', system: 'AEHF', role: 'backup', dataRate_kbps: 8000, antijam: true },
    ],
    gpsType: 'STANDARD', dataLinks: ['LINK16'],
    sensors: ['SIGINT Suite', 'ELINT Receivers'],
    weapons: [],
    maxRange_nm: 3900, maxSpeed_kts: 500, crew: 32,
  },
  {
    name: 'EA-18G', domain: 'AIR', category: 'Electronic Attack',
    milsymbolCode: 'SFAPMF----*****',
    commsSystems: [
      { band: 'UHF', system: 'MUOS', role: 'primary', dataRate_kbps: 384, antijam: true },
    ],
    gpsType: 'STANDARD', dataLinks: ['LINK16'],
    sensors: ['AN/APG-79 AESA', 'AN/ALQ-218(V)2', 'AN/ALQ-99 Jammer Pods'],
    weapons: ['AGM-88E AARGM', 'AIM-120D AMRAAM'],
    maxRange_nm: 449, maxSpeed_kts: 1190, crew: 2,
  },
  {
    name: 'P-8A', domain: 'AIR', category: 'Maritime Patrol',
    milsymbolCode: 'SFAPMP----*****',
    commsSystems: [
      { band: 'SHF', system: 'WGS', role: 'primary', dataRate_kbps: 50000 },
      { band: 'UHF', system: 'LEGACY_UHF', role: 'backup', dataRate_kbps: 64 },
    ],
    gpsType: 'STANDARD', dataLinks: ['LINK16'],
    sensors: ['AN/APY-10 Radar', 'MX-20HD EO/IR', 'Sonobuoy Receivers'],
    weapons: ['AGM-84 Harpoon', 'Mk 54 Torpedo', 'Mk 82 Bomb'],
    maxRange_nm: 1200, maxSpeed_kts: 490, crew: 9,
  },
  {
    name: 'MQ-9A', domain: 'AIR', category: 'RPAS/ISR',
    milsymbolCode: 'SFAPMR----*****',
    commsSystems: [
      { band: 'Ku', system: 'WGS', role: 'primary', dataRate_kbps: 50000 },
      { band: 'UHF', system: 'LEGACY_UHF', role: 'backup', dataRate_kbps: 64 },
    ],
    gpsType: 'STANDARD', dataLinks: ['LINK16'],
    sensors: ['MTS-B EO/IR/Laser', 'Lynx SAR/GMTI'],
    weapons: ['AGM-114 Hellfire', 'GBU-12', 'GBU-38 JDAM'],
    maxRange_nm: 1000, maxSpeed_kts: 240, crew: 0,
  },

  // ── Maritime Platforms ─────────────────────────────────────────────────────
  {
    name: 'DDG (Arleigh Burke)', domain: 'MARITIME', category: 'Destroyer',
    milsymbolCode: 'SFSPCLDD--*****',
    commsSystems: [
      { band: 'SHF', system: 'WGS', role: 'primary', dataRate_kbps: 50000 },
      { band: 'UHF', system: 'MUOS', role: 'secondary', dataRate_kbps: 384, antijam: true },
      { band: 'EHF', system: 'AEHF', role: 'protected', dataRate_kbps: 8000, antijam: true },
    ],
    gpsType: 'SAASM', dataLinks: ['LINK16'],
    sensors: ['AN/SPY-1D(V) Radar', 'AN/SQS-53C Sonar', 'AN/SPQ-9B'],
    weapons: ['SM-2 Block IIIA', 'SM-6', 'Tomahawk', 'ESSM', 'Mk 54 Torpedo'],
    maxRange_nm: 4400, maxSpeed_kts: 31, crew: 329,
  },
  {
    name: 'CG (Ticonderoga)', domain: 'MARITIME', category: 'Cruiser',
    milsymbolCode: 'SFSPCLCC--*****',
    commsSystems: [
      { band: 'SHF', system: 'WGS', role: 'primary', dataRate_kbps: 50000 },
      { band: 'UHF', system: 'MUOS', role: 'secondary', dataRate_kbps: 384, antijam: true },
      { band: 'EHF', system: 'AEHF', role: 'protected', dataRate_kbps: 8000, antijam: true },
    ],
    gpsType: 'SAASM', dataLinks: ['LINK16'],
    sensors: ['AN/SPY-1B Radar', 'AN/SQS-53C Sonar'],
    weapons: ['SM-2 Block IIIA', 'SM-6', 'Tomahawk', 'ESSM', 'Harpoon'],
    maxRange_nm: 6000, maxSpeed_kts: 32, crew: 387,
  },
  {
    name: 'CVN (Nimitz)', domain: 'MARITIME', category: 'Carrier',
    milsymbolCode: 'SFSPCLCV--*****',
    commsSystems: [
      { band: 'SHF', system: 'WGS', role: 'primary', dataRate_kbps: 50000 },
      { band: 'UHF', system: 'MUOS', role: 'secondary', dataRate_kbps: 384, antijam: true },
      { band: 'EHF', system: 'AEHF', role: 'protected', dataRate_kbps: 8000, antijam: true },
    ],
    gpsType: 'SAASM', dataLinks: ['LINK16'],
    sensors: ['AN/SPN-46 CCA', 'AN/SPS-48E 3D Radar', 'AN/SPS-67(V)3'],
    weapons: ['ESSM', 'RAM', 'Phalanx CIWS'],
    maxRange_nm: -1, maxSpeed_kts: 31, crew: 5680,  // -1 = unlimited (nuclear)
  },
  {
    name: 'SSN (Virginia)', domain: 'MARITIME', category: 'Submarine',
    milsymbolCode: 'SFUPSN----*****',
    commsSystems: [
      { band: 'EHF', system: 'AEHF', role: 'primary', dataRate_kbps: 8000, antijam: true },
      { band: 'UHF', system: 'LEGACY_UHF', role: 'backup', dataRate_kbps: 64 },
    ],
    gpsType: 'STANDARD', dataLinks: [],
    sensors: ['BYG-1 Combat System', 'TB-29A Towed Array', 'AN/BQQ-10 Sonar'],
    weapons: ['Mk 48 ADCAP Torpedo', 'Tomahawk', 'UGM-84 Harpoon'],
    maxRange_nm: -1, maxSpeed_kts: 25, crew: 132,    // -1 = unlimited (nuclear)
  },
];

// ─── INDOPACOM Bases ─────────────────────────────────────────────────────────

export const INDOPACOM_BASES: BaseSpec[] = [
  {
    name: 'Kadena AB', baseType: 'AIRBASE',
    latitude: 26.3516, longitude: 127.7692, country: 'Japan', icaoCode: 'RODN',
    runwayLength_ft: 12100, maxAircraftParking: 100, fuelCapacity_gal: 5_000_000,
    hasHardenedShelters: true,
  },
  {
    name: 'Andersen AFB', baseType: 'AIRBASE',
    latitude: 13.5839, longitude: 144.9248, country: 'Guam (US)', icaoCode: 'PGUA',
    runwayLength_ft: 11185, maxAircraftParking: 80, fuelCapacity_gal: 6_600_000,
    hasHardenedShelters: false,
  },
  {
    name: 'Misawa AB', baseType: 'JOINT_BASE',
    latitude: 40.7032, longitude: 141.3686, country: 'Japan', icaoCode: 'RJSM',
    runwayLength_ft: 10000, maxAircraftParking: 60, fuelCapacity_gal: 3_000_000,
    hasHardenedShelters: true,
  },
  {
    name: 'Yokota AB', baseType: 'AIRBASE',
    latitude: 35.7485, longitude: 139.3487, country: 'Japan', icaoCode: 'RJTY',
    runwayLength_ft: 11000, maxAircraftParking: 50, fuelCapacity_gal: 2_500_000,
    hasHardenedShelters: false,
  },
  {
    name: 'MCAS Iwakuni', baseType: 'AIRBASE',
    latitude: 34.1439, longitude: 132.2361, country: 'Japan', icaoCode: 'RJOI',
    runwayLength_ft: 8000, maxAircraftParking: 45, fuelCapacity_gal: 2_000_000,
    hasHardenedShelters: false,
  },
  {
    name: 'CFAY Yokosuka', baseType: 'NAVAL_BASE',
    latitude: 35.2833, longitude: 139.6500, country: 'Japan', icaoCode: null,
  },
  {
    name: 'CFAS Sasebo', baseType: 'NAVAL_BASE',
    latitude: 33.1600, longitude: 129.7200, country: 'Japan', icaoCode: null,
  },
  {
    name: 'Naval Base Guam', baseType: 'NAVAL_BASE',
    latitude: 13.4443, longitude: 144.6537, country: 'Guam (US)', icaoCode: null,
  },
];

// ─── US Space Constellations ─────────────────────────────────────────────────
// bandwidthProvided maps to CommSystem.band/system on platforms — this is the
// link that the knowledge graph uses: "AEHF-4 provides EHF → used by B-2A, DDG, SSN"

export const US_SPACE_CONSTELLATIONS: { constellation: string; assets: SpaceAssetSpec[] }[] = [
  {
    constellation: 'GPS III',
    assets: Array.from({ length: 6 }, (_, i) => ({
      name: `GPS III SV${String(i + 1).padStart(2, '0')}`,
      constellation: 'GPS III',
      affiliation: 'FRIENDLY' as const,
      capabilities: ['GPS' as const, 'PNT' as const],
      status: 'OPERATIONAL',
      inclination: 55.0, eccentricity: 0.001, periodMin: 717.97,
      apogeeKm: 20200, perigeeKm: 20200,
      bandwidthProvided: ['L'],
      coverageRegion: 'GLOBAL',
      operator: 'USSF',
    })),
  },
  {
    constellation: 'WGS',
    assets: Array.from({ length: 3 }, (_, i) => ({
      name: `WGS-${i + 7}`,
      constellation: 'WGS',
      affiliation: 'FRIENDLY' as const,
      capabilities: ['SATCOM_WIDEBAND' as const],
      status: i === 2 ? 'DEGRADED' : 'OPERATIONAL',
      inclination: 0.0, eccentricity: 0.0001, periodMin: 1436.1,
      apogeeKm: 35786, perigeeKm: 35786,
      bandwidthProvided: ['SHF', 'Ku', 'Ka'],
      coverageRegion: 'WESTPAC',
      operator: 'USSF',
    })),
  },
  {
    constellation: 'SBIRS',
    assets: Array.from({ length: 4 }, (_, i) => ({
      name: `SBIRS GEO-${i + 1}`,
      constellation: 'SBIRS',
      affiliation: 'FRIENDLY' as const,
      capabilities: ['OPIR' as const],
      status: 'OPERATIONAL',
      inclination: i < 2 ? 0.0 : 63.4,
      eccentricity: i < 2 ? 0.0001 : 0.7,
      periodMin: i < 2 ? 1436.1 : 717.97,
      apogeeKm: i < 2 ? 35786 : 39000,
      perigeeKm: i < 2 ? 35786 : 600,
      coverageRegion: 'GLOBAL',
      operator: 'USSF',
    })),
  },
  {
    constellation: 'DMSP',
    assets: Array.from({ length: 2 }, (_, i) => ({
      name: `DMSP-5D3 F${19 + i}`,
      constellation: 'DMSP',
      affiliation: 'FRIENDLY' as const,
      capabilities: ['WEATHER' as const],
      status: 'OPERATIONAL',
      inclination: 98.8, eccentricity: 0.001, periodMin: 101.6,
      apogeeKm: 840, perigeeKm: 840,
      coverageRegion: 'GLOBAL',
      operator: 'USSF',
    })),
  },
  {
    constellation: 'MUOS',
    assets: Array.from({ length: 2 }, (_, i) => ({
      name: `MUOS-${i + 4}`,
      constellation: 'MUOS',
      affiliation: 'FRIENDLY' as const,
      capabilities: ['SATCOM_TACTICAL' as const],
      status: 'OPERATIONAL',
      inclination: 0.0, eccentricity: 0.0001, periodMin: 1436.1,
      apogeeKm: 35786, perigeeKm: 35786,
      bandwidthProvided: ['UHF'],
      coverageRegion: 'WESTPAC',
      operator: 'USSF',
    })),
  },
  {
    constellation: 'AEHF',
    assets: Array.from({ length: 3 }, (_, i) => ({
      name: `AEHF-${i + 4}`,
      constellation: 'AEHF',
      affiliation: 'FRIENDLY' as const,
      capabilities: ['SATCOM_PROTECTED' as const],
      status: 'OPERATIONAL',
      inclination: 0.0, eccentricity: 0.0001, periodMin: 1436.1,
      apogeeKm: 35786, perigeeKm: 35786,
      bandwidthProvided: ['EHF'],
      coverageRegion: 'GLOBAL',
      operator: 'USSF',
    })),
  },
  {
    constellation: 'NRO ISR',
    assets: Array.from({ length: 3 }, (_, i) => ({
      name: `USA-${338 + i}`,
      constellation: 'NRO ISR',
      affiliation: 'FRIENDLY' as const,
      capabilities: ['ISR_SPACE' as const, 'SIGINT_SPACE' as const],
      status: 'OPERATIONAL',
      inclination: i < 2 ? 97.4 : 63.4, // SSO and inclined orbit variants
      eccentricity: i < 2 ? 0.001 : 0.002,
      periodMin: i < 2 ? 97.0 : 100.5,
      apogeeKm: i < 2 ? 680 : 720,
      perigeeKm: i < 2 ? 670 : 690,
      coverageRegion: i < 2 ? 'GLOBAL' : 'WESTPAC',
      operator: 'NRO',
    })),
  },
  {
    constellation: 'SDA Tracking',
    assets: Array.from({ length: 4 }, (_, i) => ({
      name: `SDA T2-TRK-${String(i + 1).padStart(3, '0')}`,
      constellation: 'SDA Tracking',
      affiliation: 'FRIENDLY' as const,
      capabilities: ['OPIR' as const, 'LAUNCH_DETECT' as const],
      status: 'OPERATIONAL',
      inclination: 50.0, eccentricity: 0.001, periodMin: 97.7,
      apogeeKm: 950, perigeeKm: 940,
      coverageRegion: 'GLOBAL',
      operator: 'SDA',
    })),
  },

  // ── GPS Legacy Constellations (still operational) ───────────────────────
  {
    constellation: 'GPS IIF',
    assets: Array.from({ length: 12 }, (_, i) => ({
      name: `GPS IIF-${i + 1}`,
      constellation: 'GPS IIF',
      affiliation: 'FRIENDLY' as const,
      capabilities: ['GPS' as const, 'PNT' as const],
      status: 'OPERATIONAL',
      inclination: 55.0, eccentricity: 0.001, periodMin: 717.97,
      apogeeKm: 20200, perigeeKm: 20200,
      bandwidthProvided: ['L'],
      coverageRegion: 'GLOBAL',
      operator: 'USSF',
    })),
  },
  {
    constellation: 'GPS IIR-M',
    assets: Array.from({ length: 7 }, (_, i) => ({
      name: `GPS IIR-M${i + 1}`,
      constellation: 'GPS IIR-M',
      affiliation: 'FRIENDLY' as const,
      capabilities: ['GPS' as const, 'PNT' as const],
      status: i < 5 ? 'OPERATIONAL' : 'DEGRADED',
      inclination: 55.0, eccentricity: 0.001, periodMin: 717.97,
      apogeeKm: 20200, perigeeKm: 20200,
      bandwidthProvided: ['L'],
      coverageRegion: 'GLOBAL',
      operator: 'USSF',
    })),
  },

  // ── SATCOM ──────────────────────────────────────────────────────────────
  {
    constellation: 'TDRS',
    assets: Array.from({ length: 6 }, (_, i) => ({
      name: `TDRS-${i + 8}`,
      constellation: 'TDRS',
      affiliation: 'FRIENDLY' as const,
      capabilities: ['SATCOM_WIDEBAND' as const],
      status: i < 4 ? 'OPERATIONAL' : 'DEGRADED',
      inclination: 0.0, eccentricity: 0.0001, periodMin: 1436.1,
      apogeeKm: 35786, perigeeKm: 35786,
      bandwidthProvided: ['SHF', 'Ku', 'Ka'],
      coverageRegion: 'GLOBAL',
      operator: 'NASA/USSF',
    })),
  },
  {
    constellation: 'Milstar',
    assets: Array.from({ length: 2 }, (_, i) => ({
      name: `Milstar-2 F${i + 4}`,
      constellation: 'Milstar',
      affiliation: 'FRIENDLY' as const,
      capabilities: ['SATCOM_PROTECTED' as const],
      status: 'OPERATIONAL',
      inclination: 4.0, eccentricity: 0.0001, periodMin: 1436.1,
      apogeeKm: 35786, perigeeKm: 35786,
      bandwidthProvided: ['EHF', 'UHF'],
      coverageRegion: 'GLOBAL',
      operator: 'USSF',
    })),
  },
  {
    constellation: 'WGS Legacy',
    assets: Array.from({ length: 6 }, (_, i) => ({
      name: `WGS-${i + 1}`,
      constellation: 'WGS Legacy',
      affiliation: 'FRIENDLY' as const,
      capabilities: ['SATCOM_WIDEBAND' as const],
      status: i < 4 ? 'OPERATIONAL' : 'DEGRADED',
      inclination: 0.0, eccentricity: 0.0001, periodMin: 1436.1,
      apogeeKm: 35786, perigeeKm: 35786,
      bandwidthProvided: ['SHF', 'Ku'],
      coverageRegion: i < 3 ? 'GLOBAL' : 'WESTPAC',
      operator: 'USSF',
    })),
  },
  {
    constellation: 'MUOS Full',
    assets: Array.from({ length: 3 }, (_, i) => ({
      name: `MUOS-${i + 1}`,
      constellation: 'MUOS Full',
      affiliation: 'FRIENDLY' as const,
      capabilities: ['SATCOM_TACTICAL' as const],
      status: 'OPERATIONAL',
      inclination: 0.0, eccentricity: 0.0001, periodMin: 1436.1,
      apogeeKm: 35786, perigeeKm: 35786,
      bandwidthProvided: ['UHF'],
      coverageRegion: 'GLOBAL',
      operator: 'USSF',
    })),
  },

  // ── Missile Warning / Launch Detection ──────────────────────────────────
  {
    constellation: 'SBIRS HEO',
    assets: Array.from({ length: 2 }, (_, i) => ({
      name: `SBIRS HEO-${i + 3}`,
      constellation: 'SBIRS HEO',
      affiliation: 'FRIENDLY' as const,
      capabilities: ['OPIR' as const, 'LAUNCH_DETECT' as const],
      status: 'OPERATIONAL',
      inclination: 63.4, eccentricity: 0.7, periodMin: 717.97,
      apogeeKm: 39000, perigeeKm: 600,
      coverageRegion: 'GLOBAL',
      operator: 'USSF',
    })),
  },
  {
    constellation: 'STSS',
    assets: Array.from({ length: 2 }, (_, i) => ({
      name: `STSS-Demo-${i + 1}`,
      constellation: 'STSS',
      affiliation: 'FRIENDLY' as const,
      capabilities: ['OPIR' as const, 'LAUNCH_DETECT' as const, 'SDA' as const],
      status: 'OPERATIONAL',
      inclination: 58.0, eccentricity: 0.001, periodMin: 97.7,
      apogeeKm: 1350, perigeeKm: 1340,
      coverageRegion: 'GLOBAL',
      operator: 'MDA/USSF',
    })),
  },

  // ── Space Situational Awareness (SSA) ───────────────────────────────────
  {
    constellation: 'GSSAP',
    assets: Array.from({ length: 6 }, (_, i) => ({
      name: `GSSAP-${i + 1}`,
      constellation: 'GSSAP',
      affiliation: 'FRIENDLY' as const,
      capabilities: ['SSA' as const, 'SDA' as const],
      status: 'OPERATIONAL',
      inclination: 0.0, eccentricity: 0.0001, periodMin: 1436.1,
      apogeeKm: 35786, perigeeKm: 35786,
      coverageRegion: 'GLOBAL',
      operator: 'USSF',
    })),
  },
  {
    constellation: 'SAPPHIRE',
    assets: [
      {
        name: 'SAPPHIRE',
        constellation: 'SAPPHIRE',
        affiliation: 'FRIENDLY' as const,
        capabilities: ['SSA' as const],
        status: 'OPERATIONAL',
        inclination: 98.6, eccentricity: 0.001, periodMin: 97.0,
        apogeeKm: 800, perigeeKm: 790,
        coverageRegion: 'GLOBAL',
        operator: 'CAF',  // Canadian Armed Forces — Five Eyes partner
      },
    ],
  },
  {
    constellation: 'SBSS',
    assets: [
      {
        name: 'SBSS Block 10',
        constellation: 'SBSS',
        affiliation: 'FRIENDLY' as const,
        capabilities: ['SSA' as const],
        status: 'OPERATIONAL',
        inclination: 98.0, eccentricity: 0.001, periodMin: 97.0,
        apogeeKm: 630, perigeeKm: 620,
        coverageRegion: 'GLOBAL',
        operator: 'USSF',
      },
    ],
  },

  // ── NRO / Intelligence ──────────────────────────────────────────────────
  {
    constellation: 'NROL EO',
    assets: Array.from({ length: 4 }, (_, i) => ({
      name: `USA-${314 + i}`,
      constellation: 'NROL EO',
      affiliation: 'FRIENDLY' as const,
      capabilities: ['ISR_SPACE' as const],
      status: 'OPERATIONAL',
      inclination: 97.4, eccentricity: 0.001, periodMin: 94.8,
      apogeeKm: 250, perigeeKm: 245,  // LEO optical imaging
      coverageRegion: 'GLOBAL',
      operator: 'NRO',
    })),
  },
  {
    constellation: 'NROL SIGINT/ELINT',
    assets: Array.from({ length: 4 }, (_, i) => ({
      name: `USA-${352 + i}`,
      constellation: 'NROL SIGINT/ELINT',
      affiliation: 'FRIENDLY' as const,
      capabilities: ['SIGINT_SPACE' as const, 'EW_SPACE' as const],
      status: 'OPERATIONAL',
      inclination: i < 2 ? 63.4 : 0.0,
      eccentricity: i < 2 ? 0.7 : 0.0001,
      periodMin: i < 2 ? 717.97 : 1436.1,
      apogeeKm: i < 2 ? 39000 : 35786,    // HEO SIGINT + GEO SIGINT
      perigeeKm: i < 2 ? 300 : 35786,
      coverageRegion: 'GLOBAL',
      operator: 'NRO',
    })),
  },
  {
    constellation: 'NOSS (Intruder)',
    assets: Array.from({ length: 3 }, (_, i) => ({
      name: `NOSS-3-${i + 6}`,
      constellation: 'NOSS (Intruder)',
      affiliation: 'FRIENDLY' as const,
      capabilities: ['SIGINT_SPACE' as const],
      status: 'OPERATIONAL',
      inclination: 63.4, eccentricity: 0.002, periodMin: 107.5,
      apogeeKm: 1100, perigeeKm: 1090,  // LEO ocean surveillance triplets
      coverageRegion: 'GLOBAL',
      operator: 'NRO',
    })),
  },
  {
    constellation: 'NROL SAR',
    assets: Array.from({ length: 3 }, (_, i) => ({
      name: `USA-${360 + i}`,
      constellation: 'NROL SAR',
      affiliation: 'FRIENDLY' as const,
      capabilities: ['ISR_SPACE' as const],
      status: 'OPERATIONAL',
      inclination: 57.0, eccentricity: 0.001, periodMin: 97.5,
      apogeeKm: 740, perigeeKm: 730,
      coverageRegion: 'GLOBAL',
      operator: 'NRO',
    })),
  },

  // ── SDA Proliferated Warfighter Space Architecture ─────────────────────
  {
    constellation: 'SDA Transport',
    assets: Array.from({ length: 6 }, (_, i) => ({
      name: `SDA T2-XPT-${String(i + 1).padStart(3, '0')}`,
      constellation: 'SDA Transport',
      affiliation: 'FRIENDLY' as const,
      capabilities: ['SATCOM_WIDEBAND' as const],
      status: 'OPERATIONAL',
      inclination: 50.0, eccentricity: 0.001, periodMin: 97.7,
      apogeeKm: 950, perigeeKm: 940,
      bandwidthProvided: ['Ka'],
      coverageRegion: 'GLOBAL',
      operator: 'SDA',
    })),
  },

  // ── Weather / Environmental ─────────────────────────────────────────────
  {
    constellation: 'GOES-R',
    assets: [
      {
        name: 'GOES-16 (East)',
        constellation: 'GOES-R',
        affiliation: 'FRIENDLY' as const,
        capabilities: ['WEATHER' as const],
        status: 'OPERATIONAL',
        inclination: 0.0, eccentricity: 0.0001, periodMin: 1436.1,
        apogeeKm: 35786, perigeeKm: 35786,
        coverageRegion: 'CONUS',
        operator: 'NOAA/USSF',
      },
      {
        name: 'GOES-17 (Standby)',
        constellation: 'GOES-R',
        affiliation: 'FRIENDLY' as const,
        capabilities: ['WEATHER' as const],
        status: 'DEGRADED',
        inclination: 0.0, eccentricity: 0.0001, periodMin: 1436.1,
        apogeeKm: 35786, perigeeKm: 35786,
        coverageRegion: 'WESTPAC',
        operator: 'NOAA/USSF',
      },
      {
        name: 'GOES-18 (West)',
        constellation: 'GOES-R',
        affiliation: 'FRIENDLY' as const,
        capabilities: ['WEATHER' as const],
        status: 'OPERATIONAL',
        inclination: 0.0, eccentricity: 0.0001, periodMin: 1436.1,
        apogeeKm: 35786, perigeeKm: 35786,
        coverageRegion: 'WESTPAC',
        operator: 'NOAA/USSF',
      },
    ],
  },

  // ── Earth Observation / Dual-Use ────────────────────────────────────────
  {
    constellation: 'Landsat',
    assets: [
      {
        name: 'Landsat-8',
        constellation: 'Landsat',
        affiliation: 'FRIENDLY' as const,
        capabilities: ['ISR_SPACE' as const],
        status: 'OPERATIONAL',
        inclination: 98.2, eccentricity: 0.001, periodMin: 99.0,
        apogeeKm: 705, perigeeKm: 705,
        coverageRegion: 'GLOBAL',
        operator: 'USGS/NASA',
      },
      {
        name: 'Landsat-9',
        constellation: 'Landsat',
        affiliation: 'FRIENDLY' as const,
        capabilities: ['ISR_SPACE' as const],
        status: 'OPERATIONAL',
        inclination: 98.2, eccentricity: 0.001, periodMin: 99.0,
        apogeeKm: 705, perigeeKm: 705,
        coverageRegion: 'GLOBAL',
        operator: 'USGS/NASA',
      },
    ],
  },
  {
    constellation: 'WorldView',
    assets: [
      {
        name: 'WorldView-3',
        constellation: 'WorldView',
        affiliation: 'FRIENDLY' as const,
        capabilities: ['ISR_SPACE' as const],
        status: 'OPERATIONAL',
        inclination: 97.2, eccentricity: 0.001, periodMin: 97.4,
        apogeeKm: 617, perigeeKm: 614,
        coverageRegion: 'GLOBAL',
        operator: 'NGA/Maxar',
      },
      {
        name: 'WorldView Legion-1',
        constellation: 'WorldView',
        affiliation: 'FRIENDLY' as const,
        capabilities: ['ISR_SPACE' as const],
        status: 'OPERATIONAL',
        inclination: 97.4, eccentricity: 0.001, periodMin: 94.8,
        apogeeKm: 500, perigeeKm: 490,
        coverageRegion: 'GLOBAL',
        operator: 'NGA/Maxar',
      },
      {
        name: 'WorldView Legion-2',
        constellation: 'WorldView',
        affiliation: 'FRIENDLY' as const,
        capabilities: ['ISR_SPACE' as const],
        status: 'OPERATIONAL',
        inclination: 45.0, eccentricity: 0.001, periodMin: 94.8,
        apogeeKm: 500, perigeeKm: 490,
        coverageRegion: 'WESTPAC',
        operator: 'NGA/Maxar',
      },
    ],
  },

  // ── Comm Relay / Backup ─────────────────────────────────────────────────
  {
    constellation: 'CBAS',
    assets: [
      {
        name: 'CBAS-2',
        constellation: 'CBAS',
        affiliation: 'FRIENDLY' as const,
        capabilities: ['SATCOM_WIDEBAND' as const, 'SSA' as const],
        status: 'OPERATIONAL',
        inclination: 0.0, eccentricity: 0.0001, periodMin: 1436.1,
        apogeeKm: 35786, perigeeKm: 35786,
        coverageRegion: 'GLOBAL',
        operator: 'USSF',
      },
    ],
  },
];

// ─── Adversary Space Constellations ──────────────────────────────────────────
// Comprehensive catalog of adversary space assets from public/OSINT data.
// Organized by operator → constellation family. Capabilities map to
// SpaceCapabilityType enum values for knowledge graph linking.

export const ADVERSARY_SPACE_CONSTELLATIONS: { constellation: string; assets: SpaceAssetSpec[] }[] = [

  // ═══════════════════════════════════════════════════════════════════════════
  //  CHINA — People's Liberation Army Strategic Support Force (PLASSF)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── BeiDou-3 (BDS-3) MEO — Global PNT constellation ───────────────────────
  // 24 MEO satellites at ~21,528 km, provides global coverage.
  // Military signals on B1C/B2a/B3I bands; anti-jam hardened.
  {
    constellation: 'BeiDou-3 MEO',
    assets: Array.from({ length: 24 }, (_, i) => ({
      name: `BDS-3 M${String(i + 1).padStart(2, '0')}`,
      constellation: 'BeiDou-3 MEO',
      affiliation: 'HOSTILE' as const,
      capabilities: ['GPS' as const, 'PNT' as const],
      status: i < 22 ? 'OPERATIONAL' : 'DEGRADED',
      inclination: 55.0, eccentricity: 0.002, periodMin: 773.19,
      apogeeKm: 21528, perigeeKm: 21528,
      bandwidthProvided: ['L', 'S'],
      coverageRegion: 'GLOBAL',
      operator: 'PLASSF',
    })),
  },

  // ── BeiDou-3 GEO — Regional augmentation (fixed over Asia-Pacific) ─────────
  // 3 GEO satellites providing SBAS-like augmentation + messaging over WESTPAC.
  {
    constellation: 'BeiDou-3 GEO',
    assets: Array.from({ length: 3 }, (_, i) => ({
      name: `BDS-3 G${i + 1}`,
      constellation: 'BeiDou-3 GEO',
      affiliation: 'HOSTILE' as const,
      capabilities: ['GPS' as const, 'PNT' as const, 'SATCOM_TACTICAL' as const],
      status: 'OPERATIONAL',
      inclination: 0.0, eccentricity: 0.0001, periodMin: 1436.1,
      apogeeKm: 35786, perigeeKm: 35786,
      bandwidthProvided: ['L', 'S'],
      coverageRegion: 'WESTPAC',
      operator: 'PLASSF',
    })),
  },

  // ── BeiDou-3 IGSO — Inclined GEO for high-latitude Asia coverage ──────────
  // 3 IGSO satellites in figure-8 ground tracks centered on 118°E.
  {
    constellation: 'BeiDou-3 IGSO',
    assets: Array.from({ length: 3 }, (_, i) => ({
      name: `BDS-3 I${i + 1}S`,
      constellation: 'BeiDou-3 IGSO',
      affiliation: 'HOSTILE' as const,
      capabilities: ['GPS' as const, 'PNT' as const],
      status: 'OPERATIONAL',
      inclination: 55.0, eccentricity: 0.075, periodMin: 1436.1,
      apogeeKm: 35786, perigeeKm: 35786,
      bandwidthProvided: ['L', 'S'],
      coverageRegion: 'WESTPAC',
      operator: 'PLASSF',
    })),
  },

  // ── Yaogan (Jianbing) ELINT Triplets — Naval ocean surveillance ────────────
  // "Yaogan" cover designation. NOSS-style triplets for geolocating ship emitters
  // via TDOA. 9 triplets = 27 satellites in near-circular LEO.
  {
    constellation: 'Yaogan ELINT',
    assets: Array.from({ length: 27 }, (_, i) => {
      const triplet = Math.floor(i / 3) + 1;
      const sat = (i % 3) + 1;
      return {
        name: `YG-${20 + triplet}${String.fromCharCode(64 + sat)}`,
        constellation: 'Yaogan ELINT',
        affiliation: 'HOSTILE' as const,
        capabilities: ['SIGINT_SPACE' as const, 'ISR_SPACE' as const],
        status: triplet <= 7 ? 'OPERATIONAL' : (triplet <= 8 ? 'DEGRADED' : 'OPERATIONAL'),
        inclination: 63.4, eccentricity: 0.002, periodMin: 106.4,
        apogeeKm: 1100, perigeeKm: 1080,
        coverageRegion: 'GLOBAL',
        operator: 'PLASSF',
      };
    }),
  },

  // ── Yaogan SAR — All-weather synthetic aperture radar imaging ──────────────
  // Multiple generations providing day/night, all-weather ground surveillance.
  {
    constellation: 'Yaogan SAR',
    assets: Array.from({ length: 8 }, (_, i) => ({
      name: `YG-${33 + i}`,
      constellation: 'Yaogan SAR',
      affiliation: 'HOSTILE' as const,
      capabilities: ['ISR_SPACE' as const],
      status: i < 6 ? 'OPERATIONAL' : 'DEGRADED',
      inclination: 97.4, eccentricity: 0.001, periodMin: 97.8,
      apogeeKm: 680, perigeeKm: 660,
      coverageRegion: 'GLOBAL',
      operator: 'PLASSF',
    })),
  },

  // ── Yaogan OES — Optical Earth Surveillance ────────────────────────────────
  // High-resolution electro-optical surveillance satellites.
  {
    constellation: 'Yaogan OES',
    assets: Array.from({ length: 6 }, (_, i) => ({
      name: `YG-${41 + i}`,
      constellation: 'Yaogan OES',
      affiliation: 'HOSTILE' as const,
      capabilities: ['ISR_SPACE' as const],
      status: 'OPERATIONAL',
      inclination: 97.4, eccentricity: 0.001, periodMin: 94.6,
      apogeeKm: 490, perigeeKm: 480,
      coverageRegion: 'GLOBAL',
      operator: 'PLASSF',
    })),
  },

  // ── Gaofen — High-resolution civilian/military dual-use imaging ────────────
  // Sub-meter optical and multi-spectral imaging. GF-11/12/13 series are
  // military-dedicated with reported 0.1m GSD capability.
  {
    constellation: 'Gaofen',
    assets: [
      { name: 'GF-11-01', constellation: 'Gaofen', affiliation: 'HOSTILE' as const, capabilities: ['ISR_SPACE' as const], status: 'OPERATIONAL', inclination: 97.4, eccentricity: 0.001, periodMin: 94.8, apogeeKm: 500, perigeeKm: 490, coverageRegion: 'GLOBAL', operator: 'PLASSF' },
      { name: 'GF-11-02', constellation: 'Gaofen', affiliation: 'HOSTILE' as const, capabilities: ['ISR_SPACE' as const], status: 'OPERATIONAL', inclination: 97.4, eccentricity: 0.001, periodMin: 94.8, apogeeKm: 500, perigeeKm: 490, coverageRegion: 'GLOBAL', operator: 'PLASSF' },
      { name: 'GF-12-01', constellation: 'Gaofen', affiliation: 'HOSTILE' as const, capabilities: ['ISR_SPACE' as const], status: 'OPERATIONAL', inclination: 97.4, eccentricity: 0.001, periodMin: 94.8, apogeeKm: 500, perigeeKm: 490, coverageRegion: 'GLOBAL', operator: 'PLASSF' },
      { name: 'GF-12-02', constellation: 'Gaofen', affiliation: 'HOSTILE' as const, capabilities: ['ISR_SPACE' as const], status: 'OPERATIONAL', inclination: 97.4, eccentricity: 0.001, periodMin: 94.8, apogeeKm: 500, perigeeKm: 490, coverageRegion: 'GLOBAL', operator: 'PLASSF' },
      { name: 'GF-13', constellation: 'Gaofen', affiliation: 'HOSTILE' as const, capabilities: ['ISR_SPACE' as const], status: 'OPERATIONAL', inclination: 0.0, eccentricity: 0.0001, periodMin: 1436.1, apogeeKm: 35786, perigeeKm: 35786, coverageRegion: 'WESTPAC', operator: 'PLASSF' },
    ],
  },

  // ── Tianlian — Data relay satellite system (Chinese TDRS equivalent) ───────
  // GEO relay nodes that provide real-time data downlink for LEO ISR/manned assets.
  {
    constellation: 'Tianlian',
    assets: Array.from({ length: 4 }, (_, i) => ({
      name: `TL-II-0${i + 1}`,
      constellation: 'Tianlian',
      affiliation: 'HOSTILE' as const,
      capabilities: ['DATALINK' as const, 'SATCOM_WIDEBAND' as const],
      status: 'OPERATIONAL',
      inclination: 0.0, eccentricity: 0.0001, periodMin: 1436.1,
      apogeeKm: 35786, perigeeKm: 35786,
      bandwidthProvided: ['S', 'Ka'],
      coverageRegion: 'GLOBAL',
      operator: 'PLASSF',
    })),
  },

  // ── Fengyun — Military/civil weather and environmental monitoring ──────────
  // FY-3 series (LEO polar) + FY-4 series (GEO). Dual-use for BDA cloud cover
  // assessment and battlespace environmental prediction.
  {
    constellation: 'Fengyun',
    assets: [
      // FY-3 LEO polar orbiting (3 active)
      ...Array.from({ length: 3 }, (_, i) => ({
        name: `FY-3${String.fromCharCode(68 + i)}`,
        constellation: 'Fengyun',
        affiliation: 'HOSTILE' as const,
        capabilities: ['WEATHER' as const],
        status: 'OPERATIONAL',
        inclination: 98.8, eccentricity: 0.001, periodMin: 101.3,
        apogeeKm: 836, perigeeKm: 830,
        coverageRegion: 'GLOBAL',
        operator: 'PLASSF',
      })),
      // FY-4 GEO (2 active, stationed over Indian Ocean and Western Pacific)
      ...Array.from({ length: 2 }, (_, i) => ({
        name: `FY-4${String.fromCharCode(65 + i)}`,
        constellation: 'Fengyun',
        affiliation: 'HOSTILE' as const,
        capabilities: ['WEATHER' as const],
        status: 'OPERATIONAL',
        inclination: 0.0, eccentricity: 0.0001, periodMin: 1436.1,
        apogeeKm: 35786, perigeeKm: 35786,
        coverageRegion: 'WESTPAC',
        operator: 'PLASSF',
      })),
    ],
  },

  // ── Shijian (SJ) — Experimental / EW / Space Domain Awareness ──────────────
  // SJ-6/17/21/23 series. Dual-use "technology demonstration" cover for space-
  // based EW, inspection/proximity operations, and space debris servicing.
  {
    constellation: 'Shijian',
    assets: [
      { name: 'SJ-17', constellation: 'Shijian', affiliation: 'HOSTILE' as const, capabilities: ['SDA' as const, 'SSA' as const], status: 'OPERATIONAL', inclination: 0.0, eccentricity: 0.0001, periodMin: 1436.1, apogeeKm: 35786, perigeeKm: 35786, coverageRegion: 'WESTPAC', operator: 'PLASSF' },
      { name: 'SJ-21', constellation: 'Shijian', affiliation: 'HOSTILE' as const, capabilities: ['SDA' as const, 'SSA' as const, 'EW_SPACE' as const], status: 'OPERATIONAL', inclination: 0.0, eccentricity: 0.0001, periodMin: 1436.1, apogeeKm: 35786, perigeeKm: 35786, coverageRegion: 'GLOBAL', operator: 'PLASSF' },
      { name: 'SJ-23', constellation: 'Shijian', affiliation: 'HOSTILE' as const, capabilities: ['EW_SPACE' as const, 'SDA' as const], status: 'OPERATIONAL', inclination: 0.0, eccentricity: 0.0001, periodMin: 1436.1, apogeeKm: 35786, perigeeKm: 35786, coverageRegion: 'GLOBAL', operator: 'PLASSF' },
      // LEO variants — technology demo and EW testing
      ...Array.from({ length: 3 }, (_, i) => ({
        name: `SJ-6-${String(i + 8).padStart(2, '0')}`,
        constellation: 'Shijian',
        affiliation: 'HOSTILE' as const,
        capabilities: ['EW_SPACE' as const, 'SIGINT_SPACE' as const],
        status: i < 2 ? 'OPERATIONAL' : 'DEGRADED',
        inclination: 97.7, eccentricity: 0.002, periodMin: 97.3,
        apogeeKm: 600, perigeeKm: 590,
        coverageRegion: 'GLOBAL',
        operator: 'PLASSF',
      })),
    ],
  },

  // ── TJS — Tongxin Jishu Shiyan (Communication Technology Test) ─────────────
  // Cover for GEO SIGINT/EW and missile warning. TJS-1/2/3 widely assessed as
  // Chinese equivalent of US SBIRS — GEO-based IR early warning.
  {
    constellation: 'TJS',
    assets: [
      { name: 'TJS-1', constellation: 'TJS', affiliation: 'HOSTILE' as const, capabilities: ['OPIR' as const, 'LAUNCH_DETECT' as const], status: 'OPERATIONAL', inclination: 0.0, eccentricity: 0.0001, periodMin: 1436.1, apogeeKm: 35786, perigeeKm: 35786, coverageRegion: 'WESTPAC', operator: 'PLASSF' },
      { name: 'TJS-2', constellation: 'TJS', affiliation: 'HOSTILE' as const, capabilities: ['SIGINT_SPACE' as const, 'EW_SPACE' as const], status: 'OPERATIONAL', inclination: 0.0, eccentricity: 0.0001, periodMin: 1436.1, apogeeKm: 35786, perigeeKm: 35786, coverageRegion: 'WESTPAC', operator: 'PLASSF' },
      { name: 'TJS-3', constellation: 'TJS', affiliation: 'HOSTILE' as const, capabilities: ['OPIR' as const, 'LAUNCH_DETECT' as const], status: 'OPERATIONAL', inclination: 0.0, eccentricity: 0.0001, periodMin: 1436.1, apogeeKm: 35786, perigeeKm: 35786, coverageRegion: 'GLOBAL', operator: 'PLASSF' },
      { name: 'TJS-9', constellation: 'TJS', affiliation: 'HOSTILE' as const, capabilities: ['SIGINT_SPACE' as const, 'EW_SPACE' as const], status: 'OPERATIONAL', inclination: 0.0, eccentricity: 0.0001, periodMin: 1436.1, apogeeKm: 35786, perigeeKm: 35786, coverageRegion: 'GLOBAL', operator: 'PLASSF' },
    ],
  },

  // ── Zhongxing (ChinaSat) — Military SATCOM ─────────────────────────────────
  // ZX-18/20/22/26 series used for Chinese military wideband/protected comms.
  {
    constellation: 'Zhongxing',
    assets: Array.from({ length: 4 }, (_, i) => ({
      name: `ZX-${[18, 20, 22, 26][i]}`,
      constellation: 'Zhongxing',
      affiliation: 'HOSTILE' as const,
      capabilities: ['SATCOM_WIDEBAND' as const, 'SATCOM_PROTECTED' as const],
      status: 'OPERATIONAL',
      inclination: 0.0, eccentricity: 0.0001, periodMin: 1436.1,
      apogeeKm: 35786, perigeeKm: 35786,
      bandwidthProvided: ['Ku', 'Ka', 'EHF'],
      coverageRegion: 'WESTPAC',
      operator: 'PLASSF',
    })),
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  RUSSIA — Aerospace Forces (VKS) / Main Intelligence Directorate (GRU)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── GLONASS-K — Russian PNT constellation ──────────────────────────────────
  // 24-slot MEO constellation at ~19,130 km. GLONASS-K2 modernization improving
  // accuracy and adding CDMA signals.
  {
    constellation: 'GLONASS-K',
    assets: Array.from({ length: 24 }, (_, i) => ({
      name: `GLONASS-${700 + i + 1}`,
      constellation: 'GLONASS-K',
      affiliation: 'HOSTILE' as const,
      capabilities: ['GPS' as const, 'PNT' as const],
      status: i < 20 ? 'OPERATIONAL' : (i < 22 ? 'DEGRADED' : 'MAINTENANCE'),
      inclination: 64.8, eccentricity: 0.001, periodMin: 675.7,
      apogeeKm: 19130, perigeeKm: 19130,
      bandwidthProvided: ['L'],
      coverageRegion: 'GLOBAL',
      operator: 'VKS',
    })),
  },

  // ── Liana — ELINT ocean surveillance system ────────────────────────────────
  // Lotos-S1 (passive ELINT) + Pion-NKS (active radar) — Russia's replacement
  // for the Soviet US-A/US-P RORSAT/EORSAT naval surveillance system.
  {
    constellation: 'Liana',
    assets: [
      { name: 'Lotos-S1 No.1', constellation: 'Liana', affiliation: 'HOSTILE' as const, capabilities: ['SIGINT_SPACE' as const], status: 'OPERATIONAL', inclination: 67.1, eccentricity: 0.001, periodMin: 115.0, apogeeKm: 900, perigeeKm: 890, coverageRegion: 'GLOBAL', operator: 'GRU' },
      { name: 'Lotos-S1 No.2', constellation: 'Liana', affiliation: 'HOSTILE' as const, capabilities: ['SIGINT_SPACE' as const], status: 'OPERATIONAL', inclination: 67.1, eccentricity: 0.001, periodMin: 115.0, apogeeKm: 900, perigeeKm: 890, coverageRegion: 'GLOBAL', operator: 'GRU' },
      { name: 'Lotos-S1 No.3', constellation: 'Liana', affiliation: 'HOSTILE' as const, capabilities: ['SIGINT_SPACE' as const], status: 'OPERATIONAL', inclination: 67.1, eccentricity: 0.001, periodMin: 115.0, apogeeKm: 900, perigeeKm: 890, coverageRegion: 'GLOBAL', operator: 'GRU' },
      { name: 'Lotos-S1 No.4', constellation: 'Liana', affiliation: 'HOSTILE' as const, capabilities: ['SIGINT_SPACE' as const], status: 'DEGRADED', inclination: 67.1, eccentricity: 0.001, periodMin: 115.0, apogeeKm: 900, perigeeKm: 890, coverageRegion: 'GLOBAL', operator: 'GRU' },
      { name: 'Pion-NKS No.1', constellation: 'Liana', affiliation: 'HOSTILE' as const, capabilities: ['ISR_SPACE' as const, 'SIGINT_SPACE' as const], status: 'OPERATIONAL', inclination: 67.1, eccentricity: 0.001, periodMin: 115.0, apogeeKm: 500, perigeeKm: 490, coverageRegion: 'GLOBAL', operator: 'GRU' },
      { name: 'Pion-NKS No.2', constellation: 'Liana', affiliation: 'HOSTILE' as const, capabilities: ['ISR_SPACE' as const, 'SIGINT_SPACE' as const], status: 'OPERATIONAL', inclination: 67.1, eccentricity: 0.001, periodMin: 115.0, apogeeKm: 500, perigeeKm: 490, coverageRegion: 'GLOBAL', operator: 'GRU' },
    ],
  },

  // ── Bars-M / Persona — Optical reconnaissance ──────────────────────────────
  // Russia's primary EO/IR imaging satellites. Bars-M (digital) replaced older
  // Persona (Resurs-P variant). Both SSO at ~500-700km.
  {
    constellation: 'Bars-M',
    assets: [
      { name: 'Bars-M No.1', constellation: 'Bars-M', affiliation: 'HOSTILE' as const, capabilities: ['ISR_SPACE' as const], status: 'OPERATIONAL', inclination: 97.6, eccentricity: 0.001, periodMin: 94.8, apogeeKm: 560, perigeeKm: 540, coverageRegion: 'GLOBAL', operator: 'VKS' },
      { name: 'Bars-M No.2', constellation: 'Bars-M', affiliation: 'HOSTILE' as const, capabilities: ['ISR_SPACE' as const], status: 'OPERATIONAL', inclination: 97.6, eccentricity: 0.001, periodMin: 94.8, apogeeKm: 560, perigeeKm: 540, coverageRegion: 'GLOBAL', operator: 'VKS' },
      { name: 'Bars-M No.3', constellation: 'Bars-M', affiliation: 'HOSTILE' as const, capabilities: ['ISR_SPACE' as const], status: 'OPERATIONAL', inclination: 97.6, eccentricity: 0.001, periodMin: 94.8, apogeeKm: 560, perigeeKm: 540, coverageRegion: 'GLOBAL', operator: 'VKS' },
      { name: 'Persona No.3', constellation: 'Bars-M', affiliation: 'HOSTILE' as const, capabilities: ['ISR_SPACE' as const], status: 'DEGRADED', inclination: 98.3, eccentricity: 0.001, periodMin: 96.6, apogeeKm: 720, perigeeKm: 700, coverageRegion: 'GLOBAL', operator: 'VKS' },
    ],
  },

  // ── Kondor — SAR reconnaissance ────────────────────────────────────────────
  // S-band SAR for all-weather imaging. Kondor-FKA (civil) and Kondor (military).
  {
    constellation: 'Kondor',
    assets: Array.from({ length: 3 }, (_, i) => ({
      name: `Kondor-FKA No.${i + 1}`,
      constellation: 'Kondor',
      affiliation: 'HOSTILE' as const,
      capabilities: ['ISR_SPACE' as const],
      status: i < 2 ? 'OPERATIONAL' : 'DEGRADED',
      inclination: 74.7, eccentricity: 0.0002, periodMin: 93.5,
      apogeeKm: 510, perigeeKm: 500,
      coverageRegion: 'GLOBAL',
      operator: 'VKS',
    })),
  },

  // ── Tundra (EKS/Kupol) — Missile early warning ────────────────────────────
  // Highly elliptical (Molniya) orbit — dwells over Northern Hemisphere for
  // extended observation of NA/EU ICBM launch areas. Replaces Soviet Oko system.
  {
    constellation: 'Tundra (EKS)',
    assets: Array.from({ length: 6 }, (_, i) => ({
      name: `EKS-${i + 1}`,
      constellation: 'Tundra (EKS)',
      affiliation: 'HOSTILE' as const,
      capabilities: ['OPIR' as const, 'LAUNCH_DETECT' as const],
      status: i < 5 ? 'OPERATIONAL' : 'DEGRADED',
      inclination: 63.4, eccentricity: 0.74, periodMin: 717.97,
      apogeeKm: 38950, perigeeKm: 1600,
      coverageRegion: 'GLOBAL',
      operator: 'VKS',
    })),
  },

  // ── Meridian — Military tactical SATCOM (HEO) ─────────────────────────────
  // Molniya orbit provides SATCOM coverage of Arctic/Northern sea routes where
  // GEO satellites have poor elevation angles. Fills Russia's polar SATCOM gap.
  {
    constellation: 'Meridian',
    assets: Array.from({ length: 4 }, (_, i) => ({
      name: `Meridian-M No.${i + 1}`,
      constellation: 'Meridian',
      affiliation: 'HOSTILE' as const,
      capabilities: ['SATCOM_TACTICAL' as const],
      status: i < 3 ? 'OPERATIONAL' : 'DEGRADED',
      inclination: 62.8, eccentricity: 0.74, periodMin: 717.97,
      apogeeKm: 39862, perigeeKm: 1016,
      bandwidthProvided: ['UHF', 'SHF'],
      coverageRegion: 'GLOBAL',
      operator: 'VKS',
    })),
  },

  // ── Blagovest — Military wideband SATCOM (GEO) ────────────────────────────
  // Ka/Ku-band wideband for military backbone comms. Russia's WGS equivalent.
  {
    constellation: 'Blagovest',
    assets: Array.from({ length: 4 }, (_, i) => ({
      name: `Blagovest No.${i + 11}`,
      constellation: 'Blagovest',
      affiliation: 'HOSTILE' as const,
      capabilities: ['SATCOM_WIDEBAND' as const],
      status: 'OPERATIONAL',
      inclination: 0.0, eccentricity: 0.0001, periodMin: 1436.1,
      apogeeKm: 35786, perigeeKm: 35786,
      bandwidthProvided: ['Ka', 'Ku'],
      coverageRegion: 'GLOBAL',
      operator: 'VKS',
    })),
  },

  // ── Luch (Olymp) — GEO data relay / inspection satellite ───────────────────
  // Officially data relay; Olymp-K has demonstrated proximity maneuvering near
  // Western GEO SATCOM/SIGINT satellites. Key RPO capability.
  {
    constellation: 'Luch (Olymp)',
    assets: [
      { name: 'Luch-5A', constellation: 'Luch (Olymp)', affiliation: 'HOSTILE' as const, capabilities: ['DATALINK' as const, 'SSA' as const], status: 'OPERATIONAL', inclination: 0.0, eccentricity: 0.0001, periodMin: 1436.1, apogeeKm: 35786, perigeeKm: 35786, coverageRegion: 'GLOBAL', operator: 'VKS' },
      { name: 'Luch-5B', constellation: 'Luch (Olymp)', affiliation: 'HOSTILE' as const, capabilities: ['DATALINK' as const, 'SSA' as const], status: 'OPERATIONAL', inclination: 0.0, eccentricity: 0.0001, periodMin: 1436.1, apogeeKm: 35786, perigeeKm: 35786, coverageRegion: 'GLOBAL', operator: 'VKS' },
      { name: 'Olymp-K No.1', constellation: 'Luch (Olymp)', affiliation: 'HOSTILE' as const, capabilities: ['SIGINT_SPACE' as const, 'SDA' as const, 'SSA' as const], status: 'OPERATIONAL', inclination: 0.0, eccentricity: 0.0001, periodMin: 1436.1, apogeeKm: 35786, perigeeKm: 35786, coverageRegion: 'GLOBAL', operator: 'GRU' },
      { name: 'Olymp-K No.2', constellation: 'Luch (Olymp)', affiliation: 'HOSTILE' as const, capabilities: ['SIGINT_SPACE' as const, 'SDA' as const, 'SSA' as const], status: 'OPERATIONAL', inclination: 0.0, eccentricity: 0.0001, periodMin: 1436.1, apogeeKm: 35786, perigeeKm: 35786, coverageRegion: 'GLOBAL', operator: 'GRU' },
    ],
  },

  // ── Razdan — Russian weather (DMSP equivalent) ─────────────────────────────
  // Electro-L GEO weather + Meteor-M polar orbiting.
  {
    constellation: 'Razdan/Meteor',
    assets: [
      { name: 'Electro-L No.3', constellation: 'Razdan/Meteor', affiliation: 'HOSTILE' as const, capabilities: ['WEATHER' as const], status: 'OPERATIONAL', inclination: 0.0, eccentricity: 0.0001, periodMin: 1436.1, apogeeKm: 35786, perigeeKm: 35786, coverageRegion: 'GLOBAL', operator: 'VKS' },
      { name: 'Electro-L No.4', constellation: 'Razdan/Meteor', affiliation: 'HOSTILE' as const, capabilities: ['WEATHER' as const], status: 'OPERATIONAL', inclination: 0.0, eccentricity: 0.0001, periodMin: 1436.1, apogeeKm: 35786, perigeeKm: 35786, coverageRegion: 'GLOBAL', operator: 'VKS' },
      { name: 'Meteor-M No.2-3', constellation: 'Razdan/Meteor', affiliation: 'HOSTILE' as const, capabilities: ['WEATHER' as const], status: 'OPERATIONAL', inclination: 98.8, eccentricity: 0.001, periodMin: 101.3, apogeeKm: 835, perigeeKm: 830, coverageRegion: 'GLOBAL', operator: 'VKS' },
      { name: 'Meteor-M No.2-4', constellation: 'Razdan/Meteor', affiliation: 'HOSTILE' as const, capabilities: ['WEATHER' as const], status: 'OPERATIONAL', inclination: 98.8, eccentricity: 0.001, periodMin: 101.3, apogeeKm: 835, perigeeKm: 830, coverageRegion: 'GLOBAL', operator: 'VKS' },
    ],
  },

  // ── Kosmos (14F150 Nivelir) — Russian SDA/SSA ─────────────────────────────
  // Space surveillance and inspection satellites in LEO, characterizing Western
  // space assets. Demonstrated RPO against US NRO satellites.
  {
    constellation: 'Kosmos SSA',
    assets: Array.from({ length: 3 }, (_, i) => ({
      name: `Kosmos-${2558 + i}`,
      constellation: 'Kosmos SSA',
      affiliation: 'HOSTILE' as const,
      capabilities: ['SDA' as const, 'SSA' as const],
      status: 'OPERATIONAL',
      inclination: 97.8, eccentricity: 0.002, periodMin: 97.3,
      apogeeKm: 600, perigeeKm: 580,
      coverageRegion: 'GLOBAL',
      operator: 'VKS',
    })),
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  NORTH KOREA — National Aerospace Development Administration (NADA)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    constellation: 'Malligyong',
    assets: [
      { name: 'Malligyong-1', constellation: 'Malligyong', affiliation: 'HOSTILE' as const, capabilities: ['ISR_SPACE' as const], status: 'DEGRADED', inclination: 97.4, eccentricity: 0.003, periodMin: 94.3, apogeeKm: 510, perigeeKm: 490, coverageRegion: 'WESTPAC', operator: 'NADA' },
      { name: 'Malligyong-1-1', constellation: 'Malligyong', affiliation: 'HOSTILE' as const, capabilities: ['ISR_SPACE' as const], status: 'OPERATIONAL', inclination: 97.4, eccentricity: 0.003, periodMin: 94.3, apogeeKm: 510, perigeeKm: 490, coverageRegion: 'WESTPAC', operator: 'NADA' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  IRAN — Islamic Revolutionary Guard Corps Aerospace Force (IRGC-AF)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    constellation: 'Noor',
    assets: [
      { name: 'Noor-1', constellation: 'Noor', affiliation: 'HOSTILE' as const, capabilities: ['ISR_SPACE' as const], status: 'DEGRADED', inclination: 59.8, eccentricity: 0.02, periodMin: 90.8, apogeeKm: 444, perigeeKm: 426, coverageRegion: 'GLOBAL', operator: 'IRGC' },
      { name: 'Noor-2', constellation: 'Noor', affiliation: 'HOSTILE' as const, capabilities: ['ISR_SPACE' as const], status: 'OPERATIONAL', inclination: 59.8, eccentricity: 0.02, periodMin: 90.8, apogeeKm: 500, perigeeKm: 480, coverageRegion: 'GLOBAL', operator: 'IRGC' },
      { name: 'Noor-3', constellation: 'Noor', affiliation: 'HOSTILE' as const, capabilities: ['ISR_SPACE' as const], status: 'OPERATIONAL', inclination: 59.8, eccentricity: 0.02, periodMin: 90.8, apogeeKm: 470, perigeeKm: 450, coverageRegion: 'GLOBAL', operator: 'IRGC' },
    ],
  },
];

// ─── Reference ORBAT ─────────────────────────────────────────────────────────
// Phase 3 will replace this with AI-based extraction from OPLAN prose.

export const INDOPACOM_BLUE_ORBAT: BlueUnitSpec[] = [
  { unitName: '388th Fighter Wing', unitDesignation: '388 FW', serviceBranch: 'USAF', domain: 'AIR', baseLocation: 'Kadena AB, Okinawa', baseLat: 26.3516, baseLon: 127.7692, platformName: 'F-35A', assetCount: 24 },
  { unitName: '35th Fighter Wing', unitDesignation: '35 FW', serviceBranch: 'USAF', domain: 'AIR', baseLocation: 'Misawa AB, Japan', baseLat: 40.7032, baseLon: 141.3686, platformName: 'F-16C', assetCount: 18 },
  { unitName: 'Carrier Air Wing 5', unitDesignation: 'CVW-5', serviceBranch: 'USN', domain: 'AIR', baseLocation: 'USS Ronald Reagan (CVN-76)', baseLat: 22.0, baseLon: 131.0, platformName: 'F/A-18E', assetCount: 36 },
  { unitName: '55th Wing', unitDesignation: '55 WG', serviceBranch: 'USAF', domain: 'AIR', baseLocation: 'Kadena AB (deployed)', baseLat: 26.3, baseLon: 127.8, platformName: 'RC-135V', assetCount: 4 },
  { unitName: 'Carrier Strike Group 5', unitDesignation: 'CSG-5', serviceBranch: 'USN', domain: 'MARITIME', baseLocation: 'Yokosuka, Japan', baseLat: 35.2833, baseLon: 139.6500, platformName: 'CVN (Nimitz)', assetCount: 1 },
  { unitName: 'Destroyer Squadron 15', unitDesignation: 'DESRON-15', serviceBranch: 'USN', domain: 'MARITIME', baseLocation: 'Yokosuka, Japan', baseLat: 35.2833, baseLon: 139.6500, platformName: 'DDG (Arleigh Burke)', assetCount: 5 },
  { unitName: 'Submarine Squadron 15', unitDesignation: 'SUBRON-15', serviceBranch: 'USN', domain: 'MARITIME', baseLocation: 'Guam', baseLat: 13.4443, baseLon: 144.7937, platformName: 'SSN (Virginia)', assetCount: 3 },
];

export const INDOPACOM_RED_FORCE: RedUnitSpec[] = [
  { unitName: 'Adversary Fighter Division', unitDesignation: 'RED-FTR-1', serviceBranch: 'OPFOR', domain: 'AIR', baseLocation: 'Mainland Airbase Alpha', baseLat: 25.0, baseLon: 121.5 },
  { unitName: 'Adversary SAM Brigade', unitDesignation: 'RED-AD-1', serviceBranch: 'OPFOR', domain: 'LAND', baseLocation: 'Coastal Defense Zone', baseLat: 24.5, baseLon: 118.0 },
  { unitName: 'Adversary Naval Task Force', unitDesignation: 'RED-NAVTF-1', serviceBranch: 'OPFOR', domain: 'MARITIME', baseLocation: 'Naval Base Bravo', baseLat: 24.0, baseLon: 118.5 },
];

// ─── Seed Helper Functions ───────────────────────────────────────────────────
// Each creates mutable scenario-scoped copies from the reference catalog.

export async function seedPlatformCatalog(): Promise<void> {
  for (const spec of PLATFORM_CATALOG) {
    await prisma.assetType.upsert({
      where: { name: spec.name },
      create: {
        name: spec.name,
        domain: spec.domain,
        category: spec.category,
        milsymbolCode: spec.milsymbolCode,
        commsSystems: spec.commsSystems as unknown as any,
        gpsType: spec.gpsType,
        dataLinks: spec.dataLinks,
      },
      update: {
        commsSystems: spec.commsSystems as unknown as any,
        gpsType: spec.gpsType,
        dataLinks: spec.dataLinks,
      },
    });
  }
  console.log(`  [REF-DATA] Upserted ${PLATFORM_CATALOG.length} platform types`);
}

export async function seedBasesForScenario(scenarioId: string): Promise<void> {
  for (const base of INDOPACOM_BASES) {
    await prisma.base.create({
      data: {
        scenarioId,
        name: base.name,
        baseType: base.baseType,
        latitude: base.latitude,
        longitude: base.longitude,
        country: base.country,
        icaoCode: base.icaoCode,
      },
    });
  }
  console.log(`  [REF-DATA] Created ${INDOPACOM_BASES.length} INDOPACOM bases for scenario`);
}

// ─── NORAD Catalog Numbers ───────────────────────────────────────────────────
// Public NORAD IDs for well-known satellites (source: space-track.org / CelesTrak).
// NRO/classified systems intentionally omitted — they have no public catalog entries.
// The seeder falls back to this table when the SpaceAssetSpec doesn't include noradId.
const NORAD_CATALOG: Record<string, string> = {
  // GPS III
  'GPS III SV01': '43873', 'GPS III SV02': '44506', 'GPS III SV03': '45854',
  'GPS III SV04': '46826', 'GPS III SV05': '48859', 'GPS III SV06': '53098',
  // GPS IIF
  'GPS IIF-1': '36585', 'GPS IIF-2': '37753', 'GPS IIF-3': '38833',
  'GPS IIF-4': '39166', 'GPS IIF-5': '39533', 'GPS IIF-6': '39741',
  'GPS IIF-7': '40105', 'GPS IIF-8': '40294', 'GPS IIF-9': '40534',
  'GPS IIF-10': '40730', 'GPS IIF-11': '41019', 'GPS IIF-12': '41328',
  // GPS IIR-M
  'GPS IIR-M1': '29601', 'GPS IIR-M2': '32260', 'GPS IIR-M3': '32384',
  'GPS IIR-M4': '32711', 'GPS IIR-M5': '35752', 'GPS IIR-M6': '36400',
  'GPS IIR-M7': '38857',
  // WGS
  'WGS-1': '32258', 'WGS-2': '33118', 'WGS-3': '34713',
  'WGS-4': '36108', 'WGS-5': '38070', 'WGS-6': '39222',
  'WGS-7': '40746', 'WGS-8': '42075', 'WGS-9': '44071',
  // SBIRS GEO
  'SBIRS GEO-1': '37481', 'SBIRS GEO-2': '38173',
  'SBIRS GEO-3': '43162', 'SBIRS GEO-4': '44481',
  // GOES
  'GOES-16 (East)': '41866', 'GOES-17 (Standby)': '43226', 'GOES-18 (West)': '51850',
  // TDRS
  'TDRS-8': '27566', 'TDRS-9': '27389', 'TDRS-10': '27566',
  'TDRS-11': '39070', 'TDRS-12': '40661', 'TDRS-13': '43158',
  // MUOS
  'MUOS-1': '38257', 'MUOS-2': '39486', 'MUOS-3': '40374',
  'MUOS-4': '41622', 'MUOS-5': '42649',
  // AEHF
  'AEHF-4': '43651', 'AEHF-5': '44481', 'AEHF-6': '45465',
  // Milstar
  'Milstar-2 F4': '26715', 'Milstar-2 F5': '28470',
  // DMSP
  'DMSP-5D3 F19': '40384', 'DMSP-5D3 F20': '99999',
  // STSS
  'STSS-Demo-1': '35937', 'STSS-Demo-2': '35938',
  // SSA
  'SAPPHIRE': '39088', 'SBSS Block 10': '37849',
  // Landsat
  'Landsat-8': '39084', 'Landsat-9': '49260',
  // WorldView
  'WorldView-3': '40115',
  // CBAS
  'CBAS-2': '48274',
};

export async function seedSpaceAssetsForScenario(scenarioId: string): Promise<void> {
  let total = 0;

  const allConstellations = [
    ...US_SPACE_CONSTELLATIONS,
    ...ADVERSARY_SPACE_CONSTELLATIONS,
  ];

  for (const constellation of allConstellations) {
    for (const asset of constellation.assets) {
      await prisma.spaceAsset.create({
        data: {
          scenarioId,
          name: asset.name,
          constellation: asset.constellation,
          affiliation: asset.affiliation,
          capabilities: asset.capabilities,
          status: asset.status,
          noradId: asset.noradId ?? NORAD_CATALOG[asset.name] ?? null,
          operator: asset.operator,
          coverageRegion: asset.coverageRegion,
          bandwidthProvided: asset.bandwidthProvided ?? [],
          inclination: asset.inclination,
          eccentricity: asset.eccentricity,
          periodMin: asset.periodMin,
          apogeeKm: asset.apogeeKm,
          perigeeKm: asset.perigeeKm,
        },
      });
      total++;
    }
  }

  const friendlyCount = US_SPACE_CONSTELLATIONS.reduce((sum, c) => sum + c.assets.length, 0);
  const hostileCount = ADVERSARY_SPACE_CONSTELLATIONS.reduce((sum, c) => sum + c.assets.length, 0);
  console.log(`  [REF-DATA] Created ${total} space assets (${friendlyCount} friendly, ${hostileCount} hostile) across ${allConstellations.length} constellations`);
}

export async function seedORBATForScenario(scenarioId: string): Promise<void> {
  const bases = await prisma.base.findMany({ where: { scenarioId } });
  const findBase = (name: string, lat: number, lon: number) =>
    bases.find(b => b.name.toLowerCase().includes(name.toLowerCase()))?.id
    ?? bases.find(b => Math.abs(b.latitude - lat) < 0.5 && Math.abs(b.longitude - lon) < 0.5)?.id
    ?? null;

  // Blue Force
  for (const unit of INDOPACOM_BLUE_ORBAT) {
    const baseId = findBase(unit.baseLocation, unit.baseLat, unit.baseLon);
    const dbType = await prisma.assetType.findUnique({ where: { name: unit.platformName } });

    const created = await prisma.unit.create({
      data: {
        scenarioId,
        unitName: unit.unitName,
        unitDesignation: unit.unitDesignation,
        serviceBranch: unit.serviceBranch,
        domain: unit.domain,
        baseLocation: unit.baseLocation,
        baseLat: unit.baseLat,
        baseLon: unit.baseLon,
        affiliation: 'FRIENDLY',
        baseId,
      },
    });

    if (dbType) {
      for (let i = 0; i < unit.assetCount; i++) {
        await prisma.asset.create({
          data: {
            unitId: created.id,
            assetTypeId: dbType.id,
            tailNumber: unit.domain === 'AIR'
              ? `${unit.unitDesignation.replace(/\s/g, '')}-${String(i + 1).padStart(3, '0')}`
              : undefined,
            name: unit.domain === 'MARITIME'
              ? `${unit.platformName} Hull ${i + 1}`
              : undefined,
            status: 'OPERATIONAL',
          },
        });
      }
    }
  }

  // Red Force
  for (const unit of INDOPACOM_RED_FORCE) {
    const created = await prisma.unit.create({
      data: {
        scenarioId,
        unitName: unit.unitName,
        unitDesignation: unit.unitDesignation,
        serviceBranch: unit.serviceBranch,
        domain: unit.domain,
        baseLocation: unit.baseLocation,
        baseLat: unit.baseLat,
        baseLon: unit.baseLon,
        affiliation: 'HOSTILE',
      },
    });

    const opforTypes = PLATFORM_CATALOG.filter(at => at.domain === unit.domain);
    if (opforTypes.length > 0) {
      const dbType = await prisma.assetType.findUnique({ where: { name: opforTypes[0].name } });
      if (dbType) {
        const count = unit.domain === 'AIR' ? 12 : 3;
        for (let i = 0; i < count; i++) {
          await prisma.asset.create({
            data: {
              unitId: created.id,
              assetTypeId: dbType.id,
              name: `OPFOR ${opforTypes[0].name} ${i + 1}`,
              status: 'OPERATIONAL',
            },
          });
        }
      }
    }
  }

  const totalUnits = INDOPACOM_BLUE_ORBAT.length + INDOPACOM_RED_FORCE.length;
  console.log(`  [REF-DATA] Created ${totalUnits} units (${INDOPACOM_BLUE_ORBAT.length} blue, ${INDOPACOM_RED_FORCE.length} red) for scenario`);
}
