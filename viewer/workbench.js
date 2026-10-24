import { viewerCapture } from './capture.js'
import { createSharePanel } from './workbench-share.js'
import { createTrendsPanel } from './workbench-trends.js'
import { createRetentionPanel } from './workbench-retention.js'
import { createHistoryView } from './workbench-history.js'
import { renderResultHeading, renderResultDimensions, renderProvenance } from './workbench-results.js'
import { createBaselinePanel } from './workbench-baselines.js'
import { createRepairPanel } from './workbench-repair.js'
import { createComparisonPanel } from './workbench-comparisons.js'
import { createTriagePanel } from './workbench-triage.js'
import { createAcceptanceAssistant } from './workbench-acceptance.js'
import { createInvestigationPanel } from './workbench-investigation.js'
import { createChangeAcceptancePanel } from './workbench-change-acceptance.js'
import { createExternalPanel } from './workbench-external.js'
import { createOcrPanel } from './workbench-ocr.js'
import { createMatrixPanel } from './workbench-matrix.js'
const texts = {
  'zh-CN': {
    runtimeHealth: 'App 健康', runtimePerformance: '性能时限',
    'sampling-stable': '正在验证采样稳定窗口', 'sampling-eventually': '正在等待条件成立', 'restart-app': '正在受控重启应用',
    'business-observing': '正在查询业务真值', 'measure-running': '正在测量端到端时限',
    'health-preparing': '正在准备健康采集', 'health-observing': '正在观察健康尾窗', 'health-draining': '正在排空健康采集；尚未形成最终结论',
    resultReported: '原报告结果', resultCurrent: '当前可信结果', resultEvidence: '证据状态', resultDimensions: '验证分项', resultReasons: '原因码',
    aiNavigationRecovered: '导航已恢复，原定条件通过', aiRejected: '恢复未完成',
    aiRecovered: 'AI 恢复后完成（CI 非通过）', aiRecovery: 'AI 恢复记录', 'recovery-observing': '正在采集恢复画面', 'recovery-planning': '正在分析候选入口', 'recovery-validating': '正在校验建议', 'recovery-executing': '正在执行恢复动作', 'recovery-verifying': '正在验证原定条件',
    videoOption: '同时保存录像（无声音）', videoTitle: '运行录像', videoDownload: '下载录像', videoStopped: '提前停止或采集被中断', videoHidden: '页面隐藏，提前结束', videoLimit: '达到录制上限', videoPending: '录像尚未归档', videoSaving: '正在保存录像…', videoComplete: '完整录像', videoPartial: '部分录像', videoUnavailable: '录像不可用', videoRetry: '重试保存录像', videoDiscard: '放弃归档，保留本页下载', videoSeek: '查看步骤录像', videoApprox: '步骤位置为近似时间，受画面传输延迟影响。', videoError: '录像读取失败或完整性校验失败',
    replaySnapshot: '按原快照重跑', suites: '回归套件', suiteRun: '运行套件', suiteCancel: '取消套件', parameters: '公开参数（JSON）', business: '业务验证', resources: '资源清理', prepare: '准备数据', cleanup: '清理数据', execute: '执行流程', queued: '排队中', skipped: '未执行', flaky: '重试后通过', 'not-performed': '未执行', pending: '待处理',
    toggle: '测试工作台', connect: '设备连接', title: '运行固定流程', subtitle: 'YAML 驱动操作，关键步骤留证。',
    trends: '本机趋势', trendLoad: '统计历史', trendCancel: '取消统计', trendMore: '加载更多分组', trendFrom: '开始日期', trendTo: '结束日期（含）', trendLoading: '正在统计本机归档…', trendEmpty: '暂无统计结果。仅计划用例计入分母。', trendUnknown: '环境未知，不作严格回归判断', trendUpdated: '统计完成', trendExcluded: '导入和非计划运行不计入计划用例通过率', trendAttempts: '次尝试', trendPlanned: '计划用例', trendMissing: '材料缺失或损坏', trendCorruptSuites: '损坏套件', trendActiveSuites: '进行中套件', trendFirstPass: '首次通过', trendCleanPass: '最终干净通过', trendImported: '导入', trendDerived: '派生', trendUnplanned: '非计划', trendFlaky: '重试通过', trendNotExecuted: '未执行', trendCompareTitle: '双窗口对照（UTC，结束日不含）', trendCompare: '对照窗口', trendCompareCancel: '取消对照', trendCompareLoading: '正在核对两段历史，其他控件可继续使用…', trendCompareReady: '对照完成；提示仅为描述性预算信号', trendCompareEmpty: '尚未对照', trendPreviousBuild: '前窗构建（可选）', trendCurrentBuild: '后窗构建（可选）', trendAbsoluteBudget: '绝对预算 ms', trendRelativeBudget: '相对预算比例',
    trendPreviousFrom: '前窗开始', trendPreviousTo: '前窗结束（不含）', trendCurrentFrom: '后窗开始', trendCurrentTo: '后窗结束（不含）',
    sample: '载入示例', demo: '演示设备', sampleapp: '示例 App · 需配置', run: '运行并留证', cancel: '取消运行',
    consent: '点击运行将执行当前 YAML，并在本机保存页面原图、结构和日志。', history: '运行历史', refresh: '刷新', importRun: '导入运行归档', importing: '正在校验并导入运行归档…', importHint: '导入已审查的 mobile-mirror-run v1/v2 JSON；v2 结果不会作为重验通过。',
    shareTitle: '安全分享（派生包）', shareHint: '仅选中的 PNG 和结构化 XML 会进入包；截图可画框遮蔽或填写源像素坐标。未遮蔽像素会公开。', shareMaskHint: 'x,y,width,height; ...', sharePreview: '预览派生内容', shareDownload: '确认并下载 v2 包', shareCancel: '取消转换', shareCancelling: '正在取消转换…', shareReviewed: '我已检查所有预览图和待分享内容', sharePreparing: '正在生成派生内容，其他控件可继续使用…', shareReady: '预览就绪；请逐张确认', shareDownloaded: '派生包已下载，原件未改动', shareNotRevalidated: '派生内容未重新验证，当前结果不可作为通过基线', shareReported: '原报告结果', shareSuggestion: '本机脱敏提示', 'source-secret-like': '原 YAML/参数疑似包含敏感内容；它们已排除，但请人工检查截图', 'hierarchy-secret-like': '结构中有敏感或疑似秘密节点，请核对相关截图遮蔽',
    repairTitle: '证据关联的受控修复', repairHint: '仅当同一计划的成功运行和失败运行都能唯一定位同一非敏感控件时，才建议替换 tap 定位器；断言保持原样。', repairSuggest: '检查安全修复候选', repairChecking: '正在核对两次运行和证据…', repairCandidate: '有一个定位器候选，需人工审查', repairNone: '没有安全候选；失败保持原样', repairEvidence: '证据', repairPlan: '原计划摘要', repairApply: '确认并载入新草稿', repairDraftReady: '新草稿已载入；请检查后明确点击运行', repairLineage: '已审查修复',
    visualResult: '视觉判定', baselineTitle: '视觉基线批准', baselineHint: '仅本机明确批准；项目参考图或当前干净成功运行的 PNG。批准不会更改旧运行结果。', baselineLoad: '加载配置', baselineProject: '项目参考图', baselineRun: '当前运行截图', baselineTargets: '允许的目标构建（逗号分隔；空值仅来源构建）', baselinePreview: '预览候选', baselineReview: '我已核对图像、规则摘要和目标构建', baselineReviewer: '审查人别名', baselineApprove: '批准新版本', baselineLoading: '正在核对基线来源…', baselineApproving: '正在提交不可变版本…', baselineReady: '候选已就绪，请检查图像与摘要', baselineApproved: '基线已批准', baselineEmpty: '先加载项目视觉配置',
    retentionTitle: '本机证据容量', retentionScan: '刷新占用', retentionCancel: '取消扫描', retentionHint: '自动清理默认关闭。先预览引用与候选；移入隔离区不释放磁盘，7 天内可恢复。', retentionPlan: '生成清理预览', retentionScanning: '正在扫描引用与容量，其他控件可使用…', retentionEmpty: '尚未扫描本机证据', retentionUpdated: '容量已刷新', retentionLive: '使用中', retentionTrash: '隔离区', retentionRuns: '个运行', retentionCandidates: '可移动候选', retentionProtected: '受保护运行', retentionNoFree: '移动后实际释放 0 字节；彻底清除需单独确认', retentionExpiry: '预览有效至', retentionReviewed: '我已核对候选与保护原因', retentionMove: '确认移入隔离区', retentionMoving: '正在重验引用并移动…', retentionMoved: '已移入隔离区', retentionRestore: '恢复', retentionRestoring: '正在恢复…', retentionRestored: '已恢复', retentionPurge: '彻底清除', retentionIrreversible: '不可恢复。请输入 PURGE 加完整 ID 单独确认。', retentionPurging: '正在彻底清除，不保证可取消或回滚…', retentionFreed: '实际释放', retentionPlanReady: '清理预览已生成，请核对后确认', retentionCancelled: '扫描已取消，旧结果保留', retentionPin: '固定保存', retentionUnpin: '取消固定', retentionPinning: '正在更新固定状态…',
    empty: '还没有运行记录。连接设备后执行一个流程。', starting: '正在校验用例并准备运行…', cancelling: '正在停止执行并等待设备请求结束…', loading: '正在加载…', compareCancelling: '正在取消比较并等待后台任务退出…',
    disconnected: '请先在“设备连接”中连接手机或演示设备。', scope: '验收范围：声明的 UI 断言与遮挡条件。原图仅留证，未自动验证视觉外观或业务持久化。',
    retained: '设备会话保留，可继续观察或运行。', rerun: '载入此用例重跑', flow: '原始 YAML', evidence: '步骤证据',
    compare: '与历史运行比较', compareStart: '开始比较', compareCancel: '取消比较', compareLoading: '正在生成比较报告…', compareUnavailable: '该运行缺少比较元数据，请重新运行。', compareBaseline: '基线运行', compareReport: '比较报告', compareDownload: '下载 JSON 报告', compareFirst: '最早归档差异', comparePartial: '部分材料不可比较', compareNoCandidate: '没有符合条件的成功基线', compareFacts: '失败事实', diagnosticContext: 'Diagnostic Context', diagnosticBoundary: '确定性事实摘要，不是 AI 根因判断', diagnosticCoverage: '证据覆盖', diagnosticDrill: '查看登记证据', diagnosticNoDivergence: '未发现可提升为诊断事实的差异；像素或结构变化仍保留在完整报告中。',
    previous: '前次运行', screenshot: '原始截图', source: '页面结构', files: '运行文件', integrity: 'SHA-256 在读取证据时校验',
    provenance: '运行来源', provenanceLegacy: '历史记录未包含版本化来源数据；已按未知值只读展示。', provenanceUnsupported: '该记录使用了当前版本不支持的未来契约，未解析其内容。', observed: '实际观测', declared: '项目声明', unknown: '未知', appVersion: '应用版本', appBuild: '应用构建', sourceCommit: '源码提交', backendEnvironment: '后端环境', testDataVersion: '测试数据', deviceOs: '设备系统', driver: '驱动', viewport: '视口',
    pass: '通过', fail: '失败', cancelled: '已取消', inconclusive: '无法确认', 'evidence-conflict': '证据冲突', 'evidence-contaminated': '画面受遮挡',
    running: '运行中', finalizing: '正在封存证据', finished: '已结束', passed: '步骤通过', failed: '步骤失败',
    timing: '耗时', execution: '步骤执行', waitTime: '固定等待', geometry: '坐标校验', locate: '定位与读树', action: '设备动作', png: '截图', xml: '取源树', persist: '保存材料', verify: '证据复核',
    timingNote: '步骤执行包含定位、动作和条件等待；截图、源树与保存另行计时。', executorOther: '等待与执行器开销（差额）', checkpointError: '取证未完成', recovered: '恢复材料：无法证明中断前完整性', incomplete: '可能不完整', activity: '正在处理', agentSource: 'Agent 发起', viewerSource: 'Viewer 发起', importSource: '归档导入',
  },
  en: {
    runtimeHealth: 'Health', runtimePerformance: 'Performance',
    'sampling-stable': 'Sampling the stability window', 'sampling-eventually': 'Waiting for the condition',
    'restart-app': 'Restarting the authorized app', 'business-observing': 'Querying business truth', 'measure-running': 'Measuring end-to-end budget',
    'health-preparing': 'Preparing health collection', 'health-observing': 'Observing health tail', 'health-draining': 'Draining health collection; final verdict pending',
    resultReported: 'Reported verdict', resultCurrent: 'Current trusted verdict', resultEvidence: 'Evidence state', resultDimensions: 'Verification dimensions', resultReasons: 'Reason codes',
    aiNavigationRecovered: 'Navigation recovered; original condition verified', aiRejected: 'Recovery did not complete',
    aiRecovered: 'Recovered with AI (CI non-pass)', aiRecovery: 'AI recovery attempts', 'recovery-observing': 'Capturing recovery observation', 'recovery-planning': 'Analyzing navigation candidates', 'recovery-validating': 'Validating proposal', 'recovery-executing': 'Executing recovery action', 'recovery-verifying': 'Verifying original postcondition',
    videoOption: 'Save run video (no audio)', videoTitle: 'Run video', videoDownload: 'Download video', videoStopped: 'Stopped early or capture interrupted', videoHidden: 'Stopped when the page was hidden', videoLimit: 'Recording limit reached', videoPending: 'Video not archived yet', videoSaving: 'Saving recording…', videoComplete: 'Complete recording', videoPartial: 'Partial recording', videoUnavailable: 'Video unavailable', videoRetry: 'Retry saving video', videoDiscard: 'Skip archive; keep local download', videoSeek: 'View step in video', videoApprox: 'Step positions are approximate and include media transport delay.', videoError: 'Video unavailable or integrity check failed',
    replaySnapshot: 'Replay original snapshot', suites: 'Test suites', suiteRun: 'Run suite', suiteCancel: 'Cancel suite', parameters: 'Public parameters (JSON)', business: 'Business verification', resources: 'Resource cleanup', prepare: 'Preparing data', cleanup: 'Cleaning up', execute: 'Executing flow', queued: 'Queued', skipped: 'Skipped', flaky: 'Flaky', 'not-performed': 'Not performed', pending: 'Pending',
    toggle: 'Test workbench', connect: 'Connect device', title: 'Run a fixed flow', subtitle: 'YAML actions with retained step evidence.',
    trends: 'Local trends', trendLoad: 'Analyze history', trendCancel: 'Cancel analysis', trendMore: 'Load more groups', trendFrom: 'From date', trendTo: 'Through date', trendLoading: 'Analyzing local archives…', trendEmpty: 'No trend result yet. Only planned cases enter the denominator.', trendUnknown: 'Unknown environment; no strict regression claim', trendUpdated: 'Analysis complete', trendExcluded: 'Imported and unplanned runs are excluded from planned-case pass rates', trendAttempts: 'attempts', trendPlanned: 'planned cases', trendMissing: 'missing or corrupt evidence', trendCorruptSuites: 'corrupt suites', trendActiveSuites: 'active suites', trendFirstPass: 'first pass', trendCleanPass: 'clean final pass', trendImported: 'imported', trendDerived: 'derived', trendUnplanned: 'unplanned', trendFlaky: 'flaky pass', trendNotExecuted: 'not executed', trendCompareTitle: 'Two-window comparison (UTC, end exclusive)', trendCompare: 'Compare windows', trendCompareCancel: 'Cancel comparison', trendCompareLoading: 'Checking both history windows; other controls remain available…', trendCompareReady: 'Comparison complete; signals are descriptive budgets only', trendCompareEmpty: 'No comparison yet', trendPreviousBuild: 'Previous build (optional)', trendCurrentBuild: 'Current build (optional)', trendAbsoluteBudget: 'Absolute budget ms', trendRelativeBudget: 'Relative budget ratio',
    trendPreviousFrom: 'Previous start', trendPreviousTo: 'Previous end (exclusive)', trendCurrentFrom: 'Current start', trendCurrentTo: 'Current end (exclusive)',
    sample: 'Load example', demo: 'Demo device', sampleapp: 'Sample app · configure first', run: 'Run & retain evidence', cancel: 'Cancel run',
    consent: 'Running executes this YAML and saves original screenshots, hierarchy and logs locally.', history: 'Run history', refresh: 'Refresh', importRun: 'Import run archive', importing: 'Validating and importing run archive…', importHint: 'Import a reviewed mobile-mirror-run v1/v2 JSON; v2 results are never treated as revalidated passes.',
    shareTitle: 'Safe sharing (derived archive)', shareHint: 'Only selected PNG and structure-only XML enter the archive. Draw masks on the image, or enter source-pixel coordinates. Unmasked pixels remain visible.', shareMaskHint: 'x,y,width,height; ...', sharePreview: 'Preview derived content', shareDownload: 'Confirm and download v2', shareCancel: 'Cancel conversion', shareCancelling: 'Cancelling conversion…', shareReviewed: 'I reviewed every preview and the shared content', sharePreparing: 'Preparing derived content; other controls remain available…', shareReady: 'Preview ready; review each image', shareDownloaded: 'Derived archive downloaded; originals unchanged', shareNotRevalidated: 'Derived content is not revalidated and cannot be a passing baseline', shareReported: 'Original reported result', shareSuggestion: 'Local redaction hint', 'source-secret-like': 'Source YAML/parameters look sensitive; they are withheld, but inspect screenshots manually', 'hierarchy-secret-like': 'Hierarchy has sensitive or secret-like nodes; inspect related screenshot masks',
    repairTitle: 'Evidence-linked controlled repair', repairHint: 'A tap locator is replaced only when a successful run of the same plan and this failed run uniquely identify the same non-sensitive control. Assertions stay unchanged.', repairSuggest: 'Check safe repair candidates', repairChecking: 'Checking both runs and evidence…', repairCandidate: 'One locator candidate needs review', repairNone: 'No safe candidate; failure is retained', repairEvidence: 'Evidence', repairPlan: 'Original plan digest', repairApply: 'Confirm and load new draft', repairDraftReady: 'New draft loaded; review it and explicitly run', repairLineage: 'Reviewed repair',
    visualResult: 'Visual verdict', baselineTitle: 'Visual baseline approval', baselineHint: 'Explicit local approval only. Use a project reference or PNG from the selected clean passing run. Approval does not alter past results.', baselineLoad: 'Load profiles', baselineProject: 'Project reference', baselineRun: 'Selected run image', baselineTargets: 'Allowed target builds (comma-separated; blank means source build only)', baselinePreview: 'Preview candidate', baselineReview: 'I reviewed the image, rules digest, and target builds', baselineReviewer: 'Reviewer alias', baselineApprove: 'Approve new revision', baselineLoading: 'Checking baseline source…', baselineApproving: 'Committing immutable revision…', baselineReady: 'Candidate ready; inspect image and digest', baselineApproved: 'Baseline approved', baselineEmpty: 'Load project visual profiles first',
    retentionTitle: 'Local evidence storage', retentionScan: 'Refresh usage', retentionCancel: 'Cancel scan', retentionHint: 'Automatic cleanup is off. Review references and candidates first; moving to trash frees no disk space and can be restored for 7 days.', retentionPlan: 'Preview cleanup', retentionScanning: 'Scanning references and capacity; other controls remain available…', retentionEmpty: 'Local evidence has not been scanned', retentionUpdated: 'Storage updated', retentionLive: 'Live', retentionTrash: 'Trash', retentionRuns: 'runs', retentionCandidates: 'Movable candidates', retentionProtected: 'Protected runs', retentionNoFree: 'Moving frees 0 bytes; permanent purge needs separate confirmation', retentionExpiry: 'Preview expires', retentionReviewed: 'I reviewed candidates and protection reasons', retentionMove: 'Move to trash', retentionMoving: 'Rechecking references and moving…', retentionMoved: 'Moved to trash', retentionRestore: 'Restore', retentionRestoring: 'Restoring…', retentionRestored: 'Restored', retentionPurge: 'Purge permanently', retentionIrreversible: 'Irreversible. Type PURGE and the full ID to confirm separately.', retentionPurging: 'Purging; this cannot be cancelled or rolled back…', retentionFreed: 'Physically freed', retentionPlanReady: 'Cleanup preview ready; review before confirming', retentionCancelled: 'Scan cancelled; previous result retained', retentionPin: 'Pin run', retentionUnpin: 'Unpin run', retentionPinning: 'Updating pin…',
    empty: 'No runs yet. Connect a device and run a flow.', starting: 'Validating flow and preparing the run…', cancelling: 'Stopping the executor and draining device requests…', loading: 'Loading…', compareCancelling: 'Cancelling comparison and waiting for the worker to exit…',
    disconnected: 'Connect a phone or demo device in “Connect device” first.', scope: 'Scope: declared UI assertions and blockers. Screenshots are retained; visual appearance and business persistence are not automatically verified.',
    retained: 'Device session retained for preview and subsequent runs.', rerun: 'Load flow for another run', flow: 'Original YAML', evidence: 'Step evidence',
    compare: 'Compare with history', compareStart: 'Start comparison', compareCancel: 'Cancel comparison', compareLoading: 'Generating comparison report…', compareUnavailable: 'This run lacks comparison metadata; rerun it first.', compareBaseline: 'Baseline run', compareReport: 'Comparison report', compareDownload: 'Download JSON report', compareFirst: 'Earliest archived difference', comparePartial: 'Some evidence is not comparable', compareNoCandidate: 'No eligible successful baseline', compareFacts: 'Failure facts', diagnosticContext: 'Diagnostic Context', diagnosticBoundary: 'Deterministic fact summary, not an AI root-cause judgment', diagnosticCoverage: 'Evidence coverage', diagnosticDrill: 'Inspect registered evidence', diagnosticNoDivergence: 'No difference qualified as a diagnostic fact; pixel and hierarchy changes remain in the full report.',
    previous: 'Previous run', screenshot: 'Original screenshot', source: 'Hierarchy', files: 'Run files', integrity: 'SHA-256 is checked when evidence is read',
    provenance: 'Run provenance', provenanceLegacy: 'This legacy run has no versioned provenance; unknown values are shown read-only.', provenanceUnsupported: 'This run uses a future contract version that this build does not parse.', observed: 'Observed', declared: 'Declared', unknown: 'Unknown', appVersion: 'App version', appBuild: 'App build', sourceCommit: 'Source commit', backendEnvironment: 'Backend environment', testDataVersion: 'Test data', deviceOs: 'Device OS', driver: 'Driver', viewport: 'Viewport',
    pass: 'Passed', fail: 'Failed', cancelled: 'Cancelled', inconclusive: 'Inconclusive', 'evidence-conflict': 'Evidence conflict', 'evidence-contaminated': 'Evidence contaminated',
    running: 'Running', finalizing: 'Finalizing evidence', finished: 'Finished', passed: 'Step passed', failed: 'Step failed',
    timing: 'Timing', execution: 'Step execution', waitTime: 'Fixed wait', geometry: 'Coordinate check', locate: 'Locate / read tree', action: 'Device action', png: 'Screenshot', xml: 'Hierarchy capture', persist: 'Save evidence', verify: 'Verify evidence',
    timingNote: 'Execution includes locating, actions and conditional waits; screenshot, hierarchy and persistence are timed separately.', executorOther: 'Wait / executor overhead (residual)', checkpointError: 'Checkpoint incomplete', recovered: 'Recovered evidence: pre-interruption integrity is unknown', incomplete: 'Possibly incomplete', activity: 'In progress', agentSource: 'Started by Agent', viewerSource: 'Started by Viewer', importSource: 'Imported archive',
  },
}
Object.assign(texts['zh-CN'], { retentionExports: '分享导出', retentionBaselines: '视觉基线', retentionIndexes: '派生索引', retentionScanCoverage: '扫描覆盖' })
Object.assign(texts.en, { retentionExports: 'Share exports', retentionBaselines: 'Visual baselines', retentionIndexes: 'Derived indexes', retentionScanCoverage: 'Scan coverage' })
const samples = {
  demo: `name: Demo · tap and verify\nplatform: ios\nappId: com.example.mobilemirror.mock\n---\n- launchApp\n- assertVisible:\n    text: Hello, harness.\n- tap:\n    accessibilityId: action-card\n- assertVisible:\n    text: 1 actions received\n- done\n`,
  sampleapp: `name: 第三方 App · 精选到首页\nplatform: ios\nappId: com.example.sampleapp\nblockers:\n  - text:\n      value: 跳过\n      match: contains\n---\n- launchApp\n- wait: 5\n- tap:\n    text: 精选\n- wait: 2\n- assertNotVisible:\n    text:\n      value: 跳过\n      match: contains\n- assertVisible:\n    text: 拍摄\n- tap:\n    text: 首页\n- wait: 2\n- assertVisible:\n    text: 关注\n- assertVisible:\n    text: 首页\n- done\n`,
}
const workspace = document.querySelector('.workspace')
const controls = document.querySelector('.control-panel')
const toggle = document.createElement('button')
toggle.className = 'text-button'; toggle.id = 'workbench-toggle'; toggle.type = 'button'
toggle.setAttribute('aria-expanded', 'false')
document.querySelector('.topbar-actions').prepend(toggle)
const panel = document.createElement('section')
panel.className = 'workbench-panel'; panel.id = 'workbench-panel'; panel.hidden = true
panel.innerHTML = `
  <div class="eyebrow">LOCAL TESTS</div><h1 data-wb="title"></h1><p class="wb-subtitle" data-wb="subtitle"></p>
  <div class="wb-row"><label for="wb-sample" data-wb="sample"></label><select id="wb-sample"><option value="demo" data-wb="demo"></option><option value="sampleapp" data-wb="sampleapp"></option></select></div>
  <label class="visually-hidden" for="wb-yaml">YAML</label><textarea id="wb-yaml" spellcheck="false" aria-label="YAML"></textarea>
  <label for="wb-params" data-wb="parameters"></label><input id="wb-params" value="{}" aria-label="Public parameters JSON">
  <h2 data-wb="suites"></h2><div class="wb-row"><select id="wb-suite" aria-label="Test suite"></select><button id="wb-suite-run" type="button" data-wb="suiteRun"></button><button id="wb-suite-cancel" type="button" data-wb="suiteCancel" disabled></button></div><div id="wb-suites"></div>
  <p class="wb-note" data-wb="consent"></p>
  <label class="wb-video-option"><input id="wb-record-video" type="checkbox"><span data-wb="videoOption"></span></label>
  <p id="wb-video-progress" role="status" aria-live="polite"></p><button id="wb-video-retry" type="button" class="check-button" data-wb="videoRetry" hidden></button><button id="wb-video-discard" type="button" class="text-button" data-wb="videoDiscard" hidden></button>
  <div class="wb-row"><button class="primary-button" id="wb-run" type="button" data-wb="run"></button><button class="check-button" id="wb-cancel" type="button" data-wb="cancel" disabled></button></div>
  <p id="wb-progress" role="status" aria-live="polite"></p><p id="wb-error" role="alert" hidden></p>
  <div class="wb-row wb-history-heading"><h2 data-wb="history"></h2><button class="text-button" id="wb-refresh" type="button" data-wb="refresh"></button></div>
  <section class="wb-trends">
    <div class="wb-row"><h2 data-wb="trends"></h2><button class="text-button" id="wb-trend-load" type="button" data-wb="trendLoad"></button><button class="text-button" id="wb-trend-cancel" type="button" data-wb="trendCancel" hidden></button></div>
    <div class="wb-trend-range"><div><label for="wb-trend-from" data-wb="trendFrom"></label><input id="wb-trend-from" type="date"></div><div><label for="wb-trend-to" data-wb="trendTo"></label><input id="wb-trend-to" type="date"></div></div>
    <p id="wb-trend-status" class="wb-note" role="status" aria-live="polite"></p><div id="wb-trend-results"></div><button class="text-button" id="wb-trend-more" type="button" data-wb="trendMore" hidden></button>
    <details class="wb-trend-compare"><summary data-wb="trendCompareTitle"></summary><div class="wb-trend-range">
      <div><label for="wb-trend-previous-from" data-wb="trendPreviousFrom"></label><input id="wb-trend-previous-from" type="date"></div>
      <div><label for="wb-trend-previous-to" data-wb="trendPreviousTo"></label><input id="wb-trend-previous-to" type="date"></div>
      <div><label for="wb-trend-current-from" data-wb="trendCurrentFrom"></label><input id="wb-trend-current-from" type="date"></div>
      <div><label for="wb-trend-current-to" data-wb="trendCurrentTo"></label><input id="wb-trend-current-to" type="date"></div>
      <div><label for="wb-trend-previous-build" data-wb="trendPreviousBuild"></label><input id="wb-trend-previous-build" type="text" aria-label="Previous build"></div>
      <div><label for="wb-trend-current-build" data-wb="trendCurrentBuild"></label><input id="wb-trend-current-build" type="text" aria-label="Current build"></div>
      <div><label for="wb-trend-budget-ms" data-wb="trendAbsoluteBudget"></label><input id="wb-trend-budget-ms" type="number" min="0" aria-label="Absolute budget ms"></div>
      <div><label for="wb-trend-budget-ratio" data-wb="trendRelativeBudget"></label><input id="wb-trend-budget-ratio" type="number" min="0" step="0.01" aria-label="Relative budget ratio"></div>
    </div><div class="wb-row"><button class="check-button" id="wb-trend-compare" type="button" data-wb="trendCompare"></button><button class="text-button" id="wb-trend-compare-cancel" type="button" data-wb="trendCompareCancel" hidden></button></div><p id="wb-trend-compare-status" role="status" aria-live="polite" class="wb-note"></p><div id="wb-trend-compare-results"></div></details>
  </section>
  <section class="wb-retention"><div class="wb-row"><h2 data-wb="retentionTitle"></h2><button class="text-button" id="wb-retention-scan" type="button" data-wb="retentionScan"></button><button class="text-button" id="wb-retention-cancel" type="button" data-wb="retentionCancel" hidden></button></div><p class="wb-note" data-wb="retentionHint"></p><div class="wb-row"><input id="wb-retention-days" type="number" min="0" max="3650" value="30" aria-label="Older than days"><input id="wb-retention-max" type="number" min="1" max="100" value="20" aria-label="Maximum runs"><button class="check-button" id="wb-retention-plan" type="button" data-wb="retentionPlan"></button></div><p id="wb-retention-status" role="status" aria-live="polite" class="wb-note"></p><div id="wb-retention-results"></div></section>
  <section class="wb-baselines"><div class="wb-row"><h2 data-wb="baselineTitle"></h2><button class="text-button" id="wb-baseline-load" type="button" data-wb="baselineLoad"></button></div><p class="wb-note" data-wb="baselineHint"></p><div class="wb-row"><select id="wb-baseline-profile" aria-label="Visual profile"></select><select id="wb-baseline-source" aria-label="Baseline source"><option value="project" data-wb="baselineProject"></option><option value="run" data-wb="baselineRun"></option></select><select id="wb-baseline-image" aria-label="Run PNG" hidden></select></div><label for="wb-baseline-targets" data-wb="baselineTargets"></label><input id="wb-baseline-targets" type="text" autocomplete="off"><div class="wb-row"><button class="check-button" id="wb-baseline-preview" type="button" data-wb="baselinePreview"></button></div><p id="wb-baseline-status" role="status" aria-live="polite" class="wb-note"></p><div id="wb-baseline-results"></div></section>
  <div class="wb-import"><input id="wb-import-file" type="file" accept=".json,application/json" hidden><button class="check-button" id="wb-import" type="button" data-wb="importRun"></button><span class="wb-note" data-wb="importHint"></span></div>
  <div id="wb-history"></div><div id="wb-detail"></div>`
