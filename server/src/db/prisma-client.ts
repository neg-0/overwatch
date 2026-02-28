import { PrismaClient } from '@prisma/client';
import { createOfflineProxy } from './prisma-offline-proxy.js';

// Augment global to type the dbConnected flag
declare global {
  var dbConnected: boolean | undefined;
}

const realPrisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

const offlinePrisma = createOfflineProxy();

const prisma = new Proxy(realPrisma, {
  get(target, prop) {
    if (globalThis.dbConnected === false) {
      if (prop in offlinePrisma) {
        return (offlinePrisma as any)[prop as string];
      }
    }
    return target[prop as keyof typeof target];
  }
});

export default prisma;
