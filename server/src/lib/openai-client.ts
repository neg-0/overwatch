import OpenAI from 'openai';
import crypto from 'crypto';
import { config } from '../config.js';
import prisma from '../db/prisma-client.js';
import { isDemoMode } from './demo-mode.js';

/**
 * Creates a stable deterministic hash by stripping ephemeral data (UUIDs, timestamps)
 * from the user prompt. This allows repeated demo passes to hit the cache even if
 * they are generated on a different day or map to a newly seeded database.
 */
function generateCacheKey(params: any): { key: string; schemaName: string } {
  const schemaName = params?.response_format?.json_schema?.name || 'TEXT';
  let input = '';

  const lastUserMsg = params.messages.filter((m: any) => m.role === 'user').pop();
  if (lastUserMsg && typeof lastUserMsg.content === 'string') {
    input = lastUserMsg.content;
  } else if (params.messages.length > 0) {
    const lastMsg = params.messages[params.messages.length - 1];
    input = typeof lastMsg.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg.content);
  }

  // Strip ephemeral identifiers that drift across runs
  input = input.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig, '<UUID>');
  input = input.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/g, '<DATE>');

  const hash = crypto.createHash('sha256').update(input).digest('hex').substring(0, 16);
  return { key: `${schemaName}_${hash}`, schemaName };
}

/**
 * Write a response to the Postgres LLM cache (fire-and-forget, non-blocking).
 */
async function writeToCache(
  cacheKey: string,
  schemaName: string,
  response: string,
  model: string,
  promptTokens?: number,
  outputTokens?: number,
): Promise<void> {
  try {
    await prisma.llmCache.upsert({
      where: { cacheKey },
      update: {
        response,
        model,
        promptTokens,
        outputTokens,
        lastHitAt: new Date(),
        hitCount: { increment: 1 },
      },
      create: {
        cacheKey,
        schemaName,
        response,
        model,
        promptTokens,
        outputTokens,
      },
    });
  } catch (err) {
    // Non-fatal — cache write failure should never block LLM calls
    console.warn(`[LlmCache] Failed to write cache for ${cacheKey}:`, err);
  }
}

/**
 * Read from the Postgres LLM cache. Returns null on miss.
 */
async function readFromCache(cacheKey: string): Promise<string | null> {
  try {
    const hit = await prisma.llmCache.findUnique({ where: { cacheKey } });
    if (hit) {
      // Update hit tracking (fire-and-forget)
      prisma.llmCache.update({
        where: { cacheKey },
        data: { lastHitAt: new Date(), hitCount: { increment: 1 } },
      }).catch(() => {}); // silent

      return hit.response;
    }
  } catch (err) {
    console.warn(`[LlmCache] Failed to read cache for ${cacheKey}:`, err);
  }
  return null;
}

let singletonProxy: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (singletonProxy) {
    return singletonProxy;
  }

  const isAskSage = config.llmProvider === 'asksage';
  const realClient = new OpenAI({
    apiKey: isAskSage
      ? config.askSageApiKey || 'mock-key-for-demo-mode'
      : config.openaiApiKey || 'mock-key-for-demo-mode',
    ...(isAskSage && { baseURL: 'https://api.asksage.ai/server/openai/v1' }),
  });

  if (isAskSage) {
    console.log('[LLM] Using AskSage provider (OpenAI-compatible endpoint)');
  }

  singletonProxy = new Proxy(realClient, {
    get(target, prop) {
      if (prop === 'chat') {
        return {
          completions: {
            create: async (params: any) => {
              const { key, schemaName } = generateCacheKey(params);

              // ─── DEMO MODE: check cache first ─────────────────────────────
              if (isDemoMode()) {
                const cached = await readFromCache(key);
                if (cached) {
                  console.log(`[DemoMode] 🟢 CACHE HIT: ${key}`);

                  // Realistic 2-2.5s delay for UI spinners
                  await new Promise(r => setTimeout(r, 2000 + (Math.random() * 1000)));

                  return {
                    id: crypto.randomUUID(),
                    object: 'chat.completion',
                    created: Math.floor(Date.now() / 1000),
                    model: params.model || 'gpt-5-cached',
                    choices: [
                      {
                        index: 0,
                        message: {
                          role: 'assistant',
                          content: cached,
                        },
                        finish_reason: 'stop',
                      },
                    ],
                    usage: {
                      prompt_tokens: 150,
                      completion_tokens: 500,
                      total_tokens: 650,
                    },
                  } as any;
                } else {
                  console.warn(`[DemoMode] 🔴 CACHE MISS: ${key}. Falling back to live LLM.`);
                }
              }

              // ─── LIVE LLM CALL (always, unless cache hit in demo mode) ────
              try {
                console.log(`[LlmCache] 📡 Calling Live OpenAI API: ${key}`);
                const response = await target.chat.completions.create(params);

                // ─── ALWAYS CACHE the response ────────────────────────────
                const content = response.choices[0]?.message?.content;
                if (content) {
                  writeToCache(
                    key,
                    schemaName,
                    content,
                    params.model || 'unknown',
                    response.usage?.prompt_tokens,
                    response.usage?.completion_tokens,
                  );
                  console.log(`[LlmCache] 💾 Cached response for: ${key}`);
                }

                return response;
              } catch (err) {
                if (isDemoMode()) {
                  console.error(`[DemoMode] 🔴 API Failure on Cache Miss. Returning blank placeholder.`);
                  // Fallback for demos if network is truly disconnected
                  return {
                    choices: [{ message: { content: '{}' }, finish_reason: 'stop' }],
                    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
                  } as any;
                }
                throw err;
              }
            },
          },
        };
      }

      return Reflect.get(target, prop);
    },
  });

  return singletonProxy;
}
