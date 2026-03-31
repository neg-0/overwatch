import { getTestPrisma, seedTestScenario, cleanDatabase, disconnectPrisma } from '../src/__tests__/helpers/test-helpers.js';

async function main() {
  console.log('[SEED] Cleaning database...');
  await cleanDatabase();

  console.log('[SEED] Creating enriched scenario graph...');
  const seed = await seedTestScenario();
  
  // Also create some test units
  const prisma = getTestPrisma();
  await prisma.unit.create({
    data: {
      scenarioId: seed.scenarioId,
      unitName: '18 CONS',
      unitDesignation: '18 CONS',
      serviceBranch: 'USAF',
      domain: 'AIR',
      baseLocation: 'Kadena AB',
      baseLat: 26.3556,
      baseLon: 127.7674,
      affiliation: 'FRIENDLY',
    }
  });

  console.log(`[SEED] Success! Scenario ID: ${seed.scenarioId}`);
  
  // Output the ID in a parsable format for Playwright global setup
  console.log(`TEST_SCENARIO_ID=${seed.scenarioId}`);

  await disconnectPrisma();
  process.exit(0);
}

main().catch(err => {
  console.error('[SEED] Failed to seed E2E databse:', err);
  process.exit(1);
});
