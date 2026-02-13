/**
 * Unit tests for server configuration.
 * Tests defaults and environment variable overrides.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('uses default port 3001', async () => {
    delete process.env.PORT;
    const { config } = await import('../../config.js');
    expect(config.port).toBe(3001);
  });

  it('reads PORT from environment', async () => {
    process.env.PORT = '4000';
    const { config } = await import('../../config.js');
    expect(config.port).toBe(4000);
  });

  it('defaults node env to development', async () => {
    delete process.env.NODE_ENV;
    const { config } = await import('../../config.js');
    expect(config.nodeEnv).toBe('development');
  });

  it('has simulation defaults', async () => {
    const { config } = await import('../../config.js');
    expect(config.sim.defaultCompression).toBe(720);
    expect(config.sim.tickIntervalMs).toBe(1000);
    expect(config.sim.positionUpdateIntervalMs).toBe(2000);
  });

  it('has LLM model tiers', async () => {
    const { config } = await import('../../config.js');
    expect(config.llm.flagship).toBeTruthy();
    expect(config.llm.midRange).toBeTruthy();
    expect(config.llm.fast).toBeTruthy();
  });

  it('defaults CORS origin to localhost:5173', async () => {
    delete process.env.CORS_ORIGIN;
    const { config } = await import('../../config.js');
    expect(config.corsOrigin).toBe('http://localhost:5173');
  });
});
