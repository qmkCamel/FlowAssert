const copy = {
  'zh-CN': { title: '首次业务验收', path: '1 连接设备 → 2 创建流程 → 3 校验与运行 → 4 核对结果 → 5 保存项目', connect: '检查并连接设备', inspect: '从屏幕选取步骤', template: '生成页面检查模板', app: '已安装应用 ID', expected: '预期可见文字', platform: '平台', validate: '校验当前用例', validating: '正在校验当前草稿…', cancel: '取消', stale: '草稿已变化，请重新校验', valid: '结构校验通过；尚未执行设备验收', run: '转到运行并留证', result: '查看当前运行结果', download: '下载可复用项目', exporting: '正在校验并打包项目…', downloaded: '项目已下载；解包后按 README 接入', review: '我已审查流程与公开参数，可保存在本机项目中', replace: '替换工作台中已有的草稿？当前运行与历史保持不变。', fixtures: '查看业务验证与清理能力', loading: '正在读取已登记能力…', none: '没有登记业务验证器。UI 通过不等于业务持久化已验证。', fixtureHint: '准备 → UI → 独立业务验证 → 逆序清理；每次运行独立，失败和取消仍清理已登记资源。', connected: '设备已连接', disconnected: '尚未连接设备', business: '已配置独立业务验证', noBusiness: '业务验证未配置', incomplete: '请填写应用 ID 和预期文字', previous: '以下保留上次结果；它不代表当前草稿已校验。' },
  en: { title: 'First business acceptance', path: '1 Connect → 2 Author → 3 Validate & run → 4 Review → 5 Save project', connect: 'Check & connect device', inspect: 'Pick steps from screen', template: 'Create page-check template', app: 'Installed app ID', expected: 'Expected visible text', platform: 'Platform', validate: 'Validate current flow', validating: 'Validating current draft…', cancel: 'Cancel', stale: 'Draft changed; validate again', valid: 'Structure validated; device acceptance has not run', run: 'Go to run & retain evidence', result: 'Review selected run', download: 'Download reusable project', exporting: 'Validating and packaging project…', downloaded: 'Project downloaded; extract and follow README', review: 'I reviewed the flow and public parameters for this local project', replace: 'Replace the existing workbench draft? Current runs and history remain available.', fixtures: 'Show business verification & cleanup', loading: 'Loading registered capabilities…', none: 'No business verifier registered. UI success does not establish persisted business success.', fixtureHint: 'Prepare → UI → independent verification → reverse cleanup. Every run is isolated; failure and cancellation still clean registered resources.', connected: 'Device connected', disconnected: 'Device not connected', business: 'Independent business verifier configured', noBusiness: 'Business verification not configured', incomplete: 'Enter an app ID and expected text', previous: 'Previous result retained below; it does not validate the current draft.' },
}
copy['zh-CN'].fixtureDownload = '下载业务夹具接入模板（需配置测试后端）'
copy.en.fixtureDownload = 'Download business fixture template (test backend required)'

