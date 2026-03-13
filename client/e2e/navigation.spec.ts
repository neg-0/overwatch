import { expect, test } from '@playwright/test';

/**
 * Navigation E2E tests — verify sidebar links, routing, and active states.
 */

const NAV_LINKS = [
  { text: 'Dashboard', path: '/' },
  { text: 'Map View', path: '/map' },
  { text: 'Timeline', path: '/gantt' },
  { text: 'Space Assets', path: '/space' },
  { text: 'Orders', path: '/orders' },
  { text: 'AI Decisions', path: '/decisions' },
  { text: 'Doc Intake', path: '/intake' },
  { text: 'Hierarchy', path: '/hierarchy' },
  { text: 'Knowledge Graph', path: '/graph' },
  { text: 'Scenario', path: '/scenario' },
];

test.describe('Sidebar Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('renders sidebar with logo and title', async ({ page }) => {
    await expect(page.locator('.sidebar-logo')).toHaveText('OW');
    await expect(page.locator('.sidebar-title')).toHaveText('Overwatch');
  });

  test('renders all 10 navigation links', async ({ page }) => {
    for (const link of NAV_LINKS) {
      await expect(page.locator(`.nav-link:has-text("${link.text}")`)).toBeVisible();
    }
  });

  test('Dashboard is active link on root route', async ({ page }) => {
    const dashLink = page.locator('.nav-link:has-text("Dashboard")');
    await expect(dashLink).toHaveClass(/active/);
  });

  for (const link of NAV_LINKS) {
    test(`navigates to ${link.text} (${link.path})`, async ({ page }) => {
      const navLink = page.locator(`.nav-link:has-text("${link.text}")`);
      await navLink.click();

      // URL should end with the expected path
      if (link.path === '/') {
        await expect(page).toHaveURL(/\/$/);
      } else {
        await expect(page).toHaveURL(link.path);
      }

      // Clicked link should be active
      await expect(navLink).toHaveClass(/active/);
    });
  }
});

test.describe('404 Page', () => {
  test('shows 404 for unknown routes', async ({ page }) => {
    await page.goto('/nonexistent-page');
    await expect(page.locator('text=404')).toBeVisible();
    await expect(page.locator('text=Page not found')).toBeVisible();
  });

  test('has a link back to dashboard', async ({ page }) => {
    await page.goto('/nonexistent-page');
    const backLink = page.locator('a:has-text("Return to dashboard")');
    await expect(backLink).toBeVisible();

    await backLink.click();
    await expect(page).toHaveURL('/');
  });
});
