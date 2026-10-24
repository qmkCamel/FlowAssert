export function createRepairPanel({ $, t, node, api, currentRun, rerender, onDraft }) {
  const proposals = new Map()
  let draft = null
  let draftGeneration = 0
  const tracked = new Map()
  const label = (zh, en) => document.documentElement.lang === 'zh-CN' ? zh : en
  const show = (run) => { if (currentRun()?.id === run.id) rerender() }
  async function loadTracked(run, state) {
    if (!state.caseId || state.loading) return
    state.loading = true
    try {
      state.detail = await api(`/api/workbench/repairs/${state.caseId}`)
      state.message = ''; state.loadFailed = false
    } catch (error) { state.message = error.message; state.loadFailed = true }
    finally {
      state.loading = false; show(run)
      const phase = state.detail?.case?.phase
      if (phase && !['finished', 'blocked'].includes(phase) && state.caseId) {
        clearTimeout(state.pollTimer)
        state.pollTimer = setTimeout(() => { void loadTracked(run, state) }, 400)
      }
    }
  }
  async function action(run, state, work) {
    if (state.action) return
    state.action = true; state.message = label('操作进行中；历史和证据仍可查看', 'Working; history and evidence remain available')
    show(run)
    try { await work(); state.message = ''; await loadTracked(run, state) }
    catch (error) { state.message = error.message }
    finally { state.action = false; show(run) }
  }
  function renderTracked(section, run) {
    const state = tracked.get(run.id) ?? { caseId: null, detail: null, message: '', action: false, loading: false, open: false }
    tracked.set(run.id, state)
    const panel = node('details', undefined, 'wb-repair-case')
    panel.open = state.open || Boolean(state.caseId)
    panel.addEventListener('toggle', () => { state.open = panel.open })
    panel.append(node('summary', label('受控修复任务', 'Tracked repair case')))
    const status = node('p', state.message || (state.loading ? label('正在读取任务…', 'Loading case…') : ''), 'wb-note')
    status.setAttribute('role', 'status'); panel.append(status)
    const button = (text, handler, disabled = false) => {
      const control = node('button', text, 'check-button'); control.type = 'button'; control.disabled = disabled || state.action
      control.onclick = () => { void action(run, state, handler) }; panel.append(control); return control
    }
    if (!state.caseId) {
      const proposal = proposals.get(run.id)?.result
      if (proposal?.status === 'candidate' && run.flowId) button(label('创建受控修复任务', 'Create tracked repair'), async () => {
        const created = await api('/api/workbench/repairs', { requestId: crypto.randomUUID(), sourceRunId: run.id,
          baselineRunId: proposal.baselineRunId, flowId: run.flowId })
        state.caseId = created.caseId
      })
      else panel.append(node('p', label('定位器维护需先检查安全候选；产品源码修复需登记可信仓库。',
        'Locator maintenance needs a safe candidate; source repair needs a trusted repository registration.'), 'wb-note'))
      if (run.verdict === 'fail' && run.flowId) button(label('创建源码修复任务', 'Create source repair case'), async () => {
        const repositoryId = window.prompt(label('输入已登记的仓库 ID', 'Enter registered repository ID'))?.trim()
        if (!repositoryId) return
        if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(repositoryId)) throw new Error(label('仓库 ID 格式不合法', 'Invalid repository ID'))
        const created = await api('/api/workbench/repairs', { requestId: crypto.randomUUID(),
          sourceRunId: run.id, flowId: run.flowId, route: 'product-code', repositoryId })
        state.caseId = created.caseId
      })
      button(label('查找已有任务', 'Find existing cases'), async () => {
        const page = await api('/api/workbench/repairs?limit=100')
        const match = page.items?.find(item => item.sourceSnapshot?.runId === run.id)
        if (!match) throw new Error(label('此运行没有受控任务', 'No tracked case for this run'))
        state.caseId = match.id
      })
      if (!state.discovered) {
        state.discovered = true
        void api('/api/workbench/repairs?limit=100').then(page => {
          const match = page.items?.find(item => item.sourceSnapshot?.runId === run.id)
          if (match && !state.caseId) { state.caseId = match.id; void loadTracked(run, state) }
        }).catch(() => {})
      }
    } else {
      const detail = state.detail
      if (!detail && !state.loading && !state.loadFailed) void loadTracked(run, state)
      if (detail) {
        const record = detail.case
        panel.append(node('p', `${record.id} · ${record.phase} · ${record.outcome ?? 'pending'} · ${record.updatedAt}`, 'wb-note'))
        panel.append(node('p', `${label('原失败', 'Original failure')}: ${record.sourceSnapshot.runId} · ${run.verdict}`, 'wb-note'))
        panel.append(node('pre', `${label('路径', 'Route')}: ${record.route}\n${label('候选差异', 'Candidate diff')}: ${detail.candidate?.semanticDiff ?? detail.patchSubmission?.patchDigest ?? '—'}\n${label('计划摘要', 'Plan digest')}: ${detail.plan.digest}\n${label('目标', 'Target')}: ${detail.plan.target}\n${label('必要检查', 'Required checks')}: ${detail.plan.requiredChecks.map(check => check.id).join(', ')}`))
        if (detail.hostRequest) panel.append(node('pre', `${label('宿主交接', 'Host handoff')}: ${detail.hostRequest.id}\n${label('独立生成工作区', 'Isolated generation workspace')}: ${detail.hostRequest.generationWorkspace}\n${label('允许路径', 'Permitted paths')}: ${detail.hostRequest.permittedPaths.join(', ')}\n${label('到期', 'Expires')}: ${detail.hostRequest.expiresAt}`))
        if (detail.patchSubmission) {
          const patch = node('details', undefined, 'wb-repair-patch')
          patch.append(node('summary', `${label('审查完整源码补丁', 'Review full source patch')} · ${detail.patchSubmission.patchDigest}`))
          patch.append(node('pre', detail.patchSubmission.patch))
          panel.append(patch)
        }
        if (detail.buildArtifact) panel.append(node('pre', `${label('构建制品', 'Build artifact')}: ${detail.buildArtifact.kind}\n${label('应用', 'App')}: ${detail.buildArtifact.appId}\n${label('构建标记', 'Build marker')}: ${detail.buildArtifact.buildMarker}\n${label('制品摘要', 'Artifact digest')}: ${detail.buildArtifact.artifactDigest}\n${label('源树', 'Source tree')}: ${detail.buildArtifact.sourceTreeDigest}\n${label('工具链', 'Toolchain')}: ${detail.buildArtifact.toolchainDigest}\n${label('输出路径', 'Output path')}: ${detail.buildArtifact.artifactPath}`))
        if (detail.installIntent) panel.append(node('p', `${label('安装意图', 'Install intent')}: ${detail.installIntent.status} · ${detail.installIntent.requestedAt} · ${detail.installIntent.identityState ?? 'pending'}`, 'wb-note'))
        if (state.inspection) panel.append(node('p', `${label('只读身份核查', 'Read-only identity inspection')}: ${state.inspection.state} · ${state.inspection.identity?.buildMarker ?? state.inspection.identity?.version ?? 'unknown'} · ${state.inspection.limitation}`, 'wb-note'))
        const events = [
          [record.createdAt, label('任务创建', 'Case created')],
          ...detail.approvals.map(value => [value.issuedAt, `${label('审批', 'Approval')} ${value.level}`]),
          ...detail.attempts.flatMap(value => [[value.createdAt, `${label('尝试', 'Attempt')} ${value.generation}`], ...(value.finishedAt ? [[value.finishedAt, `${label('尝试结束', 'Attempt finished')} ${value.outcome}`]] : [])]),
          ...detail.resets.map(value => [value.requestedAt, `${label('重置', 'Reset')} ${value.checkId} ${value.status}`]),
          ...detail.verifications.map(value => [value.checkedAt, `${label('核验', 'Verification')} ${value.outcome}`]),
          ...(detail.buildArtifact ? [[detail.buildArtifact.builtAt, label('构建制品已登记', 'Build artifact recorded')]] : []),
          ...(detail.installIntent ? [[detail.installIntent.requestedAt, `${label('安装', 'Install')} ${detail.installIntent.status}`]] : []),
        ].sort((a, b) => String(a[0]).localeCompare(String(b[0])))
        panel.append(node('pre', events.map(([at, event]) => `${at} · ${event}`).join('\n')))
        const last = detail.verifications.at(-1)
        if (last?.gaps?.length) panel.append(node('p', `${label('证据缺口', 'Evidence gaps')}: ${last.gaps.join(', ')}`, 'wb-error'))
        if (record.reason) panel.append(node('p', `${label('停止原因', 'Stop reason')}: ${record.reason}`, 'wb-error'))
        if (record.phase === 'awaiting-approval') {
          const scopeApproved = detail.approvals.some(value => value.level === 'scope' && Date.parse(value.expiresAt) > Date.now())
          const level = record.resumePhase === 'installing' ? 'installation' : scopeApproved ? 'execution' : 'scope'
          if (level === 'installation' || level === 'scope' || record.route === 'locator-maintenance' || detail.patchSubmission) button(level === 'scope' ? label('审查并批准证据范围', 'Review and approve evidence scope')
            : level === 'installation' ? label('审查并批准确切制品安装', 'Review and approve exact artifact installation')
              : label('审查并批准精确候选', 'Review and approve exact candidate'), async () => {
            const digest = level === 'scope' ? detail.plan.digest : level === 'installation'
              ? detail.buildArtifact?.artifactDigest : detail.candidate?.digest ?? detail.patchSubmission?.patchDigest
            if (!digest || !window.confirm(`${label('请确认', 'Confirm')} ${level}\n${digest}\n${level === 'installation' ? `${detail.buildArtifact.appId} · ${detail.buildArtifact.platform} · ${detail.plan.targetDeviceBinding}` : detail.candidate?.semanticDiff ?? ''}`)) return
            const challenge = await api(`/api/workbench/repairs/${record.id}/challenge`, { expectedRevision: record.revision, level })
            if (challenge.planDigest !== detail.plan.digest || (level === 'execution' && challenge.patchDigest !== digest)
              || (level === 'installation' && challenge.artifactDigest !== digest))
              throw new Error(label('审批摘要已变化', 'Approval digest changed'))
            await api(`/api/workbench/repairs/${record.id}/approve`, { expectedRevision: record.revision, nonce: challenge.nonce })
          })
          else panel.append(node('p', label('范围已批准，等待宿主提交源码补丁。', 'Scope approved; awaiting a host source patch.'), 'wb-note'))
        }
        if (record.phase === 'queued') button(record.route === 'product-code'
          ? label('开始独立源码软件复验', 'Start independent source checks')
          : label('开始 Mock 软件复验', 'Start Mock software verification'), async () => {
          await api(`/api/workbench/repairs/${record.id}/verify`, { expectedRevision: record.revision })
        })
        if (record.phase === 'installing' && !detail.installIntent) button(label('开始安装确切制品', 'Install the exact artifact'), async () => {
          await api(`/api/workbench/repairs/${record.id}/install`, { expectedRevision: record.revision })
        })
        if (record.phase === 'blocked' && detail.installIntent?.status === 'unknown') button(label('只读核查已安装身份', 'Read installed identity only'), async () => {
          const result = await api(`/api/workbench/repairs/${record.id}/inspect-install`, { expectedRevision: record.revision })
          state.inspection = result
        })
        if (['planning', 'awaiting-approval', 'queued', 'preparing', 'checking', 'building', 'installing', 'revalidating', 'regressing', 'finalizing'].includes(record.phase))
          button(label('取消修复任务', 'Cancel repair case'), async () => {
            await api(`/api/workbench/repairs/${record.id}/cancel`, { expectedRevision: record.revision })
          })
        if (record.phase === 'finished') button(label('退休任务引用', 'Retire case references'), async () => {
          if (!window.confirm(label('仅撤销引用保护；原运行与证据不删除。继续？', 'Revoke reference protection only; original runs remain. Continue?'))) return
          await api(`/api/workbench/repairs/${record.id}/retire`, { expectedRevision: record.revision })
          state.caseId = null; state.detail = null
        })
        button(label('刷新详情', 'Refresh details'), async () => { await loadTracked(run, state) })
      }
    }
    section.append(panel)
  }
  return {
    get draft() { return draft },
    clearDraft() { draft = null; draftGeneration++ },
    render(root, run) {
      const state = proposals.get(run.id) ?? { busy: false, result: null, message: '' }
      proposals.set(run.id, state)
      const section = node('details', undefined, 'wb-repair'); section.append(node('summary', t('repairTitle')))
      section.open = state.open ?? Boolean(state.busy || state.result || state.message)
      section.addEventListener('toggle', () => { state.open = section.open })
      section.append(node('p', t('repairHint'), 'wb-note'))
      const suggest = node('button', t('repairSuggest'), 'check-button'); suggest.type = 'button'; suggest.disabled = state.busy
      const status = node('p', state.busy ? t('repairChecking') : state.message, 'wb-note'); status.setAttribute('role', 'status')
      section.append(suggest, status)
      if (state.result?.status === 'candidate') {
        const proposal = state.result
        section.append(node('pre', `${proposal.semanticDiff}\n${t('repairEvidence')}: ${proposal.failureEvidence.name} (${proposal.failureEvidence.sha256.slice(0, 12)}), ${proposal.baselineEvidence.name} (${proposal.baselineEvidence.sha256.slice(0, 12)})\n${t('repairPlan')}: ${proposal.sourcePlanDigest.slice(0, 12)}`))
        const apply = node('button', t('repairApply'), 'check-button'); apply.type = 'button'; apply.disabled = state.busy
        apply.onclick = async () => {
          const generation = draftGeneration
          state.busy = true; status.textContent = t('repairChecking'); apply.disabled = true
          try {
            const confirmed = await api('/api/workbench/repair/confirm', { sourceRunId: run.id, baselineRunId: proposal.baselineRunId, digest: proposal.digest })
            if (generation !== draftGeneration || currentRun()?.id !== run.id) return
            draft = { digest: confirmed.digest, baselineRunId: confirmed.baselineRunId }
            onDraft(run, confirmed)
            state.message = t('repairDraftReady')
          } catch (error) { state.message = error.message }
          finally { state.busy = false; if (currentRun()?.id === run.id) rerender() }
        }
        section.append(apply)
      } else if (state.result) section.append(node('p', state.result.reason, 'wb-scope'))
      suggest.onclick = async () => {
        state.busy = true; state.message = t('repairChecking'); suggest.disabled = true; status.textContent = state.message
        try { state.result = await api('/api/workbench/repair/suggest', { sourceRunId: run.id }); state.message = state.result.status === 'candidate' ? t('repairCandidate') : t('repairNone') }
        catch (error) { state.result = null; state.message = error.message }
        finally { state.busy = false; if (currentRun()?.id === run.id) rerender() }
      }
      root.append(section)
      renderTracked(root, run)
    },
  }
}
