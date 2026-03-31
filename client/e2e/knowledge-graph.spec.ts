import { expect, test } from '@playwright/test';

test.describe('Knowledge Graph E2E', () => {
  let scenarioId: string;

  test.beforeAll(() => {
    scenarioId = process.env.TEST_SCENARIO_ID!;
    expect(scenarioId).toBeDefined();
  });

  test.beforeEach(async ({ page }) => {
    // Inject the active scenario into localStorage before page load
    await page.addInitScript((id) => {
      if (id) window.localStorage.setItem('ow_activeScenarioId', id);
    }, scenarioId);
    
    await page.goto('/graph');
  });

  test('renders the knowledge graph page and canvas', async ({ page }) => {
    // Should have page header
    await expect(page.locator('.kg-header')).toBeVisible();

    // The D3 canvas should be present
    await expect(page.locator('svg.kg-canvas, .kg-canvas-container')).toBeVisible();
  });

  test('displays nodes from the seeded scenario', async ({ page }) => {
    // Wait for D3 nodes to load
    await expect(page.locator('.node').first()).toBeVisible({ timeout: 10000 });

    // The seed provides: Strategy doc, Planning doc, Package, Order, Base, Asset
    const nodes = page.locator('.node');
    expect(await nodes.count()).toBeGreaterThan(0);
  });

  test('renders custom edges and labels', async ({ page }) => {
    // Edges are usually rendered as SVG paths in .link groups
    await expect(page.locator('.link').first()).toBeVisible({ timeout: 10000 });

    const links = page.locator('.link');
    expect(await links.count()).toBeGreaterThan(0);
  });

  test('control panel contains filters and layout toggles', async ({ page }) => {
    // Check for standard graph controls
    const controls = page.locator('.kg-controls, .controls-panel');
    await expect(controls.first()).toBeVisible();
  });
});
