/**
 * Unit tests for mission status progression logic.
 * Pure function, no database or network.
 */
import { describe, expect, it } from 'vitest';
import { getNextMissionStatus } from '../../services/simulation-engine.js';

describe('Mission Status Progression', () => {
  describe('getNextMissionStatus', () => {
    it('PLANNED → BRIEFED at TOT-4h', () => {
      expect(getNextMissionStatus('PLANNED', -4)).toBe('BRIEFED');
    });

    it('PLANNED stays PLANNED at TOT-5h (too early)', () => {
      expect(getNextMissionStatus('PLANNED', -5)).toBeNull();
    });

    it('BRIEFED → LAUNCHED at TOT-2h', () => {
      expect(getNextMissionStatus('BRIEFED', -2)).toBe('LAUNCHED');
    });

    it('LAUNCHED → AIRBORNE at TOT-1.5h', () => {
      expect(getNextMissionStatus('LAUNCHED', -1.5)).toBe('AIRBORNE');
    });

    it('AIRBORNE → ON_STATION at TOT-0.5h', () => {
      expect(getNextMissionStatus('AIRBORNE', -0.5)).toBe('ON_STATION');
    });

    it('ON_STATION → ENGAGED at TOT', () => {
      expect(getNextMissionStatus('ON_STATION', 0)).toBe('ENGAGED');
    });

    it('ENGAGED → EGRESSING at TOT+0.25h', () => {
      expect(getNextMissionStatus('ENGAGED', 0.25)).toBe('EGRESSING');
    });

    it('EGRESSING → RTB at TOT+1h', () => {
      expect(getNextMissionStatus('EGRESSING', 1)).toBe('RTB');
    });

    it('RTB → RECOVERED at TOT+3h', () => {
      expect(getNextMissionStatus('RTB', 3)).toBe('RECOVERED');
    });

    it('RECOVERED → null (terminal state)', () => {
      expect(getNextMissionStatus('RECOVERED', 10)).toBeNull();
    });

    it('full lifecycle: PLANNED → RECOVERED in correct order', () => {
      const lifecycle = [
        { status: 'PLANNED', time: -4 },
        { status: 'BRIEFED', time: -2 },
        { status: 'LAUNCHED', time: -1.5 },
        { status: 'AIRBORNE', time: -0.5 },
        { status: 'ON_STATION', time: 0 },
        { status: 'ENGAGED', time: 0.25 },
        { status: 'EGRESSING', time: 1 },
        { status: 'RTB', time: 3 },
      ];

      const expectedNext = [
        'BRIEFED', 'LAUNCHED', 'AIRBORNE', 'ON_STATION',
        'ENGAGED', 'EGRESSING', 'RTB', 'RECOVERED',
      ];

      lifecycle.forEach((step, i) => {
        const next = getNextMissionStatus(step.status, step.time);
        expect(next).toBe(expectedNext[i]);
      });
    });

    it('unknown status returns null', () => {
      expect(getNextMissionStatus('INVALID_STATUS', 0)).toBeNull();
    });

    it('does not skip statuses (PLANNED at TOT+10 only → BRIEFED)', () => {
      // Even if way past TOT, the function only returns the next immediate state
      expect(getNextMissionStatus('PLANNED', 10)).toBe('BRIEFED');
    });
  });
});
