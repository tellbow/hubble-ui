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

  // A lookahead: JavaScript takes it, relay's Go regexp (RE2) does not.
  const input = page.getByPlaceholder(/Filter flows/);
  await input.fill('http-path:(?=x)');
  await input.press('Enter');

  const toast = page
    .locator('.bp6-toast')
    .filter({ hasText: 'invalid or unsupported Perl syntax' });
  await expect(toast).toBeVisible();
  // The notification's icon exists (it used to point at a missing file).
  await expect(toast.locator('.bp6-icon').first()).toBeVisible();

  // Asking again cannot help, so the UI does not (it used to every 7 s).
  let opened = 0;
  page.on('request', r => {
    if (r.method() === 'POST' && r.url().includes('service-map-stream')) opened++;
  });
  await page.waitForTimeout(9000);
  expect(opened).toBe(0);
  await expect(page.getByText('Data streams are reconnecting')).toHaveCount(0);

  // A changed filter opens a new stream.
  await page.locator('[class*="FlowsFilterInput"] .bp6-tag-remove').click();
  await expect(row(page, 'api').first()).toBeVisible();
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
  await expect(page).toHaveURL(/filter=.*app(=|%3D)client/);
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
  await expect(page).toHaveURL(/filter=to-identity%3A\d+(&|$)/);
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

  for (const el of [page.getByPlaceholder(/Filter flows/), page.getByText('Any verdict')]) {
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

test('filters combine fields with AND and say what is wrong while typing', async ({ page }) => {
  await open(page, 'demo');
  await expect(row(page, 'api').first()).toBeVisible();

  const input = page.getByPlaceholder(/Filter flows/);
  await input.fill('to-port:99999');
  await expect(page.getByText('port: "99999" is no port')).toBeVisible();

  // demo: client → api on 8080, client → world on 443 (example.com, cloudflare.com)
  await input.fill('from-pod:client to-port:443');
  await input.press('Enter');

  await expect(page).toHaveURL(/filter=from-pod%3Aclient(\+|%20)to-port%3A443/);
  await expect(row(page, 'cloudflare.com')).toBeVisible();
  await expect(row(page, 'api')).toHaveCount(0);
});

test('the builder edits the same filters as the code mode', async ({ page }) => {
  await open(page, 'demo');
  await expect(row(page, 'api').first()).toBeVisible();

  const pick = async (label: string, option: string) => {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  };

  await page.getByRole('radio', { name: 'Builder' }).click();
  await page.getByRole('button', { name: /Add filters/ }).click();
  await page.getByRole('button', { name: 'Add filter', exact: true }).click();

  // Values seen on screen are offered, with how often.
  const value = page.getByLabel('Value');
  await value.click();
  await expect(page.getByRole('option', { name: /^client/ })).toBeVisible();
  await page.keyboard.press('Escape');

  await pick('Field', 'port 443');
  await pick('Side', 'destination');
  // Click and type as a person does: picking a Side hands focus back to its
  // button as its menu closes, and only typed keys open the value list.
  await value.click();
  await value.pressSequentially('99999');
  await value.press('Enter');
  await expect(page.getByText('port: "99999" is no port')).toBeVisible();

  await page.getByRole('button', { name: 'Remove filter' }).click();
  await page.getByRole('button', { name: 'Add filter', exact: true }).click();
  await pick('Field', 'port 443');
  await pick('Side', 'destination');
  await value.click();
  await value.pressSequentially('443');
  await value.press('Enter');
  await expect(page).toHaveURL(/filter=to-port%3A443/);
  await expect(row(page, 'api')).toHaveCount(0);

  await pick('Operator', 'is not');
  await expect(page).toHaveURL(/filter=(!|%21)to-port%3A443/);
  await expect(row(page, 'api').first()).toBeVisible();

  // The code mode shows what the builder made.
  await page.keyboard.press('Escape');
  await page.getByRole('radio', { name: 'Code' }).click();
  await expect(page.locator('[class*="FlowsFilterInput"] [class*="kind"]')).toHaveText(['port']);
});

test('the Sankey view shows who talks to what, and a click filters', async ({ page }) => {
  await open(page, 'demo');
  await expect(row(page, 'api').first()).toBeVisible();

  await page.getByRole('radio', { name: 'Sankey' }).click();
  const sankey = page.getByRole('img', { name: /source through port to destination/ });
  await expect(sankey).toBeVisible();

  await sankey.locator('[data-sankey-node="443/TCP"]').click();
  await expect(page).toHaveURL(/filter=to-port%3A443/);
  await expect(row(page, 'api')).toHaveCount(0);

  // A band filters for both of its ends.
  await sankey.locator('[data-sankey-band="client>443/TCP"]').first().click({ force: true });
  await expect(page).toHaveURL(/filter=to-port%3A443(\+|%20)from-label%3Aapp%3Dclient/);

  await page.getByRole('radio', { name: 'Map' }).click();
  await expect(page.getByRole('img', { name: /source through port/ })).toHaveCount(0);
});

test('a value in the flow details toggles a filter for flows like it', async ({ page }) => {
  await open(page, 'demo');
  await row(page, 'example.com').click();

  const encrypted = page.getByRole('button', { name: 'No', exact: true });
  await encrypted.click();
  await expect(page).toHaveURL(/filter=encrypted%3Ano/);
  await expect(row(page, 'api')).toHaveCount(0);
  await expect(row(page, 'example.com')).toBeVisible();

  // An older kind of value adds to the filters too, and toggles off alone.
  const label = page.getByRole('button', { name: 'app=client', exact: true }).first();
  await label.click();
  await expect(page).toHaveURL(/filter=encrypted%3Ano(\+|%20)from-label%3A/);
  await label.click();
  await expect(page).toHaveURL(/filter=encrypted%3Ano$/);

  await encrypted.click();
  await expect(page).not.toHaveURL(/filter=/);
  await expect(row(page, 'api').first()).toBeVisible();
});
