/**
 * Unit tests for time-anchor — DTG/time-of-day parsing and simulation-day anchoring.
 */
import { describe, expect, it } from 'vitest';
import {
  extractTimeOfDay,
  anchorToSimDay,
  anchorWindow,
  formatDTG,
} from '../../services/time-anchor.js';

describe('extractTimeOfDay', () => {
  it('parses ISO 8601 datetimes', () => {
    expect(extractTimeOfDay('2026-04-22T06:10:00Z')).toEqual({ hours: 6, minutes: 10 });
  });

  it('parses full DTGs with month and year', () => {
    expect(extractTimeOfDay('220610ZAPR26')).toEqual({ hours: 6, minutes: 10 });
    expect(extractTimeOfDay('220610Z APR 26')).toEqual({ hours: 6, minutes: 10 });
  });

  it('parses abbreviated DTGs with no month/year', () => {
    expect(extractTimeOfDay('220001Z')).toEqual({ hours: 0, minutes: 1 });
    expect(extractTimeOfDay('222359Z')).toEqual({ hours: 23, minutes: 59 });
  });

  it('parses HH:MM and HHMM time-of-day', () => {
    expect(extractTimeOfDay('06:10Z')).toEqual({ hours: 6, minutes: 10 });
    expect(extractTimeOfDay('0610Z')).toEqual({ hours: 6, minutes: 10 });
    expect(extractTimeOfDay('2200')).toEqual({ hours: 22, minutes: 0 });
  });

  it('returns null for unparseable or out-of-range input', () => {
    expect(extractTimeOfDay(null)).toBeNull();
    expect(extractTimeOfDay('')).toBeNull();
    expect(extractTimeOfDay('not a time')).toBeNull();
    expect(extractTimeOfDay('259999Z')).toBeNull(); // hour 99, minute 99
  });
});

describe('anchorToSimDay', () => {
  const start = new Date('2026-03-01T00:00:00Z');

  it('anchors time-of-day onto day 1 (the scenario start)', () => {
    expect(anchorToSimDay(start, 1, { hours: 6, minutes: 10 }).toISOString())
      .toBe('2026-03-01T06:10:00.000Z');
  });

  it('offsets by (ordinal - 1) days', () => {
    expect(anchorToSimDay(start, 2, { hours: 0, minutes: 0 }).toISOString())
      .toBe('2026-03-02T00:00:00.000Z');
    expect(anchorToSimDay(start, 14, { hours: 12, minutes: 30 }).toISOString())
      .toBe('2026-03-14T12:30:00.000Z');
  });
});

describe('anchorWindow', () => {
  const start = new Date('2026-03-01T00:00:00Z');

  it('anchors a same-day window', () => {
    const w = anchorWindow(start, 2, '220610Z', '220625Z');
    expect(w?.start.toISOString()).toBe('2026-03-02T06:10:00.000Z');
    expect(w?.end?.toISOString()).toBe('2026-03-02T06:25:00.000Z');
  });

  it('rolls a midnight-crossing window end to the next day', () => {
    const w = anchorWindow(start, 2, '2200Z', '0200Z');
    expect(w?.start.toISOString()).toBe('2026-03-02T22:00:00.000Z');
    expect(w?.end?.toISOString()).toBe('2026-03-03T02:00:00.000Z');
  });

  it('returns a null end when no end time is given', () => {
    const w = anchorWindow(start, 1, '0800Z', null);
    expect(w?.start.toISOString()).toBe('2026-03-01T08:00:00.000Z');
    expect(w?.end).toBeNull();
  });

  it('returns null when the start cannot be parsed', () => {
    expect(anchorWindow(start, 1, 'garbage', '0800Z')).toBeNull();
  });
});

describe('formatDTG', () => {
  it('formats a Date as a USMTF DTG', () => {
    expect(formatDTG(new Date('2026-03-01T04:30:00Z'))).toBe('010430ZMAR26');
    expect(formatDTG(new Date('2026-12-31T23:59:00Z'))).toBe('312359ZDEC26');
  });
});
