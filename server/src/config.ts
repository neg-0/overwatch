import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  databaseUrl: process.env.DATABASE_URL || 'file:./overwatch.db',
  databaseProvider: (process.env.DATABASE_PROVIDER || 'postgresql') as 'postgresql' | 'sqlite',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  mapboxToken: process.env.MAPBOX_TOKEN || '',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  nodeEnv: process.env.NODE_ENV || 'development',

  // LLM model tiers — defaults to known-valid OpenAI models
  llm: {
    flagship: process.env.LLM_FLAGSHIP || 'o3-mini',
    midRange: process.env.LLM_MID_RANGE || 'gpt-4.1-mini',
    fast: process.env.LLM_FAST || 'gpt-4.1-nano',
  },

  // Simulation defaults
  sim: {
    defaultCompression: 720, // 1 real minute = 12 sim hours
    tickIntervalMs: 1000,    // how often to advance sim clock
    positionUpdateIntervalMs: 2000,
  },

  // UDL (Unified Data Library) credentials
  udl: {
    username: process.env.UDL_USERNAME || '',
    password: process.env.UDL_PASSWORD || '',
    baseUrl: process.env.UDL_BASE_URL || 'https://unifieddatalibrary.com/udl',
  },
};

// Startup validation — warn about missing critical config
if (!config.openaiApiKey) {
  console.warn('[config] WARNING: OPENAI_API_KEY is not set — all LLM generation features will fail');
}
if (!config.mapboxToken) {
  console.warn('[config] WARNING: MAPBOX_TOKEN is not set — map features will be unavailable');
}
