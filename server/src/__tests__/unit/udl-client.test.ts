/**
 * Unit tests for UDL client service.
 * Tests Basic Auth construction, caching, epoch selection logic, and
 * the refreshTLEsForScenario orchestration — all with global fetch mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock Setup ──────────────────────────────────────────────────────────────

// Mock prisma before importing udl-client
vi.mock('../../db/prisma-client.js', () => ({
  default: {
    scenario: {
      findUnique: vi.fn(),
    },
    spaceAsset: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// Mock config
vi.mock('../../config.js', () => ({
  config: {
    udl: {
      username: 'testuser',
      password: 'testpass',
      baseUrl: 'https://udl.test/udl',
    },
  },
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const MOCK_ELSET = {
  idElset: 'abc-123',
  satNo: 48859,
  epoch: '2026-02-12T01:19:22.262592Z',
  line1: '1 48859U 21054A   26043.05511878 -.00000097 +00000+0 +00000+0 0 99990',
  line2: '2 48859  55.2310 337.4924 0023983 232.4263 260.3454  2.00576893034248',
  meanMotion: 2.00576893,
  eccentricity: 0.0023983,
  inclination: 55.231,
  raan: 337.4924,
  argOfPerigee: 232.4263,
  meanAnomaly: 260.3454,
  period: 717.929,
  apogee: 26622.872,
  perigee: 26495.478,
  semiMajorAxis: 26559.175,
  source: '18th SPCS',
  algorithm: 'SGP4',
  dataMode: 'REAL',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('UDL Client', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // ── Auth ─────────────────────────────────────────────────────────────────

  describe('Basic Auth', () => {
    it('sends correct Authorization header', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([MOCK_ELSET]),
      });

      const { fetchCurrentElset } = await import('../../services/udl-client.js');
      await fetchCurrentElset(48859);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://udl.test/udl/elset/current?satNo=48859');

      const expectedAuth = Buffer.from('testuser:testpass').toString('base64');
      expect(opts.headers.Authorization).toBe(`Basic ${expectedAuth}`);
      expect(opts.headers.Accept).toBe('application/json');
    });
  });

  // ── fetchCurrentElset ────────────────────────────────────────────────────

  describe('fetchCurrentElset', () => {
    it('returns the first ELSET from a successful response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([MOCK_ELSET]),
      });

      const { fetchCurrentElset } = await import('../../services/udl-client.js');
      const result = await fetchCurrentElset(48859);

      expect(result).toEqual(MOCK_ELSET);
      expect(result?.line1).toContain('48859');
      expect(result?.satNo).toBe(48859);
    });

    it('returns null when API returns empty array', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const { fetchCurrentElset } = await import('../../services/udl-client.js');
      const result = await fetchCurrentElset(99999);

      expect(result).toBeNull();
    });

    it('returns null on HTTP error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('Unauthorized'),
      });

      const { fetchCurrentElset } = await import('../../services/udl-client.js');
      const result = await fetchCurrentElset(48859);

      expect(result).toBeNull();
    });

    it('returns null on network error', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      const { fetchCurrentElset } = await import('../../services/udl-client.js');
      const result = await fetchCurrentElset(48859);

      expect(result).toBeNull();
    });

    it('caches results across calls', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([MOCK_ELSET]),
      });

      const { fetchCurrentElset } = await import('../../services/udl-client.js');

      const first = await fetchCurrentElset(48859);
      const second = await fetchCurrentElset(48859);

      expect(first).toEqual(second);
      // Only one fetch call — second hit the cache
      expect(mockFetch).toHaveBeenCalledOnce();
    });
  });

  // ── fetchElsetAtEpoch ────────────────────────────────────────────────────

  describe('fetchElsetAtEpoch', () => {
    it('uses current endpoint for dates within last 24h', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([MOCK_ELSET]),
      });

      const { fetchElsetAtEpoch } = await import('../../services/udl-client.js');
      const recentDate = new Date(Date.now() - 6 * 3600000); // 6h ago
      await fetchElsetAtEpoch(48859, recentDate);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('/elset/current');
      expect(url).not.toContain('/elset/history');
    });

    it('uses history endpoint for dates older than 24h', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([MOCK_ELSET]),
      });

      const { fetchElsetAtEpoch } = await import('../../services/udl-client.js');
      const oldDate = new Date('2025-06-15T00:00:00Z');
      await fetchElsetAtEpoch(48859, oldDate);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('/elset/history');
      expect(url).toContain('satNo=48859');
      expect(url).toContain('orderBy');
    });

    it('falls back to current if history returns empty', async () => {
      // First call (history) returns empty, second call (current) returns data
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([MOCK_ELSET]),
        });

      const { fetchElsetAtEpoch } = await import('../../services/udl-client.js');
      const oldDate = new Date('2025-01-01T00:00:00Z');
      const result = await fetchElsetAtEpoch(48859, oldDate);

      expect(result).toEqual(MOCK_ELSET);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  // ── refreshTLEsForScenario ───────────────────────────────────────────────

  describe('refreshTLEsForScenario', () => {
    it('fetches TLEs for all space assets with NORAD IDs and updates DB', async () => {
      const prisma = (await import('../../db/prisma-client.js')).default;

      (prisma.scenario.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        startDate: new Date(Date.now() - 2 * 3600000), // 2h ago → triggers current endpoint
      });

      (prisma.spaceAsset.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'sa-1', name: 'GPS III SV01', noradId: '48859' },
        { id: 'sa-2', name: 'WGS-10', noradId: '44071' },
        { id: 'sa-3', name: 'No NORAD', noradId: null },
      ]);

      (prisma.spaceAsset.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([MOCK_ELSET]),
      });

      const { refreshTLEsForScenario } = await import('../../services/udl-client.js');
      const updated = await refreshTLEsForScenario('test-scenario-id');

      // 2 assets with NORAD IDs should be updated (3rd has null)
      expect(updated).toBe(2);
      expect(prisma.spaceAsset.update).toHaveBeenCalledTimes(2);

      // Verify DB update payload includes TLE data
      const updateCall = (prisma.spaceAsset.update as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(updateCall[0].data.tleLine1).toBe(MOCK_ELSET.line1);
      expect(updateCall[0].data.tleLine2).toBe(MOCK_ELSET.line2);
      expect(updateCall[0].data.inclination).toBe(MOCK_ELSET.inclination);
      expect(updateCall[0].data.eccentricity).toBe(MOCK_ELSET.eccentricity);
      expect(updateCall[0].data.periodMin).toBe(MOCK_ELSET.period);
    });

    it('skips assets with invalid NORAD IDs', async () => {
      const prisma = (await import('../../db/prisma-client.js')).default;

      (prisma.scenario.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        startDate: new Date(),
      });

      (prisma.spaceAsset.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'sa-1', name: 'Bad ID', noradId: 'not-a-number' },
      ]);

      const { refreshTLEsForScenario } = await import('../../services/udl-client.js');
      const updated = await refreshTLEsForScenario('test-scenario-id');

      expect(updated).toBe(0);
      expect(prisma.spaceAsset.update).not.toHaveBeenCalled();
    });

    it('returns 0 when scenario not found', async () => {
      const prisma = (await import('../../db/prisma-client.js')).default;
      (prisma.scenario.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const { refreshTLEsForScenario } = await import('../../services/udl-client.js');
      const updated = await refreshTLEsForScenario('nonexistent');

      expect(updated).toBe(0);
    });

    it('continues processing remaining assets when one fails', async () => {
      const prisma = (await import('../../db/prisma-client.js')).default;

      (prisma.scenario.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        startDate: new Date(),
      });

      (prisma.spaceAsset.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'sa-1', name: 'Fail Asset', noradId: '11111' },
        { id: 'sa-2', name: 'Good Asset', noradId: '22222' },
      ]);

      // First fetch fails, second succeeds
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([MOCK_ELSET]),
        });

      (prisma.spaceAsset.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const { refreshTLEsForScenario } = await import('../../services/udl-client.js');
      const updated = await refreshTLEsForScenario('test-scenario-id');

      // Only the second asset succeeds
      expect(updated).toBe(1);
      expect(prisma.spaceAsset.update).toHaveBeenCalledOnce();
    });
  });

  // ── Unconfigured credentials ─────────────────────────────────────────────

  describe('when credentials not configured', () => {
    it('refreshTLEsForScenario returns 0 without making API calls', async () => {
      // Re-mock config with empty credentials
      vi.doMock('../../config.js', () => ({
        config: {
          udl: {
            username: '',
            password: '',
            baseUrl: 'https://udl.test/udl',
          },
        },
      }));

      const { refreshTLEsForScenario } = await import('../../services/udl-client.js');
      const updated = await refreshTLEsForScenario('any-id');

      expect(updated).toBe(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
