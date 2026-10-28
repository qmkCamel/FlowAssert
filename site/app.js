import { examples, parseFlow, executeFlow } from './playground.js';
import { copy } from './copy.js';

const $ = id => document.getElementById(id);
const query = new URL(location.href).searchParams.get('lang');
let saved;
try { saved = localStorage.getItem('flowassert-site-language'); } catch { /* Optional preference storage. */ }
let language = query === 'zh' || query === 'zh-CN' ? 'zh-CN' : query === 'en' ? 'en' :
  ['en', 'zh-CN'].includes(saved) ? saved : navigator.language.startsWith('zh') ? 'zh-CN' : 'en';
let records = [], selected, stepIndex = 0, controller, progress, sequence = 0, error, viewRevision = 0;
const t = (key, values = {}) => (copy[language][key] ?? key).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '');
const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};

function renderStatus() {
  $('run-status').textContent = controller ? t('running', { current: (progress?.index ?? 0) + 1, total: progress?.total ?? 0 }) : error ? t('invalid') : selected ? t(selected.status) : t('ready');
  $('run-status').dataset.status = controller ? 'running' : error ? 'failed' : selected?.status ?? 'ready';
  $('run-flow').disabled = Boolean(controller);
  $('cancel-run').hidden = !controller;
  $('editor-note').textContent = t(controller ? 'nextRun' : 'editHint');
  $('playground-error').hidden = !error;
  $('playground-error').textContent = error ? t(`error_${error.code ?? 'unknown'}`, { details: error.details }) : '';
}

function renderPhone() {
  const result = selected?.steps[stepIndex];
  if (!controller && selected) $('device-platform').textContent = selected.platform === 'ios' ? 'iOS' : 'Android';
  $('phone-count').textContent = String(controller ? progress?.count ?? 0 : result?.snapshot?.count ?? selected?.count ?? 0);
  $('phone-event').textContent = controller ? t('step', { step: (progress?.index ?? 0) + 1 }) : result ? `${String(stepIndex + 1).padStart(2, '0')} · ${result.action}` : t('waiting');
  $('snapshot-label').textContent = controller ? t('live') : result?.snapshot ? t('snapshot', { step: stepIndex + 1 }) : result ? t('notExecuted') : t('deviceNote');
}

function renderResult() {
  $('result-empty').hidden = Boolean(selected);
  $('result-content').hidden = !selected;
  $('result-badge').textContent = selected ? t(selected.status) : '—';
  $('result-badge').dataset.status = selected?.status ?? '';
  if (!selected) { renderPhone(); return; }
  $('result-name').textContent = `#${selected.number} · ${selected.name}`;
  $('result-steps').replaceChildren(...selected.steps.map((step, index) => {
    const li = element('li');
    const button = element('button');
    button.type = 'button';
    button.dataset.status = step.status;
    button.setAttribute('aria-pressed', String(stepIndex === index));
    button.setAttribute('aria-label', `${t('step', { step: index + 1 })}: ${step.action}, ${t(step.status)}`);
    button.append(element('span', String(index + 1).padStart(2, '0'), 'step-number'), element('span', step.action),
      element('span', step.status === 'passed' ? '✓' : step.status === 'failed' ? '×' : '—', 'step-symbol'));
    button.addEventListener('click', () => {
      viewRevision++; stepIndex = index; renderResult();
      $('result-steps').querySelectorAll('button')[index].focus({ preventScroll: true });
    });
    li.append(button); return li;
  }));
  const step = selected.steps[stepIndex];
  const detail = $('step-detail');
  detail.replaceChildren();
  if (!step.snapshot) detail.append(element('p', t('notExecuted')));
  else {
    if (step.status === 'failed') detail.append(element('p', t('mismatch'), 'failure'));
    const pairs = step.expected !== undefined
      ? [[t(step.action === 'assertNotVisible' ? 'absent' : 'expected'), step.expected], [t('actual'), step.snapshot.visibleText.join(' / ')]]
      : [[t('count'), String(step.snapshot.count)], [t('visible'), step.snapshot.visibleText.join(' / ')]];
    for (const [label, value] of pairs) {
      const row = element('p'); row.append(element('span', `${label}: `), element('b', value)); detail.append(row);
    }
    detail.append(element('p', t('simulated')));
  }
  renderPhone();
}

function renderHistory() {
  const list = $('history-list');
  if (!records.length) { list.replaceChildren(element('span', t('noHistory'), 'muted')); return; }
  list.replaceChildren(...records.map(run => {
    const button = element('button', `#${run.number} ${t(run.status)}`);
    button.dataset.status = run.status;
    button.setAttribute('aria-pressed', String(run === selected));
    button.title = `${run.name} · ${new Date(run.finishedAt).toLocaleTimeString(language)}`;
    button.addEventListener('click', () => {
      viewRevision++; selectRun(run); renderHistory(); renderStatus();
      list.querySelectorAll('button')[records.indexOf(run)]?.focus({ preventScroll: true });
    });
    return button;
  }));
}

