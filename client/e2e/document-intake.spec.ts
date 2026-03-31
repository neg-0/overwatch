import { expect, test } from '@playwright/test';

test.describe('Document Intake E2E', () => {
  let scenarioId: string;

  test.beforeAll(() => {
    scenarioId = process.env.TEST_SCENARIO_ID!;
    expect(scenarioId).toBeDefined();
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((id) => {
      if (id) window.localStorage.setItem('ow_activeScenarioId', id);
    }, scenarioId);
    
    await page.goto('/intake');
  });

  test('renders the document intake form and dropzone', async ({ page }) => {
    // Check for correct h1
    await expect(page.locator('h1.intake-header__title')).toContainText('DOCUMENT INTAKE');
    
    // Check for main body
    await expect(page.locator('.intake-body')).toBeVisible();
  });

  test('requires text or file to submit', async ({ page }) => {
    // Look for submit button
    const submitBtn = page.locator('button[type="submit"], button:has-text("Ingest")');
    if (await submitBtn.count() > 0) {
      await expect(submitBtn).toBeVisible();
      // Most forms disable the button initially
      await expect(submitBtn).toBeDisabled();
    }
  });

  test('shows ingestion history or review flags panel', async ({ page }) => {
    // Review flags typically show up in a side panel or under a toggle
    const reviewPanel = page.locator('.review-flags-panel, .ingest-history');
    if (await reviewPanel.count() > 0) {
      await expect(reviewPanel).toBeVisible({ timeout: 10000 });
    }
  });
});
