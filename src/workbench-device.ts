import { SaxesParser } from 'saxes'
import { createHash, randomUUID } from 'node:crypto'
import { RecoveryRejected, type RecoveryCandidate, type RecoveryObservation, type RecoveryPolicy } from './workbench-recovery.js'
import { parseIOSPageSource } from './workbench-engine-adapter.js'
import { parseAndroidPageSource } from './workbench-engine-adapter.js'
import { parseElementSelector, resolveElementSelector } from './workbench-engine-adapter.js'
import { normalizeScreenSource } from './screen-source-normalizer.js'
import { isSensitivePlatformRole, requirePositiveVisibleBounds, validatePublicText } from './semantic-actions.js'
import type { MirrorAction, MirrorProvider, ScreenGeometry, ScreenStructure, ScreenNode, ProviderScreenSource } from './types.js'
import { waitForReadiness, ReadinessFailure, readinessFingerprint, resolveSemanticTarget, type ReadyStep } from './workbench-readiness.js'
import { timed, type TimingObserver } from './workbench-timing.js'
import { recoveryVisual } from './recovery-visual.js'
import type { DispatchRecord, RecordedVisualAction } from './workbench-domain.js'
import { requireHealthCapability, type HealthBinding, type HealthSignal } from './workbench-health.js'
import { factDigest, stepDigest, LocalTapFailure, type TapResolution } from './workbench-tap-facts.js'
import { trustedPageContainer, withinTrustedPage, type TrustedPageScope } from './workbench-page-scope.js'
export type { DispatchRecord } from './workbench-domain.js'

export interface CheckpointPart { kind: 'png' | 'xml'; bytes: Uint8Array | string; startedAt: string; endedAt: string }
export class TargetFailure extends Error {
  constructor(readonly code: 'target-not-found' | 'ambiguous-target', readonly dispatch: 'not-dispatched' = 'not-dispatched') { super(code) }
}

/** This port is only constructed by MirrorService while holding its run lease. */
export class WorkbenchDevice {
  timing?: TimingObserver
  path = ''
  readonly dispatches: DispatchRecord[] = []
  onDispatch?: () => Promise<void>
  onVisualAction?: (record: RecordedVisualAction, bytes?: Uint8Array) => Promise<(state: RecordedVisualAction['dispatch']) => Promise<void>>
  visualCaptureBudget = 0
  #lastSourceAt = 0
  constructor(
    readonly sessionId: string,
    readonly platform: 'android' | 'ios',
    private readonly provider: MirrorProvider,
    private readonly exclusive: <T>(operation: (signal: AbortSignal) => Promise<T>) => Promise<T>,
    private readonly mutated: (uncertain?: boolean) => void,
    readonly release: () => Promise<void>,
    private readonly runSignal?: AbortSignal,
    readonly sessionGeneration = 0,
    private readonly authorizeRestart?: (appId: string) => void,
  ) {}

  assertRestartSupported(appId: string): void {
    const context = this.provider.appControlContext?.()
    if (!context?.owned || context.targetAppId !== appId || !this.provider.manageApp || !this.provider.queryAppState) throw new Error('restart-app-unavailable')
    if (!this.authorizeRestart) throw new Error('restart-app-authorization-unavailable')
    this.authorizeRestart(appId)
  }
  assertHealthSupported(signals: HealthSignal[]) {
    const capability = requireHealthCapability(this.provider.healthCapability?.(), signals)
    if (!this.provider.startHealth) throw new Error('health-collector-unavailable')
    return capability
  }
  async startHealth(binding: HealthBinding, signals: HealthSignal[], signal: AbortSignal) {
    this.assertHealthSupported(signals)
    return this.exclusive(leaseSignal => this.provider.startHealth!(binding, signals, AbortSignal.any([signal, leaseSignal])))
  }