workspace.insertBefore(panel, document.querySelector('.stage'))
const $ = (id) => document.getElementById(id)
const t = (key) => (texts[document.documentElement.lang] ?? texts.en)[key] ?? key
export const workbenchText = t
let activeId = null, selectedId = null, parentRunId = null, detail = null, history = [], busy = false, polling = false, open = false
let detailVersion = '', videoJob = null, suiteActiveId = null, suites = []
let externalRepair = null
document.addEventListener('journey:legacy', event => {
  open = event.detail; panel.hidden = !open; toggle.setAttribute('aria-expanded', String(open)); translate()
  if (open) { trendsPanel.hydrate(); void refresh() }
})
document.addEventListener('journey:repair-draft', event => {
  const { sourceRun, confirmed } = event.detail
  $('wb-yaml').value = confirmed.yaml; $('wb-params').value = JSON.stringify(sourceRun.params ?? {}); parentRunId = sourceRun.id
  externalRepair = { digest: confirmed.digest, baselineRunId: confirmed.baselineRunId }
})
const renderShare = createSharePanel({ node, t, api, currentRunId: () => detail?.id, rerender: () => { if (detail) renderDetail(detail) } })
const trendsPanel = createTrendsPanel({ $, t, node, api, onSelectRun(id) { selectedId = id; detailVersion = ''; void refresh() } })
const retentionPanel = createRetentionPanel({ $, t, node, api, onRefresh: refresh })
const historyView = createHistoryView({ $, t, node, onSelect(id) { selectedId = id; detailVersion = ''; progress('loading'); void refresh() } })
const baselinePanel = createBaselinePanel({ $, t, node, api, currentRun: () => detail })
const repairPanel = createRepairPanel({ $, t, node, api, currentRun: () => detail, rerender: () => { if (detail) renderDetail(detail) }, onDraft(run, confirmed) {
  $('wb-yaml').value = confirmed.yaml; $('wb-params').value = JSON.stringify(run.params ?? {}); parentRunId = run.id
  acceptance.changed()
  $('wb-yaml').focus(); panel.scrollTop = 0
} })
const comparisonPanel = createComparisonPanel({ t, node, api, selectedRunId: () => selectedId, history: () => history, currentRun: () => detail, rerender: () => { if (detail) renderDetail(detail) }, showError })
const triagePanel = createTriagePanel({ api, rerender: () => { if (detail) renderDetail(detail) }, currentRunId: () => detail?.id, currentComparison: () => comparisonPanel.current() })
const investigationPanel = createInvestigationPanel({ api, history: () => history, currentRunId: () => detail?.id === selectedId ? selectedId : null, rerender: () => { if (detail) renderDetail(detail) } })
$('wb-yaml').value = samples.demo
try { $('wb-yaml').value = localStorage.getItem('mobile-mirror.flow.v1') || samples.demo } catch { /* storage optional */ }
const acceptance = createAcceptanceAssistant({ panel, editor: $('wb-yaml'), params: $('wb-params'), api,
  onDraft(yaml) { $('wb-yaml').value = yaml; $('wb-params').value = '{}'; parentRunId = null; repairPanel.clearDraft(); $('wb-yaml').dispatchEvent(new Event('input')) },
  connect() { if (open) toggle.click() },
  inspect() { if (open) toggle.click(); document.querySelector('#inspect-button').click() },
  runControl: $('wb-run'), resultControl: $('wb-detail') })
