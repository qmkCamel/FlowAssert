import type { MirrorService } from './mirror-service.js'
import { closeInOrder } from './lifecycle.js'
import { WorkbenchService } from './workbench-service.js'
import { WorkbenchSuites } from './workbench-suites.js'
import { WorkbenchComparisonService } from './workbench-comparison.js'
import { WorkbenchTriageService } from './workbench-triage-service.js'
import { WorkbenchTrendIndex } from './workbench-trends.js'
import { WorkbenchShare } from './workbench-share.js'
import { WorkbenchShareJobs } from './workbench-share-jobs.js'
import { WorkbenchRepair } from './workbench-repair.js'
import { WorkbenchRepairCoordinator } from './workbench-repair-coordinator.js'
import { WorkbenchRetention } from './workbench-retention.js'
import { WorkbenchInvestigation } from './workbench-investigation.js'
import { WorkbenchChangeAcceptance } from './workbench-change-acceptance.js'
import { WorkbenchExternalAssets } from './workbench-external-assets.js'
import type { TriageAnalyzer } from './workbench-triage-analyzer.js'
import { WorkbenchOcrPreviews } from './workbench-ocr-preview.js'
import { LocalDeviceMatrix } from './device-matrix.js'
import { MatrixAcceptanceSources } from './device-matrix-sources.js'
import { CombinedAcceptanceSources, NativeAcceptanceSources } from './workbench-change-source.js'
import { WorkbenchAcceptance } from './workbench-acceptance.js'
import { WorkbenchAuthoring } from './workbench-authoring.js'
import { WorkbenchCaseLibrary } from './workbench-cases.js'
import { loadTestProject } from './workbench-project.js'
import type { ProjectSnapshot } from './workbench-project.js'

export interface WorkbenchApplicationOptions {
  webTests?: boolean
  root?: string
  projectPath?: string
  matrixRegistryPath?: string
  workbench?: WorkbenchService
  planner?: import('./workbench-recovery.js').RecoveryPlanner
  analyzer?: TriageAnalyzer | null
  externalAdapters?: import('./workbench-external-adapters.js').ExternalResultAdapter[]
  repairProjectLoader?: () => Promise<ProjectSnapshot>
}

/** Single composition root. Constructing services does not initialize storage or start jobs. */
export class WorkbenchApplication {
  readonly workbench: WorkbenchService
  readonly suites: WorkbenchSuites
  readonly comparisons: WorkbenchComparisonService
  readonly triage: WorkbenchTriageService
  readonly trends: WorkbenchTrendIndex
  readonly share: WorkbenchShare
  readonly shareJobs: WorkbenchShareJobs
  readonly repair: WorkbenchRepair
  readonly repairCases: WorkbenchRepairCoordinator
  readonly retention: WorkbenchRetention
  readonly investigation: WorkbenchInvestigation
  readonly acceptanceRecords: WorkbenchChangeAcceptance
  readonly externalAssets: WorkbenchExternalAssets
  readonly ocrPreviews: WorkbenchOcrPreviews
  readonly matrix: LocalDeviceMatrix
  readonly acceptance: WorkbenchAcceptance
  readonly authoring: WorkbenchAuthoring
  readonly cases: WorkbenchCaseLibrary
  #closePromise: Promise<void> | undefined

  constructor(mirror: MirrorService, options: WorkbenchApplicationOptions = {}) {
    this.workbench = options.workbench ?? new WorkbenchService(mirror, options)
    this.ocrPreviews = new WorkbenchOcrPreviews(this.workbench.ocr)
    const store = this.workbench.store
    this.acceptance = new WorkbenchAcceptance(store)
    this.cases = new WorkbenchCaseLibrary(store, async () => (await this.workbench.baselines.applyApproved(await loadTestProject(this.workbench.projectPath))).sha256)
    this.investigation = new WorkbenchInvestigation(store)
    this.authoring = new WorkbenchAuthoring(this.workbench, this.acceptance, { cases: this.cases })
    this.suites = new WorkbenchSuites(this.workbench)
    this.comparisons = new WorkbenchComparisonService(store)
    this.triage = new WorkbenchTriageService(store, this.comparisons, options.analyzer === undefined ? {} : { analyzer: options.analyzer })
    this.trends = new WorkbenchTrendIndex(store, this.suites)
    this.share = new WorkbenchShare(store)
    this.shareJobs = new WorkbenchShareJobs(store)
    this.repair = new WorkbenchRepair(store)
    this.repairCases = new WorkbenchRepairCoordinator(this.workbench, this.suites, options.repairProjectLoader)
    this.retention = new WorkbenchRetention(store, () => this.workbench.activeId)
    this.externalAssets = new WorkbenchExternalAssets(store, options.externalAdapters ? { adapters: options.externalAdapters } : {})
    this.matrix = new LocalDeviceMatrix(store, this.workbench.projectPath, options.matrixRegistryPath)
    this.acceptanceRecords = new WorkbenchChangeAcceptance(store, { external: this.externalAssets,
      resolver: new MatrixAcceptanceSources(new CombinedAcceptanceSources(new NativeAcceptanceSources(store), this.externalAssets), this.matrix) })
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise
    this.acceptance.stopAccepting()
    this.cases.stopAccepting()
    this.investigation.stopAccepting()
    this.repairCases.stopAccepting()
    this.suites.stopAccepting()
    this.workbench.stopAccepting()
    this.comparisons.stopAccepting()
    // Start all background stops before awaiting any one of their drains.
    const background = Promise.allSettled([this.matrix.close(), this.ocrPreviews.close(), this.triage.close(), this.shareJobs.close(), this.comparisons.close(), closeInOrder([() => this.acceptanceRecords.close(), () => this.externalAssets.close()])])
    return this.#closePromise = closeInOrder([
      () => this.acceptance.close(),
      () => this.cases.close(),
      () => this.investigation.close(),
      () => this.repairCases.close(),
      async () => {
        const errors = (await background).filter(result => result.status === 'rejected').map(result => result.reason)
        if (errors.length) throw new AggregateError(errors, 'Background cleanup failed')
      },
      () => this.suites.close(),
      () => this.workbench.close(),
    ])
  }
}