  async restartApp(appId: string, timeoutMs: number, signal: AbortSignal) {
    this.assertRestartSupported(appId)
    const operationId = randomUUID()
    return this.exclusive(async leaseSignal => {
      const combined = AbortSignal.any([signal, leaseSignal, AbortSignal.timeout(timeoutMs)])
      combined.throwIfAborted()
      const before = await this.provider.queryAppState!(appId, combined)
      await this.#write('restart-terminate:' + operationId, async () => {
        const result = await this.provider.manageApp!({ operation: 'terminate', appId }, combined)
        if (result.afterState !== 'not-running') throw new Error('restart-terminate-unconfirmed')
      }, () => combined.throwIfAborted())
      combined.throwIfAborted()
      await this.#write('restart-activate:' + operationId, async () => {
        const result = await this.provider.manageApp!({ operation: 'activate', appId }, combined)
        if (result.afterState !== 'foreground') throw new Error('restart-activate-unconfirmed')
      }, () => combined.throwIfAborted())
      const after = await this.provider.queryAppState!(appId, combined)
      combined.throwIfAborted()
      if (after !== 'foreground') throw new Error('restart-state-unconfirmed')
      return { operationId, status: 'pass' as const, before, after }
    })
  }

  async #write(operation: string, execute: () => Promise<void>, ready?: () => void | Promise<void>, visual?: { action: MirrorAction; geometry: ScreenGeometry; signal: AbortSignal }): Promise<void> {
    if (this.dispatches.some(record => record.state === 'unknown')) throw new Error('Device outcome is uncertain; reconnect before further actions')
    const entry: DispatchRecord = { operation, path: this.path, sessionId: this.sessionId, sessionGeneration: this.sessionGeneration, startedAt: new Date().toISOString(), state: 'dispatched' }
    this.dispatches.push(entry)
    // Persist intent before provider invocation. Failure here cannot dispatch.
    await this.onDispatch?.()
    let finishVisual: ((state: RecordedVisualAction['dispatch']) => Promise<void>) | undefined
    try {
      this.runSignal?.throwIfAborted(); await ready?.(); this.runSignal?.throwIfAborted()
      if (visual && this.onVisualAction && this.visualCaptureBudget > 0 && (visual.action.kind === 'tap' || visual.action.kind === 'swipe')) {
        this.visualCaptureBudget--
        const action = visual.action
        const record: RecordedVisualAction = { kind: action.kind, capturedAt: new Date().toISOString(), viewport: { ...visual.geometry.viewport },
          points: action.kind === 'tap' ? [{ x: action.x, y: action.y }] : [{ x: action.startX, y: action.startY }, { x: action.endX, y: action.endY }], dispatch: 'not-dispatched' }
        let bytes: Uint8Array | undefined
        try {
          const captureSignal = AbortSignal.any([visual.signal, AbortSignal.timeout(1500)])
          const shot = await this.provider.snapshot(captureSignal)
          if (shot.bytes.byteLength > 4 * 1024 * 1024) throw new Error('Action image exceeds 4 MiB')
          if (JSON.stringify(await this.provider.screenGeometry(captureSignal)) !== JSON.stringify(visual.geometry)) throw new Error('Geometry changed during capture')
          record.image = { width: shot.width, height: shot.height }; bytes = shot.bytes
        } catch { record.reason = 'before-image-unavailable' }
        visual.signal.throwIfAborted(); this.runSignal?.throwIfAborted()
        finishVisual = await this.onVisualAction(record, bytes)
        await ready?.(); visual.signal.throwIfAborted(); this.runSignal?.throwIfAborted()
      }
      // Persist unknown before dispatch so a crash cannot masquerade as "not dispatched".
      await finishVisual?.('unknown'); this.runSignal?.throwIfAborted(); visual?.signal.throwIfAborted()
    }
    catch (error) { entry.state='not-dispatched';entry.endedAt=new Date().toISOString();await finishVisual?.('not-dispatched');await this.onDispatch?.();throw error }
    try { await execute(); entry.state = 'settled' }
    finally { if (entry.state !== 'settled') entry.state = 'unknown'; entry.endedAt = new Date().toISOString(); this.mutated(entry.state === 'unknown'); this.#lastSourceAt = 0; await this.onDispatch?.(); await finishVisual?.(entry.state) }
  }

  async #elements(signal: AbortSignal) {
    const source = await this.provider.screenSource(signal)
    const xml = source.kind === 'xml' ? source.xml : mockXml(source.structure)
    const tree = normalizeScreenSource(xml, this.platform)
    if ((source.kind === 'normalized' && source.structure.truncated) || tree.truncated || !tree.nodes.length)
      throw new RecoveryRejected('Page observation is incomplete')
    return { xml, elements: this.platform === 'ios' ? parseIOSPageSource(xml, { includeHidden: true }) : parseAndroidPageSource(xml) }
  }

  async #foreground(appId: string, signal: AbortSignal) {
    if (!this.provider.queryAppState || await this.provider.queryAppState(appId, signal) !== 'foreground') throw new RecoveryRejected('Expected app is not foreground')
  }

  /** Deterministic first attempt: typed not-found is emitted before any mutation. */
  async navigationTap(selector: unknown, appId: string, policy: RecoveryPolicy, externalSignal?: AbortSignal): Promise<void> {
    await this.exclusive(async leaseSignal => {
      const signal = externalSignal ? AbortSignal.any([externalSignal, leaseSignal]) : leaseSignal
      signal.throwIfAborted()
      await this.#foreground(appId, signal)
      const { xml, elements } = await this.#elements(signal)
      const confirmPage = (current: typeof elements) => {
        if (resolveElementSelector(current.filter(e => e.visible === true), parseElementSelector(policy.page, 'recovery page')).matches.length !== 1)
          throw new RecoveryRejected('Page scope is not uniquely confirmed')
      }
      confirmPage(elements)
      const matches = resolveElementSelector(elements.filter(e => e.visible !== false), parseElementSelector(selector, 'navigation tap')).matches
      if (!matches.length) throw new TargetFailure('target-not-found')
      if (matches.length !== 1) throw new TargetFailure('ambiguous-target')
      const target = matches[0]!
      const allowed = policy.allowedTargets.some(raw => resolveElementSelector(elements, parseElementSelector(raw, 'navigation candidate')).matches.some(candidate => candidate === target))
      if (!allowed || target.editable || target.password || !target.enabled) throw new RecoveryRejected('Original target is outside allowed navigation candidates')
      const geometry = await this.provider.screenGeometry(signal)
      requirePositiveVisibleBounds({ x: target.center[0] - target.size[0] / 2, y: target.center[1] - target.size[1] / 2, width: target.size[0], height: target.size[1] }, geometry.viewport)
      await this.#write('navigation-tap', () => this.provider.action({ kind: 'tap', x: target.center[0], y: target.center[1] }, signal), async () => {
        await this.#foreground(appId, signal)
        const fresh = await this.#elements(signal); confirmPage(fresh.elements)
        if (fresh.xml !== xml || JSON.stringify(await this.provider.screenGeometry(signal)) !== JSON.stringify(geometry))
          throw new RecoveryRejected('Page changed before navigation dispatch')
      }, { action: { kind: 'tap', x: target.center[0], y: target.center[1] }, geometry, signal })
    })
  }

  /** Opt-in ordinary tap. The owning host persists the exact resolution before any mutation. */
  async recordedNavigationTap(selector: unknown, appId: string, blockers: unknown[], signal: AbortSignal,
    persist: (xml: string, resolution: TapResolution) => Promise<void>,
    scope?: { page: TrustedPageScope; allowedTarget: { role: string; text: string } }): Promise<void> {
    await this.exclusive(async leaseSignal => {
      const combined = AbortSignal.any([signal, leaseSignal]); combined.throwIfAborted()
      await this.#foreground(appId, combined)
      const source = await this.provider.screenSource(combined)
      const xml = source.kind === 'xml' ? source.xml : mockXml(source.structure)
      const structure = normalizeScreenSource(xml, this.platform)
      // An empty or truncated snapshot cannot prove that a locator is missing.
      if ((source.kind === 'normalized' && source.structure.truncated) || structure.truncated || !structure.nodes.length) throw new LocalTapFailure('tap-not-ready')
      const elements = this.platform === 'ios' ? parseIOSPageSource(xml, { includeHidden: true }) : parseAndroidPageSource(xml)
      if (blockers.some(raw => resolveElementSelector(elements.filter(e => e.visible !== false), parseElementSelector(raw, 'blocker')).matches.length)) throw new LocalTapFailure('tap-not-ready')
      const matches = resolveElementSelector(elements, parseElementSelector(selector, 'recorded navigation tap')).matches
      const fields = selector && typeof selector === 'object' ? Object.entries(selector) : []
      if (fields.length !== 1 || !['id', 'accessibilityId'].includes(fields[0]![0]) || typeof fields[0]![1] !== 'string') throw new LocalTapFailure('tap-not-ready')
      const [key, value] = fields[0] as [string, string]
      const identityNodes = structure.nodes.filter(node => {
        const identity = key === 'id' ? node.identifier : this.platform === 'ios' ? node.identifier || node.name : node.name || node.identifier?.split('/').at(-1)
        return identity?.toLowerCase() === value.toLowerCase()
      })
      // Native parsers omit zero-sized/unusable nodes. Omission is not a missing locator.
      if (identityNodes.length !== matches.length) throw new LocalTapFailure('tap-not-ready')
      if (matches.length > 500) throw new LocalTapFailure('tap-not-ready')
      const resolution: TapResolution = { version: 1, selectorSha256: stepDigest(selector), observationSha256: factDigest(xml),
        observedAt: new Date().toISOString(), matches: matches.length,
        code: !matches.length ? 'target-not-found' : matches.length > 1 ? 'ambiguous-target' : 'resolved' }
      await persist(xml, resolution)
      combined.throwIfAborted()
      if (scope && !trustedPageContainer(structure, scope.page)) throw new LocalTapFailure('tap-not-ready')
      if (resolution.code !== 'resolved') throw new LocalTapFailure(resolution.code)
      const target = matches[0]!
      if (scope) {
        const node = identityNodes[0]
        if (!node || node.role !== scope.allowedTarget.role || node.text !== scope.allowedTarget.text || !withinTrustedPage(structure, scope.page, node))
          throw new LocalTapFailure('tap-not-ready')
      }
      if (identityNodes[0]?.visible !== true || identityNodes[0]?.enabled !== true || identityNodes[0]?.sensitive
        || target.visible !== true || target.enabled !== true || target.editable || target.password || isSensitivePlatformRole(target.type)
        || [...structure.nodes, ...(source.kind === 'normalized' ? source.structure.nodes : [])].some(node => node.sensitive && node.bounds && target.center[0] >= node.bounds.x && target.center[0] <= node.bounds.x + node.bounds.width
          && target.center[1] >= node.bounds.y && target.center[1] <= node.bounds.y + node.bounds.height)) throw new LocalTapFailure('tap-not-ready')
      const geometry = await this.provider.screenGeometry(combined)
      const bounds = { x: target.center[0] - target.size[0] / 2, y: target.center[1] - target.size[1] / 2, width: target.size[0], height: target.size[1] }
      if (JSON.stringify(requirePositiveVisibleBounds(bounds, geometry.viewport)) !== JSON.stringify(bounds)) throw new LocalTapFailure('tap-not-ready')
      await this.#write('recorded-navigation-tap', () => this.provider.action({ kind: 'tap', x: target.center[0], y: target.center[1] }, combined), async () => {
        combined.throwIfAborted()
        await this.#foreground(appId, combined)
        const fresh = await this.provider.screenSource(combined)
        const freshTree = normalizeScreenSource(fresh.kind === 'xml' ? fresh.xml : mockXml(fresh.structure), this.platform)
        if (scope && !trustedPageContainer(freshTree, scope.page)) throw new LocalTapFailure('tap-not-ready')
        if ((fresh.kind === 'normalized' && (fresh.structure.truncated || (source.kind === 'normalized' && JSON.stringify(fresh.structure) !== JSON.stringify(source.structure))))
          || (fresh.kind === 'xml' ? fresh.xml : mockXml(fresh.structure)) !== xml
          || JSON.stringify(await this.provider.screenGeometry(combined)) !== JSON.stringify(geometry)
          || Date.now() - Date.parse(resolution.observedAt) > 15_000) throw new LocalTapFailure('tap-not-ready')
        combined.throwIfAborted()
      }, { action: { kind: 'tap', x: target.center[0], y: target.center[1] }, geometry, signal: combined })
    })
  }

  async recoveryObserve(policy: RecoveryPolicy, signal: AbortSignal): Promise<RecoveryObservation> {
    return this.exclusive(async leaseSignal => {
      const combined = AbortSignal.any([signal, leaseSignal]); combined.throwIfAborted()
      const capturedAt = Date.now()
      await this.#foreground(policy.appId, combined)
      const geometry = await this.provider.screenGeometry(combined)
      const { xml, elements } = await this.#elements(combined)
      const visible = elements.filter(e => e.visible !== false)
      if (resolveElementSelector(visible, parseElementSelector(policy.page, 'recovery page')).matches.length !== 1) throw new RecoveryRejected('Page sharing scope is not uniquely confirmed')
      if (elements.some(e => e.password)) throw new RecoveryRejected('Sensitive page cannot be shared')
      const candidates: RecoveryCandidate[] = []
      for (const selector of policy.allowedTargets) {
        const matches = resolveElementSelector(visible, parseElementSelector(selector, 'allowed navigation')).matches
        if (matches.length > 1) throw new RecoveryRejected('Allowed navigation is ambiguous')
        for (const target of matches) {
          if (target.editable || target.password || target.enabled === false) continue
          requirePositiveVisibleBounds({x:target.center[0]-target.size[0]/2,y:target.center[1]-target.size[1]/2,width:target.size[0],height:target.size[1]},geometry.viewport)
          if (candidates.some(c => JSON.stringify(c.center) === JSON.stringify(target.center))) continue
          candidates.push({ nodeId: `candidate-${candidates.length + 1}`, identifier: target.id, text: target.text, type: target.type, center: [...target.center], size: [...target.size] })
        }
      }
      if (!candidates.length || candidates.length > 100) throw new RecoveryRejected('No bounded navigation candidates')
      const image = await this.provider.snapshot(combined)
      if (image.bytes.byteLength > 2 * 1024 * 1024) throw new RecoveryRejected('Recovery image exceeds 2 MiB')
      combined.throwIfAborted()
      const after = await this.#elements(combined)
      if (xml !== after.xml) throw new RecoveryRejected('Page changed during image capture')
      const visual = await recoveryVisual(image.bytes, xml, this.platform, policy.appId, geometry)
      for (const target of candidates) {
        const bounds = { x: target.center[0]! - target.size[0]! / 2, y: target.center[1]! - target.size[1]! / 2, width: target.size[0]!, height: target.size[1]! }
        const visible = requirePositiveVisibleBounds(bounds, visual.region)
        if (JSON.stringify(visible) !== JSON.stringify(bounds)) throw new RecoveryRejected('Candidate extends outside the visual verification region')
      }
      return { id: randomUUID(), sessionId: this.sessionId, sessionGeneration: this.sessionGeneration, appId: policy.appId, capturedAt, endedAt: Date.now(), source: xml, geometry, fingerprint: createHash('sha256').update(xml).digest('hex'), image: Buffer.from(image.bytes).toString('base64'), candidates, visual }
    })
  }

  async recoveryTap(observation: RecoveryObservation, nodeId: string, policy: RecoveryPolicy, signal: AbortSignal): Promise<boolean> {
    return this.exclusive(async leaseSignal => {
      signal.throwIfAborted()
      if (observation.sessionId !== this.sessionId || observation.sessionGeneration !== this.sessionGeneration || observation.appId !== policy.appId || Date.now() - observation.capturedAt > 15_000) throw new RecoveryRejected('Recovery observation expired')
      await this.#foreground(policy.appId, leaseSignal)
      const { xml } = await this.#elements(leaseSignal)
      if (createHash('sha256').update(xml).digest('hex') !== observation.fingerprint) return false
      const image = await this.provider.snapshot(leaseSignal)
      const visual = await recoveryVisual(image.bytes, xml, this.platform, policy.appId, observation.geometry)
      if (JSON.stringify(visual) !== JSON.stringify(observation.visual)) return false
      if ((await this.#elements(leaseSignal)).xml !== xml) return false
      const target = observation.candidates.find(c => c.nodeId === nodeId)
      if (!target) throw new RecoveryRejected('Unknown recovery node')
      const geometry = await this.provider.screenGeometry(leaseSignal)
      if (JSON.stringify(geometry) !== JSON.stringify(observation.geometry)) return false
      requirePositiveVisibleBounds({ x: target.center[0]! - target.size[0]! / 2, y: target.center[1]! - target.size[1]! / 2, width: target.size[0]!, height: target.size[1]! }, geometry.viewport)
      signal.throwIfAborted()
      if (Date.now() - observation.capturedAt > 15_000) throw new RecoveryRejected('Recovery observation expired')
      // Recheck after the durable journal write, immediately before provider dispatch.
      await this.#write('recovery-tap', () => this.provider.action({ kind: 'tap', x: target.center[0]!, y: target.center[1]! }, leaseSignal), async () => {
        signal.throwIfAborted(); await this.#foreground(policy.appId, leaseSignal)
        const fresh = await this.#elements(leaseSignal)
        if (fresh.xml !== xml || resolveElementSelector(fresh.elements.filter(e => e.visible === true), parseElementSelector(policy.page, 'recovery page')).matches.length !== 1)
          throw new RecoveryRejected('Page changed before recovery dispatch')
        if (JSON.stringify(await this.provider.screenGeometry(leaseSignal)) !== JSON.stringify(geometry)
          || Date.now() - observation.capturedAt > 15_000) throw new RecoveryRejected('Recovery observation expired or geometry changed')
        signal.throwIfAborted()
      }, { action: { kind: 'tap', x: target.center[0]!, y: target.center[1]! }, geometry, signal: AbortSignal.any([signal, leaseSignal]) })
      return true
    })
  }

  async geometry(): Promise<ScreenGeometry> {
    return this.exclusive((signal) => timed(this.timing, 'geometry', () => this.provider.screenGeometry(signal)))
  }

  /** Opt-in semantic operations share the lease and journal; only reads are retried. */
  async executeReady(step: ReadyStep, signal: AbortSignal): Promise<void> {
    await this.exclusive(async leaseSignal => {
      const combined = AbortSignal.any([signal, leaseSignal, AbortSignal.timeout(step.timeoutMs)])
      let lastSource: ProviderScreenSource | undefined
      const observe = async (readSignal: AbortSignal): Promise<ScreenStructure> => {
        lastSource = await timed(this.timing, 'locate', () => this.provider.screenSource(readSignal, { resolveFocus: step.operation === 'fillReady' }))
        return lastSource.kind === 'normalized' ? lastSource.structure : lastSource.structure ?? normalizeScreenSource(lastSource.xml, lastSource.platform)
      }
      // waitForReadiness classifies its own read deadline; outer budget also bounds focus and dispatch.
      const target = await waitForReadiness(step, observe, AbortSignal.any([signal, leaseSignal]))
      if (step.operation !== 'tapReady' && step.operation !== 'fillReady') return
      if (!target) throw new ReadinessFailure('target-not-found')
      if (step.operation === 'fillReady' && target.role !== 'input') throw new ReadinessFailure('readiness-not-input')
      let selected = target
      const recheck = async (focused = false): Promise<ScreenNode> => {
        const [fresh] = resolveSemanticTarget(await observe(combined), step.target)
        if (!fresh || fresh.visible !== true || fresh.enabled !== true || readinessFingerprint(fresh) !== readinessFingerprint(selected)) throw new ReadinessFailure('readiness-target-changed')
        if (focused && fresh.focused !== true) throw new ReadinessFailure('readiness-timeout-unfocused')
        combined.throwIfAborted(); return fresh
      }
      const tap = async () => {
        const geometry = await timed(this.timing, 'geometry', () => this.provider.screenGeometry(combined))
        const bounds = requirePositiveVisibleBounds(selected.bounds, geometry.viewport)
        await this.#write(step.operation === 'fillReady' ? 'ready-focus' : 'ready-tap',
          () => timed(this.timing, 'action', () => this.provider.action({ kind: 'tap', x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, combined)), async () => { selected = await recheck() },
          { action: { kind: 'tap', x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, geometry, signal: combined })
      }
      if (step.operation === 'tapReady') { await tap(); return }
      if (!this.provider.inputText) throw new Error('Provider text input unavailable')
      if (selected.focused !== true) {
        await tap()
        try { selected = (await waitForReadiness(step, observe, combined, true))! }
        catch (error) {
          signal.throwIfAborted(); leaseSignal.throwIfAborted()
          if (combined.aborted) throw new ReadinessFailure('readiness-timeout-unfocused')
          throw error
        }
      }
      const geometry = await timed(this.timing, 'geometry', () => this.provider.screenGeometry(combined))
      const expectedBounds = requirePositiveVisibleBounds(selected.bounds, geometry.viewport)
      let text = step.text
      await this.#write('ready-input', () => timed(this.timing, 'action', () => this.provider.inputText!({ mode: 'replace', text, expectedBounds }, combined)), async () => {
        selected = await recheck(true)
        let current = selected.value ?? ''
        if (this.platform === 'android' && lastSource?.kind === 'xml') {
          const b = selected.bounds!
          current = androidInputValue(lastSource.xml, `[${b.x},${b.y}][${b.x + b.width},${b.y + b.height}]`, selected.identifier ?? '')
        }
        text = step.mode === 'append' ? current + step.text : step.text
        validatePublicText(text, 'replace')
      })
    })
  }

  /** Persist each successful part before attempting the next. Failure never hides its sibling. */
  async checkpoint(accept: (part: CheckpointPart) => Promise<void>, externalSignal?: AbortSignal, appId?: string): Promise<void> {
    await this.exclusive(async (leaseSignal) => {
      const signal = externalSignal ? AbortSignal.any([externalSignal, leaseSignal]) : leaseSignal
      signal.throwIfAborted()
      if (appId) await this.#foreground(appId, signal)
      const errors: string[] = []
      for (const kind of ['png', 'xml'] as const) {
        const startedAt = new Date().toISOString()
        try {
          const bytes = await timed(this.timing, kind, async () => {
            if (kind === 'png') return (await this.provider.snapshot(signal)).bytes
            const source = await this.provider.screenSource(signal)
            return source.kind === 'xml' ? source.xml : mockXml(source.structure)
          })
          await accept({ kind, bytes, startedAt, endedAt: new Date().toISOString() })
        } catch (error) { errors.push(`${kind}: ${error instanceof Error ? error.message : String(error)}`) }
      }
      if (errors.length) throw new Error(`Checkpoint incomplete: ${errors.join('; ')}`)
      if (appId) await this.#foreground(appId, signal)
    })
  }

  async callTool(name: string, args: Record<string, unknown>, appId: string): Promise<unknown> {
    const ok = { content: [{ type: 'text', text: 'OK' }] }
    if (name === 'appium_get_page_source') {
      const source = await this.exclusive((signal) => timed(this.timing, 'locate', () => this.provider.screenSource(signal)))
      this.#lastSourceAt = Date.now()
      return { content: [{ type: 'text', text: source.kind === 'xml' ? source.xml : mockXml(source.structure) }] }
    }
    if (name === 'appium_set_value') {
      if (typeof args.text !== 'string' || (args.mode !== 'replace' && args.mode !== 'append')) throw new Error('Invalid public input')
      const text = args.text, mode = args.mode, selector = parseElementSelector(args.selector, 'type selector')
      validatePublicText(text, mode)
      await this.exclusive(async (signal) => {
        const source = await timed(this.timing, 'locate', () => this.provider.screenSource(signal, { resolveFocus: true }))
        const xml = source.kind === 'xml' ? source.xml : mockXml(source.structure)
        const elements = this.platform === 'ios' ? parseIOSPageSource(xml, { includeHidden: true }) : parseAndroidPageSource(xml)
        const matches = resolveElementSelector(elements, selector).matches
        if (matches.length !== 1 || !matches[0]!.editable) throw new Error('Input target must resolve to one editable element')
        const target = matches[0]!
        const structure = source.kind === 'normalized' ? source.structure : source.structure ?? normalizeScreenSource(source.xml, source.platform)
        // iOS may expose a container and its TextView with identical bounds.
        // Bind the selected editable element by identity/type before geometry;
        // retain the uniqueness check for genuinely indistinguishable inputs.
        const nodes = structure.nodes.filter(n => n.role === 'input'
          && (!target.id || n.identifier === target.id)
          && (this.platform !== 'ios' || !n.platformRole?.startsWith('XCUIElementType') || n.platformRole.replace(/^XCUIElementType/, '') === target.type)
          && n.bounds && Math.abs(n.bounds.x + n.bounds.width / 2 - target.center[0]) <= 1 && Math.abs(n.bounds.y + n.bounds.height / 2 - target.center[1]) <= 1 && Math.abs(n.bounds.width - target.size[0]) <= 1 && Math.abs(n.bounds.height - target.size[1]) <= 1)
        if (nodes.length !== 1) throw new Error('Input target bounds are ambiguous')
        const node = nodes[0]!
        if (target.password || node.sensitive || isSensitivePlatformRole(node.platformRole)) throw new Error('Sensitive input is forbidden')
        if (node.role !== 'input' || node.focused !== true || node.visible !== true || node.enabled !== true) throw new Error('Input target must be visible, enabled and focused')
        const geometry = await timed(this.timing, 'geometry', () => this.provider.screenGeometry(signal))
        const expectedBounds = requirePositiveVisibleBounds(node.bounds, geometry.viewport)
        if (!this.provider.inputText) throw new Error('Provider text input unavailable')
        // Re-focusing may replace Android text or leave an iOS cursor mid-value.
        // Materialize append from the fresh value, independent of selection.
        const current = this.platform === 'android' && source.kind === 'xml' ? androidInputValue(source.xml, target.bounds, target.id) : node.value ?? ''
        const writeText = mode === 'append' ? current + text : text
        validatePublicText(writeText, 'replace')
        await this.#write('input', () => timed(this.timing, 'action', () => this.provider.inputText!({ mode: mode === 'append' ? 'replace' : mode, text: writeText, expectedBounds }, signal)))
      })
      return ok
    }
    if (name === 'appium_screenshot') {
      const shot = await this.exclusive((signal) => timed(this.timing, 'png', () => this.provider.snapshot(signal)))
      return { content: [{ type: 'image', mimeType: 'image/png', data: Buffer.from(shot.bytes).toString('base64') }] }
    }
    if (name === 'appium_app_lifecycle' && args.action === 'activate' && args.id === appId) {
      await this.exclusive(async (signal) => {
        if (!this.provider.manageApp) throw new Error('App activation unavailable')
        // The reviewed YAML appId is a local user authorization, not Agent policy.
        await this.#write('activate', async () => { await timed(this.timing, 'action', () => this.provider.manageApp!({ operation: 'activate', appId }, signal)) })
      })
      return ok
    }
    if (name === 'appium_gesture' || (name === 'appium_mobile_press_key' && args.key === 'BACK')) {
      await this.exclusive(async (signal) => {
        const needsTarget = name === 'appium_gesture' && !args.direction
        if (needsTarget && Date.now() - this.#lastSourceAt > 15_000) throw new Error('Flow target expired; capture source again')
        // Only coordinate actions need geometry. Always read it immediately before dispatch.
        const geometry = name === 'appium_mobile_press_key' ? null : await timed(this.timing, 'geometry', () => this.provider.screenGeometry(signal))
        if (needsTarget && Date.now() - this.#lastSourceAt > 15_000) throw new Error('Flow target expired; capture source again')
        const { x, y, width, height } = geometry?.viewport ?? { x: 0, y: 0, width: 0, height: 0 }
        const point = (px: unknown, py: unknown) => {
          if (typeof px !== 'number' || typeof py !== 'number' || !Number.isFinite(px) || !Number.isFinite(py)
            || px < x || py < y || px >= x + width || py >= y + height) throw new Error('Flow coordinates outside viewport')
          return { x: px, y: py }
        }
        let action: MirrorAction
        if (name === 'appium_mobile_press_key') action = { kind: 'back' }
        else if (args.action === 'tap' && !args.elementUUID) action = { kind: 'tap', ...point(args.x, args.y) }
        else if (args.action === 'swipe' || args.action === 'scroll') {
          let start = { x: args.x, y: args.y }, end = { x: args.endX, y: args.endY }
          if (args.direction) {
            const dir = String(args.direction)
            if (!['up', 'down', 'left', 'right'].includes(dir)) throw new Error('Unsupported swipe direction')
            const vertical = dir === 'up' || dir === 'down'
            // AppClaw follows appium-mcp scroll semantics on Android.
            const reverse = vertical && this.platform === 'android'
            const forward = (dir === 'up' || dir === 'left') !== reverse
            start = { x: x + width * (vertical ? .5 : forward ? .8 : .2), y: y + height * (vertical ? forward ? .8 : .2 : .5) }
            end = { x: x + width * (vertical ? .5 : forward ? .2 : .8), y: y + height * (vertical ? forward ? .2 : .8 : .5) }
          }
          const a = point(start.x, start.y), b = point(end.x, end.y)
          action = { kind: 'swipe', startX: a.x, startY: a.y, endX: b.x, endY: b.y, durationMs: 400 }
        } else throw new Error(`Unsupported deterministic gesture: ${String(args.action)}`)
        await this.#write(action.kind, () => timed(this.timing, 'action', () => this.provider.action(action, signal)), undefined,
          geometry ? { action, geometry, signal } : undefined)
      })
      return ok
    }
    throw new Error(`Unsupported workbench tool: ${name}`)
  }
}

