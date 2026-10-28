import { parseAllDocuments } from 'yaml';

export class FlowError extends Error {
  constructor(code, details = '') { super(code); this.code = code; this.details = details; }
}

export const examples = {
  pass: 'name: Tap and verify\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- launchApp\n- assertVisible:\n    text: Hello, harness.\n- tap:\n    accessibilityId: action-card\n- assertVisible:\n    text: 1 actions received\n- done\n',
  fail: 'name: Find the mismatch\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- launchApp\n- assertVisible:\n    text: Hello, harness.\n- tap:\n    accessibilityId: action-card\n- assertVisible:\n    text: 2 actions received\n- done\n',
  double: 'name: Two taps, one assertion\nplatform: android\nappId: com.example.mobilemirror.mock\n---\n- launchApp\n- tap:\n    accessibilityId: action-card\n- tap:\n    accessibilityId: action-card\n- assertVisible:\n    text: 2 actions received\n- done\n',
};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keysAre = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));

export function parseFlow(source) {
  if (typeof source !== 'string' || source.length > 12000) throw new FlowError('size');
  let values;
  try {
    const docs = parseAllDocuments(source, { schema: 'core', uniqueKeys: true });
    if (docs.some(doc => doc.errors.length || doc.warnings.length)) throw new Error('Invalid YAML');
    values = docs.map(doc => doc.toJS({ maxAliasCount: 0 }));
  } catch { throw new FlowError('yaml'); }
  if (values.length !== 2) throw new FlowError('documents');
  const [header, steps] = values;
  if (!keysAre(header, ['name', 'platform', 'appId']) || typeof header.name !== 'string' ||
      !header.name.trim() || header.name.length > 80 || !['ios', 'android'].includes(header.platform) ||
      (header.appId !== undefined && header.appId !== 'com.example.mobilemirror.mock')) throw new FlowError('header');
  if (!Array.isArray(steps) || !steps.length || steps.length > 40) throw new FlowError('steps');
  const normalized = steps.map((step, index) => {
    if (step === 'launchApp' || step === 'done') return { action: step, index };
    if (!object(step) || Object.keys(step).length !== 1) throw new FlowError('command', String(index + 1));
    const [action] = Object.keys(step);
    const arg = step[action];
    if (action === 'tap' && keysAre(arg, ['accessibilityId']) && arg.accessibilityId === 'action-card') {
      return { action, index, target: arg.accessibilityId };
    }
    if (['assertVisible', 'assertNotVisible'].includes(action) && keysAre(arg, ['text']) &&
        typeof arg.text === 'string' && arg.text.length > 0 && arg.text.length <= 160) {
      return { action, index, expected: arg.text };
    }
    throw new FlowError('command', String(index + 1));
  });
  const doneIndex = normalized.findIndex(step => step.action === 'done');
  if (doneIndex >= 0 && doneIndex !== normalized.length - 1) throw new FlowError('done');
  return { name: header.name.trim(), platform: header.platform, source, steps: normalized };
}

export function snapshot(count) {
  return { count, visibleText: ['Hello, harness.', `${count} actions received`] };
}

export function applyStep(step, count) {
  // launchApp preserves the counter, matching the product's Mock behavior.
  const next = step.action === 'tap' ? count + 1 : count;
  const state = snapshot(next);
  let passed = true;
  if (step.action === 'assertVisible') passed = state.visibleText.includes(step.expected);
  if (step.action === 'assertNotVisible') passed = !state.visibleText.includes(step.expected);
  return { ...step, status: passed ? 'passed' : 'failed', snapshot: state };
}

function pause(milliseconds, signal) {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve();
    const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, milliseconds);
    signal?.addEventListener('abort', finish, { once: true });
  });
}

export async function executeFlow(plan, { signal, onStep = () => {}, delay = 480 } = {}) {
  const run = { origin: 'flowassert-browser-mock', scope: 'simulation-not-device-evidence',
    name: plan.name, platform: plan.platform, source: plan.source,
    startedAt: new Date().toISOString(), status: 'passed', steps: [] };
  let count = 0;
  for (const step of plan.steps) {
    onStep({ index: step.index, count, phase: 'running', total: plan.steps.length });
    await pause(delay, signal);
    if (signal?.aborted) { run.status = 'cancelled'; break; }
    const result = applyStep(step, count);
    count = result.snapshot.count;
    run.steps.push(result);
    onStep({ index: step.index, count, phase: result.status, total: plan.steps.length });
    if (result.status === 'failed') { run.status = 'failed'; break; }
  }
  run.steps.push(...plan.steps.slice(run.steps.length).map(step => ({ ...step, status: 'skipped' })));
  return { ...run, finishedAt: new Date().toISOString(), count };
}
