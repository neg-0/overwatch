import OpenAI from 'openai';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

const DEMO_CACHE_PATH = path.resolve(process.cwd(), 'data/demo-cache.json');

let cacheData: Record<string, string> = {};
let cacheLoaded = false;

function loadCache() {
  if (cacheLoaded) return;
  if (fs.existsSync(DEMO_CACHE_PATH)) {
    try {
      cacheData = JSON.parse(fs.readFileSync(DEMO_CACHE_PATH, 'utf-8'));
    } catch {
      cacheData = {};
    }
  } else {
    cacheData = {};
    const dir = path.dirname(DEMO_CACHE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  cacheLoaded = true;
}

function saveCache() {
  fs.writeFileSync(DEMO_CACHE_PATH, JSON.stringify(cacheData, null, 2), 'utf-8');
}

/**
 * Creates a stable deterministic hash by stripping ephemeral data (UUIDs, timestamps)
 * from the user prompt. This allows repeated demo passes to hit the cache even if
 * they are generated on a different day or map to a newly seeded database.
 */
function generateCacheKey(params: any): string {
  const schema = params?.response_format?.json_schema?.name || 'TEXT';
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
  return `${schema}_${hash}`;
}

let singletonProxy: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (singletonProxy) {
    return singletonProxy;
  }

  const realClient = new OpenAI({ apiKey: config.openaiApiKey || 'mock-key-for-demo-mode' });

  if (config.demoMode === 'false' || !config.demoMode) {
    singletonProxy = realClient;
    return singletonProxy;
  }

  loadCache();

  singletonProxy = new Proxy(realClient, {
    get(target, prop) {
      if (prop === 'chat') {
        return {
          completions: {
            create: async (params: any) => {
              const key = generateCacheKey(params);

              // ─── PLAYBACK MODE ─────────────────────────────────────────────
              if (config.demoMode === 'playback') {
                if (cacheData[key]) {
                  console.log(`[DemoMode] 🟢 PLAYBACK HIT: ${key}`);
                  
                  // Introduce a realistic 2.5 second delay for UI spinners
                  await new Promise(r => setTimeout(r, 2000 + (Math.random() * 1000)));
                  
                  return {
                    id: crypto.randomUUID(),
                    object: 'chat.completion',
                    created: Math.floor(Date.now() / 1000),
                    model: params.model || 'gpt-5-mock',
                    choices: [
                      {
                        index: 0,
                        message: {
                          role: 'assistant',
                          content: cacheData[key]
                        },
                        finish_reason: 'stop',
                      }
                    ],
                    usage: {
                      prompt_tokens: 150,
                      completion_tokens: 500,
                      total_tokens: 650
                    }
                  } as any;
                } else {
                  console.warn(`[DemoMode] 🔴 PLAYBACK MISS: ${key}. Falling back to live LLM.`);
                }
              }

              // ─── RECORD MODE ───────────────────────────────────────────────
              try {
                console.log(`[DemoMode] 📡 Calling Live OpenAI API: ${key}`);
                const response = await target.chat.completions.create(params);
                
                if (config.demoMode === 'record') {
                  const content = response.choices[0]?.message?.content;
                  if (content) {
                    cacheData[key] = content;
                    saveCache();
                    console.log(`[DemoMode] 💾 RECORDED Response for: ${key}`);
                  }
                }

                return response;
              } catch (err) {
                 if (config.demoMode === 'playback') {
                   console.error(`[DemoMode] 🔴 API Failure on Cache Miss. Returning blank placeholder.`);
                   // Fallback for demos if network is truly disconnected
                   return {
                     choices: [{ message: { content: "{}" }, finish_reason: 'stop' }],
                     usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
                   } as any;
                 }
                 throw err;
              }
            }
          }
        };
      }
      
      return Reflect.get(target, prop);
    }
  });

  return singletonProxy;
}
