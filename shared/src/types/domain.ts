import {
  Affiliation,
  Classification,
  Domain,
  MissionStatus,
  OrderType,
  SpaceCapabilityType,
  SupportType,
  TimeWindowType,
  WaypointType,
} from './enums.js';

// ─── Geospatial ──────────────────────────────────────────────────────────────

export interface GeoCoordinate {
  latitude: number;
  longitude: number;
  altitude_m?: number;
  mgrs?: string;
  killbox_id?: string;
}

export interface GeoJSONPoint {
  type: 'Point';
  coordinates: [number, number]; // [lon, lat]
}

export interface GeoJSONLineString {
  type: 'LineString';
  coordinates: [number, number][];
}

export interface GeoJSONPolygon {
  type: 'Polygon';
  coordinates: [number, number][][];
}

export type GeoJSONGeometry = GeoJSONPoint | GeoJSONLineString | GeoJSONPolygon;

export interface GeoJSONFeature<G extends GeoJSONGeometry = GeoJSONGeometry> {
  type: 'Feature';
  geometry: G;
  properties: Record<string, unknown>;
}

export interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

// ─── Scenario & Strategy ─────────────────────────────────────────────────────

export interface Scenario {
  id: string;
  name: string;
  description: string;
  theater: string;
  adversary: string;
  startDate: string; // ISO 8601
  endDate: string;
  classification: Classification;
  createdAt: string;
}

export interface StrategyDocument {
  id: string;
  scenarioId: string;
  title: string;
  docType: 'NMS' | 'CAMPAIGN_PLAN' | 'JFC_GUIDANCE' | 'COMPONENT_GUIDANCE';
  content: string;
  authorityLevel: string;
  effectiveDate: string;
}

export interface PlanningDocument {
  id: string;
  scenarioId: string;
  title: string;
  docType: 'JIPTL' | 'JPEL' | 'COMPONENT_PRIORITY' | 'SPINS' | 'ACO';
  content: string;
  effectiveDate: string;
  priorities: PriorityEntry[];
}

export interface PriorityEntry {
  id: string;
  planningDocId: string;
  rank: number;
  targetId?: string;
  effect: string;
  description: string;
  justification: string;
}

// ─── Tasking Orders ──────────────────────────────────────────────────────────

export interface TaskingOrder {
  id: string;
  scenarioId: string;
  orderType: OrderType;
  orderId: string; // e.g. "ATO-2026-025A"
  issuingAuthority: string;
  effectiveStart: string;
  effectiveEnd: string;
  classification: Classification;
  atoDayNumber?: number;
  rawText?: string;
  rawFormat?: 'USMTF' | 'OTH_GOLD' | 'MTF_XML' | 'PLAIN_TEXT';
  missionPackages: MissionPackage[];
  createdAt: string;
}

export interface MissionPackage {
  id: string;
  taskingOrderId: string;
  packageId: string;
  priorityRank: number;
  missionType: string;
  effectDesired: string;
  missions: Mission[];
}

export interface Mission {
  id: string;
  packageId: string;
  missionId: string; // e.g. "MSN4001"
  callsign?: string;
  domain: Domain;
  unitId?: string;
  platformType: string;
  platformCount: number;
  missionType: string;
  status: MissionStatus;
  affiliation: Affiliation;
  waypoints: Waypoint[];
  timeWindows: TimeWindow[];
  targets: Target[];
  supportRequirements: SupportRequirement[];
  spaceNeeds: SpaceNeed[];
}

export interface Waypoint {
  id: string;
  missionId: string;
  waypointType: WaypointType;
  sequence: number;
  latitude: number;
  longitude: number;
  altitude_ft?: number;
  speed_kts?: number;
  name?: string;
}

export interface TimeWindow {
  id: string;
  missionId: string;
  windowType: TimeWindowType;
  startTime: string;
  endTime?: string;
}

export interface Target {
  id: string;
  missionId: string;
  targetId: string;
  beNumber?: string;
  targetName: string;
  latitude: number;
  longitude: number;
  targetCategory?: string;
  priorityRank?: number;
  desiredEffect: string;
  collateralConcern?: string;
}

export interface SupportRequirement {
  id: string;
  missionId: string;
  supportType: SupportType;
  supportingMissionId?: string;
  details?: string;
}

// ─── Assets ──────────────────────────────────────────────────────────────────

export interface Unit {
  id: string;
  scenarioId: string;
  unitName: string;
  unitDesignation: string; // e.g. "388 FW"
  serviceBranch: string;
  domain: Domain;
  baseLocation: string;
  baseLat: number;
  baseLon: number;
  affiliation: Affiliation;
}

export interface AssetType {
  id: string;
  name: string; // e.g. "F-16C"
  domain: Domain;
  category: string; // e.g. "Fighter", "Destroyer", "Satellite"
  milsymbolCode?: string;
  spaceCapabilities?: SpaceCapabilityType[];
}

export interface Asset {
  id: string;
  unitId: string;
  assetTypeId: string;
  assetType?: AssetType;
  tailNumber?: string; // aircraft tail number or hull number
  name?: string; // e.g. "USS Mason"
  status: 'OPERATIONAL' | 'MAINTENANCE' | 'DAMAGED' | 'DESTROYED';
}

// ─── Space-Specific ──────────────────────────────────────────────────────────

