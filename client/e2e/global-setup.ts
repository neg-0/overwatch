import { execSync } from 'child_process';
import path from 'path';

/**
 * Playwright Global Setup
 * Runs before all tests to ensure the database is clean and seeded
 * with the integrated test scenario (Doctrine -> Base -> Asset -> Space Allocation).
 * It exports the scenarioId to process.env.TEST_SCENARIO_ID so tests can hit the correct URLs.
 */
export default async function globalSetup() {
  console.log('[E2E-SETUP] Running scenario seed script...');
  
  const serverDir = path.resolve(process.cwd(), '../server');
  
  try {
    // Run the seed script inside the server package
    // tsx resolves TS files directly
    const output = execSync('npx tsx scripts/seed-e2e.ts', {
      cwd: serverDir,
      env: { ...process.env, NODE_ENV: 'test' },
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    
    // Parse the TEST_SCENARIO_ID from the output
    const match = output.match(/TEST_SCENARIO_ID=([a-f0-9-]+)/);
    if (!match) {
      console.error('[E2E-SETUP] Could not parse TEST_SCENARIO_ID from output:\\n', output);
      throw new Error('Seed script missing TEST_SCENARIO_ID=...');
    }
    
    const scenarioId = match[1];
    console.log(`[E2E-SETUP] Seed success! Scenario ID: ${scenarioId}`);
    
    // Playwright passes process.env changes in globalSetup to test workers!
    process.env.TEST_SCENARIO_ID = scenarioId;
    
  } catch (error: any) {
    if (error.stdout) console.log(error.stdout);
    if (error.stderr) console.error(error.stderr);
    console.error('[E2E-SETUP] Failed to run seed script');
    throw error;
  }
}
