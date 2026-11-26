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

  // A world card names what it stands for.
  for (const card of ['client', 'api', 'world example.com']) {
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

test('the welcome screen lists namespaces by their traffic', async ({ page }) => {
  await page.goto('/?e2e=preset=demo');

  // demo: 5 flows, 1 of them dropped; other: 1 flow
  const demo = page.getByRole('button', { name: 'demo 5 1', exact: true });
  await expect(demo).toBeVisible();
  await expect(page.getByRole('button', { name: 'other 1 0', exact: true })).toBeVisible();

  await demo.click();
  await expect(page).toHaveURL(/namespace=demo/);
});

test('"All namespaces" boxes each namespace', async ({ page }) => {
  await page.goto('/?e2e=preset=demo&namespace=*');

  const boxes = page.locator('[class*="namespaceBackplate"] text');
  await expect(boxes.filter({ hasText: /^demo$/ })).toBeVisible();
  await expect(boxes.filter({ hasText: /^other$/ })).toBeVisible();
});

test('a red arrow shows its dropped flows and why', async ({ page }) => {
  await open(page, 'demo');
  await expect(row(page, 'cloudflare.com')).toBeVisible();

  // A click where the red line is: its box has no height, so the mouse goes there.
  const hit = page.locator('[data-drops-to]').first();
  const { x, y } = await hit.evaluate(el => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(x, y);

  await expect(page).toHaveURL(/verdicts=2(&|$)/); // Verdict.Dropped
  // Only the card's identity: its world label would match every world peer.
  await expect(page).toHaveURL(/flows-filter=to%3Aidentity%3D\d+(&|$)/);
  await expect(row(page, 'example.com')).toHaveCount(0);
  await expect(row(page, 'cloudflare.com')).toContainText('dropped · Policy denied');
});

test('the time range goes into the URL', async ({ page }) => {
  await open(page, 'demo');
  await page.getByText('All buffered').click();
  await page.getByRole('menuitem', { name: 'Since 15 min ago' }).click();

  await expect(page).toHaveURL(/since=15m/);
  await expect(page.getByRole('button', { name: 'Since 15 min ago' })).toBeVisible();
});

test('flows can be paused and exported as Hubble JSON', async ({ page }) => {
  await open(page, 'demo');
  await expect(row(page, 'cloudflare.com')).toBeVisible();

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: /Hubble JSON/ }).click();
  const file = await (await download).path();

  const { readFileSync } = await import('node:fs');
  const flows = readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map(l => JSON.parse(l).flow);
  expect(flows.length).toBeGreaterThan(0);
  expect(
    flows.some(f => f.verdict === 'DROPPED' && f.destination_names?.[0] === 'cloudflare.com'),
  ).toBe(true);
});

test('the theme follows a dark system setting', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await open(page, 'demo');

  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await expect(page.locator('body')).toHaveClass(/\bbp6-dark\b/);
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(28, 33, 39)');
});

test('the top bar fits a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, 'demo');

  for (const el of [page.getByPlaceholder(/Filter by/), page.getByText('Any verdict')]) {
    const box = (await el.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
});

test('flows can be exported as CSV', async ({ page }) => {
  await open(page, 'demo');
  await expect(row(page, 'cloudflare.com')).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: /CSV/ }).click();
  const csv = await download;
  expect(csv.suggestedFilename()).toMatch(/^hubble-flows-demo-.*\.csv$/);

  const { readFileSync } = await import('node:fs');
  const [header, ...rows] = readFileSync(await csv.path(), 'utf8')
    .trim()
    .split('\r\n');
  expect(header).toContain('destination_dns');
  expect(rows.some(r => r.includes('dropped') && r.includes('cloudflare.com'))).toBe(true);
});
