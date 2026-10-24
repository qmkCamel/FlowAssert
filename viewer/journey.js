import { api, node, button, field, copy, choose } from './journey-common.js'
import { parseJourneyRoute } from './journey-router.js'
import { createAuthoring } from './journey-authoring.js'
import { createReportCatalog } from './report-catalog.js'
import { createAnalysis } from './journey-analysis.js'
import { createWebAuthoring } from './journey-web.js'

const workspace = document.querySelector('.workspace'), root = node('section', undefined, 'journey workbench-panel'), navigation = node('nav', undefined, 'journey-nav'), active = node('section', undefined, 'journey-active')
root.id = 'journey'; navigation.setAttribute('aria-label', copy('工作台页面', 'Workbench pages')); active.setAttribute('aria-live', 'polite')
const pages = Object.fromEntries(['cases', 'edit', 'runs', 'analysis', 'manage', 'missing'].map(key => { const element = node('section'); element.id = `journey-${key}`; root.append(element); return [key, element] }))
workspace.prepend(root); workspace.before(navigation, active)
const videoNotice = node('section', undefined, 'journey-active'); videoNotice.hidden = true; videoNotice.setAttribute('aria-live', 'polite'); active.after(videoNotice)
for (const [key, zh, en] of [['cases', '用例', 'Cases'], ['runs', '运行记录', 'Runs'], ['devices', '设备', 'Devices'], ['manage', '管理', 'Manage']]) { const link = node('a', copy(zh, en)); link.href = `#/${key}`; link.dataset.page = key; navigation.append(link) }
let currentRoute = null, editorKey, ticket = 0, activeRun = null, acceptance = null, pollBusy = false, skipEditLoad = false, libraryEpoch = 0, historyEpoch = 0
const mobileEditor=node('div'),webEditor=node('div');pages.edit.append(mobileEditor,webEditor);webEditor.hidden=true
const webAuthoring=createWebAuthoring(webEditor,navigate)
const nativeAuthoring = createAuthoring(mobileEditor, navigate, result => { acceptance = result; activeRun = result.runId; renderActive(); navigate(`#/runs/${result.runId}`) })
const authoring={...nativeAuthoring,async open(id){
  const record=id?await api(`/api/workbench/cases/${id}`):null,web=record?.platform==='web'
  if(!webEditor.hidden&&!webAuthoring.mayReplace())return false
  const opened=web?await webAuthoring.open(id):await nativeAuthoring.open(id)
  if(opened){mobileEditor.hidden=web;webEditor.hidden=!web}return opened
},mayReplace(){return webEditor.hidden?nativeAuthoring.mayReplace():webAuthoring.mayReplace()}}
const analysis = createAnalysis(pages.analysis, navigate, async (yaml, params, repair) => {
  if (!await authoring.mayReplace()) return
  if (repair) {
    // The existing reviewed repair owner keeps the exact authorization and child-run path.
    document.dispatchEvent(new CustomEvent('journey:repair-draft', { detail: repair })); navigate('#/legacy'); return
  }
  await authoring.loadDraft(yaml, params, null); navigate('#/cases/new', true)
}, hash => {
  const next = parseJourneyRoute(hash)
  if (next.page !== 'analysis' || currentRoute?.page !== 'analysis' || next.id !== currentRoute.id) return
  history.replaceState(null, '', hash); currentRoute = next
})
function navigate(hash, retainDraft = false) { skipEditLoad = retainDraft; if (location.hash === hash) void show(); else location.hash = hash }
const caseStatus = node('p'), caseList = node('div'), caseActions = node('div', undefined, 'journey-actions')
caseStatus.setAttribute('role', 'status'); pages.cases.append(node('h1', copy('本机用例库', 'Local case library')), node('p', copy('用例只保存到本机；连接设备后校验和执行。', 'Cases stay on this Mac. Connect a device to validate and execute.')))
caseActions.append(button('创建第一条用例', 'Create a case', async () => { if (await authoring.open(null)) navigate('#/cases/new', true) }, 'journey-new'))
const newWeb=button('创建 Web 自检用例','Create Web self-test',async()=>{if(!await authoring.mayReplace())return;if(await webAuthoring.open(null)){mobileEditor.hidden=true;webEditor.hidden=false;navigate('#/cases/new',true)}},'journey-new-web');newWeb.hidden=true;caseActions.append(newWeb)
const nameFilter = node('div', undefined, 'journey-filter'), tagFilter = node('div', undefined, 'journey-filter'); caseActions.append(nameFilter, tagFilter)
const search = field(nameFilter, '名称搜索', 'Search name', 'journey-search'), tag = field(tagFilter, '标签', 'Tag', 'journey-filter-tag')
const archived = node('input'); archived.type = 'checkbox'; const archivedLabel = node('label', copy('已归档', 'Archived')); archivedLabel.prepend(archived); caseActions.append(archivedLabel)
const refresh = button('刷新用例', 'Refresh cases', () => void loadCases(), 'journey-case-refresh'), more = button('下一页', 'Next page', () => void loadCases(more.dataset.cursor), 'journey-more'); more.hidden = true; caseActions.append(refresh)
pages.cases.append(caseActions, caseStatus, caseList, more)
async function loadCases(cursor) {
  const epoch = ++libraryEpoch; refresh.disabled = true; caseStatus.textContent = copy('正在读取用例…', 'Loading cases…')
  try {
    const query = new URLSearchParams({ query: search.value, tag: tag.value, archived: String(archived.checked), ...(cursor ? { cursor } : {}) })
    const result = await api(`/api/workbench/cases?${query}`)
    if (epoch !== libraryEpoch) return
    const items = result.cases.map(record => {
      const row = node('article', undefined, 'journey-case'); row.append(node('h2', record.name), node('p', `${record.platform} · ${record.platform==='web'?'synthetic-viewer':record.appId} · ${record.tags.join(', ')} · ${record.updatedAt}`))
      row.append(button('查看运行历史', 'View run history', () => { document.dispatchEvent(new CustomEvent('report:case', { detail: { caseId: record.caseId } })); navigate('#/runs') }))
      row.append(button('打开修订', 'Open revision', () => navigate(`#/cases/${record.caseId}/edit`)))
      if(record.platform!=='web')row.append(button('复制为新用例', 'Copy as a new case', async () => { if (!await authoring.mayReplace()) return; try { const revision = await api(`/api/workbench/cases/${record.caseId}/revisions/${record.headRevision}`); await authoring.loadDraft(revision.yaml, revision.publicParams, null); navigate('#/cases/new', true) } catch (failure) { caseStatus.textContent = failure.message } }))
      const archive = button(record.archivedAt ? '恢复' : '归档', record.archivedAt ? 'Restore' : 'Archive', async () => {
        archive.disabled = true; caseStatus.textContent = copy('正在更新归档状态…', 'Updating archive state…')
        try { await api(`/api/workbench/cases/${record.caseId}/archive`, { requestId: crypto.randomUUID(), expectedRevision: record.headRevision, archived: !record.archivedAt }); await loadCases() }
        catch (failure) { caseStatus.textContent = failure.message; archive.disabled = false }
      }); row.append(archive); return row
    })
    caseList.replaceChildren(...items); if (!items.length) caseList.append(node('p', copy('没有匹配的用例。创建新用例或调整筛选。', 'No matching cases. Create a case or adjust filters.')))
    caseStatus.textContent = copy(`共 ${result.total} 条；本页 ${items.length} 条`, `${result.total} cases; ${items.length} on this page`); more.hidden = !result.cursor; more.dataset.cursor = result.cursor ?? ''
  } catch (failure) { if (epoch === libraryEpoch) caseStatus.textContent = copy(`读取失败，保留上一页：${failure.message}`, `Read failed; previous page retained: ${failure.message}`) }
  finally { if (epoch === libraryEpoch) refresh.disabled = false }
}
archived.onchange = () => void loadCases()
document.addEventListener('journey:cases-changed', () => { if (currentRoute?.page === 'cases') void loadCases() })
const trendSection = document.querySelector('.wb-trends'), trendMarker = document.createComment('report-trends'); trendSection.before(trendMarker)
const catalog = createReportCatalog(pages.runs, { navigate, trends: trendSection })
pages.manage.append(node('h1', copy('本机管理', 'Local management')))
const managed = ['.wb-retention', '.wb-baselines'].map(selector => { const section = document.querySelector(selector), marker = document.createComment(selector); section.before(marker); return { section, marker } })
pages.missing.append(node('h1', copy('页面或选择无效', 'Invalid page or selection')), node('p', copy('未加载其他运行证据，也未执行设备操作。', 'No unrelated evidence loaded or device action executed.'))); const home = node('a', copy('返回用例', 'Back to cases')); home.href = '#/cases'; pages.missing.append(home)
async function show() {
  const next = parseJourneyRoute(location.hash), epoch = ++ticket
  const sameAnalysis = currentRoute?.page === 'analysis' && next.page === 'analysis' && currentRoute.id === next.id
  if (next.page === 'edit' && !skipEditLoad && editorKey !== next.id) {
    try { if (!await authoring.open(next.id)) { history.replaceState(null, '', currentRoute?.page === 'edit' && currentRoute.id ? `#/cases/${currentRoute.id}/edit` : '#/cases'); return } }
    catch (failure) { pages.missing.querySelector('p').textContent = failure.message; next.page = 'missing' }
  }
  skipEditLoad = false; if (epoch !== ticket) return
  if (next.page === 'edit') editorKey = next.id
  currentRoute = next; if (next.page !== 'analysis') analysis.deactivate(); catalog.deactivate()
  if (next.page !== 'runs') { trendMarker.after(trendSection); trendSection.hidden = false }
  for (const [key, page] of Object.entries(pages)) page.hidden = key !== next.page
  const legacy = next.page === 'legacy', device = next.page === 'devices', landing = !location.hash
  root.hidden = legacy || device
  document.dispatchEvent(new CustomEvent('journey:legacy', { detail: legacy }))
  document.querySelector('.control-panel').hidden = !(device || landing)
  document.querySelector('.stage').hidden = !(legacy || device || landing)
  workspace.classList.toggle('journey-only', !legacy && !device && !landing)
  for (const item of managed) if (next.page === 'manage') pages.manage.append(item.section); else item.marker.after(item.section)
  for (const link of navigation.querySelectorAll('a')) link.setAttribute('aria-current', link.dataset.page === (next.page === 'edit' ? 'cases' : next.page === 'analysis' ? 'runs' : next.page) ? 'page' : 'false')
  if (next.page === 'cases') void loadCases()
  if (next.page === 'runs') catalog.activate()
  if (next.page === 'analysis') void analysis.show(next)
  const title = pages[next.page]?.querySelector('h1'); if (title && next.page !== 'runs' && !sameAnalysis) { title.tabIndex = -1; title.focus({ preventScroll: true }) }
}
function renderActive() {
  active.replaceChildren(); active.hidden = !activeRun
  if (!activeRun) return
  active.append(node('span', copy('运行中 / 正在封存', 'Running / finalizing')))
  const link = node('a', copy('前往查看', 'View run')); link.href = `#/runs/${activeRun}`; active.append(link)
  const cancel = button('取消运行', 'Cancel run', async () => { const id = activeRun; cancel.disabled = true; cancel.textContent = copy('正在等待取消…', 'Waiting for cancellation…'); try { if (acceptance?.runId === id) await api('/api/workbench/authoring/cancel', { executionId: acceptance.executionId }); else await api(`/api/runs/${id}/cancel`, {}); await poll() } catch (failure) { active.append(node('p', failure.message)); cancel.disabled = false } }, 'journey-cancel-run'); active.append(cancel)
}
async function poll() {
  if (pollBusy) return
  pollBusy = true
  try {
    const [state, runs] = await Promise.all([api('/api/state'), api('/api/runs')]); authoring.setDevice(state)
    newWeb.hidden=!runs.webTests?.enabled;webAuthoring.setEnabled(Boolean(runs.webTests?.enabled))
    const previous = activeRun; activeRun = runs.activeId
    if (!activeRun && acceptance && acceptance.phase !== 'finished') { const found = runs.runs.find(run => run.id === acceptance.runId); if (found?.phase === 'finished') acceptance = null; else if (!found) { const status = await api(`/api/workbench/authoring/status?requestId=${encodeURIComponent(acceptance.requestId)}`); if (status.phase === 'finished') { active.replaceChildren(node('p', `${status.outcome.verdict}: ${status.outcome.error ?? ''}`)); acceptance = null } else activeRun = acceptance.runId } }
    if (currentRoute?.page === 'analysis') analysis.refreshRunning(runs.runs.find(run => run.id === currentRoute.id))
    if (previous !== activeRun) { renderActive(); if (currentRoute?.page === 'runs') catalog.refresh() }
  } catch { /* connection failure must not invent a finished run */ }
  finally { pollBusy = false }
}
document.addEventListener('journey:inspector', event => { void authoring.handoff(event.detail).catch(failure => { const message = node('p', failure.message, 'wb-error'); message.setAttribute('role', 'alert'); document.querySelector('#inspection-draft-issues').append(message) }) })
document.addEventListener('journey:video', event => {
  const { state, text, id } = event.detail; videoNotice.hidden = !state; videoNotice.replaceChildren(node('p', text))
  if (state === 'failed') videoNotice.append(button('重试录像归档', 'Retry video archive', () => document.querySelector('#wb-video-retry').click()), button('放弃归档，保留本机下载', 'Skip archive; retain local download', () => document.querySelector('#wb-video-discard').click()))
  if (state === 'saved' && currentRoute?.page === 'analysis' && currentRoute.id === id) void analysis.show(currentRoute)
})
window.addEventListener('hashchange', () => void show())
new MutationObserver(() => { if (currentRoute?.page === 'analysis') void analysis.show(currentRoute) }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
setInterval(() => void poll(), 1000)
void show(); void poll()
