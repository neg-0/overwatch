/**
 * Unit tests for the mission taxonomy — canonicalization and applicableTo normalization.
 */
import { describe, expect, it } from 'vitest';
import {
  ALL_TOKEN,
  canonicalMissionType,
  canonicalMissionTypes,
  normalizeApplicableTo,
} from '../../services/mission-taxonomy.js';

describe('canonicalMissionTypes', () => {
  it('maps short codes to their canonical token', () => {
    expect(canonicalMissionTypes('SEAD')).toEqual(['SEAD']);
    expect(canonicalMissionTypes('OCA')).toEqual(['OCA']);
    expect(canonicalMissionTypes('DCA')).toEqual(['DCA']);
    expect(canonicalMissionTypes('ISR')).toEqual(['ISR']);
    expect(canonicalMissionTypes('TANKER')).toEqual(['TANKER']);
    expect(canonicalMissionTypes('C2')).toEqual(['C2']);
  });

  it('maps long-form descriptions to canonical tokens', () => {
    expect(canonicalMissionTypes('Suppression of Enemy Air Defenses')).toEqual(['SEAD']);
    expect(canonicalMissionTypes('Offensive Counter-Air')).toEqual(['OCA']);
    expect(canonicalMissionTypes('Close Air Support')).toEqual(['CAS']);
    expect(canonicalMissionTypes('Air Interdiction')).toEqual(['AI']);
    expect(canonicalMissionTypes('Combat Search and Rescue')).toEqual(['CSAR']);
  });

  it('resolves compound strings to multiple tokens', () => {
    expect(canonicalMissionTypes('OCA/Strike').sort()).toEqual(['OCA', 'STRIKE']);
    expect(canonicalMissionTypes('ESCORT/OCA').sort()).toEqual(['ESCORT', 'OCA']);
  });

  it('falls back to OTHER for unrecognized input', () => {
    expect(canonicalMissionTypes('General')).toEqual(['OTHER']);
    expect(canonicalMissionTypes('')).toEqual(['OTHER']);
    expect(canonicalMissionTypes(null)).toEqual(['OTHER']);
    expect(canonicalMissionTypes(undefined)).toEqual(['OTHER']);
  });

  it('does not false-match short codes inside longer words', () => {
    // "AI" must not match inside "AIRLIFT"; "EW" must not match inside "CREW"
    expect(canonicalMissionTypes('Airlift')).toEqual(['AIRLIFT']);
    expect(canonicalMissionTypes('Aircrew Coordination')).toEqual(['OTHER']);
  });

  it('canonicalMissionType returns the first match', () => {
    expect(canonicalMissionType('OCA/Strike')).toBe('OCA');
    expect(canonicalMissionType('nonsense')).toBe('OTHER');
  });
});

describe('normalizeApplicableTo', () => {
  it('canonicalizes each entry', () => {
    expect(normalizeApplicableTo(['sead', 'Offensive Counter-Air']).sort()).toEqual(['OCA', 'SEAD']);
  });

  it('collapses to [ALL] when ALL is present, dropping redundant siblings', () => {
    expect(normalizeApplicableTo(['SEAD', 'OCA', 'ALL'])).toEqual([ALL_TOKEN]);
    expect(normalizeApplicableTo(['ALL'])).toEqual([ALL_TOKEN]);
  });

  it('drops unrecognized noise entries', () => {
    expect(normalizeApplicableTo(['SEAD', 'gibberish'])).toEqual(['SEAD']);
  });

  it('dedupes repeated and synonymous entries', () => {
    expect(normalizeApplicableTo(['SEAD', 'SEAD', 'Suppression of Enemy Air Defenses'])).toEqual(['SEAD']);
  });

  it('returns an empty array for empty/nullish input', () => {
    expect(normalizeApplicableTo([])).toEqual([]);
    expect(normalizeApplicableTo(null)).toEqual([]);
    expect(normalizeApplicableTo(undefined)).toEqual([]);
  });
});
