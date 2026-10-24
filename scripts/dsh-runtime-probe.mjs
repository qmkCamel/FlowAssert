import { randomUUID } from 'node:crypto'

export const name = 'mobile-mirror-runtime-probe'
export const inject = ['tools', 'llm']
export const supportedHarnessVersion = '0.2.0-rc.2'
const viewerOrigin = process.env.MOBILE_MIRROR_PROBE_ORIGIN ?? 'http://127.0.0.1:3210'

export async function apply(ctx) {
  // Loader entries activate concurrently; wait for sibling bundle registrations.
  await new Promise((resolve) => setTimeout(resolve, 250))
  const expected = [
    'mobile_mirror_list_devices',
    'mobile_mirror_ios_preflight',
    'mobile_mirror_start',
    'mobile_mirror_status',
    'mobile_mirror_snapshot',
    'mobile_mirror_inspect_screen',
    'mobile_mirror_action',
    'mobile_mirror_manage_app',
    'mobile_mirror_stop',
    'mobile_mirror_query_screen',
    'mobile_mirror_test_catalog',
    'mobile_mirror_run_start',
    'mobile_mirror_run_status',
    'mobile_mirror_run_cancel',
    'mobile_mirror_run_evidence',
    'mobile_mirror_run_diagnostic_context',
    'mobile_mirror_run_triage',
    'mobile_acceptance_get',
    'mobile_external_result_get',
    'mobile_matrix_status',
  ]
  const registered = expected.filter((toolName) => ctx.tools.get(toolName))
  if (registered.length !== expected.length) {
    throw new Error(`FlowAssert tools missing: ${expected.filter((toolName) => !registered.includes(toolName)).join(', ')}`)
  }
  process.stdout.write(`[mobile-mirror-probe] registered=${registered.join(',')}\n`)
  process.stdout.write(`[mobile-mirror-probe] harness-baseline=${supportedHarnessVersion}\n`)

  if (process.env.MOBILE_MIRROR_PROBE_CASE === 'hmr') {
    // Web logs do not reach stdout; observe HMR through the public Cordis logger.
    ctx.logger.exporter({
      levels: { default: 2 },
      export: ({ args }) => {
        if (String(args[0]).includes('config reload') && String(args[0]).includes('failed')) {
          process.stdout.write('[mobile-mirror-probe] hmr-config-reload-failed\n')
        }
      },
    })
    ctx.effect(() => {
      const timer = setInterval(() => {
        process.stdout.write(`[mobile-mirror-probe] hmr-tools=${expected.filter((toolName) => ctx.tools.get(toolName)).length}\n`)
      }, 200)
      return () => clearInterval(timer)
    })
    process.stdout.write('[mobile-mirror-probe] hmr-ready\n')
    return
  }

  let callSequence = 0
  const execute = async (toolName, argumentsValue = {}) => {
    const result = await ctx.tools.execute({
      callId: `mobile-mirror-probe-${toolName}-${callSequence++}`,
      name: toolName,
      arguments: argumentsValue,
      signal: new AbortController().signal,
    })
    if (result.isError) throw new Error(`${toolName}: ${result.error?.message ?? 'tool execution failed'}`)
    process.stdout.write(`[mobile-mirror-probe] ${toolName}=ok\n`)
    return result
  }

  if (process.env.MOBILE_MIRROR_PROBE_CASE === 'model-image-boundary') {
    const models = await ctx.llm.listModels('deepseek-official')
    const imageModel = models.find((entry) => entry.id === 'deepseek-flash')
    if (!imageModel) throw new Error('deepseek-flash is missing from the DeepSeek model catalog')
    if (!imageModel.inputModalities?.includes('image')) throw new Error('deepseek-flash must advertise image input')
    const textModel = models.find((entry) => entry.id === 'deepseek-v4-pro')
    if (!textModel) throw new Error('deepseek-v4-pro is missing from the DeepSeek model catalog')
    if (textModel.inputModalities?.includes('image')) throw new Error('deepseek-v4-pro unexpectedly advertises image input')
    await execute('mobile_mirror_start', { provider: 'mock' })
    try {
      const snapshotResult = await execute('mobile_mirror_snapshot')
      const imageContext = snapshotResult.additionalContexts?.[0]
      if (imageContext?.content?.some((block) => block.type === 'image') !== true) {
        throw new Error('mobile_mirror_snapshot: missing deferred image context')
      }
      if (imageContext.source?.kind !== 'mobile-mirror' || imageContext.source?.form !== 'notice') {
        throw new Error('mobile_mirror_snapshot: invalid producer provenance')
      }
      const { contentHasImage, projectImagesForTextModel } = await import('@deepseek-ai/dsh-llm')
      const projected = projectImagesForTextModel([imageContext])
      if (projected.some((message) => contentHasImage(message.content))) {
        throw new Error('text-only projection retained an image block')
      }
      const projectedText = projected.flatMap((message) => message.content)
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
      if (!projectedText.includes('image omitted because this model accepts text only')) {
        throw new Error('text-only projection omitted the stable placeholder')
      }
      process.stdout.write('[mobile-mirror-probe] model-image-boundary=CATALOG_IMAGE_AND_TEXT_ONLY_PROJECTION\n')
    } finally {
      await execute('mobile_mirror_stop')
    }
    process.stdout.write('[mobile-mirror-probe] lifecycle=complete\n')
    return
  }

  if (process.env.MOBILE_MIRROR_PROBE_CASE === 'agent-test-control') {
    const mode = process.env.DSH_TOOLS_MODE === 'ptc' ? 'ptc' : 'native'
    if (mode === 'ptc') {
      const codeResult = await ctx.tools.execute({
        callId: 'mobile-mirror-agent-test-ptc', name: 'run_code',
        arguments: { description: 'Run one registered FlowAssert flow and inspect its retained evidence.', code: `
          await tools.mobile_mirror_start({ provider: 'mock' });
          const catalog = JSON.parse(await tools.mobile_mirror_test_catalog({}));
          const accepted = JSON.parse(await tools.mobile_mirror_run_start({ requestId: 'packed-ptc-flow', target: { kind: 'flow', id: 'fixture' }, catalogRevision: catalog.catalogRevision }));
          let status;
          for (let i = 0; i < 200; i++) { status = JSON.parse(await tools.mobile_mirror_run_status({ executionId: accepted.executionId })); if (status.phase === 'finished') break; await new Promise(r => setTimeout(r, 50)); }
          if (status?.verdict !== 'pass') throw new Error('registered flow failed');
          const evidence = JSON.parse(await tools.mobile_mirror_run_evidence({ executionId: accepted.executionId }));
          const image = evidence.items.find(item => item.kind === 'image');
          if (!image) throw new Error('missing image evidence');
          const delivered = JSON.parse(await tools.mobile_mirror_run_evidence({ executionId: accepted.executionId, artifactId: image.artifactId, format: 'image' }));
          let unknownTriageRejected = false;
          try { await tools.mobile_mirror_run_triage({ reportId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }); } catch { unknownTriageRejected = true; }
          await tools.mobile_mirror_stop({});
          return { verdict: status.verdict, runId: status.runId, evidenceCount: evidence.items.length, renditionHash: delivered.renditionHash, unknownTriageRejected };
        ` }, signal: new AbortController().signal,
      })
      if (codeResult.isError || codeResult.value?.result?.verdict !== 'pass' || !codeResult.value?.result?.unknownTriageRejected || codeResult.additionalContexts?.length !== 1) throw new Error('PTC registered-test lifecycle failed')
      assertImageProvenance(codeResult, 'PTC historical evidence')
      const reportId = await createTriageReport(codeResult.value.result.runId)
      const triageResult = await ctx.tools.execute({
        callId: 'mobile-mirror-agent-triage-ptc', name: 'run_code',
        arguments: { description: 'Read an already generated local triage report.', code: `
          const triage = JSON.parse(await tools.mobile_mirror_run_triage({ reportId: ${JSON.stringify(reportId)} }));
          return { reportId: triage.reportId, disposition: triage.disposition, availability: triage.availability };
        ` }, signal: new AbortController().signal,
      })
      if (triageResult.isError || triageResult.value?.result?.reportId !== reportId || triageResult.value?.result?.disposition !== 'not-applicable')
        throw new Error('PTC triage report projection failed')
      const acceptanceId = await createAcceptanceRecord(codeResult.value.result.runId)
      const acceptanceResult = await ctx.tools.execute({ callId: 'acceptance-ptc', name: 'run_code',
        arguments: { description: 'Read a local acceptance record without granting device control.', code: `return JSON.parse(await tools.mobile_acceptance_get({ id: ${JSON.stringify(acceptanceId)} }));` }, signal: new AbortController().signal })
      if (acceptanceResult.isError || acceptanceResult.value?.result?.id !== acceptanceId || acceptanceResult.value.result.current?.status !== 'incomplete' || acceptanceResult.additionalContexts?.length) throw new Error('PTC acceptance projection failed')
    } else {
      await execute('mobile_mirror_start', { provider: 'mock' })
      const catalog = JSON.parse((await execute('mobile_mirror_test_catalog')).value)
      const accepted = JSON.parse((await execute('mobile_mirror_run_start', { requestId: 'packed-native-flow', target: { kind: 'flow', id: 'fixture' }, catalogRevision: catalog.catalogRevision })).value)
      let status
      for (let i = 0; i < 200; i++) { status = JSON.parse((await execute('mobile_mirror_run_status', { executionId: accepted.executionId })).value); if (status.phase === 'finished') break; await new Promise(r => setTimeout(r, 50)) }
      if (status?.verdict !== 'pass') throw new Error('Native registered flow failed')
      const evidence = JSON.parse((await execute('mobile_mirror_run_evidence', { executionId: accepted.executionId })).value)
      const image = evidence.items.find((item) => item.kind === 'image')
      const delivered = await execute('mobile_mirror_run_evidence', { executionId: accepted.executionId, artifactId: image.artifactId, format: 'image' })
      const deliveredMetadata = JSON.parse(delivered.value)
      if (delivered.additionalContexts?.length !== 1 || !deliveredMetadata.renditionHash) throw new Error('Native evidence image was not delivered')
      assertImageProvenance(delivered, 'Native historical evidence')
      let unknownTriageRejected = false
      try { await execute('mobile_mirror_run_triage', { reportId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }) } catch { unknownTriageRejected = true }
      if (!unknownTriageRejected) throw new Error('Native triage accepted an unknown report')
      const reportId = await createTriageReport(status.runId)
      const triage = JSON.parse((await execute('mobile_mirror_run_triage', { reportId })).value)
      if (triage.reportId !== reportId || triage.disposition !== 'not-applicable') throw new Error('Native triage report projection failed')
      const acceptanceId = await createAcceptanceRecord(status.runId)
      const acceptanceResult = await execute('mobile_acceptance_get', { id: acceptanceId })
      const acceptance = JSON.parse(acceptanceResult.value)
      if (acceptance.id !== acceptanceId || acceptance.current?.status !== 'incomplete' || acceptance.input || acceptanceResult.additionalContexts?.length) throw new Error('Native acceptance projection failed')
      await execute('mobile_mirror_stop')
    }
    const externalId = await createExternalAsset()
    const externalRead = async () => mode === 'ptc'
      ? ctx.tools.execute({ callId: `external-${callSequence++}`, name: 'run_code', arguments: { description: 'Read authorized external report metadata only.', code: `return JSON.parse(await tools.mobile_external_result_get({id:${JSON.stringify(externalId)}}));` }, signal: new AbortController().signal })
      : ctx.tools.execute({ callId: `external-${callSequence++}`, name: 'mobile_external_result_get', arguments: { id: externalId }, signal: new AbortController().signal })
    if (!(await externalRead()).isError) throw new Error('External report was shared without authorization')
    await grantExternalAsset(externalId, true)
    const external = await externalRead(), projection = mode === 'ptc' ? external.value?.result : JSON.parse(external.value)
    if (external.isError || projection.id !== externalId || external.additionalContexts?.length || /private-test|private-secret/.test(JSON.stringify(projection))) throw new Error('External metadata boundary failed')
    await grantExternalAsset(externalId, false)
    if (!(await externalRead()).isError) throw new Error('Revoked external report remained accessible')
    process.stdout.write(`[mobile-mirror-probe] external-result=${mode}=PASS\n`)
    const matrix = await createProbeMatrix()
    const matrixResult = mode === 'ptc'
      ? await ctx.tools.execute({ callId: 'matrix-ptc', name: 'run_code', arguments: { description: 'Read only the registered local matrix summary.', code: `return JSON.parse(await tools.mobile_matrix_status({ id: ${JSON.stringify(matrix.id)} }));` }, signal: new AbortController().signal })
      : await execute('mobile_matrix_status', { id: matrix.id })
    const matrixProjection = mode === 'ptc' ? matrixResult.value?.result : JSON.parse(matrixResult.value)
    if (matrixResult.isError || matrixProjection.exitCode !== 0 || matrixProjection.cells.length !== 2 || matrixResult.additionalContexts?.length || /base64|storeId|processIdentity|mock-device-/.test(JSON.stringify(matrixProjection))) throw new Error('Matrix summary boundary failed')
    process.stdout.write(`[mobile-mirror-probe] matrix=${mode}=DUAL_MOCK_PASS\n`)
    process.stdout.write(`[mobile-mirror-probe] agent-test-control=${mode}=PASS\n`)
    process.stdout.write(`[mobile-mirror-probe] acceptance-record=${mode}=PASS\n`)
    process.stdout.write('[mobile-mirror-probe] lifecycle=complete\n')
    return
  }

  if (process.env.DSH_TOOLS_MODE === 'ptc') {
    const codeResult = await ctx.tools.execute({
      callId: 'mobile-mirror-probe-ptc-mode',
      name: 'run_code',
      arguments: {
        description: 'Run the FlowAssert Mock observation and safe-action lifecycle.',
        code: `
          const preflight = JSON.parse(await tools.mobile_mirror_ios_preflight({}));
          await tools.mobile_mirror_start({ provider: 'mock' });
          const compact = await tools.mobile_mirror_inspect_screen({ structureMode: 'summary' });
          if (!compact.structureSummary || compact.structure || compact.image) throw new Error('Invalid summary');
          for (const args of [{ op: 'find' }, { op: 'get', nodeId: 'n3' }, { op: 'subtree', nodeId: 'n0' }]) {
            const query = await tools.mobile_mirror_query_screen({ observationId: compact.observationId, ...args });
            if (!Array.isArray(query.nodes) || query.image) throw new Error('Invalid query');
          }
          await tools.mobile_mirror_action({ kind: 'tap_node', observationId: compact.observationId, nodeId: 'n3' });
          const snapshot = await tools.mobile_mirror_snapshot({});
          const inspect = await tools.mobile_mirror_inspect_screen({});
          await tools.mobile_mirror_action({ kind: 'tap_node', observationId: inspect.observationId, nodeId: 'n3' });
          const focused = await tools.mobile_mirror_inspect_screen({});
          await tools.mobile_mirror_action({ kind: 'input_text', observationId: focused.observationId, nodeId: 'n3', mode: 'replace', text: 'PUBLIC-DSH-PROBE' });
          const next = await tools.mobile_mirror_inspect_screen({});
          let secureRejected = false;
          try { await tools.mobile_mirror_action({ kind: 'input_text', observationId: next.observationId, nodeId: 'n4', mode: 'append', text: 'PUBLIC-DSH-PROBE' }); } catch { secureRejected = true; }
          await tools.mobile_mirror_action({ kind: 'input_text', observationId: next.observationId, nodeId: 'n3', mode: 'append', text: '-APPEND' });
          const afterAppend = await tools.mobile_mirror_inspect_screen({});
          let appPolicyRejected = false;
          try { await tools.mobile_mirror_manage_app({ operation: 'terminate' }); } catch { appPolicyRejected = true; }
          await tools.mobile_mirror_stop({});
          let staleRejected = false;
          try { await tools.mobile_mirror_action({ kind: 'back', observationId: snapshot.observationId }); } catch { staleRejected = true; }
          return { preflightStatus: preflight.status, firstRevision: snapshot.frameRevision, lastRevision: afterAppend.frameRevision, staleRejected, secureRejected, appPolicyRejected };
        `,
      },
      signal: new AbortController().signal,
    })
    if (codeResult.isError) throw new Error(`run_code: ${codeResult.error?.message ?? 'tool execution failed'}`)
    const summary = codeResult.value?.result
    if (!summary?.staleRejected || !summary?.secureRejected || !summary?.appPolicyRejected || summary.lastRevision <= summary.firstRevision || codeResult.additionalContexts?.length !== 1) {
      throw new Error('run_code: observation lifecycle or deferred image context check failed')
    }
    assertImageProvenance(codeResult, 'PTC observation')
    process.stdout.write('[mobile-mirror-probe] summary-query=no-additional-images\n')
    process.stdout.write(`[mobile-mirror-probe] ptc-mode-revisions=${summary.firstRevision}->${summary.lastRevision}\n`)
    process.stdout.write(`[mobile-mirror-probe] ios-preflight-status=${summary.preflightStatus}\n`)
    process.stdout.write('[mobile-mirror-probe] lifecycle=complete\n')
    return
  }

  const preflightResult = await execute('mobile_mirror_ios_preflight')
  const preflight = JSON.parse(preflightResult.value)
  process.stdout.write(`[mobile-mirror-probe] ios-preflight-status=${preflight.status}\n`)
  await execute('mobile_mirror_start', { provider: 'mock' })
  await execute('mobile_mirror_status')
  const snapshotResult = await execute('mobile_mirror_snapshot')
  if (snapshotResult.value?.image?.delivery !== 'deferred-context' || snapshotResult.additionalContexts?.length !== 1) {
    throw new Error('mobile_mirror_snapshot: missing deferred image context')
  }
  assertImageProvenance(snapshotResult, 'Native observation')
  const compact = await execute('mobile_mirror_inspect_screen', { structureMode: 'summary' })
  if (!compact.value?.structureSummary || compact.value.structure || compact.additionalContexts?.length) throw new Error('Summary projection leaked structure or images')
  for (const args of [{ op: 'find', role: 'input' }, { op: 'get', nodeId: 'n3' }, { op: 'subtree', nodeId: 'n0' }]) {
    const query = await execute('mobile_mirror_query_screen', { observationId: compact.value.observationId, ...args })
    if (!Array.isArray(query.value?.nodes) || query.additionalContexts?.length || query.value.image) throw new Error('Query projection is invalid')
  }
  await execute('mobile_mirror_action', { kind: 'tap_node', observationId: compact.value.observationId, nodeId: 'n3' })
  process.stdout.write('[mobile-mirror-probe] summary-query=no-additional-images\n')
  const inspectResult = await execute('mobile_mirror_inspect_screen')
  if (!Array.isArray(inspectResult.value?.structure?.nodes)) throw new Error('mobile_mirror_inspect_screen: missing structure')
  await execute('mobile_mirror_action', { kind: 'tap_node', observationId: inspectResult.value.observationId, nodeId: 'n3' })
  const focusedResult = await execute('mobile_mirror_inspect_screen')
  await execute('mobile_mirror_action', {
    kind: 'input_text',
    observationId: focusedResult.value.observationId,
    nodeId: 'n3',
    mode: 'replace',
    text: 'PUBLIC-DSH-PROBE',
  })
  const reobserveResult = await execute('mobile_mirror_inspect_screen')
  if (reobserveResult.value.frameRevision <= snapshotResult.value.frameRevision) throw new Error('re-observe revision did not advance')
  const secureResult = await ctx.tools.execute({
    callId: 'mobile-mirror-probe-secure-input',
    name: 'mobile_mirror_action',
    arguments: { kind: 'input_text', observationId: reobserveResult.value.observationId, nodeId: 'n4', mode: 'append', text: 'PUBLIC-DSH-PROBE' },
    signal: new AbortController().signal,
  })
  if (!secureResult.isError || !String(secureResult.error?.message).includes('screen_text_input_sensitive')) {
    throw new Error('mobile_mirror_action: secure input was not rejected')
  }
  await execute('mobile_mirror_action', {
    kind: 'input_text', observationId: reobserveResult.value.observationId, nodeId: 'n3', mode: 'append', text: '-APPEND',
  })
  const afterAppendResult = await execute('mobile_mirror_inspect_screen')
  const appControl = await ctx.tools.execute({
    callId: 'mobile-mirror-probe-app-policy',
    name: 'mobile_mirror_manage_app',
    arguments: { operation: 'terminate' },
    signal: new AbortController().signal,
  })
  if (!appControl.isError || !String(appControl.error?.message).includes('app_control_disabled')) {
    throw new Error('mobile_mirror_manage_app: default-disabled policy was not enforced')
  }
  await execute('mobile_mirror_stop')
  const staleResult = await ctx.tools.execute({
    callId: 'mobile-mirror-probe-stale-action',
    name: 'mobile_mirror_action',
    arguments: { kind: 'back', observationId: snapshotResult.value.observationId },
    signal: new AbortController().signal,
  })
  if (!staleResult.isError) throw new Error('stopped observation unexpectedly remained actionable')
  process.stdout.write(`[mobile-mirror-probe] revisions=${snapshotResult.value.frameRevision}->${afterAppendResult.value.frameRevision}\n`)
  process.stdout.write('[mobile-mirror-probe] lifecycle=complete\n')
}

