import { expect, test } from '@playwright/test';

test.describe('Map View E2E', () => {
  let scenarioId: string;

  test.beforeAll(() => {
    scenarioId = process.env.TEST_SCENARIO_ID!;
    expect(scenarioId).toBeDefined();
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((id) => {
      if (id) window.localStorage.setItem('ow_activeScenarioId', id);
    }, scenarioId);
    
    await page.goto('/map');
  });

  test('renders the map container spanning the main area', async ({ page }) => {
    await expect(page.locator('.map-view, .map-container, .mapboxgl-map')).toBeVisible({ timeout: 15000 });
  });

  test('layer controls map panel is present', async ({ page }) => {
    // Map view should have layer toggles (Airspace, Bases, Assets, Assets)
    const layerControls = page.locator('.layer-controls, .map-layers-panel, .control-panel');
    await expect(layerControls).toBeVisible();

    // Ensure we have some checkbox toggles
    const toggles = layerControls.locator('input[type="checkbox"], .toggle-switch');
    await expect(toggles).toHaveCountGreaterThan(0);
  });

  test('time controls or timeline overlay are available in map mode', async ({ page }) => {
    // Even in map mode, timeline context is vital
    const timelineControl = page.locator('.timeline-bar, .playback-controls__shuttle');
    await expect(timelineControl.first()).toBeVisible();
  });
});
