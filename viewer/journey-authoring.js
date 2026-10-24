import { api, node, button, field, copy, choose, download } from './journey-common.js'
import { beginAuthoringRecording } from './workbench.js'

const blank = (name, platform, appId) => `name: ${JSON.stringify(name)}\nplatform: ${platform}\nappId: ${JSON.stringify(appId)}\n---\n`
const demo = 'name: Mock example\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- launchApp\n- assertVisible: {text: "Hello, harness."}\n'
function wrapFields(root) { for (const label of [...root.querySelectorAll(':scope > label')]) { const input = label.nextElementSibling, wrapper = node('div'); label.before(wrapper); wrapper.append(label, input) } }
export function createAuthoring(root, navigate, accepted) {
  let version = 0, savedText = '', identity = null, receipt = null, validationController = null, runRequest = null, saveRequest = null, busyRun = false, saving = false, describing = 0, exporting = false, exported = null, state = null
  let recordingAttempt = null, videoState = null, openSequence = 0
  const status = node('p'), error = node('p', '', 'wb-error'), cards = node('div'), preview = node('div')
  status.id = 'journey-validation'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); error.setAttribute('role', 'alert')
  root.append(node('h1', copy('创建可验证用例', 'Create a verifiable case')))
  root.append(node('p', copy('1 选择目标 → 2 编写步骤与预期 → 3 校验 → 4 确认运行。仅操作成功不等于断言通过。', '1 Target → 2 Steps and expectations → 3 Validate → 4 Confirm run. Successful actions are not assertions.'), 'wb-note'))
  const target = node('section'), name = field(target, '名称', 'Name', 'journey-name', 'New case'), platform = field(target, '平台（ios / android）', 'Platform (ios / android)', 'journey-platform', 'ios'), appId = field(target, 'App ID', 'App ID', 'journey-app', 'com.example.mobilemirror.mock')
  target.className = 'authoring-target'; wrapFields(target)
  root.append(target)
  const device = node('p'), devices = node('a', copy('前往设备 / Inspector', 'Open device / Inspector')); devices.href = '#/devices'; root.append(device, devices)
  const sourceDetails = node('details'); sourceDetails.id = 'journey-source'; sourceDetails.append(node('summary', copy('原始 YAML（执行事实）', 'Source YAML (execution input)')))
  const yaml = field(sourceDetails, 'YAML 源码', 'YAML source', 'journey-yaml', '', 'textarea'); yaml.rows = 12; yaml.spellcheck = false
  root.append(sourceDetails)
  const params = field(root, '公开参数 JSON（不要填写凭据）', 'Public parameters JSON (no credentials)', 'journey-params', '{}')
  const tags = field(root, '标签（逗号分隔）', 'Tags (comma-separated)', 'journey-tags', '')
  const publicData = node('input'); publicData.type = 'checkbox'; publicData.id = 'journey-public'; const publicLabel = node('label', copy('我确认 YAML 和参数仅含可持久化/导出的公开测试数据', 'I confirm YAML and parameters contain only public test data for saving/export')); publicLabel.prepend(publicData); root.append(publicLabel)
  const stepForm = node('section'), kind = field(stepForm, '步骤类型', 'Step type', 'journey-kind', '', 'select')
  for (const value of ['assertVisible', 'assertNotVisible', 'tap', 'type', 'waitUntil', 'waitUntilGone', 'launchApp', 'wait']) { const option = node('option', value); option.value = value; kind.append(option) }
  const selector = field(stepForm, '可见文本 / accessibilityId', 'Visible text / accessibilityId', 'journey-selector', '')
  const selectorMode = field(stepForm, '定位字段', 'Selector field', 'journey-selector-mode', '', 'select'); for (const key of ['text', 'accessibilityId']) { const option = node('option', key); option.value = key; selectorMode.append(option) }
  const value = field(stepForm, '输入值 / 等待秒数（公开数据）', 'Value / wait seconds (public data)', 'journey-value', '')
  stepForm.className = 'authoring-step-form'; wrapFields(stepForm)
  const append = button('添加步骤 / 预期', 'Add step / expectation', async () => {
    if (append.disabled) return
    append.disabled = true; status.textContent = copy('正在更新步骤，其他页面仍可使用…', 'Updating steps; other pages remain available…')
    try {
      let step
      if (kind.value === 'launchApp') step = '- launchApp\n'
      else if (kind.value === 'wait') { const seconds = Number(value.value); if (!Number.isFinite(seconds) || seconds < 0 || seconds > 60) throw new Error(copy('等待需为 0–60 秒', 'Wait must be 0–60 seconds')); step = `- wait: ${seconds}\n` }
      else if (kind.value === 'type') { if (!selector.value) throw new Error(copy('请填写输入控件定位条件', 'Enter an input locator')); step = `- type:\n    into: {${selectorMode.value}: ${JSON.stringify(selector.value)}}\n    text: ${JSON.stringify(value.value)}\n` }
      else if (kind.value === 'waitUntil' || kind.value === 'waitUntilGone') { if (!selector.value) throw new Error(copy('请填写等待条件', 'Enter a wait condition')); step = `- ${kind.value}:\n    target: {${selectorMode.value}: ${JSON.stringify(selector.value)}}\n    timeout: 10\n` }
      else { if (!selector.value) throw new Error(copy('请填写明确的定位条件', 'Enter an explicit locator')); step = `- ${kind.value}:\n    ${selectorMode.value}: ${JSON.stringify(selector.value)}\n` }
      if (!yaml.value.trim()) { yaml.value = blank(name.value, platform.value, appId.value) + step; changed(); void describe(); return }
      const revision = version
      const result = await api('/api/workbench/authoring/append', { yaml: yaml.value, addition: blank(name.value, platform.value, appId.value) + step })
      if (version !== revision) return
      yaml.value = result.yaml; changed(); void describe()
    } catch (failure) { error.textContent = failure.message }
    finally { append.disabled = false }
  }, 'journey-add-step')
  stepForm.append(append); root.append(stepForm, cards)
  const actions = node('div', undefined, 'journey-actions')
  const validate = button('校验当前输入', 'Validate current input', async () => {
    if (validationController) return
    const current = version, controller = new AbortController(); validationController = controller; receipt = null; runRequest = null; recordingAttempt?.handle.stop('revalidate'); recordingAttempt = null; error.textContent = ''; status.textContent = copy('正在校验…其他页面仍可使用', 'Validating… other pages remain available'); controls()
    try {
      const snapshot = await api('/api/state', undefined, controller.signal)
      const result = await api('/api/workbench/authoring/validate', { yaml: yaml.value, params: JSON.parse(params.value), target: { platform: platform.value, appId: appId.value, sessionId: snapshot.lifecycle === 'streaming' ? snapshot.sessionId : null } }, controller.signal)
      if (current !== version || controller.signal.aborted) return
      receipt = result.valid ? result : null
      validationFacts.replaceChildren(node('summary', copy('校验绑定与验证范围（输入变化后不再有效）', 'Validation binding and scope (invalid after input changes)')), node('pre', JSON.stringify(result.valid ? { name: result.name, steps: result.steps, target: result.receipt.targetBinding, inputDigest: result.receipt.inputDigest, expiresAt: result.receipt.expiresAt, scope: result.scope } : { actionOnly: result.actionOnly, blockers: result.blockers }, null, 2)))
      status.textContent = result.valid ? copy(`静态校验通过；UI 断言尚未执行。${result.canRun ? '请审查目标与留证范围。' : '设备未就绪；可保存，连接后重新校验。'}`, `Static validation passed; UI assertions not executed. ${result.canRun ? 'Review target and evidence scope.' : 'Device not ready; save, connect and revalidate.'}`) : result.actionOnly ? copy('仅动作流程：没有有效断言，可保存但不能作为已验证用例。', 'Action-only flow: no assertion. Saveable, but not a verified test.') : (result.blockers ?? []).map(issue => `${issue.line ?? ''} ${issue.message}`).join('\n')
    } catch (failure) { if (!controller.signal.aborted && version === current) error.textContent = failure.message }
    finally { if (validationController === controller) validationController = null; controls() }
  }, 'journey-validate')
  const cancelValidation = button('取消校验', 'Cancel validation', () => { validationController?.abort(); validationController = null; receipt = null; status.textContent = copy('校验已取消，草稿保留', 'Validation cancelled; draft retained'); controls() })
  const evidence = node('input'); evidence.type = 'checkbox'; evidence.id = 'journey-consent'; const evidenceLabel = node('label', copy('确认执行该输入，并在本机保存原图、结构、日志（可能包含 App 敏感内容）', 'Execute this input and retain original images, structure and logs locally (may contain sensitive App content)')); evidenceLabel.prepend(evidence)
  const video = node('input'); video.type = 'checkbox'; video.id = 'journey-video'; const videoLabel = node('label', copy('另存无声运行录像（可选，不代表视觉验证）', 'Also save silent run video (optional, not visual verification)')); videoLabel.prepend(video)
  const videoStatus = node('p'); videoStatus.id = 'journey-video-status'; videoStatus.setAttribute('role', 'status')
  const videoRetry = button('重试归档录像', 'Retry video archive', () => document.querySelector('#wb-video-retry').click()), videoDiscard = button('放弃归档，保留设备页本机下载', 'Skip archive; retain local download on Devices', () => document.querySelector('#wb-video-discard').click()); videoRetry.hidden = videoDiscard.hidden = true
  const run = button('确认运行并留证', 'Confirm run and retain evidence', async () => {
    if (busyRun || !receipt?.canRun || !evidence.checked) return
    busyRun = true; controls(); error.textContent = ''; status.textContent = copy('正在受理运行…', 'Accepting execution…')
    try {
      if (!runRequest && video.checked) recordingAttempt = beginAuthoringRecording()
      runRequest ??= { receipt: receipt.receipt.token, inputDigest: receipt.receipt.inputDigest, requestId: crypto.randomUUID(), localEvidence: true, ...(recordingAttempt ? { video: recordingAttempt.binding } : {}), ...(identity && !dirty() ? { caseRevision: { caseId: identity.caseId, revisionId: identity.revisionId, inputDigest: identity.contentDigest } } : {}) }
      const result = await api('/api/workbench/authoring/run', runRequest)
      recordingAttempt?.attach(result.runId); recordingAttempt = null
      accepted({ ...result, requestId: runRequest.requestId }); receipt = null; status.textContent = copy('运行已受理，切换页面不会取消。', 'Execution accepted; navigation does not cancel it.')
    }
    catch (failure) { error.textContent = copy(`受理状态可能未知；重试会使用相同请求，不会自动重跑。${failure.message}`, `Acceptance may be unknown; retry keeps the same identity. ${failure.message}`) }
    finally { busyRun = false; controls() }
  }, 'journey-run')
  const save = button('保存到用例库', 'Save to case library', () => void saveDraft(false), 'journey-save')
  const saveCopy = button('另存副本', 'Save copy', () => void saveDraft(true), 'journey-save-copy')
  const exportButton = button('预览项目导出', 'Preview project export', async () => {
    if (exporting) return
    if (!publicData.checked) { error.textContent = publicLabel.textContent; return }
    exporting = true; controls(); const revision = version; status.textContent = copy('正在生成导出预览…', 'Preparing export preview…')
    try {
      const result = await api('/api/workbench/authoring/export', { yaml: yaml.value, params: JSON.parse(params.value), publicData: true })
      if (revision !== version) return
      exported = result; preview.replaceChildren(node('h3', copy('固定相对路径；请检查所有公开内容', 'Fixed relative paths; review all public content')))
      for (const [file, content] of Object.entries(result.files)) { const detail = node('details'); detail.append(node('summary', file), node('pre', content)); preview.append(detail) }
      preview.append(button('确认并下载项目包', 'Confirm and download project', () => { if (revision === version && exported === result) download('mobile-mirror-project.tar', projectTar(result.files), 'application/x-tar') }))
      status.textContent = copy('预览就绪，尚未注册项目或执行。', 'Preview ready; no project registration or execution.')
    } catch (failure) { error.textContent = failure.message }
    finally { exporting = false; controls() }
  }, 'journey-export')
  actions.append(validate, cancelValidation, save, saveCopy, exportButton)
  const validationFacts = node('details')
  root.append(actions, videoLabel, videoStatus, videoRetry, videoDiscard, evidenceLabel, run, status, validationFacts, error, preview)
  document.addEventListener('journey:video', event => { videoState = event.detail.state; videoStatus.textContent = event.detail.text; videoRetry.hidden = videoDiscard.hidden = videoState !== 'failed'; controls() })
  root.append(button('载入 Mock 演示（替换需确认）', 'Load Mock example (review replacement)', async () => { if (await mayReplace()) await loadDraft(demo, {}, null) }, 'journey-demo'))
  try { const old = localStorage.getItem('mobile-mirror.flow.v1'); if (old) root.append(button('恢复旧本机草稿为新用例', 'Restore legacy local draft as a new case', async () => { if (await mayReplace()) await loadDraft(old, {}, null) }, 'journey-restore')) } catch { /* optional storage */ }
  function snapshot() { return JSON.stringify({ yaml: yaml.value, params: params.value, name: name.value, platform: platform.value, appId: appId.value, tags: tags.value }) }
  function dirty() { return snapshot() !== savedText && Boolean(yaml.value.trim()) }
  function changed() { version++; receipt = null; runRequest = null; recordingAttempt?.handle.stop('input-changed'); recordingAttempt = null; evidence.checked = false; exported = null; validationController?.abort(); validationController = null; status.textContent = copy('输入已修改，需要重新校验；草稿尚未保存。', 'Input changed; revalidation required. Draft not saved.'); controls() }
  function controls() { validate.disabled = Boolean(validationController); cancelValidation.hidden = !validationController; save.disabled = saveCopy.disabled = saving; exportButton.disabled = exporting; run.disabled = busyRun || Boolean(videoState && videoState !== 'saved') || !receipt?.canRun || !evidence.checked || Date.parse(receipt?.receipt.expiresAt ?? '') <= Date.now() }
  for (const input of [yaml, params, name, platform, appId, tags]) input.addEventListener('input', changed)
  for (const [input, key] of [[name, 'name'], [platform, 'platform'], [appId, 'appId']]) input.addEventListener('change', async () => {
    if (!yaml.value.trim()) return
    const revision = version
    try { const result = await api('/api/workbench/authoring/header', { yaml: yaml.value, key, value: input.value }); if (revision === version) { yaml.value = result.yaml; changed(); void describe() } }
    catch (failure) { if (revision === version) error.textContent = failure.message }
  })
  evidence.onchange = controls
  async function describe() {
    const current = version, ticket = ++describing
    try {
      const result = await api('/api/workbench/authoring/document', { yaml: yaml.value })
      if (current !== version || ticket !== describing) return
      cards.replaceChildren(node('h2', copy('步骤卡（不支持的语法请在源码中编辑）', 'Step cards (edit advanced syntax in source)')))
      for (const card of result.cards) {
        const section = node('fieldset'); section.append(node('legend', `${card.index + 1}. ${card.kind}`))
        if (!card.editable) section.append(node('p', copy('高级步骤：仅源码编辑，原文保留。', 'Advanced step: source editing only; original retained.')))
        if (!card.editable && !['done', 'back'].includes(card.kind)) sourceDetails.open = true
        for (const entry of card.fields) {
          const input = field(section, entry.key || '值', entry.key || 'Value', `journey-card-${card.index}-${entry.key}`, String(entry.value))
          section.append(button('应用字段修改', 'Apply field edit', async event => {
            if (current !== version) { error.textContent = copy('步骤卡已过期，请重新载入', 'Cards are stale; reload'); return }
            const control = event.currentTarget; control.disabled = true; status.textContent = copy('正在更新字段…其他页面仍可使用', 'Updating field… other pages remain available')
            try { const edited = await api('/api/workbench/authoring/edit', { yaml: yaml.value, digest: result.digest, index: card.index, field: entry.key, value: typeof entry.value === 'number' ? Number(input.value) : input.value }); if (version === current) { yaml.value = edited.yaml; changed(); void describe() } } catch (failure) { error.textContent = failure.message; status.textContent = copy('字段修改失败，原稿保留', 'Field update failed; draft retained') }
            finally { control.disabled = false }
          }))
        }
        cards.append(section)
      }
    } catch (failure) { if (current === version) { cards.replaceChildren(node('p', copy('保留原文；步骤卡暂不可用。', 'Source retained; cards unavailable.'))); error.textContent = failure.message } }
  }
  root.insertBefore(button('刷新步骤卡', 'Refresh step cards', () => void describe(), 'journey-cards-refresh'), cards)
  async function saveDraft(asCopy) {
    if (saving) return false
    if (!publicData.checked) { error.textContent = publicLabel.textContent; return false }
    saving = true; controls(); status.textContent = copy('正在保存修订…其他页面仍可使用', 'Saving revision… other pages remain available'); const current = version, frozen = snapshot()
    try {
      const content = { name: name.value, tags: tags.value.split(',').map(value => value.trim()).filter(Boolean), platform: platform.value, appId: appId.value, yaml: yaml.value, publicParams: JSON.parse(params.value) }
      const key = asCopy ? null : identity?.caseId
      const signature = JSON.stringify({ key, frozen })
      if (saveRequest?.signature !== signature) saveRequest = { signature, body: { requestId: crypto.randomUUID(), expectedRevision: key ? identity.revisionId : null, content, publicData: true } }
      const result = await api(key ? `/api/workbench/cases/${key}/revisions` : '/api/workbench/cases', saveRequest.body)
      const revision = await api(`/api/workbench/cases/${result.caseId}/revisions/${result.revisionId}`)
      if (current === version) { identity = revision; savedText = frozen; saveRequest = null; status.textContent = copy(`已保存修订 · ${revision.createdAt}`, `Revision saved · ${revision.createdAt}`); error.textContent = '' }
      document.dispatchEvent(new Event('journey:cases-changed')); return current === version
    } catch (failure) { error.textContent = failure.code === 'case-revision-conflict' ? copy('另一个窗口已保存。当前草稿保留，请另存副本或重新打开。', 'Another editor saved first. Draft retained; save a copy or reopen.') : failure.message; return false }
    finally { saving = false; controls() }
  }
  async function mayReplace() {
    if (!dirty()) return true
    const choice = await choose(copy('当前草稿尚未保存', 'Unsaved draft'), [['save', '保存后继续', 'Save and continue'], ['discard', '放弃修改', 'Discard changes'], ['cancel', '取消', 'Cancel']])
    return choice === 'discard' || choice === 'save' && await saveDraft(false)
  }
  async function loadDraft(text, publicParams, origin) {
    yaml.value = text; params.value = JSON.stringify(publicParams); identity = origin; tags.value = origin?.tags.join(',') ?? ''; changed()
    const revision = version
    try { const description = await api('/api/workbench/authoring/document', { yaml: text }); if (version !== revision) return; name.value = description.header.name ?? ''; platform.value = description.header.platform ?? 'ios'; appId.value = description.header.appId ?? '' } catch { /* retain arbitrary legacy text */ }
    if (version !== revision) return
    savedText = origin ? snapshot() : ''; void describe(); controls()
  }
  async function open(caseId) {
    const sequence = ++openSequence, revision = version
    if (caseId && identity?.caseId === caseId) return true
    if (!await mayReplace()) return false
    if (sequence !== openSequence) return false
    if (!caseId) { await loadDraft('', {}, null); savedText = snapshot(); return true }
    const record = await api(`/api/workbench/cases/${caseId}`), loaded = await api(`/api/workbench/cases/${caseId}/revisions/${record.headRevision}`)
    if (sequence !== openSequence || revision !== version) return false
    await loadDraft(loaded.yaml, loaded.publicParams, loaded); return true
  }
  async function handoff(detail) {
    const snapshot = await api('/api/state')
    if (!detail.expiresAt || Date.parse(detail.expiresAt) <= Date.now() || snapshot.inspectionContext?.generationToken !== detail.generationToken || snapshot.inspectionContext?.screenEpoch !== detail.screenEpoch) throw new Error(copy('Inspector 快照已过期或会话变化，请重新采集', 'Inspector snapshot expired or session changed; capture again'))
    const choice = await choose(copy('接收 Inspector 草稿', 'Receive Inspector draft'), [['append', '追加到当前用例', 'Append to current case'], ['new', '作为新用例', 'Create new case'], ['replace', '替换当前草稿', 'Replace current draft'], ['cancel', '取消', 'Cancel']])
    if (choice === 'cancel') return
    if (choice === 'append' && yaml.value.trim()) { const result = await api('/api/workbench/authoring/append', { yaml: yaml.value, addition: detail.yaml }); yaml.value = result.yaml; changed(); void describe() }
    else if (await mayReplace()) await loadDraft(detail.yaml, {}, null)
    else return
    navigate('#/cases/new', true)
  }
  function setDevice(next) {
    const binding = `${next?.sessionId}:${next?.inspectionContext?.generationToken}`
    if (state && state !== binding && receipt) { receipt = null; status.textContent = copy('设备会话变化，需要重新校验', 'Device session changed; revalidate') }
    state = binding
    device.textContent = next?.lifecycle === 'streaming' ? copy(`当前设备：${next.deviceName ?? next.sessionId}`, `Current device: ${next.deviceName ?? next.sessionId}`) : copy('设备未就绪：可编写和保存，不能运行。', 'Device not ready: author and save, but cannot run.')
    controls()
  }
  window.addEventListener('beforeunload', event => { if (dirty()) { event.preventDefault(); event.returnValue = '' } })
  savedText = snapshot(); controls()
  return { open, dirty, save: saveDraft, handoff, setDevice, loadDraft, mayReplace }
}

/** Fixed-name USTAR download; data is the reviewed bounded server response. */
function projectTar(files) {
  const chunks = [], encoder = new TextEncoder()
  for (const [name, content] of Object.entries(files)) {
    if (!['flows/acceptance.yaml', 'mobile-mirror.project.json', 'README.md', '.gitignore'].includes(name)) throw new Error('Unexpected export path')
    const bytes = encoder.encode(content), header = new Uint8Array(512), write = (offset, text) => header.set(encoder.encode(text), offset)
    write(0, name); write(100, '0000644\0'); write(108, '0000000\0'); write(116, '0000000\0'); write(124, bytes.length.toString(8).padStart(11, '0') + '\0'); write(136, '00000000000\0'); header.fill(32, 148, 156); header[156] = 48; write(257, 'ustar\0'); write(263, '00'); write(148, header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ')
    chunks.push(header, bytes, new Uint8Array((512 - bytes.length % 512) % 512))
  }
  chunks.push(new Uint8Array(1024)); const output = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0)); let offset = 0; for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length }; return output
}