function assertImageProvenance(result, label) {
  const message = result.additionalContexts?.[0]
  if (message?.source?.kind !== 'mobile-mirror' || message.source.form !== 'notice'
    || !message.content?.some(block => block.type === 'image')) {
    throw new Error(`${label}: invalid image producer provenance`)
  }
}

async function createTriageReport(runId) {
  const origin = viewerOrigin
  const accepted = await fetch(`${origin}/api/workbench/triage-jobs`, { method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: randomUUID(), targetRunId: runId }) })
  if (!accepted.ok) throw new Error(`Local triage acceptance failed (${accepted.status})`)
  const job = await accepted.json()
  for (let index = 0; index < 200; index++) {
    const response = await fetch(`${origin}/api/workbench/triage-jobs/${job.jobId}`)
    if (!response.ok) throw new Error(`Local triage status failed (${response.status})`)
    const current = await response.json()
    if (current.state === 'succeeded' && current.reportId) return current.reportId
    if (['failed', 'cancelled', 'interrupted'].includes(current.state)) throw new Error(`Local triage failed (${current.errorCode ?? current.state})`)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('Local triage did not finish within the probe budget')
}

// Intentionally incomplete Mock provenance must stay incomplete through every host.
export async function createExternalAsset(origin = viewerOrigin) {
  const accepted = await externalCall(origin, '/preview', { contractVersion: 1, requestKey: randomUUID(), adapter: 'junit', engine: 'synthetic-probe', engineVersion: '1', declaration: {}, bindings: [], attachments: [], report: Buffer.from('<testsuite><testcase name="private-test"><system-out>private-secret</system-out></testcase></testsuite>').toString('base64') })
  for (let i = 0; i < 200; i++) {
    const job = await externalCall(origin, `/jobs/${accepted.id}`)
    if (job.phase === 'preview') { const result = await externalCall(origin, `/jobs/${job.id}/confirm`, { reviewed: true, previewDigest: job.previewDigest }); if (result.phase !== 'finished') throw new Error('External probe commit failed'); return result.assetId }
    if (['failed', 'cancelled', 'interrupted'].includes(job.phase)) throw new Error(`External probe ${job.phase}`)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('External probe timeout')
}
export async function grantExternalAsset(id, granted, origin = viewerOrigin) {
  const project = await externalCall(origin, '/project')
  return externalCall(origin, `/${id}/grant`, { project, granted, confirm: `${granted ? 'GRANT' : 'REVOKE'} ${id}` })
}
async function externalCall(origin, path, body) {
  const response = await fetch(`${origin}/api/workbench/external-assets${path}`, { ...(body === undefined ? {} : { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) })
  if (!response.ok) throw new Error(`External probe HTTP ${response.status}`)
  return response.json()
}

/** Synthetic engineering registry. Never points at a physical device. */
export async function createProbeMatrixRegistry(directory, flow = 'fixture') {
  const { createServer } = await import('node:net'), { writeFile, realpath } = await import('node:fs/promises'), { join } = await import('node:path')
  const ports = []
  while (ports.length < 4) {
    const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); if (!ports.includes(port)) ports.push(port)
  }
  const slots = ['one', 'two'].map((id, i) => ({ id, configId: id, platform: 'ios', provider: 'mock', udid: `mock-device-${randomUUID()}`, config: { mockStartupDelayMs: 0 }, capabilities: {}, ports: { driver: ports[i * 2], mjpeg: ports[i * 2 + 1] } }))
  const path = join(await realpath(directory), 'matrix-registry.json')
  await writeFile(path, JSON.stringify({ contractVersion: 1, slots, plans: { smoke: { cells: slots.map(s => ({ id: s.id, slotId: s.id, flow, fixture: { parallelSafe: true, namespace: s.id, resourceKeys: [], reset: flow } })) } } }))
  return path
}
export async function createProbeMatrix(origin = viewerOrigin) {
  const call = async (path, body) => {
    const response = await fetch(`${origin}/api/workbench/matrices${path}`, { ...(body ? { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) })
    if (!response.ok) throw new Error(`Matrix probe HTTP ${response.status}: ${await response.text()}`)
    return response.json()
  }
  let state = await call('', { planId: 'smoke', confirm: 'START smoke', localEvidence: true })
  for (let i = 0; i < 300; i++) {
    state = await call(`/${state.id}`)
    if (state.phase === 'finished') { if (state.exitCode !== 0) throw new Error(`Matrix incomplete: ${JSON.stringify(state)}`); return state }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Matrix probe timeout')
}

export async function createAcceptanceRecord(runId, origin = viewerOrigin) {
  const call = async (path, body) => {
    const response = await fetch(`${origin}/api/workbench/acceptance-records${path}`, { ...(body === undefined ? {} : { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) })
    if (!response.ok) throw new Error(`Acceptance probe request failed (${response.status})`)
    return response.json()
  }
  const preview = await call('/preview', { contractVersion: 1, repository: 'public-probe', commit: 'a'.repeat(40), declarationsReviewed: true,
    cells: [{ id: 'fixture', title: 'Public fixture', platform: 'ios', appId: 'com.example.mobilemirror.mock', binarySha256: 'b'.repeat(64), build: '1', logicalTestKey: 'probe', inputDigest: 'c'.repeat(64),
      environment: { os: 'mock', provider: 'mock', driver: 'mock', viewport: '390x844', backendEnvironment: 'mock' }, required: ['ui', 'cleanup', 'evidence'], runId }] })
  const id = randomUUID(), job = await call('', { id, expectedRevision: 0, previewId: preview.previewId, previewDigest: preview.previewDigest, requestKey: randomUUID(), reviewed: true })
  for (let i = 0; i < 200; i++) {
    const current = await call(`/jobs/${job.jobId}`)
    if (current.phase === 'finished') return id
    if (['failed', 'cancelled', 'interrupted'].includes(current.phase)) throw new Error(`Acceptance probe ${current.phase}`)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('Acceptance probe timeout')
}