export interface SpaceAsset {
  id: string;
  scenarioId: string;
  name: string; // e.g. "GPS III SV05"
  constellation: string; // e.g. "GPS III", "WGS", "SBIRS"
  noradId?: string;
  tleLine1?: string;
  tleLine2?: string;
  capabilities: SpaceCapabilityType[];
  status: 'OPERATIONAL' | 'MAINTENANCE' | 'DEGRADED' | 'LOST';
  orbitalParams?: {
    inclination: number;
    eccentricity: number;
    period_min: number;
    apogee_km: number;
    perigee_km: number;
  };
}

export interface SpaceNeed {
  id: string;
  missionId: string;
  spaceAssetId?: string;
  capabilityType: SpaceCapabilityType;
  priority: number;
  startTime: string;
  endTime: string;
  coverageLat?: number;
  coverageLon?: number;
  coverageRadiusKm?: number;
  fulfilled: boolean;
}

export interface SpaceCoverageWindow {
  id: string;
  spaceAssetId: string;
  startTime: string; // AOS
  endTime: string; // LOS
  maxElevation: number; // degrees
  maxElevationTime: string;
  centerLat: number;
  centerLon: number;
  swathWidthKm: number;
  capabilityType: SpaceCapabilityType;
}

// ─── Simulation ──────────────────────────────────────────────────────────────

export interface SimulationState {
  id: string;
  scenarioId: string;
  status: 'IDLE' | 'RUNNING' | 'PAUSED' | 'STOPPED';
  simTime: string; // current simulated time (ISO 8601)
  realStartTime: string;
  compressionRatio: number; // e.g. 720 = 1 real minute = 12 sim hours
  currentAtoDay: number;
}

export interface PositionUpdate {
  missionId: string;
  callsign?: string;
  domain: Domain;
  timestamp: string;
  latitude: number;
  longitude: number;
  altitude_ft?: number;
  heading?: number;
  speed_kts?: number;
  status: MissionStatus;
  fuelState?: string;
}

// ─── Decision Support ────────────────────────────────────────────────────────

export interface SpaceGap {
  id: string;
  capabilityType: SpaceCapabilityType;
  startTime: string;
  endTime: string;
  affectedMissions: string[]; // mission IDs
  severity: 'CRITICAL' | 'DEGRADED' | 'LOW';
  recommendation: string;
}

export interface LeadershipDecision {
  id: string;
  scenarioId: string;
  decisionType: 'ASSET_REALLOCATION' | 'PRIORITY_SHIFT' | 'MAINTENANCE_SCHEDULE' | 'CONTINGENCY';
  description: string;
  affectedAssetIds: string[];
  affectedMissionIds: string[];
  rationale: string;
  status: 'PROPOSED' | 'APPROVED' | 'EXECUTED';
  createdAt: string;
  executedAt?: string;
}

// ─── Gantt View ──────────────────────────────────────────────────────────────

export interface GanttTask {
  taskId: string;
  label: string;
  domain: Domain;
  start: string;
  end: string;
  status: MissionStatus;
  priorityRank: number;
  color: string;
  milestones: GanttMilestone[];
  dependencies: GanttDependency[];
  spaceWindows?: GanttSpaceWindow[];
}

export interface GanttMilestone {
  type: string;
  time: string;
  label?: string;
}

export interface GanttDependency {
  type: 'REQUIRES' | 'SUPPORTS' | 'CONFLICTS';
  missionId: string;
  label: string;
}

export interface GanttSpaceWindow {
  assetName: string;
  capabilityType: SpaceCapabilityType;
  start: string;
  end: string;
}

export interface GanttData {
  atoPeriod: {
    start: string;
    end: string;
  };
  priorityGroups: {
    priorityRank: number;
    effect: string;
    color: string;
    tasks: GanttTask[];
  }[];
  spaceAssetLanes: {
    assetId: string;
    assetName: string;
    windows: GanttSpaceWindow[];
  }[];
}

// ─── WebSocket Events ────────────────────────────────────────────────────────

export interface WSSimulationTick {
  event: 'simulation:tick';
  simTime: string;
  realTime: string;
  ratio: number;
  atoDay: number;
}

export interface WSOrderPublished {
  event: 'order:published';
  orderId: string;
  orderType: OrderType;
  day: number;
}

export interface WSMissionStatus {
  event: 'mission:status';
  missionId: string;
  status: MissionStatus;
  timestamp: string;
}

export interface WSPositionUpdate {
  event: 'position:update';
  update: PositionUpdate;
}

export interface WSSpaceCoverage {
  event: 'space:coverage';
  assetId: string;
  status: 'AOS' | 'LOS';
  coverageArea?: {
    centerLat: number;
    centerLon: number;
    radiusKm: number;
  };
}

export interface WSAlertGap {
  event: 'alert:gap';
  gap: SpaceGap;
}

export type WSEvent =
  | WSSimulationTick
  | WSOrderPublished
  | WSMissionStatus
  | WSPositionUpdate
  | WSSpaceCoverage
  | WSAlertGap;

// ─── API Response Types ──────────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number;
  page: number;
  pageSize: number;
}

// ─── Data Source Abstraction ─────────────────────────────────────────────────

export interface RawOrder {
  id: string;
  format: 'USMTF' | 'OTH_GOLD' | 'MTF_XML' | 'PLAIN_TEXT';
  orderType: OrderType;
  rawText: string;
  receivedAt: string;
}

export interface DataSourceProvider {
  getOrders(filter: OrderFilter): AsyncIterable<RawOrder>;
  getPositionUpdates(): AsyncIterable<PositionUpdate>;
}

export interface OrderFilter {
  orderType?: OrderType;
  fromDate?: string;
  toDate?: string;
  domain?: Domain;
}