function selectRun(run) {
  selected = run;
  const failure = run.steps.findIndex(step => step.status === 'failed');
  stepIndex = failure >= 0 ? failure : Math.max(0, run.steps.filter(step => step.snapshot).length - 1);
  if (!controller) $('device-platform').textContent = run.platform === 'ios' ? 'iOS' : 'Android';
  renderResult();
}

function subtitles() {
  for (const track of $('intro-video').textTracks) track.mode = language === 'en' && track.language === 'en' ? 'showing' : 'disabled';
}

function renderLanguage() {
  document.documentElement.lang = language;
  document.title = language === 'en' ? 'FlowAssert — Every test tells a story.' : 'FlowAssert — 每一次验证，都有据可查。';
  document.querySelector('meta[name="description"]').content = t('heroBody');
  document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
  document.querySelectorAll('[data-label]').forEach(node => node.setAttribute('aria-label', t(node.dataset.label)));
  document.querySelectorAll('[data-alt]').forEach(node => node.alt = t(node.dataset.alt));
  $('language').textContent = language === 'en' ? '中文' : 'EN';
  $('language').setAttribute('aria-label', language === 'en' ? '切换为中文' : 'Switch to English');
  $('quickstart-link').href = language === 'en' ? 'https://github.com/qmkCamel/flowassert#quickstart' : 'https://github.com/qmkCamel/flowassert/blob/main/README.zh-CN.md#快速开始';
  $('limits-link').href = language === 'en' ? 'https://github.com/qmkCamel/flowassert#status-and-limits' : 'https://github.com/qmkCamel/flowassert/blob/main/README.zh-CN.md#当前状态与限制';
  renderStatus(); renderResult(); renderHistory(); subtitles();
}

function updateEditor() {
  $('line-numbers').textContent = Array.from({ length: $('flow-source').value.split('\n').length }, (_, index) => index + 1).join('\n');
  $('line-numbers').scrollTop = $('flow-source').scrollTop;
}

async function run() {
  if (controller) return;
  let plan;
  try { plan = parseFlow($('flow-source').value); } catch (cause) { error = cause; renderStatus(); return; }
  error = undefined;
  const revisionAtStart = viewRevision;
  controller = new AbortController();
  progress = { index: 0, total: plan.steps.length, count: 0 };
  $('run-progress').style.width = '0%';
  $('device-platform').textContent = plan.platform === 'ios' ? 'iOS' : 'Android';
  renderStatus(); renderPhone();
  try {
    const result = await executeFlow(plan, { signal: controller.signal, onStep: event => {
      progress = event;
      $('run-progress').style.width = `${(event.index + (event.phase === 'running' ? 0 : 1)) / event.total * 100}%`;
      renderStatus(); renderPhone();
    } });
    const record = { ...result, number: ++sequence };
    records = [record, ...records].slice(0, 8);
    controller = undefined;
    if (viewRevision === revisionAtStart || !records.includes(selected)) selectRun(record);
    else renderResult();
  } catch { error = { code: 'unknown' }; }
  finally { controller = undefined; renderStatus(); renderResult(); renderHistory(); }
}

$('flow-source').value = examples.pass;
$('flow-source').addEventListener('input', () => {
  updateEditor(); error = undefined; renderStatus();
  document.querySelectorAll('[data-example]').forEach(button => button.setAttribute('aria-pressed', String($('flow-source').value === examples[button.dataset.example])));
});
$('flow-source').addEventListener('scroll', updateEditor);
$('flow-source').addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void run(); }
});
document.querySelectorAll('[data-example]').forEach(button => button.addEventListener('click', () => {
  $('flow-source').value = examples[button.dataset.example];
  $('flow-source').dispatchEvent(new Event('input'));
}));
$('run-flow').addEventListener('click', run);
$('cancel-run').addEventListener('click', () => controller?.abort());
$('rerun').addEventListener('click', () => { if (selected) { $('flow-source').value = selected.source; $('flow-source').dispatchEvent(new Event('input')); $('flow-source').focus({ preventScroll: true }); } });
$('export-result').addEventListener('click', () => {
  if (!selected) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(selected, null, 2)], { type: 'application/json' }));
  const link = element('a'); link.href = url; link.download = `flowassert-browser-mock-${selected.number}.json`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('language').addEventListener('click', () => {
  language = language === 'en' ? 'zh-CN' : 'en';
  try { localStorage.setItem('flowassert-site-language', language); } catch { /* The switch still works without storage. */ }
  const url = new URL(location.href); url.searchParams.set('lang', language === 'en' ? 'en' : 'zh');
  history.replaceState(null, '', url); renderLanguage();
});
$('intro-video').addEventListener('loadedmetadata', subtitles);
$('intro-video').addEventListener('error', () => { document.querySelector('[data-i18n="videoNote"]').textContent = t('videoError'); });
updateEditor(); renderLanguage();
