/**
 * Unit tests for generation-logger.ts
 *
 * Tests:
 * - logGenerationAttempt: DB persistence, error handling, WebSocket broadcasts
 * - callLLMWithRetry: success path, retry on short output, retry on error,
 *   max retries exhausted, placeholder vs error status, token escalation
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock dependencies ───────────────────────────────────────────────────────

const { mockPrisma, mockBroadcast } = vi.hoisted(() => ({
  mockPrisma: {
    generationLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
  mockBroadcast: vi.fn(),
}));

vi.mock('../../db/prisma-client.js', () => ({
  default: mockPrisma,
}));

vi.mock('../../websocket/ws-server.js', () => ({
  broadcastArtifactResult: mockBroadcast,
}));

// Stub sleep to avoid real delays
vi.mock('../../services/generation-logger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/generation-logger.js')>();
  return {
    ...actual,
  };
});

// We need to mock the `sleep` function which is internal.
// Instead we'll use vi.useFakeTimers to fast-forward timers.

// ─── Import after mocks ─────────────────────────────────────────────────────

import type { GenerationLogEntry } from '../../services/generation-logger.js';
import { callLLMWithRetry, logGenerationAttempt } from '../../services/generation-logger.js';

// ═══════════════════════════════════════════════════════════════════════════════

function makeEntry(overrides: Partial<GenerationLogEntry> = {}): GenerationLogEntry {
  return {
    scenarioId: 'scen-001',
    step: '1/8',
    artifact: 'NDS',
    model: 'gpt-4o',
    rawOutput: 'Strategy document content...',
    outputLength: 500,
    status: 'success',
    durationMs: 1500,
    promptTokens: 100,
    outputTokens: 500,
    ...overrides,
  };
}

function makeMockOpenAI(responseContent: string, opts: { tokens?: number; finishReason?: string } = {}) {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{
            message: { content: responseContent },
            finish_reason: opts.finishReason ?? 'stop',
          }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: opts.tokens ?? 500,
            total_tokens: (opts.tokens ?? 500) + 100,
            completion_tokens_details: { reasoning_tokens: 50 },
          },
        }),
      },
    },
  } as any;
}

describe('Generation Logger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  // ─── logGenerationAttempt ──────────────────────────────────────────────────

  describe('logGenerationAttempt', () => {
    it('writes generation log to database', async () => {
      await logGenerationAttempt(makeEntry());

      expect(mockPrisma.generationLog.create).toHaveBeenCalledOnce();
      expect(mockPrisma.generationLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          scenarioId: 'scen-001',
          step: '1/8',
          artifact: 'NDS',
          model: 'gpt-4o',
          status: 'success',
          outputLength: 500,
        }),
      });
    });

    it('broadcasts success status to WebSocket', async () => {
      await logGenerationAttempt(makeEntry({ status: 'success' }));

      expect(mockBroadcast).toHaveBeenCalledOnce();
      expect(mockBroadcast).toHaveBeenCalledWith('scen-001', expect.objectContaining({
        status: 'success',
        artifact: 'NDS',
      }));
    });

    it('broadcasts error status with error message', async () => {
      await logGenerationAttempt(makeEntry({
        status: 'error',
        errorMessage: 'API rate limit exceeded',
      }));

      expect(mockBroadcast).toHaveBeenCalledWith('scen-001', expect.objectContaining({
        status: 'error',
        message: 'API rate limit exceeded',
      }));
    });

    it('broadcasts placeholder status with short output message', async () => {
      await logGenerationAttempt(makeEntry({
        status: 'placeholder',
        outputLength: 42,
      }));

      expect(mockBroadcast).toHaveBeenCalledWith('scen-001', expect.objectContaining({
        status: 'placeholder',
        message: 'LLM output too short (42 chars)',
      }));
    });

    it('does NOT broadcast retry status', async () => {
      await logGenerationAttempt(makeEntry({ status: 'retry' }));

      expect(mockBroadcast).not.toHaveBeenCalled();
    });

    it('handles null optional fields', async () => {
      const entry = makeEntry({
        promptTokens: undefined,
        outputTokens: undefined,
        errorMessage: undefined,
        retryCount: undefined,
        rawOutput: '',
      });

      await logGenerationAttempt(entry);

      expect(mockPrisma.generationLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          promptTokens: null,
          outputTokens: null,
          errorMessage: null,
          retryCount: 0,
          rawOutput: null,
        }),
      });
    });

    it('does not throw when DB write fails', async () => {
      mockPrisma.generationLog.create.mockRejectedValueOnce(new Error('DB connection lost'));

      // Should not throw
      await expect(logGenerationAttempt(makeEntry())).resolves.toBeUndefined();
    });

    it('still broadcasts even if DB write fails', async () => {
      mockPrisma.generationLog.create.mockRejectedValueOnce(new Error('DB error'));

      await logGenerationAttempt(makeEntry({ status: 'success' }));

      expect(mockBroadcast).toHaveBeenCalledOnce();
    });
  });

  // ─── callLLMWithRetry ─────────────────────────────────────────────────────

  describe('callLLMWithRetry', () => {
    it('returns content on first attempt when output meets minimum length', async () => {
      const longContent = 'A'.repeat(200);
      const openai = makeMockOpenAI(longContent);

      const result = await callLLMWithRetry({
        openai,
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Generate something' }],
        maxTokens: 8000,
        minOutputLength: 100,
        scenarioId: 'scen-001',
        step: '1/8',
        artifact: 'NDS',
      });

      expect(result.content).toBe(longContent);
      expect(result.retries).toBe(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(openai.chat.completions.create).toHaveBeenCalledOnce();
    });

    it('returns promptTokens and outputTokens', async () => {
      const openai = makeMockOpenAI('A'.repeat(200), { tokens: 750 });

      const result = await callLLMWithRetry({
        openai,
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'test' }],
        maxTokens: 8000,
        minOutputLength: 100,
        scenarioId: 'scen-001',
        step: '1/8',
        artifact: 'Test',
      });

      expect(result.promptTokens).toBe(100);
      expect(result.outputTokens).toBe(750);
    });

    it('retries when output is too short and eventually succeeds', async () => {
      vi.useFakeTimers();
      const shortContent = 'short';
      const longContent = 'A'.repeat(200);
      const openai = makeMockOpenAI(shortContent);

      // First call returns short, second returns long
      openai.chat.completions.create
        .mockResolvedValueOnce({
          choices: [{ message: { content: shortContent }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105, completion_tokens_details: {} },
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: longContent }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300, completion_tokens_details: {} },
        });

      const promise = callLLMWithRetry({
        openai,
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'test' }],
        maxTokens: 8000,
        minOutputLength: 100,
        maxRetries: 2,
        scenarioId: 'scen-001',
        step: '1/8',
        artifact: 'NDS',
      });

      // Advance past backoff
      await vi.advanceTimersByTimeAsync(10000);

      const result = await promise;

      expect(result.content).toBe(longContent);
      expect(result.retries).toBe(1);
      expect(openai.chat.completions.create).toHaveBeenCalledTimes(2);
    });

    it('returns best content as placeholder when all retries produce short output', async () => {
      vi.useFakeTimers();
      const mediumContent = 'B'.repeat(50); // short but not empty
      const openai = makeMockOpenAI(mediumContent);

      const promise = callLLMWithRetry({
        openai,
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'test' }],
        maxTokens: 8000,
        minOutputLength: 100,
        maxRetries: 1,
        scenarioId: 'scen-001',
        step: '1/8',
        artifact: 'NDS',
      });

      await vi.advanceTimersByTimeAsync(10000);
      const result = await promise;

      expect(result.content).toBe(mediumContent);
      expect(result.retries).toBe(1);
      // Should log 'placeholder' status (not 'error') since we have some content
      expect(mockPrisma.generationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'placeholder' }),
        }),
      );
    });

    it('returns error status when all retries produce empty output', async () => {
      vi.useFakeTimers();
      const openai = makeMockOpenAI('');

      const promise = callLLMWithRetry({
        openai,
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'test' }],
        maxTokens: 8000,
        minOutputLength: 100,
        maxRetries: 1,
        scenarioId: 'scen-001',
        step: '1/8',
        artifact: 'NDS',
      });

      await vi.advanceTimersByTimeAsync(10000);
      const result = await promise;

      expect(result.content).toBe('');
      expect(result.retries).toBe(1);
      expect(mockPrisma.generationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'error' }),
        }),
      );
    });

    it('escalates max_tokens on each retry', async () => {
      vi.useFakeTimers();
      const shortContent = 'tiny';
      const openai = makeMockOpenAI(shortContent);

      const promise = callLLMWithRetry({
        openai,
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'test' }],
        maxTokens: 8000,
        minOutputLength: 100,
        maxRetries: 2,
        scenarioId: 'scen-001',
        step: '1/8',
        artifact: 'NDS',
      });

      await vi.advanceTimersByTimeAsync(20000);
      await promise;

      // 3 attempts total (0, 1, 2)
      expect(openai.chat.completions.create).toHaveBeenCalledTimes(3);

      // Verify escalating token counts: 8000, 12000, 16000
      const calls = openai.chat.completions.create.mock.calls;
      expect(calls[0][0].max_completion_tokens).toBe(8000);
      expect(calls[1][0].max_completion_tokens).toBe(12000);
      expect(calls[2][0].max_completion_tokens).toBe(16000);
    });

    it('handles API errors with retry', async () => {
      vi.useFakeTimers();
      const openai = makeMockOpenAI('A'.repeat(200));

      // First call throws, second succeeds
      openai.chat.completions.create
        .mockRejectedValueOnce(new Error('Rate limit exceeded'))
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'A'.repeat(200) }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300, completion_tokens_details: {} },
        });

      const promise = callLLMWithRetry({
        openai,
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'test' }],
        maxTokens: 8000,
        minOutputLength: 100,
        maxRetries: 2,
        scenarioId: 'scen-001',
        step: '1/8',
        artifact: 'NDS',
      });

      await vi.advanceTimersByTimeAsync(10000);
      const result = await promise;

      expect(result.content).toBe('A'.repeat(200));
      expect(result.retries).toBe(1);
    });

    it('defaults maxRetries to 2', async () => {
      vi.useFakeTimers();
      const openai = makeMockOpenAI('short');

      const promise = callLLMWithRetry({
        openai,
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'test' }],
        maxTokens: 8000,
        minOutputLength: 100,
        // maxRetries not specified — should default to 2
        scenarioId: 'scen-001',
        step: '1/8',
        artifact: 'NDS',
      });

      await vi.advanceTimersByTimeAsync(30000);
      await promise;

      // 3 total attempts (0, 1, 2) → maxRetries defaults to 2
      expect(openai.chat.completions.create).toHaveBeenCalledTimes(3);
    });

    it('keeps best (longest) content across retries', async () => {
      vi.useFakeTimers();
      const openai = makeMockOpenAI('');

      // First: 30 chars, second: 50 chars, third: 20 chars — best is 50
      openai.chat.completions.create
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'A'.repeat(30) }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130, completion_tokens_details: {} },
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'B'.repeat(50) }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, completion_tokens_details: {} },
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'C'.repeat(20) }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, completion_tokens_details: {} },
        });

      const promise = callLLMWithRetry({
        openai,
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'test' }],
        maxTokens: 8000,
        minOutputLength: 100,
        maxRetries: 2,
        scenarioId: 'scen-001',
        step: '1/8',
        artifact: 'NDS',
      });

      await vi.advanceTimersByTimeAsync(30000);
      const result = await promise;

      expect(result.content).toBe('B'.repeat(50));
    });

    it('passes reasoningEffort when specified', async () => {
      const openai = makeMockOpenAI('A'.repeat(200));

      await callLLMWithRetry({
        openai,
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'test' }],
        maxTokens: 8000,
        reasoningEffort: 'high',
        minOutputLength: 100,
        scenarioId: 'scen-001',
        step: '1/8',
        artifact: 'NDS',
      });

      expect(openai.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          reasoning_effort: 'high',
        }),
      );
    });

    it('does not include reasoning_effort when not specified', async () => {
      const openai = makeMockOpenAI('A'.repeat(200));

      await callLLMWithRetry({
        openai,
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'test' }],
        maxTokens: 8000,
        minOutputLength: 100,
        scenarioId: 'scen-001',
        step: '1/8',
        artifact: 'NDS',
      });

      const callArgs = openai.chat.completions.create.mock.calls[0][0];
      expect(callArgs).not.toHaveProperty('reasoning_effort');
    });
  });
});
