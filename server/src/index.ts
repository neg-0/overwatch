import cors from 'cors';
import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { config } from './config.js';
import prisma from './db/prisma-client.js';

// API route handlers
import { createAdvisorRoutes } from './api/advisor.js';
import { assetRoutes } from './api/assets.js';
import { createDecisionRoutes } from './api/decisions.js';
import eventsRoutes from './api/events.js';
import { createIngestRoutes } from './api/ingest.js';
import { injectRoutes } from './api/injects.js';
import { missionRoutes } from './api/missions.js';
import { orderRoutes } from './api/orders.js';
import { scenarioRoutes } from './api/scenarios.js';
import { createSimulationRoutes } from './api/simulation.js';
import { spaceAssetRoutes } from './api/space-assets.js';
import { setupWebSocket } from './websocket/ws-server.js';

const app = express();
const httpServer = createServer(app);

// ─── WebSocket (created before routes so simulation routes can access io) ────

const io = new SocketIOServer(httpServer, {
  cors: { origin: config.corsOrigin, methods: ['GET', 'POST'] },
});

setupWebSocket(io);

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json({ limit: '10mb' }));

// ─── Health Check ────────────────────────────────────────────────────────────

app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      success: true,
      data: {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: config.nodeEnv,
        database: config.databaseProvider,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      error: 'Database connection failed',
      timestamp: new Date().toISOString(),
    });
  }
});

// ─── API Routes ──────────────────────────────────────────────────────────────

app.use('/api/scenarios', scenarioRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/missions', missionRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/simulation', createSimulationRoutes(io));
app.use('/api/decisions', createDecisionRoutes(io));
app.use('/api/space-assets', spaceAssetRoutes);
app.use('/api/ingest', createIngestRoutes(io));
app.use('/api/injects', injectRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/advisor', createAdvisorRoutes(io));

// ─── Static File Serving (production) ────────────────────────────────────────
// In production, serve the built Vite client. API routes above take priority.
if (config.nodeEnv !== 'development') {
  const path = await import('path');
  const { fileURLToPath } = await import('url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const clientDist = path.resolve(__dirname, '../../client/dist');

  app.use(express.static(clientDist));

  // SPA fallback — serve index.html for any non-API route
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// ─── Start Server ────────────────────────────────────────────────────────────

httpServer.listen(config.port, () => {
  console.log(`
╔═══════════════════════════════════════════════════════╗
║                   OVERWATCH SERVER                    ║
║              Multi-Domain Decision Support            ║
╠═══════════════════════════════════════════════════════╣
║  REST API:    http://localhost:${config.port}/api            ║
║  WebSocket:   ws://localhost:${config.port}                  ║
║  Database:    ${config.databaseProvider.padEnd(39)}║
║  Environment: ${config.nodeEnv.padEnd(39)}║
╚═══════════════════════════════════════════════════════╝
  `);
});

export { app, httpServer, io };
