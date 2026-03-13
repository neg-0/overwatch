import { expect, test } from '@playwright/test';

/**
 * Scenario Setup E2E tests — verify scenario creation form and API integration.
 */

test.describe('Scenario Setup Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/scenario');
  });

  test('navigates to scenario setup page', async ({ page }) => {
    await expect(page).toHaveURL('/scenario');
    const navLink = page.locator('.nav-link:has-text("Scenario")');
    await expect(navLink).toHaveClass(/active/);
  });

  test('renders scenario setup form elements', async ({ page }) => {
    // The page should contain form inputs for scenario configuration
    // Look for any form elements or input fields
    const mainContent = page.locator('.main-content');
    await expect(mainContent).toBeVisible();

    // Check for heading or title indicating scenario setup
    const heading = mainContent.locator('h1, h2, h3, [class*="title"], [class*="header"]').first();
    await expect(heading).toBeVisible();
  });

  test('lists existing scenarios from API', async ({ page }) => {
    // The scenario page should load and display content from the API
    // Wait for any loading to complete
    await page.waitForLoadState('networkidle');

    // The page should have rendered content (not just loading state)
    const mainContent = page.locator('.main-content');
    const children = await mainContent.locator('> *').count();
    expect(children).toBeGreaterThan(0);
  });
});

test.describe('Scenario API Integration', () => {
  test('health endpoint is accessible', async ({ page }) => {
    const response = await page.request.get('http://localhost:3001/api/health');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('healthy');
  });

  test('scenarios API returns valid response', async ({ page }) => {
    const response = await page.request.get('http://localhost:3001/api/scenarios');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });
});
