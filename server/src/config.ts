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

  // LLM model tiers
  llm: {
    flagship: process.env.LLM_FLAGSHIP || 'gpt-5.2',
    midRange: process.env.LLM_MID_RANGE || 'gpt-5-mini',
    fast: process.env.LLM_FAST || 'gpt-5-nano',
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
