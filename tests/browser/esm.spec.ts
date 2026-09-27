import { expect, test } from '@playwright/test';

// The built package (lib/) must load in browsers without a bundler: raw files and import maps.
for (const page of ['raw-esm', 'import-map']) {
  test(`${page}: loads injecute without a bundler`, async ({
    page: browser,
  }) => {
    const errors: string[] = [];
    browser.on('pageerror', (error) => errors.push(error.message));
    await browser.goto(`/tests/browser/${page}.html`);
    await expect(browser.locator('#out')).toHaveText('ok');
    expect(errors).toEqual([]);
  });
}
