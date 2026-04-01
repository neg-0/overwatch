import { Router } from 'express';
import { isDemoMode, setDemoMode } from '../lib/demo-mode.js';
import prisma from '../db/prisma-client.js';

export const configRoutes = Router();

configRoutes.get('/demo-mode', (req, res) => {
  res.json({ enabled: isDemoMode() });
});

configRoutes.post('/demo-mode', (req, res) => {
  const { enabled } = req.body;
  
  if (typeof enabled === 'boolean') {
    setDemoMode(enabled);
    res.json({ success: true, enabled: isDemoMode() });
  } else {
    res.status(400).json({ success: false, error: 'enabled must be a boolean' });
  }
});

configRoutes.get('/cache-stats', async (req, res) => {
  try {
    const count = await prisma.llmCache.count();
    
    // Most popular cache items
    const topHits = await prisma.llmCache.findMany({
      orderBy: { hitCount: 'desc' },
      take: 5,
      select: {
        cacheKey: true,
        schemaName: true,
        hitCount: true,
        model: true,
        lastHitAt: true,
      }
    });

    res.json({ count, topHits });
  } catch (error) {
    console.error('Failed to get cache stats:', error);
    res.status(500).json({ error: 'Failed to fetch cache stats' });
  }
});
