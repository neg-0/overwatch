import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import prisma from '../src/db/prisma-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cachePath = path.resolve(__dirname, '../../data/demo-cache.json');

async function main() {
  if (!fs.existsSync(cachePath)) {
    console.log(`[Migrate] No legacy cache file found at ${cachePath}. Exiting.`);
    return;
  }

  console.log(`[Migrate] Loading records from ${cachePath}...`);
  const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  const entries = Object.entries(data);

  console.log(`[Migrate] Found ${entries.length} items to migrate.`);

  let successCount = 0;
  let failureCount = 0;

  for (const [key, response] of entries) {
    if (typeof response !== 'string') {
      console.warn(`[Migrate] Skipping key ${key} — response is not a string`);
      failureCount++;
      continue;
    }

    try {
      await prisma.llmCache.upsert({
        where: { cacheKey: key },
        update: {},
        create: {
          cacheKey: key,
          schemaName: key.includes('_') ? key.split('_')[0] : 'TEXT',
          response,
          model: 'gpt-5-migrated', // Default placeholder
        },
      });
      successCount++;
    } catch (err) {
      console.error(`[Migrate] Failed to insert ${key}:`, err);
      failureCount++;
    }
  }

  console.log(`[Migrate] Complete! Inserted: ${successCount}, Failed: ${failureCount}`);
  
  if (successCount > 0) {
    console.log(`[Migrate] You can now safely delete data/demo-cache.json`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
