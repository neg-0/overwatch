/**
 * Time anchoring for tasking orders.
 *
 * The simulation owns the calendar: every order maps to a day-ordinal
 * (atoDayNumber) and supplies only a time-of-day. Absolute calendar dates in
 * source documents are never trusted for placement — military DTGs are often
 * abbreviated (`220430Z`, no month/year), and exercise documents use their own
 * notional calendar that need not match the scenario's start date.
 */

export interface TimeOfDay {
  hours: number;
  minutes: number;
}

const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAY_MS = 24 * 60 * 60 * 1000;

function clampTime(hours: number, minutes: number): TimeOfDay | null {
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

/**
 * Extract the UTC time-of-day from any common order time format: ISO 8601
 * datetime, full or abbreviated DTG (`DDHHMM[Z][MON][YY]`), or `HH:MM[Z]` /
 * `HHMM[Z]`. The date portion is deliberately ignored — only the time matters.
 * Returns null when no time can be extracted.
 */
export function extractTimeOfDay(raw: string | null | undefined): TimeOfDay | null {
  if (!raw) return null;
  const s = raw.trim().toUpperCase();

  // ISO 8601 datetime — e.g. 2026-04-22T06:10:00Z
  const iso = s.match(/T(\d{2}):(\d{2})/);
  if (iso) return clampTime(parseInt(iso[1], 10), parseInt(iso[2], 10));

  // DTG — DDHHMM, optionally followed by Z / month / year (e.g. 220610Z, 220610ZAPR26)
  const dtg = s.match(/^\d{2}(\d{2})(\d{2})\s*Z?\s*(?:[A-Z]{3})?\s*(?:\d{2,4})?$/);
  if (dtg) return clampTime(parseInt(dtg[1], 10), parseInt(dtg[2], 10));

  // HH:MM[Z] or HHMM[Z] — e.g. 06:10Z, 0610Z
  const hm = s.match(/^(\d{1,2}):?(\d{2})\s*Z?$/);
  if (hm) return clampTime(parseInt(hm[1], 10), parseInt(hm[2], 10));

  return null;
}

/**
 * Anchor a time-of-day onto a specific simulation day. `dayOrdinal` is 1-based:
 * day 1 is the scenario start date.
 */
export function anchorToSimDay(scenarioStart: Date, dayOrdinal: number, time: TimeOfDay): Date {
  const d = new Date(scenarioStart.getTime() + (dayOrdinal - 1) * DAY_MS);
  d.setUTCHours(time.hours, time.minutes, 0, 0);
  return d;
}

export interface AnchoredWindow {
  start: Date;
  end: Date | null;
}

/**
 * Anchor a start/end window onto a simulation day. When the end time-of-day is
 * at or before the start (a window crossing midnight, e.g. a 2200Z–0200Z CAP),
 * the end rolls to the next day.
 */
export function anchorWindow(
  scenarioStart: Date,
  dayOrdinal: number,
  startRaw: string | null | undefined,
  endRaw: string | null | undefined,
): AnchoredWindow | null {
  const startTod = extractTimeOfDay(startRaw);
  if (!startTod) return null;
  const start = anchorToSimDay(scenarioStart, dayOrdinal, startTod);

  const endTod = extractTimeOfDay(endRaw);
  if (!endTod) return { start, end: null };

  let end = anchorToSimDay(scenarioStart, dayOrdinal, endTod);
  if (end.getTime() <= start.getTime()) {
    end = new Date(end.getTime() + DAY_MS);
  }
  return { start, end };
}

/** Format a Date as a USMTF DTG: `DDHHMMZmmmYY` (e.g. `010430ZMAR26`). */
export function formatDTG(date: Date): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  return (
    p2(date.getUTCDate()) +
    p2(date.getUTCHours()) +
    p2(date.getUTCMinutes()) +
    'Z' +
    MONTH_NAMES[date.getUTCMonth()] +
    p2(date.getUTCFullYear() % 100)
  );
}
