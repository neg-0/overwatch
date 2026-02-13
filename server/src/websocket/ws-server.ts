import { Socket, Server as SocketIOServer } from 'socket.io';

let ioInstance: SocketIOServer | null = null;

export function setupWebSocket(io: SocketIOServer) {
  ioInstance = io;

  io.on('connection', (socket: Socket) => {
    console.log(`[WS] Client connected: ${socket.id}`);

    // Join scenario room for targeted broadcasts
    socket.on('join:scenario', (scenarioId: string) => {
      socket.join(`scenario:${scenarioId}`);
      console.log(`[WS] ${socket.id} joined scenario:${scenarioId}`);
    });

    socket.on('leave:scenario', (scenarioId: string) => {
      socket.leave(`scenario:${scenarioId}`);
      console.log(`[WS] ${socket.id} left scenario:${scenarioId}`);
    });

    socket.on('disconnect', () => {
      console.log(`[WS] Client disconnected: ${socket.id}`);
    });
  });
}

// ─── Broadcast Helpers ───────────────────────────────────────────────────────

export function broadcastSimulationTick(scenarioId: string, data: {
  simTime: string;
  realTime: string;
  ratio: number;
  atoDay: number;
}) {
  ioInstance?.to(`scenario:${scenarioId}`).emit('simulation:tick', data);
}

export function broadcastOrderPublished(scenarioId: string, data: {
  orderId: string;
  orderType: string;
  day: number;
}) {
  ioInstance?.to(`scenario:${scenarioId}`).emit('order:published', data);
}

export function broadcastMissionStatus(scenarioId: string, data: {
  missionId: string;
  status: string;
  timestamp: string;
}) {
  ioInstance?.to(`scenario:${scenarioId}`).emit('mission:status', data);
}

export function broadcastPositionUpdate(scenarioId: string, data: {
  missionId: string;
  callsign?: string;
  domain: string;
  timestamp: string;
  latitude: number;
  longitude: number;
  altitude_ft?: number;
  heading?: number;
  speed_kts?: number;
  status: string;
}) {
  ioInstance?.to(`scenario:${scenarioId}`).emit('position:update', data);
}

export function broadcastSpaceCoverage(scenarioId: string, data: {
  assetId: string;
  status: 'AOS' | 'LOS';
  coverageArea?: {
    centerLat: number;
    centerLon: number;
    radiusKm: number;
  };
}) {
  ioInstance?.to(`scenario:${scenarioId}`).emit('space:coverage', data);
}

export function broadcastAlertGap(scenarioId: string, data: {
  id: string;
  capabilityType: string;
  startTime: string;
  endTime: string;
  affectedMissions: string[];
  severity: string;
  recommendation: string;
}) {
  ioInstance?.to(`scenario:${scenarioId}`).emit('alert:gap', data);
}

export function getIO(): SocketIOServer | null {
  return ioInstance;
}
