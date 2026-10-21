import { expect, test } from '@playwright/test';

test('Twoslash shows inferred types on hover', async ({ page }) => {
  await page.goto('guide/getting-started');
  await page
    .locator('.twoslash .twoslash-hover', { hasText: /^address$/ })
    .first()
    .hover();
  await expect(page.locator('.v-popper__popper--shown')).toContainText(
    'const address: string',
  );
});

test('pages offer Markdown and agent links', async ({ page, request }) => {
  await page.goto('guide/containers');
  await expect(page.locator('.version-banner')).toContainText(
    'Documents injecute 1.x',
  );
  const markdown = page.getByRole('link', { name: 'View as Markdown' });
  await expect(markdown).toHaveAttribute(
    'href',
    '/injecute/guide/containers.md',
  );
  await expect(
    page.getByRole('link', { name: 'Open in Claude' }),
  ).toHaveAttribute('href', /^https:\/\/claude\.ai\/new\?q=/);
  const md = await request.get('guide/containers.md');
  expect(md.ok()).toBe(true);
  // embedded examples are inlined in the Markdown copy agents read
  expect(await md.text()).toContain('fork({ isolated: true })');
});

test('llms.txt lists the guides with absolute links', async ({ request }) => {
  const llms = await (await request.get('llms.txt')).text();
  expect(llms).toContain('# injecute');
  expect(llms).toContain(
    'https://masyaka.github.io/injecute/guide/getting-started.md',
  );
  const full = await (await request.get('llms-full.txt')).text();
  expect(full.length).toBeGreaterThan(20_000);
});
