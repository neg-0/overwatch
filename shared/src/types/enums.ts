// ─── Enums ───────────────────────────────────────────────────────────────────

export enum OrderType {
  ATO = 'ATO',
  MTO = 'MTO',
  STO = 'STO',
  OPORD = 'OPORD',
  EXORD = 'EXORD',
  FRAGORD = 'FRAGORD',
  ACO = 'ACO',
  SPINS = 'SPINS',
}

export enum Domain {
  AIR = 'AIR',
  MARITIME = 'MARITIME',
  SPACE = 'SPACE',
  LAND = 'LAND',
}

export enum MissionStatus {
  PLANNED = 'PLANNED',
  BRIEFED = 'BRIEFED',
  LAUNCHED = 'LAUNCHED',
  AIRBORNE = 'AIRBORNE',
  ON_STATION = 'ON_STATION',
  ENGAGED = 'ENGAGED',
  EGRESSING = 'EGRESSING',
  RTB = 'RTB',
  RECOVERED = 'RECOVERED',
  CANCELLED = 'CANCELLED',
  DIVERTED = 'DIVERTED',
  DELAYED = 'DELAYED',
}

export enum WaypointType {
  DEP = 'DEP',
  IP = 'IP',
  CP = 'CP',
  TGT = 'TGT',
  EGR = 'EGR',
  REC = 'REC',
  ORBIT = 'ORBIT',
  REFUEL = 'REFUEL',
  CAP = 'CAP',
  PATROL = 'PATROL',
}

export enum TimeWindowType {
  TOT = 'TOT',
  ONSTA = 'ONSTA',
  OFFSTA = 'OFFSTA',
  REFUEL = 'REFUEL',
  COVERAGE = 'COVERAGE',
  SUPPRESS = 'SUPPRESS',
  TRANSIT = 'TRANSIT',
}

export enum SupportType {
  TANKER = 'TANKER',
  SEAD = 'SEAD',
  ISR = 'ISR',
  EW = 'EW',
  ESCORT = 'ESCORT',
  CAP = 'CAP',
}

export enum SpaceCapabilityType {
  GPS = 'GPS',
  GPS_MILITARY = 'GPS_MILITARY',
  SATCOM = 'SATCOM',
  SATCOM_PROTECTED = 'SATCOM_PROTECTED',
  SATCOM_WIDEBAND = 'SATCOM_WIDEBAND',
  SATCOM_TACTICAL = 'SATCOM_TACTICAL',
  OPIR = 'OPIR',
  ISR_SPACE = 'ISR_SPACE',
  EW_SPACE = 'EW_SPACE',
  WEATHER = 'WEATHER',
  PNT = 'PNT',
  LINK16 = 'LINK16',
  SIGINT_SPACE = 'SIGINT_SPACE',
  SDA = 'SDA',
  LAUNCH_DETECT = 'LAUNCH_DETECT',
  CYBER_SPACE = 'CYBER_SPACE',
  DATALINK = 'DATALINK',
  SSA = 'SSA',
}

export enum Affiliation {
  FRIENDLY = 'FRIENDLY',
  HOSTILE = 'HOSTILE',
  NEUTRAL = 'NEUTRAL',
  UNKNOWN = 'UNKNOWN',
}

export enum Classification {
  UNCLASSIFIED = 'UNCLASSIFIED',
  CUI = 'CUI',
  CONFIDENTIAL = 'CONFIDENTIAL',
  SECRET = 'SECRET',
  TOP_SECRET = 'TOP_SECRET',
}

export enum SimulationStatus {
  IDLE = 'IDLE',
  RUNNING = 'RUNNING',
  PAUSED = 'PAUSED',
  STOPPED = 'STOPPED',
}
