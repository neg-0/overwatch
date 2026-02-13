/**
 * Shared test helpers for integration and E2E tests.
 */
import { PrismaClient } from '@prisma/client';
import express from 'express';
import { createServer, type Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';

// ─── Test Prisma Client ──────────────────────────────────────────────────────

let _testPrisma: PrismaClient | null = null;

export function getTestPrisma(): PrismaClient {
  if (!_testPrisma) {
    _testPrisma = new PrismaClient({ log: ['error'] });
  }
  return _testPrisma;
}

export async function disconnectPrisma(): Promise<void> {
  if (_testPrisma) {
    await _testPrisma.$disconnect();
    _testPrisma = null;
  }
}

// ─── Database Cleanup ────────────────────────────────────────────────────────

export async function cleanDatabase(): Promise<void> {
  const prisma = getTestPrisma();
  // Delete in dependency order
  await prisma.ingestLog.deleteMany();
  await prisma.positionUpdate.deleteMany();
  await prisma.spaceCoverageWindow.deleteMany();
  await prisma.spaceNeed.deleteMany();
  await prisma.supportRequirement.deleteMany();
  await prisma.missionTarget.deleteMany();
  await prisma.timeWindow.deleteMany();
  await prisma.waypoint.deleteMany();
  await prisma.mission.deleteMany();
  await prisma.missionPackage.deleteMany();
  await prisma.taskingOrder.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.assetType.deleteMany();
  await prisma.unit.deleteMany();
  await prisma.spaceAsset.deleteMany();
  await prisma.priorityEntry.deleteMany();
  await prisma.planningDocument.deleteMany();
  await prisma.strategyDocument.deleteMany();
  await prisma.simulationState.deleteMany();
  await prisma.leadershipDecision.deleteMany();
  await prisma.scenario.deleteMany();
}

// ─── Minimal Seed for Testing ────────────────────────────────────────────────

export interface TestSeedResult {
  scenarioId: string;
  unitId: string;
  missionId: string;
  packageId: string;
  orderId: string;
}

export async function seedTestScenario(): Promise<TestSeedResult> {
  const prisma = getTestPrisma();
  const now = new Date();
  const start = new Date(now.getTime() - 2 * 3600000); // 2h ago
  const end = new Date(now.getTime() + 24 * 3600000);  // +24h
  const totTime = new Date(now.getTime() + 1 * 3600000); // +1h from now

  const scenario = await prisma.scenario.create({
    data: {
      name: 'Test Scenario',
      description: 'Automated test scenario',
      theater: 'TEST',
      adversary: 'OPFOR',
      startDate: start,
      endDate: end,
      classification: 'UNCLASSIFIED',
    },
  });

  const unit = await prisma.unit.create({
    data: {
      scenarioId: scenario.id,
      unitName: 'Test Squadron',
      unitDesignation: 'TST-1',
      serviceBranch: 'USAF',
      domain: 'AIR',
      baseLocation: 'Test Base',
      baseLat: 26.35,
      baseLon: 127.77,
    },
  });

  const order = await prisma.taskingOrder.create({
    data: {
      scenarioId: scenario.id,
      orderType: 'ATO',
      orderId: 'ATO-TEST-001',
      issuingAuthority: 'TEST/CC',
      effectiveStart: start,
      effectiveEnd: end,
      atoDayNumber: 1,
    },
  });

  const pkg = await prisma.missionPackage.create({
    data: {
      taskingOrderId: order.id,
      packageId: 'PKGT01',
      priorityRank: 1,
      missionType: 'STRIKE',
      effectDesired: 'Test effect',
    },
  });

  const mission = await prisma.mission.create({
    data: {
      packageId: pkg.id,
      missionId: 'MSN-TEST-001',
      callsign: 'TEST 01',
      domain: 'AIR',
      unitId: unit.id,
      platformType: 'F-35A',
      platformCount: 1,
      missionType: 'STRIKE',
      status: 'PLANNED',
      affiliation: 'FRIENDLY',
    },
  });

  // Create waypoints for position interpolation
  await prisma.waypoint.createMany({
    data: [
      { missionId: mission.id, waypointType: 'DEP', sequence: 1, latitude: 26.35, longitude: 127.77, altitude_ft: 0, speed_kts: 0 },
      { missionId: mission.id, waypointType: 'IP', sequence: 2, latitude: 20.0, longitude: 122.0, altitude_ft: 35000, speed_kts: 480 },
      { missionId: mission.id, waypointType: 'TGT', sequence: 3, latitude: 15.0, longitude: 118.0, altitude_ft: 25000, speed_kts: 520 },
      { missionId: mission.id, waypointType: 'REC', sequence: 4, latitude: 26.35, longitude: 127.77, altitude_ft: 0, speed_kts: 0 },
    ],
  });

  // Create TOT time window for mission status progression
  await prisma.timeWindow.create({
    data: {
      missionId: mission.id,
      windowType: 'TOT',
      startTime: totTime,
    },
  });

  return {
    scenarioId: scenario.id,
    unitId: unit.id,
    missionId: mission.id,
    packageId: pkg.id,
    orderId: order.id,
  };
}

// ─── Test App Factory ────────────────────────────────────────────────────────

export interface TestApp {
  app: express.Express;
  httpServer: HttpServer;
  io: SocketIOServer;
  baseUrl: string;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  // Dynamic import to avoid module-level side effects
  const { scenarioRoutes } = await import('../../api/scenarios.js');
  const { missionRoutes } = await import('../../api/missions.js');
  const { createSimulationRoutes } = await import('../../api/simulation.js');
  const { createDecisionRoutes } = await import('../../api/decisions.js');
  const { createAdvisorRoutes } = await import('../../api/advisor.js');
  const { createIngestRoutes } = await import('../../api/ingest.js');
  const { setupWebSocket } = await import('../../websocket/ws-server.js');

  const app = express();
  const httpServer = createServer(app);

  const io = new SocketIOServer(httpServer, {
    cors: { origin: '*' },
  });

  // Register WebSocket handlers (join:scenario, etc.)
  setupWebSocket(io);

  app.use(express.json());

  // Health check
  app.get('/api/health', async (_req, res) => {
    const prisma = getTestPrisma();
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ success: true, data: { status: 'healthy' } });
    } catch {
      res.status(503).json({ success: false, error: 'DB down' });
    }
  });

  app.use('/api/scenarios', scenarioRoutes);
  app.use('/api/missions', missionRoutes);
  app.use('/api/simulation', createSimulationRoutes(io));
  app.use('/api/decisions', createDecisionRoutes(io));
  app.use('/api/advisor', createAdvisorRoutes(io));
  app.use('/api/ingest', createIngestRoutes(io));

  return new Promise((resolve) => {
    httpServer.listen(0, () => {
      const addr = httpServer.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const baseUrl = `http://localhost:${port}`;

      resolve({
        app,
        httpServer,
        io,
        baseUrl,
        close: async () => {
          io.close();
          await new Promise<void>((r) => httpServer.close(() => r()));
        },
      });
    });
  });
}

// ─── WebSocket Test Client ───────────────────────────────────────────────────

export function createTestClient(baseUrl: string): ClientSocket {
  return ioClient(baseUrl, {
    transports: ['websocket'],
    autoConnect: true,
  });
}

export function waitForEvent<T = any>(
  socket: ClientSocket,
  event: string,
  timeoutMs = 10000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for event '${event}' after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

export function collectEvents<T = any>(
  socket: ClientSocket,
  event: string,
  count: number,
  timeoutMs = 15000,
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const collected: T[] = [];
    const timer = setTimeout(() => {
      socket.off(event, handler);
      if (collected.length > 0) {
        resolve(collected); // return what we got
      } else {
        reject(new Error(`Timed out collecting '${event}' events (0/${count}) after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    const handler = (data: T) => {
      collected.push(data);
      if (collected.length >= count) {
        clearTimeout(timer);
        socket.off(event, handler);
        resolve(collected);
      }
    };

    socket.on(event, handler);
  });
}