const changeAcceptance = createChangeAcceptancePanel({ panel, history: () => history })
const externalPanel = createExternalPanel({ panel })
const ocrPanel = createOcrPanel({ panel })
const matrixPanel = createMatrixPanel({ panel })
window.addEventListener('mobile-mirror:inspector-draft', event => {
  if (typeof event.detail?.yaml !== 'string' || !acceptance.receive(event.detail.yaml)) return
  document.querySelector('#inspection-live').click()
  if (!open) toggle.click()
  panel.scrollTop = 0
})
function translate() {
  toggle.textContent = t(open ? 'connect' : 'toggle')
  for (const node of panel.querySelectorAll('[data-wb]')) node.textContent = t(node.dataset.wb)
  for (const node of panel.querySelectorAll('[data-placeholder-wb]')) node.placeholder = t(node.dataset.placeholderWb)
  acceptance.render(); changeAcceptance.render(); externalPanel.render(); ocrPanel.render(); matrixPanel.render(); renderVideoJob(); renderHistory(); trendsPanel.render(); retentionPanel.render(); baselinePanel.render(); if (detail) renderDetail(detail)
}
let currentLocale = document.documentElement.lang
new MutationObserver(() => {
  if (document.documentElement.lang !== currentLocale) { currentLocale = document.documentElement.lang; translate() }
}).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
translate()
toggle.addEventListener('click', () => {
  if (document.querySelector('#journey')) { location.hash = open ? '#/devices' : '#/legacy'; return }
  open = !open; panel.hidden = !open; controls.hidden = open; toggle.setAttribute('aria-expanded', String(open)); translate()
  if (open) {
    trendsPanel.hydrate()
    void refresh()
  }
})
$('wb-sample').addEventListener('change', () => { $('wb-yaml').value = samples[$('wb-sample').value]; parentRunId = null; externalRepair = null; repairPanel.clearDraft(); acceptance.changed() })
$('wb-yaml').addEventListener('input', () => { externalRepair = null; repairPanel.clearDraft(); acceptance.changed(); try { localStorage.setItem('mobile-mirror.flow.v1', $('wb-yaml').value) } catch { /* optional */ } })
$('wb-refresh').addEventListener('click', () => void refresh())
$('wb-import').addEventListener('click', () => $('wb-import-file').click())
$('wb-import-file').addEventListener('change', async () => {
  const file = $('wb-import-file').files?.[0]
  if (!file) return
  busy = true; updateControls(); progress('importing'); showError(null)
  try {
    if (file.size > 24 * 1024 * 1024) throw new Error('Run archive request is too large')
    const archive = JSON.parse(await file.text())
    const run = await api('/api/runs/import', { archive, localEvidence: true })
    selectedId = run.id; detailVersion = ''; detail = run; renderDetail(run)
  } catch (error) { showError(error.message) }
  finally { $('wb-import-file').value = ''; busy = false; progress(''); await refresh(); updateControls() }
})
$('wb-run').addEventListener('click', async () => {
  busy = true; updateControls(); progress('starting'); showError(null)
  let recording
  try {
    const state = await api('/api/state')
    if (state.lifecycle !== 'streaming') throw new Error(t('disconnected'))
    if ($('wb-record-video').checked) recording = viewerCapture.beginRun()
    const binding = recording ? { captureId: crypto.randomUUID(), sessionId: recording.sessionId, startedAt: recording.startedAt } : undefined
    const reviewedRepair = externalRepair ?? repairPanel.draft
    const run = await api('/api/runs', { ...(binding ? { video: binding } : {}), yaml: $('wb-yaml').value, params: JSON.parse($('wb-params').value), localEvidence: true, ...(parentRunId ? { parentRunId } : {}), ...(reviewedRepair ? { repairDigest: reviewedRepair.digest, repairBaselineRunId: reviewedRepair.baselineRunId } : {}) })
    if (recording) watchRecording(run.id, binding, recording)
    repairPanel.clearDraft()
    externalRepair = null
    selectedId = activeId = run.id; detailVersion = ''; detail = run; renderDetail(run)
  } catch (error) { recording?.stop('run-start-failed'); showError(error.message) }
  finally { busy = false; updateControls(); progress(''); await refresh() }
})
$('wb-cancel').addEventListener('click', async () => {
  if (!activeId) return
  progress('cancelling'); $('wb-cancel').disabled = true
  try { await api(`/api/runs/${activeId}/cancel`, {}); await refresh() } catch (error) { showError(error.message); updateControls() }
})
async function api(path, body, signal) {
  const response = await fetch(path, body === undefined ? { signal } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || data.message || `HTTP ${response.status}`)
  return data
}
async function refresh() {
  if (polling || !open) return
  polling = true; $('wb-refresh').disabled = true
  try {
    acceptance.setDevice(await api('/api/state'))
    await refreshSuites()
    const data = await api('/api/runs'); activeId = data.activeId; history = data.runs; renderHistory()
    selectedId ??= activeId ?? history[0]?.id ?? null
    if (selectedId) {
      const requestedId = selectedId
      const run = await api(`/api/runs/${requestedId}`)
      if (selectedId === requestedId) {
        const version = JSON.stringify(run)
        detail = run
        if (version !== detailVersion) { detailVersion = version; renderDetail(run) }
      }
    }
    if (!busy) progress(activeId ? history.find((r) => r.id === activeId)?.phase ?? 'running' : '')
  } catch (error) { showError(error.message) }
  finally { polling = false; $('wb-refresh').disabled = false; updateControls() }
}
function updateControls() { $('wb-suite-run').disabled=busy||Boolean(activeId)||Boolean(suiteActiveId)||!$('wb-suite').value; $('wb-suite-cancel').disabled=!suiteActiveId||busy; $('wb-run').disabled = busy || Boolean(activeId) || Boolean(suiteActiveId) || Boolean(videoJob && videoJob.state !== 'saved'); $('wb-cancel').disabled = !activeId || busy; $('wb-import').disabled = busy }
function progress(key) { $('wb-progress').textContent = key ? t(key) : ''; $('wb-progress').classList.toggle('active', Boolean(key)) }
function showError(error) { $('wb-error').textContent = error ?? ''; $('wb-error').hidden = !error }
function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el }
function renderHistory() {
  historyView.render(history, selectedId)
}
function artifactLink(run, file, label) {
  const link = node('a', `${label ?? file.name}${file.recovered ? ` · ${t('recovered')}` : ''}${file.incomplete ? ` · ${t('incomplete')}` : ''}`)
  link.href = `/api/runs/${run.id}/artifacts/${file.name}`; link.target = '_blank'; link.rel = 'noopener'; link.title = `SHA-256: ${file.sha256}`
  if (file.contentType.startsWith('video/')) { link.download = file.name; link.removeAttribute('target'); link.textContent = t('videoDownload') }
  return link
}
function renderDetail(run) {
  baselinePanel.onRunChanged(run)
  const root = $('wb-detail')
  const scrollTop = panel.scrollTop
  const expanded = new Set([...root.querySelectorAll('.wb-step[open]')].map((el) => el.dataset.step))
  const previousPlayer = root.querySelector('.wb-video-player')
  const previousSource = previousPlayer?.getAttribute('src')
  root.replaceChildren()
  renderResultHeading(root, run, { t, node })
  root.append(node('p', `${sourceLabel(run.source)} · ${run.deviceName} · ${run.engine}`, 'wb-note'), node('code', run.id, 'wb-run-id'))
  renderResultDimensions(root, run, { t, node })
  renderProvenance(root, run, { t, node })
  triagePanel.render(root, run)
  investigationPanel.render(root, run)
  renderComparison(root, run)
  root.append(node('p', run.businessVerification === 'not-performed' ? t('scope') : `${t('business')}: ${t(run.businessVerification)} · ${t('resources')}: ${t(run.resourceCleanup)}`, 'wb-scope'))
  if (run.visualVerification !== 'not-performed') root.append(node('p', `${t('visualResult')}: ${t(run.visualVerification)}`, 'wb-scope'))
  if(run.stage && run.phase!=='finished')root.append(node('p',t(run.stage),'wb-stage'))
  if(run.aiRecovery) {
    const section=node('section',undefined,'wb-ai-recovery');section.append(node('h3',t('aiRecovery')))
    for(const attempt of run.aiRecovery.attempts) {
      section.append(node('p',`${attempt.status==='recovered' ? t('aiNavigationRecovered') : attempt.status==='rejected' ? t('aiRejected') : t('recovery-'+attempt.status)} · ${Math.max(0,Math.round((Date.parse(attempt.endedAt ?? new Date().toISOString())-Date.parse(attempt.startedAt))/1000))}s`))
      if(attempt.reason)section.append(node('p',attempt.reason,'wb-error'))
      for(const proposal of attempt.proposals)section.append(node('p',proposal.reason))
      const details=node('details');details.append(node('summary',attempt.model),node('pre',JSON.stringify(attempt,null,2)));section.append(details)
    }
    root.append(section)
  }
  if(run.suiteId)root.append(node('p',`${run.caseId} · attempt ${run.attempt}`,'wb-note'))
  for(const extension of run.extensionResults ?? []) {const item=node('details');item.append(node('summary',`${t(extension.role)} · ${extension.ref} · ${t(extension.status)}`),node('pre',JSON.stringify(extension.result ?? extension.error ?? {},null,2)));root.append(item)}
  if (run.activity) root.append(node('p', `${t('activity')} · ${run.activity.step ? `${run.activity.step}. ` : ''}${t(run.activity.phase)}`, 'wb-activity wb-note'))
  if (run.recovery) root.append(node('p', t('recovered'), 'wb-scope'))
  if (run.error) root.append(node('p', run.error, 'wb-error'))
  if (run.cleanup === 'session-retained') root.append(node('p', t('retained'), 'wb-note'))
  if (run.parentRunId) {
    const previous = node('button', t('previous'), 'text-button'); previous.type = 'button'
    previous.onclick = () => { selectedId = run.parentRunId; detailVersion = ''; void refresh() }; root.append(previous)
  }
  if (run.repair) root.append(node('p', `${t('repairLineage')}: ${run.repair.before} → ${run.repair.after} · ${run.repair.sourceRunId.slice(-8)}`, 'wb-scope'))
  if (run.share) root.append(node('p', `${t('shareNotRevalidated')} · ${t('shareReported')}: ${t(run.share.reportedVerdict)} · ${run.share.withheld.join('; ')}`, 'wb-scope'))
  const pinState = retentionPanel.isPinned(run.id)
  const pin = node('button', t(pinState ? 'retentionUnpin' : 'retentionPin'), 'text-button'); pin.type = 'button'
  pin.onclick = async () => { pin.disabled = true; pin.textContent = t('retentionPinning'); try { await retentionPanel.togglePin(run.id, !pinState); if (detail?.id === run.id) renderDetail(detail) } catch (error) { pin.textContent = error.message; pin.disabled = false } }
  root.append(pin)
  if (run.verdict === 'fail' && run.source !== 'import') repairPanel.render(root, run)
  const rerun = node('button', t('rerun'), 'check-button'); rerun.type = 'button'
  rerun.onclick = () => { $('wb-yaml').value = run.yaml; $('wb-params').value=JSON.stringify(run.params??{}); parentRunId = run.id; repairPanel.clearDraft(); acceptance.changed(); $('wb-yaml').focus(); panel.scrollTop = 0 }; root.append(rerun)
  if(run.evidence.some(file=>file.name==='plan.json')){const replay=node('button',t('replaySnapshot'),'check-button');replay.disabled=busy||Boolean(activeId)||Boolean(suiteActiveId);replay.onclick=async()=>{busy=true;updateControls();progress('starting');try{const next=await api(`/api/runs/${run.id}/replay`,{localEvidence:true});selectedId=activeId=next.id;detailVersion=''}catch(error){showError(error.message)}finally{busy=false;await refresh();updateControls()}};root.append(replay)}
  const source = node('details'); source.append(node('summary', t('flow')), node('pre', run.yaml)); root.append(source)
  if (run.phase === 'finished' && run.source !== 'import') renderShare(root, run)
  let player
  if (run.video) {
    const section = node('section', undefined, 'wb-video'); section.append(node('h3', t('videoTitle')))
    const videoStatus = node('p', t({ pending: 'videoPending', complete: 'videoComplete', partial: 'videoPartial', unavailable: 'videoUnavailable' }[run.video.status]), 'wb-note wb-video-status')
    section.append(videoStatus)
    if (run.video.status === 'partial') section.append(node('p', t(run.video.reason === 'hidden' ? 'videoHidden' : run.video.reason === 'limit' ? 'videoLimit' : 'videoStopped'), 'wb-note'))
    if (run.video.file) {
      const src = `/api/runs/${run.id}/artifacts/${run.video.file.name}`
      player = previousSource === src ? previousPlayer : node('video', undefined, 'wb-video-player')
      player.controls = true; player.preload = 'metadata'
      if (previousSource !== src) player.src = src
      player.onerror = () => { videoStatus.textContent = t('videoUnavailable'); if (!section.querySelector('.wb-error')) section.append(node('p', t('videoError'), 'wb-error')) }
      section.append(player, artifactLink(run, run.video.file), node('p', t('videoApprox'), 'wb-note'))
    }
    root.append(section)
  }
  root.append(node('h3', t('evidence')))
  for (const step of run.steps) {
    const item = node('details', undefined, 'wb-step'); item.dataset.step = String(step.index)
    item.open = expanded.has(String(step.index)) || Boolean(step.checkpointError) || step.status === 'failed' || Boolean(step.verification && step.verification.status !== 'pass')
    item.append(node('summary', `${step.index}. ${step.kind} · ${t(step.checkpointError ? 'checkpointError' : step.status)}${step.target ? ` · ${step.target}` : ''}`))
    if(step.path)item.append(node('code',`${step.path}${step.sourceLine ? ` · line ${step.sourceLine}` : ''}`))
    if (step.message || step.error) item.append(node('p', step.error ?? step.message))
    if (step.checkpointError) item.append(node('p', `${t('checkpointError')}: ${step.checkpointError}`, 'wb-error'))
    if (step.verification) item.append(node('p', step.verification.message, 'wb-note'))
    if (step.temporal) item.append(node('p', `${step.temporal.result.mode} · ${step.temporal.result.samples.length} samples · ${Math.round(step.temporal.result.elapsedMs)} ms · ${step.temporal.result.coverage} · ${step.temporal.result.reason}`, 'wb-temporal wb-note'))
    if (step.business) item.append(node('p', `${step.business.ref} · ${step.business.mode} · ${step.business.samples} samples · ${step.business.status} · ${step.business.reason}`, 'wb-business wb-note'))
    if (step.restart) item.append(node('p', `restartApp · ${step.restart.before} → ${step.restart.after ?? 'unknown'} · ${step.restart.status}`, 'wb-restart wb-note'))
    if (step.visual) item.append(node('p', `${t('visualResult')}: ${t(step.visual.status)} · ${step.visual.profile} r${step.visual.revision} · ${step.visual.message}`, step.visual.status === 'pass' ? 'wb-note' : 'wb-error'))
    if (typeof step.executionMs === 'number' || run.timings?.some((entry) => entry.step === step.index)) {
      const timing = node('div', undefined, 'wb-timing')
      timing.append(node('strong', t('timing')))
      const totals = new Map()
      if (typeof step.executionMs === 'number') totals.set('execution', step.executionMs)
      if (typeof step.waitMs === 'number') totals.set('waitTime', step.waitMs)
      if (typeof step.executorOtherMs === 'number') totals.set('executorOther', step.executorOtherMs)
      for (const entry of run.timings ?? []) if (entry.step === step.index) totals.set(entry.phase, (totals.get(entry.phase) ?? 0) + entry.durationMs)
      for (const [phase, ms] of totals) timing.append(node('p', `${t(phase)}: ${(ms / 1000).toFixed(3)} s`, 'wb-note'))
      timing.append(node('small', t('timingNote'))); item.append(timing)
    }
    if (player && run.video) {
      const offset = (Date.parse(step.startedAt) - Date.parse(run.video.startedAt)) / 1000
      const seek = node('button', `${t('videoSeek')} · ${Math.max(0, offset).toFixed(1)} s`, 'text-button'); seek.type = 'button'
      seek.disabled = offset < 0 || offset * 1000 > run.video.durationMs
      seek.onclick = () => { player.currentTime = offset; player.scrollIntoView({ block: 'nearest' }); void player.play().catch(() => {}) }
      item.append(seek)
    }
    item.append(node('small', `${step.startedAt}${step.endedAt ? ` → ${step.endedAt}` : ''}`))
    for (const file of step.evidence) {
      if (file.contentType === 'image/png' && !file.incomplete) {
        const link = artifactLink(run, file)
        const img = node('img'); img.loading = 'lazy'; img.alt = `${t('screenshot')} · ${step.index}`; img.src = link.href
        img.addEventListener('error', () => { img.replaceWith(node('p', 'Evidence unavailable / integrity check failed', 'wb-error')) })
        link.replaceChildren(img); item.append(link)
        if (file.recovered) item.append(node('small', t('recovered')))
      } else item.append(artifactLink(run, file, t('source')))
    }
    if (step.verification?.diagnostics) item.append(node('pre', JSON.stringify(step.verification.diagnostics, null, 2)))
    root.append(item)
  }
  root.append(node('p', t('integrity'), 'wb-note'))
  const links = node('div', undefined, 'wb-file-links'); for (const file of run.evidence) links.append(artifactLink(run, file)); root.append(links)
  panel.scrollTop = scrollTop
}
function sourceLabel(source) { return historyView.sourceLabel(source) }

