import { expect, test, type Page } from '@playwright/test';
import LZString from 'lz-string';

const status = (page: Page) => page.locator('.playground-status');
const shared = (code: string) =>
  `playground#code=${LZString.compressToEncodedURIComponent(code)}`;

test('runs the default code: graph, console, trace', async ({ page }) => {
  await page.goto('playground');
  await expect(status(page)).toHaveText(/\d+ services/, { timeout: 30_000 });
  await expect(page.locator('#tree-container-svg svg')).toBeVisible();
  await page.getByRole('button', { name: /Console/ }).click();
  await expect(page.locator('.playground-console')).toContainText(
    'email to readers@example.com: New post: Hello, injecute',
  );
  await page.getByRole('button', { name: 'Resolution trace' }).click();
  await expect(page.locator('.playground-trace li').first()).toBeVisible();
});

test('share links load code, and service keys are never rendered as HTML', async ({
  page,
}) => {
  const key = '<img src=x onerror="window.__pwned=1">';
  await page.goto(
    shared(`import { DIContainer } from 'injecute';
export default new DIContainer().addInstance(${JSON.stringify(key)}, 1).addInstance('other', 2);`),
  );
  await expect(status(page)).toHaveText('2 services', { timeout: 30_000 });
  await page.locator('.pack-rect').first().hover();
  await page.waitForTimeout(300);
  expect(
    await page.evaluate(() => (globalThis as { __pwned?: number }).__pwned),
  ).toBeUndefined();
});

test('user code runs without access to the page', async ({ page }) => {
  await page.goto(
    shared(`document.body.innerHTML = 'hacked';
export default 1;`),
  );
  await expect(page.locator('.playground-error')).toContainText(
    'document is not defined',
    {
      timeout: 30_000,
    },
  );
  await expect(page.locator('.playground-toolbar')).toBeVisible();
});

test('stops endless loops', async ({ page }) => {
  await page.goto(shared(`while (true) {}\nexport {};`));
  await expect(status(page)).toHaveText('Timed out', { timeout: 30_000 });
});

test('loads an example from ?example=', async ({ page }) => {
  await page.goto('playground?example=containers');
  await expect(page.locator('.playground-toolbar select')).toHaveValue(
    'containers',
  );
  await expect(status(page)).toHaveText(/\d+ services/, { timeout: 30_000 });
});

test('errors show their code and a docs link', async ({ page }) => {
  await page.goto(
    shared(`import { DIContainer } from 'injecute';
const c = new DIContainer().addSingleton('a', (b: unknown) => b, ['b' as never]);
export default c;`),
  );
  const error = page.locator('.playground-error');
  await expect(error).toContainText('INJECUTE_NOT_REGISTERED', {
    timeout: 30_000,
  });
  await expect(
    error.getByRole('link', { name: 'How to fix it' }),
  ).toHaveAttribute(
    'href',
    'https://masyaka.github.io/injecute/errors/not-registered',
  );
});
