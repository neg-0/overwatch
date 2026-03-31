import { expect, test } from '@playwright/test';

test.describe('Scenario Detail E2E', () => {
  let scenarioId: string;

  test.beforeAll(() => {
    scenarioId = process.env.TEST_SCENARIO_ID!;
    expect(scenarioId).toBeDefined();
  });

  test.beforeEach(async ({ page }) => {
    // Navigation to the scenario detail page doesn't require active scenario in local storage,
    // just the ID in the URL.
    await page.goto(`/scenario/${scenarioId}`);
  });

  test('renders the scenario details and title', async ({ page }) => {
    // Check if the title is loaded
    await expect(page.locator('h1.scenario-title')).toBeVisible({ timeout: 10000 });
    
    // Check for the seeded scenario name
    await expect(page.locator('h1.scenario-title')).toContainText('Test Scenario');
    
    // Check theatre and adversary data
    const metaContainer = page.locator('.scenario-meta');
    await expect(metaContainer).toContainText('TEST');
    await expect(metaContainer).toContainText('OPFOR');
  });

  test('displays generated artifacts if available', async ({ page }) => {
    // The enriched test scenario might have strategy docs or plans
    const artifactsSection = page.locator('.artifacts-section, .scenario-documents');
    
    // In our test, there should be at least some generated artifacts shown
    await expect(artifactsSection).toBeVisible();
  });

  test('provides actions to activate scenario', async ({ page }) => {
    // Wait for the buttons to be ready
    const activateBtn = page.locator('button:has-text("Activate Scenario"), .activate-btn');
    await expect(activateBtn).toBeVisible();
  });
});
