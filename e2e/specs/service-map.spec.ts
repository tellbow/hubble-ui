import { expect, test, type Page } from '@playwright/test';

// e2e/fixtures/demo: client → api (encrypted), client → example.com,
// client → cloudflare.com (dropped by policy), and other/web → other/db.
const open = (page: Page, namespace: string) =>
  page.goto(`/?e2e=preset=demo&namespace=${namespace}`);

const row = (page: Page, text: string) =>
  page
    .getByRole('button')
    .filter({ hasText: text })
    .filter({ hasText: /forwarded|dropped/ });

test('a namespace shows its service map and flows', async ({ page }) => {
  await open(page, 'demo');

  for (const card of ['client', 'api', 'world']) {
    await expect(page.getByRole('button', { name: card, exact: true })).toBeVisible();
  }
  await expect(row(page, 'cloudflare.com')).toContainText('dropped');
  await expect(row(page, 'example.com')).toContainText('forwarded');
  await expect(row(page, 'db')).toHaveCount(0);
});

test('"All namespaces" shows every namespace and survives a reload', async ({ page }) => {
  await open(page, 'demo');
  await page.getByRole('button', { name: 'demo', exact: true }).first().click();
  await page.getByRole('menuitem', { name: 'All namespaces' }).click();

  await expect(page).toHaveURL(/namespace=(\*|%2A)/);
  await expect(row(page, 'db')).toBeVisible();
  await expect(row(page, 'cloudflare.com')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: 'All namespaces' })).toBeVisible();
  await expect(row(page, 'db')).toBeVisible();
});

test('a filter hubble-relay rejects shows its error', async ({ page }) => {
  await open(page, 'demo');
  await expect(row(page, 'api').first()).toBeVisible();

  const input = page.getByPlaceholder(/Filter by/);
  await input.fill('ip=foo');
  await input.press('Enter');

  const toast = page.locator('.bp6-toast').filter({ hasText: 'invalid IP address "foo"' });
  await expect(toast).toBeVisible();
  // The notification's icon exists (it used to point at a missing file).
  await expect(toast.locator('.bp6-icon').first()).toBeVisible();
});

test('the Encrypted column and row tell encrypted flows apart', async ({ page }) => {
  await open(page, 'demo');
  await page.getByRole('button', { name: 'Columns' }).click();
  await page.getByText('Encrypted', { exact: true }).click();
  await page.keyboard.press('Escape');

  await expect(row(page, 'api').first()).toContainText('Yes');
  await expect(row(page, 'example.com')).toContainText('No');
});

test('the flow details name the policies that allowed or denied it', async ({ page }) => {
  await open(page, 'demo');

  await row(page, 'cloudflare.com').click();
  await expect(page.getByText('Egress denied by policies')).toBeVisible();
  await expect(page.getByText('demo/client-deny-cloudflare')).toBeVisible();

  await row(page, 'example.com').click();
  await expect(page.getByText('Egress allowed by policies')).toBeVisible();
  await expect(page.getByText('demo/client-egress')).toBeVisible();
  await expect(page.getByText('Egress denied by policies')).toHaveCount(0);
});

test('a flow can be opened with the keyboard', async ({ page }) => {
  await open(page, 'demo');

  const flow = row(page, 'cloudflare.com');
  await flow.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('demo/client-deny-cloudflare')).toBeVisible();

  // A label in the details becomes a filter, also from the keyboard.
  await page.getByRole('button', { name: 'app=client' }).first().focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/flows-filter=.*app(=|%3D)client/);
});