export function createAcceptanceAssistant({ panel, editor, params, api, onDraft, connect, inspect, runControl, resultControl }) {
  const root = document.createElement('details'); root.className = 'wb-acceptance'; root.id = 'wb-acceptance'
  root.innerHTML = `<summary data-a="title"></summary><p data-a="path" class="wb-note"></p><p id="acceptance-device" class="wb-note"></p>
    <div class="wb-row"><button type="button" id="acceptance-connect" data-a="connect"></button><button type="button" id="acceptance-inspect" data-a="inspect"></button></div>
    <div class="acceptance-fields"><label><span data-a="platform"></span><select id="acceptance-platform"><option value="ios">iOS</option><option value="android">Android</option></select></label><label><span data-a="app"></span><input id="acceptance-app" autocomplete="off"></label><label><span data-a="expected"></span><input id="acceptance-expected" autocomplete="off"></label></div>
    <button type="button" id="acceptance-template" data-a="template"></button>
    <div class="wb-row"><button type="button" id="acceptance-validate" data-a="validate"></button><button type="button" id="acceptance-cancel" data-a="cancel" hidden></button><button type="button" id="acceptance-run" data-a="run"></button><button type="button" id="acceptance-result" data-a="result"></button></div>
    <p id="acceptance-status" role="status" aria-live="polite"></p><div id="acceptance-validation"></div>
    <details><summary data-a="fixtures"></summary><button type="button" id="acceptance-fixtures" data-a="fixtures"></button><p data-a="fixtureHint" class="wb-note"></p><div id="acceptance-fixture-result"></div></details>
    <label class="wb-video-option"><input type="checkbox" id="acceptance-reviewed"><span data-a="review"></span></label><button type="button" id="acceptance-export" data-a="download"></button><button type="button" id="acceptance-fixture-download" data-a="fixtureDownload"></button>`
  panel.insertBefore(root, editor.previousElementSibling)
  const $ = id => root.querySelector(`#acceptance-${id}`)
  const t = key => (copy[document.documentElement.lang] ?? copy.en)[key] ?? key
  let generation = 0, operation = null, status = '', error = '', last = null, lastKey = '', fixtures = null, fixtureBusy = false, fixtureError = '', device = null
  const key = () => `${editor.value}\0${params.value}`
  function render() {
    root.querySelectorAll('[data-a]').forEach(el => { el.textContent = t(el.dataset.a) })
    $('device').textContent = t(device?.lifecycle === 'streaming' ? 'connected' : 'disconnected')
    $('inspect').disabled = device?.lifecycle !== 'streaming'
    $('status').textContent = error || (status ? t(status) : '')
    $('validate').disabled = Boolean(operation); $('export').disabled = Boolean(operation) || !$('reviewed').checked
    $('fixture-download').disabled = Boolean(operation) || !$('reviewed').checked
    $('cancel').hidden = !operation; $('fixtures').disabled = fixtureBusy
    const result = $('validation'); result.replaceChildren()
    if (last) {
      if (lastKey !== key()) append(result, t('previous'))
      append(result, last.valid ? `${t('valid')} · ${last.steps} steps · ${t(last.businessRequired ? 'business' : 'noBusiness')}` : '')
      for (const issue of [...(last.blockers ?? []), ...(last.advice ?? [])]) append(result, `${issue.line ?? ''} ${issue.message}`)
    }
    const info = $('fixture-result'); info.replaceChildren()
    if (fixtureBusy) append(info, t('loading'))
    if (fixtureError) append(info, fixtureError)
    if (fixtures) {
      if (!fixtures.fixtures.length) append(info, t('none'))
      for (const fixture of fixtures.fixtures) append(info, `${fixture.role} · ${fixture.ref}${fixture.cleanup ? ` → cleanup: ${fixture.cleanup}` : ''}\n${JSON.stringify(fixture.input)}`)
    }
  }
  function append(target, text) { const p = document.createElement('p'); p.textContent = text; p.className = 'wb-note'; target.append(p) }
  function changed() { generation++; operation?.abort(); operation = null; $('reviewed').checked = false; status = last ? 'stale' : ''; error = ''; render() }
  editor.addEventListener('input', changed); params.addEventListener('input', changed)
  function replace(yaml) {
    if (editor.value.trim() && editor.value !== yaml && !window.confirm(t('replace'))) return false
    onDraft(yaml); changed(); root.open = true; return true
  }
  $('connect').onclick = connect; $('inspect').onclick = inspect
  $('template').onclick = () => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,254}$/.test($('app').value) || !$('expected').value.trim()) { error = t('incomplete'); render(); return }
    replace(`name: "First acceptance"\nplatform: ${$('platform').value}\nappId: ${JSON.stringify($('app').value)}\n---\n- launchApp\n- assertVisible:\n    text: ${JSON.stringify($('expected').value)}\n- done\n`)
  }
  $('validate').onclick = async () => {
    if (operation) return
    const current = ++generation, sourceKey = key(), controller = new AbortController(); operation = controller; status = 'validating'; error = ''; render()
    try {
      const value = await api('/api/workbench/drafts/validate', { yaml: editor.value, params: JSON.parse(params.value) }, controller.signal)
      if (current !== generation || controller.signal.aborted || sourceKey !== key()) return
      last = value; lastKey = sourceKey; status = ''
    } catch (cause) { if (current === generation && !controller.signal.aborted) error = cause.message }
    finally { if (operation === controller) operation = null; render() }
  }
  $('cancel').onclick = () => { generation++; operation?.abort(); operation = null; status = 'stale'; render() }
  $('reviewed').onchange = render
  $('run').onclick = () => { runControl.scrollIntoView({ block: 'center' }); runControl.focus() }
  $('result').onclick = () => resultControl.scrollIntoView({ block: 'start' })
  $('fixtures').onclick = async () => {
    if (fixtureBusy) return
    fixtureBusy = true; fixtureError = ''; render()
    try { fixtures = await api('/api/workbench/acceptance/capabilities') }
    catch (cause) { fixtureError = cause.message }
    finally { fixtureBusy = false; render() }
  }
  async function downloadProject(fixture = false) {
    if (operation || !$('reviewed').checked) return
    const current = ++generation, sourceKey = key(), controller = new AbortController(); operation = controller; status = 'exporting'; error = ''; render()
    try {
      const response = await fetch(`/api/workbench/acceptance/${fixture ? 'fixture-template' : 'export'}`, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify(fixture ? { reviewed: true } : { yaml: editor.value, params: JSON.parse(params.value), reviewed: true }) })
      if (!response.ok) throw new Error((await response.json()).error ?? `HTTP ${response.status}`)
      const blob = await response.blob()
      if (current !== generation || controller.signal.aborted || sourceKey !== key()) return
      const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = fixture ? 'mobile-business-template.tar' : 'mobile-acceptance.tar'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
      status = 'downloaded'
    } catch (cause) { if (current === generation && !controller.signal.aborted) error = cause.message }
    finally { if (operation === controller) operation = null; render() }
  }
  $('export').onclick = () => downloadProject()
  $('fixture-download').onclick = () => downloadProject(true)
  render()
  return { render, changed, receive: replace, setDevice(value) { device = value; render() } }
}
