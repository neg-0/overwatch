import { PrismaClient } from '@prisma/client';
import { createOfflineProxy } from './prisma-offline-proxy.js';

const realPrisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

const offlinePrisma = createOfflineProxy();

const prisma = new Proxy(realPrisma, {
  get(target, prop) {
    if (global.dbConnected === false) {
      if (prop in offlinePrisma) {
        return (offlinePrisma as any)[prop as string];
      }
    }
    return target[prop as keyof typeof target];
  }
});

export default prisma;