function mockXml(structure: ScreenStructure): string {
  const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (s) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[s]!)
  const ids = new Set(structure.nodes.map(node => node.nodeId)), visited = new Set<string>()
  const render = (n: ScreenNode): string => {
    if (visited.has(n.nodeId)) throw new Error('Invalid normalized checkpoint tree')
    visited.add(n.nodeId)
    const b = n.bounds ?? { x: 0, y: 0, width: 0, height: 0 }
    const type = n.platformRole?.startsWith('XCUIElementType') ? n.platformRole : n.role === 'application' ? 'XCUIElementTypeApplication' : n.role === 'input' ? n.sensitive ? 'XCUIElementTypeSecureTextField' : 'XCUIElementTypeTextField' : n.role === 'button' ? 'XCUIElementTypeButton' : 'XCUIElementTypeStaticText'
    const children = structure.nodes.filter(child => child.parentId === n.nodeId).map(render).join('')
    return `<${type} type="${type}" name="${esc(n.identifier ?? n.name)}" label="${esc(n.text ?? n.name)}" value="${esc(n.value)}" focused="${n.focused === true}" visible="${n.visible !== false}" enabled="${n.enabled !== false}" x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}">${children}</${type}>`
  }
  const xml = structure.nodes.filter(node => !node.parentId || !ids.has(node.parentId)).map(render).join('')
  if (visited.size !== structure.nodes.length) throw new Error('Invalid normalized checkpoint tree')
  return `<?xml version="1.0"?><AppiumAUT>${xml}</AppiumAUT>`
}

// Read actual text rather than accessibility labels or displayed hint text.
// The source was already validated by normalizeScreenSource above.
function androidInputValue(xml: string, bounds: string, id: string): string {
  const values: string[] = []
  const parser = new SaxesParser({ xmlns: false })
  parser.on('opentag', ({ attributes }) => {
    if (attributes.bounds === bounds && (attributes['resource-id'] ?? '') === id) values.push(attributes['showing-hint'] === 'true' ? '' : attributes.text ?? '')
  })
  parser.write(xml).close()
  if (values.length !== 1) throw new Error('Input value is ambiguous')
  return values[0]!
}
