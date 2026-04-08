/**
 * One-off script: re-ingest OPLAN/CONPLAN docs through the new extraction pipeline.
 * Reads their content from DB, deletes the old ingested copies, then re-ingests.
 *
 * Usage: npx tsx scripts/reingest-oplans.ts
 */
import dotenv from 'dotenv';
dotenv.config();  // Must load .env BEFORE prisma-client reads DATABASE_URL

import prisma from '../src/db/prisma-client.js';
import { ingestDocument } from '../src/services/doc-ingest.js';

const SCENARIO_ID = '33b01af2-c518-4baa-a954-432e3d699614';

async function main() {
  // Find all ingested OPLAN/CONPLAN docs
  const docs = await prisma.strategyDocument.findMany({
    where: {
      scenarioId: SCENARIO_ID,
      docType: { in: ['OPLAN', 'CONPLAN'] },
      ingestedAt: { not: null },
    },
    select: { id: true, title: true, docType: true, content: true },
  });

  console.log(`Found ${docs.length} ingested OPLAN/CONPLAN docs to re-ingest`);

  for (const doc of docs) {
    console.log(`\n--- Re-ingesting: ${doc.title} (${doc.docType}) ---`);
    const rawText = doc.content;

    // Delete old ingested doc (cascade removes priorities, phases, tasks, pace comms)
    await prisma.strategyDocument.delete({ where: { id: doc.id } });
    console.log(`  Deleted old record: ${doc.id}`);

    // Re-ingest through the full pipeline
    const result = await ingestDocument(SCENARIO_ID, rawText, `reingest:${doc.docType}`, null as any);
    console.log(`  Re-ingested as: ${result.createdId}`);
    console.log(`  Extracted:`, result.extracted);
  }

  // Final counts
  const phaseCount = await prisma.oPLANPhase.count({ where: { strategyDoc: { scenarioId: SCENARIO_ID } } });
  const cmdTaskCount = await prisma.commandTask.count({ where: { strategyDoc: { scenarioId: SCENARIO_ID } } });
  const paceCount = await prisma.pACEComm.count({ where: { strategyDoc: { scenarioId: SCENARIO_ID } } });
  console.log(`\n=== Final counts ===`);
  console.log(`  OPLAN Phases: ${phaseCount}`);
  console.log(`  Command Tasks: ${cmdTaskCount}`);
  console.log(`  PACE Comms: ${paceCount}`);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Re-ingest failed:', err);
  process.exit(1);
});
