/**
 * Comprehensive re-ingest script: finds all generator-created docs that have
 * rich content but haven't been properly extracted, deletes stale shells,
 * and re-ingests everything through the new pipeline.
 *
 * Usage: npx tsx scripts/reingest-all.ts
 */
import dotenv from 'dotenv';
dotenv.config();

// Dynamic imports so dotenv loads first
const { default: prisma } = await import('../src/db/prisma-client.js');
const { ingestDocument } = await import('../src/services/doc-ingest.js');

const SCENARIO_ID = '33b01af2-c518-4baa-a954-432e3d699614';
const MIN_CONTENT_LENGTH = 500; // Skip shells under 500 chars

async function main() {
  console.log('=== COMPREHENSIVE RE-INGEST ===\n');

  // ─── Phase 1: Find strategy docs needing re-ingest ────────────────────
  // Strategy docs where ingestedAt is set but extraction is empty (priorities = 0)
  // OR ingestedAt is null (never ingested) but content is rich
  const strategyDocs = await prisma.strategyDocument.findMany({
    where: { scenarioId: SCENARIO_ID },
    include: {
      priorities: { select: { id: true } },
      oplanPhases: { select: { id: true } },
    },
  });

  const stratDocsToReingest: typeof strategyDocs = [];
  const stratDocsToDelete: string[] = [];

  for (const doc of strategyDocs) {
    const hasExtraction = doc.priorities.length > 0 || doc.oplanPhases.length > 0;
    const isRich = doc.content.length >= MIN_CONTENT_LENGTH;

    if (hasExtraction) {
      // Already has extraction — skip
      console.log(`  ✓ KEEP: ${doc.docType} "${doc.title}" (${doc.priorities.length} priorities, ${doc.oplanPhases.length} phases)`);
    } else if (isRich) {
      // Rich content but no extraction — needs re-ingest
      stratDocsToReingest.push(doc);
      console.log(`  → RE-INGEST: ${doc.docType} "${doc.title}" (${doc.content.length} chars, 0 extraction)`);
    } else {
      // Tiny shell with no extraction — delete
      stratDocsToDelete.push(doc.id);
      console.log(`  ✗ DELETE SHELL: ${doc.docType} "${doc.title}" (${doc.content.length} chars)`);
    }
  }

  // ─── Phase 2: Find planning docs needing re-ingest ────────────────────
  const planningDocs = await prisma.planningDocument.findMany({
    where: { scenarioId: SCENARIO_ID },
    include: {
      priorities: { select: { id: true } },
      spinsEntries: { select: { id: true } },
      commPlans: { select: { id: true } },
      coordinationMeasures: { select: { id: true } },
      forceApportionments: { select: { id: true } },
      weaponTargetPairs: { select: { id: true } },
    },
  });

  const planDocsToReingest: typeof planningDocs = [];
  const planDocsToDelete: string[] = [];

  for (const doc of planningDocs) {
    const hasExtraction =
      doc.priorities.length > 0 ||
      doc.spinsEntries.length > 0 ||
      doc.commPlans.length > 0 ||
      doc.coordinationMeasures.length > 0 ||
      doc.forceApportionments.length > 0 ||
      doc.weaponTargetPairs.length > 0;
    const isRich = doc.content.length >= MIN_CONTENT_LENGTH;

    if (hasExtraction) {
      console.log(`  ✓ KEEP: ${doc.docType} "${doc.title}" (${doc.priorities.length}p/${doc.spinsEntries.length}s/${doc.commPlans.length}c/${doc.coordinationMeasures.length}cm/${doc.forceApportionments.length}fa/${doc.weaponTargetPairs.length}wtp)`);
    } else if (isRich) {
      planDocsToReingest.push(doc);
      console.log(`  → RE-INGEST: ${doc.docType} "${doc.title}" (${doc.content.length} chars, 0 extraction)`);
    } else {
      planDocsToDelete.push(doc.id);
      console.log(`  ✗ DELETE SHELL: ${doc.docType} "${doc.title}" (${doc.content.length} chars)`);
    }
  }

  console.log(`\n--- SUMMARY ---`);
  console.log(`Strategy: ${stratDocsToReingest.length} to re-ingest, ${stratDocsToDelete.length} shells to delete`);
  console.log(`Planning: ${planDocsToReingest.length} to re-ingest, ${planDocsToDelete.length} shells to delete`);

  // ─── Phase 3: Delete shells ────────────────────────────────────────────
  if (stratDocsToDelete.length > 0) {
    await prisma.strategyDocument.deleteMany({ where: { id: { in: stratDocsToDelete } } });
    console.log(`\nDeleted ${stratDocsToDelete.length} strategy shells`);
  }
  if (planDocsToDelete.length > 0) {
    await prisma.planningDocument.deleteMany({ where: { id: { in: planDocsToDelete } } });
    console.log(`Deleted ${planDocsToDelete.length} planning shells`);
  }

  // ─── Phase 4: Re-ingest strategy docs ──────────────────────────────────
  for (const doc of stratDocsToReingest) {
    console.log(`\n--- Re-ingesting STRATEGY: ${doc.docType} "${doc.title}" ---`);
    try {
      const result = await ingestDocument(SCENARIO_ID, doc.content, `reingest:${doc.docType}`, null as any);
      // Only delete the old doc AFTER successful re-ingest to avoid data loss
      await prisma.strategyDocument.delete({ where: { id: doc.id } });
      console.log(`  ✓ Created ${result.createdId} — extracted:`, result.extracted);
    } catch (err) {
      console.error(`  ✗ FAILED (original preserved):`, err instanceof Error ? err.message : err);
    }
  }

  // ─── Phase 5: Re-ingest planning docs ──────────────────────────────────
  for (const doc of planDocsToReingest) {
    console.log(`\n--- Re-ingesting PLANNING: ${doc.docType} "${doc.title}" ---`);
    try {
      const result = await ingestDocument(SCENARIO_ID, doc.content, `reingest:${doc.docType}`, null as any);
      // Only delete the old doc AFTER successful re-ingest to avoid data loss
      await prisma.planningDocument.delete({ where: { id: doc.id } });
      console.log(`  ✓ Created ${result.createdId} — extracted:`, result.extracted);
    } catch (err) {
      console.error(`  ✗ FAILED (original preserved):`, err instanceof Error ? err.message : err);
    }
  }

  // ─── Phase 6: Final report ─────────────────────────────────────────────
  console.log('\n=== FINAL EXTRACTION REPORT ===');

  const finalStrat = await prisma.strategyDocument.findMany({
    where: { scenarioId: SCENARIO_ID },
    include: {
      priorities: { select: { id: true } },
      oplanPhases: { select: { id: true } },
      commandTasks: { select: { id: true } },
      paceComms: { select: { id: true } },
    },
  });

  for (const doc of finalStrat) {
    console.log(`  ${doc.docType} "${doc.title}" — ${doc.priorities.length} priorities, ${doc.oplanPhases.length} phases, ${doc.commandTasks.length} tasks, ${doc.paceComms.length} PACE`);
  }

  const finalPlan = await prisma.planningDocument.findMany({
    where: { scenarioId: SCENARIO_ID },
    include: {
      priorities: { select: { id: true } },
      spinsEntries: { select: { id: true } },
      commPlans: { select: { id: true } },
      coordinationMeasures: { select: { id: true } },
      forceApportionments: { select: { id: true } },
      weaponTargetPairs: { select: { id: true } },
    },
  });

  for (const doc of finalPlan) {
    console.log(`  ${doc.docType} "${doc.title}" — ${doc.priorities.length}p, ${doc.spinsEntries.length}s, ${doc.commPlans.length}c, ${doc.coordinationMeasures.length}cm, ${doc.forceApportionments.length}fa, ${doc.weaponTargetPairs.length}wtp`);
  }

  const orders = await prisma.taskingOrder.findMany({
    where: { scenarioId: SCENARIO_ID },
    include: {
      missionPackages: {
        include: { missions: { include: { targets: true, spaceNeeds: true } } },
      },
    },
  });

  for (const o of orders) {
    const missionCount = o.missionPackages.reduce((acc, mp) => acc + mp.missions.length, 0);
    const targetCount = o.missionPackages.reduce((acc, mp) => acc + mp.missions.reduce((a2, m) => a2 + m.targets.length, 0), 0);
    const spaceNeedCount = o.missionPackages.reduce((acc, mp) => acc + mp.missions.reduce((a2, m) => a2 + m.spaceNeeds.length, 0), 0);
    console.log(`  ${o.orderType} "${o.orderId}" — ${o.missionPackages.length} pkgs, ${missionCount} missions, ${targetCount} targets, ${spaceNeedCount} space needs`);
  }

  await prisma.$disconnect();
  console.log('\nDone!');
}

main().catch(err => {
  console.error('Re-ingest failed:', err);
  process.exit(1);
});