function renderComparison(root, run) { comparisonPanel.render(root, run) }
setInterval(() => { if (open) void refresh() }, 1000)
setInterval(() => { if (open) void comparisonPanel.poll() }, 500)

function renderVideoJob() {
  if (!$('wb-video-progress')) return
  $('wb-video-progress').textContent = videoJob ? `${videoJob.id.slice(0, 8)} · ${t(videoJob.state === 'saving' ? 'videoSaving' : videoJob.state === 'failed' ? 'videoUnavailable' : videoJob.state === 'saved' ? (videoJob.result?.partial ? 'videoPartial' : 'videoComplete') : 'videoPending')}${videoJob.error ? `: ${videoJob.error}` : ''}` : ''
  $('wb-video-retry').hidden = videoJob?.state !== 'failed' || !videoJob.result?.blob
  $('wb-video-discard').hidden = videoJob?.state !== 'failed'
  document.dispatchEvent(new CustomEvent('journey:video', { detail: { id: videoJob?.id, state: videoJob?.state ?? null, text: $('wb-video-progress').textContent } }))
  updateControls()
}
$('wb-video-retry').onclick = () => { if (videoJob) void uploadRecording(videoJob) }
$('wb-video-discard').onclick = () => { videoJob = null; renderVideoJob() }
export function beginAuthoringRecording() {
  if (videoJob && videoJob.state !== 'saved') throw new Error(t('videoPending'))
  const handle = viewerCapture.beginRun(), binding = { captureId: crypto.randomUUID(), sessionId: handle.sessionId, startedAt: handle.startedAt }
  return { handle, binding, attach: id => watchRecording(id, binding, handle, true) }
}
function watchRecording(id, binding, handle, pendingPublication = false) {
  const job = { id, binding, handle, result: null, state: 'recording', error: '' }
  videoJob = job; renderVideoJob()
  void handle.done.then((result) => { job.result = result; void uploadRecording(job) })
  void (async () => {
    let publicationAttempts = pendingPublication ? 30 : 0
    while (!job.result) {
      try {
        const run = await api(`/api/runs/${id}`)
        if (run.phase === 'finished') { handle.stop('run-finished'); return }
      } catch { if (publicationAttempts-- <= 0) { handle.stop('disconnected'); return } }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  })()
}
async function uploadRecording(job) {
  if (job.state === 'saving') return
  job.state = 'saving'; job.error = ''; renderVideoJob()
  try {
    if (!job.result?.blob?.size) throw new Error(t('videoUnavailable'))
    const result = job.result
    const response = await fetch(`/api/runs/${job.id}/video`, { method: 'POST', signal: AbortSignal.timeout(45_000), headers: {
      'content-type': result.blob.type, 'x-capture-id': job.binding.captureId,
      'x-video-duration-ms': String(result.durationMs), 'x-video-reason': result.reason,
    }, body: result.blob })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
    job.state = 'saved'
    // The capture controller retains the visible local download; release our second reference.
    job.result = { partial: data.status === 'partial' }
    detailVersion = ''; await refresh()
  } catch (error) { job.state = 'failed'; job.error = error.message }
  finally { renderVideoJob() }
}
window.addEventListener('beforeunload', (event) => {
  if (videoJob && videoJob.state !== 'saved') { event.preventDefault(); event.returnValue = '' }
})

async function refreshSuites() {
  const project=await api('/api/test-project')
  const select=$('wb-suite'),selected=select.value
  select.replaceChildren(...project.suites.map(suite=>{const option=node('option',suite.name);option.value=suite.id;return option}))
  if(project.suites.some(suite=>suite.id===selected))select.value=selected
  const data=await api('/api/suites');suiteActiveId=data.activeId;suites=data.runs
  const root=$('wb-suites');root.replaceChildren()
  for(const suite of suites) {
    const item=node('details');item.open=suite.id===suiteActiveId
    item.append(node('summary',`${suite.name} · ${t(suite.source === 'agent' ? 'agentSource' : 'viewerSource')} · ${t(suite.phase)}${suite.exitCode!==undefined?` · exit ${suite.exitCode}`:''}`))
    if(suite.error)item.append(node('p',suite.error,'wb-error'))
    for(const entry of suite.cases) {
      item.append(node('p',`${entry.id} · ${t(entry.status === 'recovered' ? 'aiRecovered' : entry.status)}`))
      entry.attempts.forEach((id,index)=>{const button=node('button',`attempt ${index+1}`,'text-button');button.onclick=()=>{selectedId=id;detailVersion='';void refresh()};item.append(button)})
    }
    for(const [suffix,label] of [['','JSON'],['/junit','JUnit']]){const link=node('a',label);link.href=`/api/suites/${suite.id}${suffix}`;link.target='_blank';link.rel='noopener';item.append(link)}
    root.append(item)
  }
}
$('wb-suite-run').onclick=async()=> {
  busy=true;updateControls();progress('starting');showError(null)
  try {const suite=await api('/api/suites',{id:$('wb-suite').value,params:JSON.parse($('wb-params').value),localEvidence:true});suiteActiveId=suite.id}
  catch(error){showError(error.message)}finally{busy=false;await refresh();updateControls()}
}
$('wb-suite-cancel').onclick=async()=> {
  if(!suiteActiveId)return
  busy=true;updateControls();progress('cancelling')
  try{await api(`/api/suites/${suiteActiveId}/cancel`,{})}catch(error){showError(error.message)}finally{busy=false;await refresh();updateControls()}
}
