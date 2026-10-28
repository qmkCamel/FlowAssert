import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { examples, parseFlow, applyStep, executeFlow } from '../site/playground.js';
import { copy } from '../site/copy.js';
import { buildSite } from '../scripts/site/build.mjs';

describe('public browser Mock', () => {
  it('executes edited YAML and retains a failure with unexecuted following steps', async () => {
    const passed = await executeFlow(parseFlow(examples.pass), { delay: 0 });
    const failed = await executeFlow(parseFlow(examples.fail), { delay: 0 });
    const doubled = await executeFlow(parseFlow(examples.double), { delay: 0 });
    expect(passed).toMatchObject({ status: 'passed', count: 1, origin: 'flowassert-browser-mock' });
    expect(failed).toMatchObject({ status: 'failed', count: 1, scope: 'simulation-not-device-evidence' });
    expect(failed.steps.map(step => step.status)).toEqual(['passed', 'passed', 'passed', 'failed', 'skipped']);
    expect(failed.steps[3]).toMatchObject({ expected: '2 actions received', snapshot: { count: 1 } });
    expect(doubled).toMatchObject({ status: 'passed', count: 2, platform: 'android' });
    expect(passed.steps[2].snapshot.count).toBe(1);
  });
  it('matches literal visible text and supports negative assertions without resetting on launch', () => {
    expect(applyStep({ action: 'assertVisible', expected: '.*' }, 1).status).toBe('failed');
    expect(applyStep({ action: 'assertNotVisible', expected: '2 actions received' }, 1).status).toBe('passed');
    expect(applyStep({ action: 'assertNotVisible', expected: '1 actions received' }, 1).status).toBe('failed');
    expect(applyStep({ action: 'launchApp' }, 2).snapshot.count).toBe(2);
  });
  it('cancels before dispatch and does not execute queued steps', async () => {
    const controller = new AbortController();
    const events = [];
    const result = await executeFlow(parseFlow(examples.double), { delay: 1, signal: controller.signal,
      onStep(event) { events.push(event); if (event.phase === 'passed') controller.abort(); } });
    expect(result.status).toBe('cancelled');
    expect(result.steps.map(step => step.status)).toEqual(['passed', 'skipped', 'skipped', 'skipped', 'skipped']);
    expect(result.count).toBe(0);
  });
  it.each([
    ['unknown actions', examples.pass.replace('- launchApp', '- runScript: https://example.com/script.js')],
    ['unknown arguments', examples.pass.replace('accessibilityId: action-card', 'accessibilityId: action-card\n    retries: 5')],
    ['non Mock apps', examples.pass.replace('com.example.mobilemirror.mock', 'com.example.other')],
    ['duplicate keys', examples.pass.replace('platform: ios', 'platform: ios\nplatform: android')],
    ['YAML aliases', 'name: &name Demo\nplatform: ios\n---\n- assertVisible: {text: *name}'],
    ['custom tags', 'name: !!js/function hello\nplatform: ios\n---\n- done'],
    ['steps after done', examples.pass + '- tap: {accessibilityId: action-card}\n'],
    ['more than 40 steps', 'name: Many\nplatform: ios\n---\n' + '- launchApp\n'.repeat(41)],
    ['oversized input', '#'.repeat(12001)],
  ])('rejects %s instead of pretending to execute it', (_, source) => {
    expect(() => parseFlow(source)).toThrow();
  });
  it('provides both languages for all static and dynamic UI strings', async () => {
    const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
    const keys = [...html.matchAll(/data-(?:i18n|label|alt)="([^"]+)"/g)].map(match => match[1]);
    for (const language of ['en', 'zh-CN']) for (const key of keys) expect(copy[language][key], key).toBeTruthy();
    expect(Object.keys(copy.en)).toEqual(Object.keys(copy['zh-CN']));
  });
  it('publishes only the static allowlist with identical approved video bytes and local dependencies', async () => {
    const output = await mkdtemp(join(tmpdir(), 'flowassert-site-build-'));
    try {
      await buildSite(output);
      expect((await readdir(output)).sort()).toEqual(['.nojekyll', 'app.js', 'assets', 'copy.js', 'index.html', 'playground.js', 'styles.css', 'vendor']);
      const video = await readFile(join(output, 'assets/flowassert-introduction.zh-CN.mp4'));
      expect(video.equals(await readFile(new URL('../docs/communications/product-video/flowassert-introduction.zh-CN.mp4', import.meta.url)))).toBe(true);
      expect(await readFile(join(output, 'assets/subtitles.zh-CN.vtt'), 'utf8')).toMatch(/^WEBVTT/);
      expect(await readFile(join(output, 'vendor/yaml/index.js'), 'utf8')).toContain('./dist/index.js');
      expect(await readFile(join(output, 'vendor/yaml/LICENSE'), 'utf8')).toContain('ISC');
    } finally { await rm(output, { recursive: true, force: true }); }
  });
});
