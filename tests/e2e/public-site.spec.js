import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test, expect } from '@playwright/test';
import { buildSite } from '../../scripts/site/build.mjs';
import { startSiteServer } from '../../scripts/site/serve.mjs';
import { examples } from '../../site/playground.js';

let root, server, url;
test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'flowassert-site-e2e-'));
  await buildSite(root);
  ({ server, url } = await startSiteServer({ root }));
});
test.afterAll(async () => {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true });
});
test.beforeEach(async ({ page }) => { await page.goto(url + '?lang=en'); });

test('runs editable YAML, exposes failure evidence and retains the earlier success', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.locator('#run-flow').click();
  await expect(page.locator('#run-status')).toHaveText('Passed');
  await expect(page.locator('#phone-count')).toHaveText('1');
  await page.locator('[data-example=fail]').click();
  await page.locator('#run-flow').click();
  await expect(page.locator('#run-status')).toHaveText('Running 1/5');
  await expect(page.locator('#result-badge')).toHaveText('Passed');
  await page.locator('#flow-source').fill(examples.double);
  await page.locator('#language').click();
  await expect(page.locator('#run-status')).toContainText('执行中');
  await expect(page.locator('#flow-source')).toHaveValue(examples.double);
  await expect(page.locator('#run-status')).toHaveText('失败');
  await expect(page.locator('#step-detail')).toContainText('2 actions received');
  await expect(page.locator('#step-detail')).toContainText('1 actions received');
  await expect(page.locator('#result-steps [data-status=skipped]')).toHaveCount(1);
  await expect(page.locator('#history-list button')).toHaveCount(2);
  await page.locator('#history-list button').last().click();
  await expect(page.locator('#result-badge')).toHaveText('通过');
  expect(errors).toEqual([]);
});

test('preserves results after invalid input, exports provenance and keeps unsafe strings as text', async ({ page }) => {
  const unsafe = '<img src=x onerror=alert(1)>';
  await page.locator('#flow-source').fill(examples.pass.replace('Tap and verify', unsafe));
  await page.locator('#run-flow').click();
  await expect(page.locator('#run-status')).toHaveText('Passed');
  await expect(page.locator('#result-name')).toContainText(unsafe);
  await expect(page.locator('#result-name img')).toHaveCount(0);
  await page.locator('#flow-source').fill('not: [valid');
  await page.locator('#run-flow').click();
  await expect(page.locator('#playground-error')).toContainText('Invalid YAML');
  await expect(page.locator('#result-badge')).toHaveText('Passed');
  await expect(page.locator('#history-list button')).toHaveCount(1);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-result').click();
  const download = await downloadPromise;
  const result = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(result).toMatchObject({ origin: 'flowassert-browser-mock', scope: 'simulation-not-device-evidence', name: unsafe, status: 'passed' });
});

test('keeps a deliberately selected historical step and its platform when another run finishes', async ({ page }) => {
  await page.locator('#run-flow').click();
  await expect(page.locator('#run-status')).toHaveText('Passed');
  await page.locator('[data-example=double]').click();
  await page.locator('#run-flow').click();
  await expect(page.locator('#device-platform')).toHaveText('Android');
  await page.locator('#result-steps button').first().click();
  await expect(page.locator('#cancel-run')).toBeHidden();
  await expect(page.locator('#history-list button')).toHaveCount(2);
  await expect(page.locator('#result-name')).toContainText('#1');
  await expect(page.locator('#result-steps button').first()).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#phone-count')).toHaveText('0');
  await expect(page.locator('#device-platform')).toHaveText('iOS');
});

test('cancels without dispatching a pending tap and keeps language and editor usable', async ({ page }) => {
  await page.locator('#run-flow').click();
  await expect(page.locator('#cancel-run')).toBeVisible();
  await expect(page.locator('#run-flow')).toBeDisabled();
  await page.locator('#syntax-help summary').click();
  await expect(page.locator('#syntax-help')).toHaveAttribute('open', '');
  await page.locator('#cancel-run').click();
  await expect(page.locator('#run-status')).toHaveText('Cancelled');
  await expect(page.locator('#run-flow')).toBeEnabled();
  await expect(page.locator('#phone-count')).toHaveText('0');
  await page.locator('#language').click();
  await expect(page).toHaveURL(/lang=zh/);
  await expect(page.locator('#run-status')).toHaveText('已取消');
});

test('serves MP4 with range support and plays, seeks and loads English subtitles', async ({ page, request }) => {
  const response = await request.get(url + 'assets/flowassert-introduction.zh-CN.mp4', { headers: { Range: 'bytes=0-99' } });
  expect(response.status()).toBe(206); expect(response.headers()['content-type']).toBe('video/mp4');
  expect((await response.body()).length).toBe(100);
  const video = page.locator('#intro-video');
  await video.evaluate(async element => { element.muted = true; await element.play(); });
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(0.1);
  await expect.poll(() => video.evaluate(element => element.textTracks[0].cues?.length ?? 0)).toBe(12);
  await video.evaluate(element => { element.currentTime = 25; });
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(25);
  expect(await video.evaluate(element => Math.round(element.duration))).toBe(46);
  await video.evaluate(element => element.pause());
});

test('keeps both languages, media and playground usable at desktop and narrow widths', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'artifacts/runtime/pages-2026-10-28/site-en-desktop.png', fullPage: true });
  await page.locator('#language').click();
  await page.screenshot({ path: 'artifacts/runtime/pages-2026-10-28/site-zh-desktop.png', fullPage: true });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('#flow-source')).toBeVisible();
    await page.locator('#run-flow').click();
    await expect(page.locator('#run-status')).toHaveText('通过');
  }
  await page.screenshot({ path: 'artifacts/runtime/pages-2026-10-28/site-zh-narrow.png', fullPage: true });
  await page.locator('#language').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/runtime/pages-2026-10-28/site-en-narrow.png', fullPage: true });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#history-list button')).toHaveCount(0);
});
