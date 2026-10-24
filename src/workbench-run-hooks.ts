import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { validateShape } from './workbench-project.js'
import { bind, type ExecutionPlan, type Hook } from './workbench-plan.js'
import { executeExtension, type ExtensionResult } from './workbench-extensions.js'
import type { WorkbenchStore } from './workbench-store.js'
import type { TestRun } from './workbench-domain.js'
import { conjoinBusiness } from './workbench-runtime-execution.js'

const message = (error: unknown) => error instanceof Error ? error.message : String(error)

/** Private business-resource journal and hook lifecycle; it never owns a device. */
export function createRunHooks(store: WorkbenchStore, run: TestRun, plan: ExecutionPlan) {
  const outputs: Record<string, unknown> = {}
  const resources: { ref: string; token: unknown }[] = []
  const persistResources = async () => {
    const dir = join(store.root, run.id, 'private')
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const directory = await lstat(dir)
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('Invalid private resource directory')
    const temporary = join(dir, `resources-${randomUUID()}.tmp`)
    const handle = await open(temporary, 'wx', 0o600)
    try { await handle.writeFile(JSON.stringify(resources)); await handle.sync() } finally { await handle.close() }
    await rename(temporary, join(dir, 'resources.json'))
    run.resourceCleanup = resources.length ? 'pending' : 'pass'
    await store.save(run)
  }
  const invoke = async (hook: Hook, role: string, signal: AbortSignal, overrideArgs?: unknown) => {
    const def = plan.project.extensions[hook.ref]!
    const entry: ExtensionResult = { ref: hook.ref, role, status: 'running', startedAt: new Date().toISOString() }
    ;(run.extensionResults ??= []).push(entry); run.stage = role; await store.save(run)
    try {
      const value = await executeExtension(def, role === 'cleanup' ? overrideArgs : bind(hook.args, plan.params, outputs), signal, async token => {
        if (role !== 'prepare' || !def.cleanup) throw new Error('Cleanup registration requires a declared cleanup extension')
        if (resources.length >= 100) throw new Error('Resource registration limit exceeded')
        validateShape(plan.project.extensions[def.cleanup]!.input, token, 'cleanup token')
        resources.push({ ref: def.cleanup, token }); await persistResources()
      })
      entry.result = value; entry.status = 'pass'
      if (role === 'verify') {
        const verdict = value as { verdict?: string; expected?: unknown; actual?: unknown; source?: string; artifactRefs?: unknown }
        if (!['pass', 'fail', 'inconclusive'].includes(verdict?.verdict ?? '') || !Object.hasOwn(verdict, 'expected') || !Object.hasOwn(verdict, 'actual')
          || typeof verdict.source !== 'string' || !verdict.source.trim() || !Array.isArray(verdict.artifactRefs))
          throw new Error('Verifier requires verdict, expected, actual, source and artifactRefs')
        entry.status = verdict.verdict as ExtensionResult['status']
        run.businessVerification = conjoinBusiness(run.businessVerification, entry.status as 'pass' | 'fail' | 'inconclusive')
        if (entry.status !== 'pass') run.diagnostics!.push({ domain: 'business-assertion', code: `verifier-${entry.status}`, phase: 'verify', retryable: false,
          evidenceRefs: [], observedAt: new Date().toISOString(), message: `Business verifier ${hook.ref} returned ${entry.status}` })
        if (entry.status !== 'pass') throw new Error(`Business verification ${entry.status}`)
      }
      if (hook.as) outputs[hook.as] = value
    } catch (error) {
      if (entry.status !== 'fail') entry.status = 'inconclusive'
      entry.error = message(error)
      if (role === 'verify') run.businessVerification = conjoinBusiness(run.businessVerification, entry.status)
      if (role === 'cleanup') run.diagnostics!.push({ domain: 'cleanup', code: 'extension-cleanup-failed', phase: 'cleanup', retryable: true,
        evidenceRefs: [], observedAt: new Date().toISOString(), message: message(error) })
      throw error
    } finally {
      entry.endedAt = new Date().toISOString()
      run.evidence.push(await store.put(run.id, `extension-${run.extensionResults!.length}.json`, JSON.stringify(entry), 'application/json'))
      await store.save(run)
    }
  }
  const hooks = async (list: Hook[], role: string, signal: AbortSignal) => {
    for (const hook of list) { signal.throwIfAborted(); await invoke(hook, role, signal) }
  }
  return { outputs, resources, persistResources, invoke, hooks }
}
