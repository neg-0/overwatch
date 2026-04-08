// ─── Shared Order Types & Helpers ──────────────────────────────────────────
// Used by both OrdersView and DocumentIntake pages.

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MissionTarget {
  id: string;
  targetName: string;
  latitude: number;
  longitude: number;
  desiredEffect: string;
  priorityRank?: number;
  targetCategory?: string;
}

export interface OrderTimeWindow {
  id: string;
  windowType: string;
  startTime?: string;
  endTime?: string;
}

export interface SupportReq {
  id: string;
  supportType: string;
  details?: string;
}

export interface SpaceNeed {
  id: string;
  capabilityType: string;
  systemName?: string;
  role: string;
  commsBand?: string;
  priority: number;
  fulfilled: boolean;
  spaceAsset?: { id: string; name: string; type: string };
}

export interface MissionDetail {
  id: string;
  missionId: string;
  callsign?: string;
  domain?: string;
  platformType?: string;
  platformCount?: number;
  status?: string;
  timeWindows: OrderTimeWindow[];
  targets: MissionTarget[];
  supportReqs: SupportReq[];
  spaceNeeds: SpaceNeed[];
  unit?: { id: string; name: string };
}

export interface MissionPackageDetail {
  id: string;
  packageId?: string;
  priorityRank?: number;
  missionType?: string;
  effectDesired?: string;
  missions: MissionDetail[];
}

export interface OrderSummary {
  id: string;
  orderId: string;
  orderType: string;
  effectiveStart?: string;
  effectiveEnd?: string;
  issuingAuthority?: string;
  atoDayNumber?: number;
  status?: string;
}

export interface OrderDetail extends OrderSummary {
  classification?: string;
  sourceFormat?: string;
  confidence?: number | null;
  rawText?: string | null;
  rawFormat?: string | null;
  missionPackages: MissionPackageDetail[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Map orderType (ATO/MTO/STO) to CSS badge class suffix */
export function orderTypeBadge(orderType: string): string {
  switch (orderType) {
    case 'ATO': return 'air';
    case 'MTO': return 'maritime';
    case 'STO': return 'space';
    default: return 'land';
  }
}

/** Format ISO datetime as DTG: "0600Z 15APR" */
export function formatDtg(iso?: string): string {
  if (!iso) return '--';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return `${hh}${mm}Z ${day}${months[d.getUTCMonth()]}`;
}
