import OpenAI from 'openai';
import prisma from '../db/prisma-client.js';
import { broadcastArtifactResult } from '../websocket/ws-server.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ArtifactStatus = 'success' | 'placeholder' | 'error' | 'retry';

export interface GenerationLogEntry {
  scenarioId: string;
  step: string;
  artifact: string;
  model: string;
  rawOutput: string;
  outputLength: number;
  status: ArtifactStatus;
  errorMessage?: string;
  retryCount?: number;
  durationMs: number;
  promptTokens?: number;
  outputTokens?: number;
}

export interface LLMCallResult {
  content: string;
  promptTokens?: number;
  outputTokens?: number;
  durationMs: number;
  retries: number;
}

// ─── Log a generation attempt to the database ────────────────────────────────

export async function logGenerationAttempt(entry: GenerationLogEntry): Promise<void> {
  try {
    await prisma.generationLog.create({
      data: {
        scenarioId: entry.scenarioId,
        step: entry.step,
        artifact: entry.artifact,
        status: entry.status,
        model: entry.model,
        promptTokens: entry.promptTokens ?? null,
        outputTokens: entry.outputTokens ?? null,
        outputLength: entry.outputLength,
        rawOutput: entry.rawOutput || null,
        errorMessage: entry.errorMessage ?? null,
        retryCount: entry.retryCount ?? 0,
        durationMs: entry.durationMs,
      },
    });
  } catch (err) {
    // Never let logging failures crash the generation pipeline
    console.error(`  [LOG] Failed to write generation log for ${entry.artifact}:`, err);
  }

  // Broadcast to frontend (non-retry statuses only)
  if (entry.status !== 'retry') {
    broadcastArtifactResult(entry.scenarioId, {
      step: entry.step,
      artifact: entry.artifact,
      status: entry.status,
      outputLength: entry.outputLength,
      message: entry.status === 'error'
        ? entry.errorMessage || 'Unknown error'
        : entry.status === 'placeholder'
          ? `LLM output too short (${entry.outputLength} chars)`
          : undefined,
    });
  }
}

// ─── LLM call with retry + minimum-length validation ─────────────────────────

export async function callLLMWithRetry(params: {
  openai: OpenAI;
  model: string;
  messages: OpenAI.ChatCompletionMessageParam[];
  maxTokens: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
  minOutputLength: number;
  maxRetries?: number;
  scenarioId: string;
  step: string;
  artifact: string;
}): Promise<LLMCallResult> {
  const {
    openai,
    model,
    messages,
    maxTokens,
    reasoningEffort,
    minOutputLength,
    scenarioId,
    step,
    artifact,
  } = params;
  const maxRetries = params.maxRetries ?? 2;

  let bestContent = '';
  let bestTokens = { prompt: 0, output: 0 };
  let totalDurationMs = 0;
  let lastError: string | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const escalatedTokens = maxTokens + (attempt * 4000);
    const startMs = Date.now();

    try {
      const response = await openai.chat.completions.create({
        model,
        messages,
        ...(reasoningEffort && { reasoning_effort: reasoningEffort }),
        max_completion_tokens: escalatedTokens,
      });

      const durationMs = Date.now() - startMs;
      totalDurationMs += durationMs;

      const content = response.choices[0]?.message?.content || '';
      const finishReason = response.choices[0]?.finish_reason;
      const usage = response.usage;
      const reasoningTokens = (usage as any)?.completion_tokens_details?.reasoning_tokens ?? 0;

      console.log(`  [LLM] ${artifact} attempt ${attempt + 1}: ${content.length} chars, ${durationMs}ms (model: ${model}, max_tokens: ${escalatedTokens}, finish_reason: ${finishReason}, reasoning_tokens: ${reasoningTokens}, output_tokens: ${usage?.completion_tokens ?? 0})`);

      // Track the best (longest) response across retries
      if (content.length > bestContent.length) {
        bestContent = content;
        bestTokens = {
          prompt: usage?.prompt_tokens ?? 0,
          output: usage?.completion_tokens ?? 0,
        };
      }

      // If it meets the minimum length, log success and return
      if (content.length >= minOutputLength) {
        await logGenerationAttempt({
          scenarioId,
          step,
          artifact,
          model,
          rawOutput: content,
          outputLength: content.length,
          status: 'success',
          retryCount: attempt,
          durationMs: totalDurationMs,
          promptTokens: bestTokens.prompt,
          outputTokens: bestTokens.output,
        });

        return {
          content,
          promptTokens: bestTokens.prompt,
          outputTokens: bestTokens.output,
          durationMs: totalDurationMs,
          retries: attempt,
        };
      }

      // Too short — log retry and try again
      if (attempt < maxRetries) {
        console.warn(`  [LLM] ${artifact} too short (${content.length} < ${minOutputLength}), retrying with ${escalatedTokens + 2000} tokens...`);
        await logGenerationAttempt({
          scenarioId,
          step,
          artifact,
          model,
          rawOutput: content,
          outputLength: content.length,
          status: 'retry',
          retryCount: attempt,
          durationMs,
          promptTokens: usage?.prompt_tokens,
          outputTokens: usage?.completion_tokens,
        });

        // Exponential backoff: 1s, 2s, 4s
        await sleep(1000 * Math.pow(2, attempt));
      }
    } catch (err) {
      const durationMs = Date.now() - startMs;
      totalDurationMs += durationMs;
      lastError = err instanceof Error ? err.message : String(err);

      console.error(`  [LLM] ${artifact} attempt ${attempt + 1} failed: ${lastError}`);

      if (attempt < maxRetries) {
        await logGenerationAttempt({
          scenarioId,
          step,
          artifact,
          model,
          rawOutput: '',
          outputLength: 0,
          status: 'retry',
          errorMessage: lastError,
          retryCount: attempt,
          durationMs,
        });
        await sleep(1000 * Math.pow(2, attempt));
      }
    }
  }

  // All retries exhausted — log final status
  const finalStatus: ArtifactStatus = bestContent.length > 0 ? 'placeholder' : 'error';
  await logGenerationAttempt({
    scenarioId,
    step,
    artifact,
    model,
    rawOutput: bestContent,
    outputLength: bestContent.length,
    status: finalStatus,
    errorMessage: lastError || `Output too short after ${maxRetries + 1} attempts (best: ${bestContent.length} chars)`,
    retryCount: maxRetries,
    durationMs: totalDurationMs,
    promptTokens: bestTokens.prompt,
    outputTokens: bestTokens.output,
  });

  return {
    content: bestContent,
    promptTokens: bestTokens.prompt,
    outputTokens: bestTokens.output,
    durationMs: totalDurationMs,
    retries: maxRetries,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
