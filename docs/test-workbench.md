# 本机测试工作台

第三方 App 示例中的包名与选择器已经脱敏，须按自己的应用修改后使用；默认 Mock 示例可直接运行。[历史资料说明](privacy-history-cleanup.md)区分原始真机结论与当前占位示例。

新增修复闭环为 **Preview（默认关闭）**，与原有人工定位器草稿分开：M1/M2 软件验证、M3 Mock 协议不代表真实 App 安装修复；启用、人工审批、停用和剩余门槛见[修复操作指南](https://github.com/qmkCamel/flowassert/blob/main/docs/evidence-guided-repair-operations.md)。

显式时间/持久性/业务端点与健康/性能门禁见 [runtime assertions](runtime-assertions.md)。当前真实健康来源尚未认可；工程测试或 Android 只读来源探针不等于真实信号放行。

首次使用、语义就绪步骤和失败后明确复验见[连续验收指南](guided-mobile-acceptance.md)。旧 YAML 行为不变，新增能力须显式选择。

当前开发分支还提供[变更验收对象](change-acceptance-records.md)、[外部报告导入](external-test-assets.md)、[本机区域 OCR](local-region-ocr.md)和[双槽设备矩阵](local-device-matrix.md)。六项工程实现不等于真实验收完成；逐项设备／材料／人员依赖见[验收清单](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/add-change-acceptance-records/roadmap.md)。OCR 默认生产关闭，矩阵仅本机显式登记与启动，旧单设备目标不随矩阵选槽变化。

报告目录、失败定位、历史/趋势和画框脱敏/离线HTML的完整用法见[报告阅读与分享](report-reading-and-sharing.md)。高级兼容入口仍可使用；历史验收基线以链接报告的日期和版本为准。

本机闭环：创建用例 → 校验并确认执行 → 查看归档证据 → 修订与复验。高级 YAML 和旧工作台仍可使用。

参数、子流程、条件/循环、可信代码验证及串行套件见[编排与套件指南](test-orchestration.md)。直接扩展当前 YAML，不要求版本字段。

## 第一次创建与执行用例

1. 运行 `pnpm dev`，进入“设备”连接手机，或使用 Mock 演示。设备/签名操作仍沿用现有助手；无设备也能编写和保存用例。
2. 在“用例”点击“创建第一条用例”，填写名称、平台、App ID。通过步骤类型与定位字段添加明确断言，例如 `assertVisible`，不必先写 YAML。仅动作的流程会提示没有断言，不能算完成验证。
3. 也可在“设备 → 检查屏幕”选定唯一、非敏感定位器，生成步骤，再显式追加/新建/替换到用例。取消交接保留两份草稿；旧快照、跨会话和歧义节点不能自动变成坐标点击。
4. 可展开原始 YAML 编辑高级步骤。步骤卡仅修改支持的标量字段，保留注释与未知节点；复杂循环、hook、视觉断言仍通过源码编辑，不承诺无损可视化编辑所有语法。
5. 确认 YAML/参数只包含可持久化的公开测试数据后“保存到用例库”。保存不执行、不注册 Agent 工具，也不写回项目。双窗口冲突保留当前稿，可另存副本；归档可恢复，不删除历史运行。
6. 点击“校验”，审查目标和范围。静态校验不证明 App 当前满足断言；有效期 10 分钟、重启失效，编辑输入、项目或目标变化后必须重验。
7. 明确同意保存本机原图/结构/日志后执行。录像单独勾选，复用原采集器；录到画面不等于视觉或业务验证。运行全局状态条支持查看/取消，切页面不会取消执行。

临时查看历史/设备会保留当前编辑器；打开其他用例、新建替换和载入快照前要求保存/放弃/取消，关闭网页有未保存提醒。旧 localStorage 草稿只提供显式恢复按钮，不自动迁移。受理响应未知时沿用原 requestId 查询/重试，不自动用新身份重跑设备动作。

### 分析、比较与复验

从“运行记录”或用例历史打开报告，先看首个失败、断言期望与当时材料，再检查业务/视觉等未验范围。截图缺失或损坏不会用当前手机画面补齐；派生副本不代表重新执行。目录筛选、截图回放、录像与分享的完整操作见[报告指南](report-reading-and-sharing.md)。

比较前明确选择并审查基线，同名或最近成功不保证可比。“载入快照为新草稿”与“按原快照复跑”是不同操作；复验产生关联的新运行，保留原失败，通过也不证明根因。受控定位器修复仍需审查候选并明确运行。

`#/runs/<runId>?step=2&tab=evidence` 只定位本机记录，分享需审查导出的报告。项目导出仅含固定相对路径的 flow、配置、README 和 `.gitignore`，不复制凭据、主机命令或证据；依赖外部 hook/profile/dataset 时拒绝误导性的独立包。

### 保存预算、迁移与回滚

用例保存与运行证据分别管理。预算不足时保留已有内容并明确拒绝；回滚前停止运行、正常关闭应用并保留用例、journal、manifest 与引用账本。完整限额及版本限制见[维护参考](workbench-maintenance.md#保存预算迁移与回滚)。

## 高级 YAML / 兼容入口

运行 `pnpm dev`，在 Viewer 中连接手机，点击右上角“测试工作台”。也可以先连接 Mock 演示设备，载入“演示设备”示例体验完整闭环。依赖是固定的 AppClaw 2.7.0 原生执行器，设备会话仍由 MirrorService/Appium 持有，不需要安装 AppClaw CLI。

1. 选择示例或粘贴 YAML，确认平台和已安装的 appId。第三方 App示例是 `com.example.sampleapp`，其他安装版本需替换包名。
2. 点击“运行并留证”。这会执行当前 YAML，并在本机保留页面截图、结构和日志。原有 Agent 屏幕内容政策不变。
3. 运行期间实时画面、主题、缩放和历史保持可用；手动动作和断开会话被运行租约阻止。需要中止时点击“取消运行”。
4. 查看结果，展开步骤查看原图、结构、断言诊断与时间。证据链接会验证 SHA-256。
5. 点击“载入此用例重跑”，审阅并再次运行。新记录关联旧 run，不覆盖旧结果。

截图和运行历史默认位于 `~/.local/share/mobile-mirror/runs/`。设置绝对路径环境变量 `MOBILE_MIRROR_RUNS_DIR` 可以使用独立目录。一个证据目录同时只允许一个工作台进程持有。目录可能包含账号和页面内容，仅保存在本机，请按自己的留存要求管理；工作台不自动删除运行。

### Inspector 辅助创作（Fixture样本已验，真实构建变更待补）

连接设备后点击“检查屏幕”，在冻结的结构树选中节点。候选定位器显示当前页面的匹配数与风险；选中唯一匹配项后可添加点击或可见断言，也可添加 1 秒等待。步骤进入单独的 YAML 草稿，不执行设备动作、不修改 Agent observation 或项目文件。草稿可编辑、校验、复制或下载；真正执行仍需自行审阅后在测试工作台明确运行。

当前唯一匹配不代表跨版本稳定。过期或历史快照禁止继续生成节点步骤，但已有草稿保留。敏感节点不生成候选，缺少可确认平台时也不生成。校验会区分阻断错误和维护建议：YAML 语法/header/步骤错误尽可能指向原草稿行号；固定长等待、纯文本/类型定位器只提示维护风险，不改变原 parser/plan 的执行准入。此路径有软件/伪Appium验证及双端历史Fixture创作/新修订复验；两次真实App构建变更与独立维护收益尚未验收。

### 本机趋势（开发中）

测试工作台“本机趋势”支持选择日期窗并主动统计，结果保存在可重建的本机分页索引中。统计以**完成套件中的计划用例**为分母，重试是同一用例的多个 attempt；导入副本、非计划运行、进行中套件及损坏套件单列，不拿它们填充通过率。未知构建/环境单独显示，不能据此宣称严格回归。分组可展开到 runId，再回到原证据；索引损坏时可从原归档重建，原 verdict 不变。取消或失败保留上一份可用结果。

单次默认最多 10,000 条计划用例摘要，运行清单读取预算为 128 MiB；超限会拒绝发布新结果，上一份可用索引保留，可能需要先安全归档旧数据，不能接受被截断的“完整结论”。统计规则/派生索引为 v2，旧 v1 缓存不直接作为新口径读取，可从原始归档重建；原始运行不会因此改写。分组固定项目快照、计划/输入、视觉范围及环境身份，分页固定同一索引 generation，重建期间旧页不会与新页混合。界面分别显示首次通过率和最终干净通过率，导入、派生及非计划运行分别列出。

展开“双窗口对照”可输入两组 UTC 日期（结束日不包含在窗口内）。比较仅使用同组、完整、已知环境的首次通过样本；跨 App 构建必须同时明确填写前后构建，其他计划/输入/环境口径保持一致。若填写版本 1 的绝对毫秒和相对比例预算，两个窗口各至少 30 样本才给出描述性的 `within-budget` 或 `slower-than-budget`；等于阈值不触发，零基线不伪造无穷比例。没有预算、样本不足或不可比时会分别显示状态，不改原 run verdict，也不声称统计显著性或根因。对照可取消，失败时保留上一份结果；跨窗口实际试点数据仍待收集。

### 导入脱敏运行归档

测试工作台的历史区提供“导入运行归档”。选择 `mobile-mirror-run` v1/v2，或带runtime必需功能的v3/v4 JSON 后，Viewer 会在写入前检查完成状态、文件名、文件数量、单文件/总大小、manifest 引用、字节数和 SHA-256；通过后分配新的 runId。v1/v3保留原记录有限结果；v2/v4是脱敏派生副本，原报告结果单列，当前结果强制为 `inconclusive` / `not-revalidated`，不会进入自动通过基线。导入不需要连接设备，也不会占用设备控制。

v1/v3原始归档是本机证据的便携副本，不是自动脱敏工具。导入前仍需确认其中没有账号、设备标识、业务数据或其他不应进入共享环境的内容。不读取任意本机目录、不导入录像；HTML阅读文档不能导入或复跑，未知格式/必需功能拒绝。仓库中的[脱敏失败样本](https://github.com/qmkCamel/flowassert/blob/main/tests/fixtures/workbench-runs/sampleapp-ios-history-title-missing.mobile-mirror-run.json)可用于体验和 Web 回归。

### 证据引导的失败分诊（实验入口）

已结束运行的“失败分诊（实验）”可从结构化事件和已登记证据生成检查方向；无基线也可使用，但不是自动根因。详见[证据引导的失败分诊](evidence-guided-triage.md)。

### 受控定位器修复（工程实现，真实构建变更待验）

失败记录的“证据关联的受控修复”会查找相同 YAML、同平台的成功运行，核对失败 `tap` 步骤前后的完整 XML 证据。仅旧定位器在成功记录中唯一、非敏感文本和角色锚点在新结构中仍唯一、新 ID 也唯一、旧 ID 在新结构中已失效时，才提出一个 ID/accessibilityId 替换建议。它不改断言、不扩大 App 范围、不做坐标兜底；真实功能消失或结构有歧义时显示“没有安全候选”。

建议显示原计划摘要、两份证据哈希和唯一定位器 diff。点击“确认并载入新草稿”只修改编辑器；还需再次点击“运行并留证”。运行前会重验原记录/基线的 manifest 与提案，原失败不覆盖，新 run 记录 `parentRunId` 和修复来源。编辑草稿后确认失效，须重新审查。当前只覆盖这种保守的 `tap` 身份变更，不宣称能修复断言期望或产品功能缺陷。

### 显式确定性视觉断言（工程实现，双端真机待验）

旧 YAML 不会自动执行视觉比较；仍须至少一个结构化 UI 断言。在受信的 `MOBILE_MIRROR_TEST_PROJECT` 项目文件中登记已人工批准的 PNG 参考图，例如：

```json
{
  "visualProfiles": {
    "home": {
      "rulesVersion": 1,
      "revision": 1,
      "platform": "ios",
      "appId": "com.example.mobilemirror.mock",
      "build": "mock-1",
      "theme": "any",
      "approvedBy": "your-reviewer",
      "approvedAt": "2026-09-25T00:00:00.000Z",
      "reference": "baselines/home.png",
      "referenceSha256": "填写参考图的 64 位 SHA-256",
      "channelDelta": 0,
      "maxDifferentRatio": 0,
      "regions": [{"x": 0, "y": 0, "width": 390, "height": 844}],
      "masks": []
    }
  }
}
```

`reference` 必须位于项目目录内，先由人审查并记录 revision、审批人与哈希；更换基线不会因失败自动学习。区域和 mask 使用原图像素坐标，参考图最大 4096×4096、4 MiB。若未登记 profile 或 App/平台不符，流程在动作前拒绝。YAML 在 UI 断言后添加：

```yaml
- assertVisual: {profile: home}
```

执行时复用当前设备租约和该步骤截图，不开第二个 Appium；按登记区域、mask、逐通道差异和最大差异比例作确定性比较，并留存参考图哈希及截图。尺寸/方向、App build 或主题不可比、图片缺失/损坏时为 `inconclusive`，明确超阈值为 `fail`；UI 和视觉分项独立显示。`theme: any` 是明确允许跨主题比较，`light`/`dark` 在当前无法可信观测主题的运行里会保守返回不可比。未声明仍为 `not-performed`。[OCR/语义模型实验](workbench-visual-evaluation.md)默认关闭、当前 no-go，不能把这套像素规则称作通用视觉理解。

Viewer 的“视觉基线批准”可从登记的项目参考图，或当前本机原始、首次尝试、干净成功且证据完整的运行 PNG 生成候选。先加载 profile，选择来源和图片，必要时填写逗号分隔的允许目标构建，点击“预览候选”；检查实际图片、来源、图像/规则 SHA-256、构建范围和预计 revision 后，填写本机审查人别名并勾选确认，才会保存新 revision。候选 10 分钟失效，默认只允许来源构建；跨构建需要再次显式批准。导入/派生、失败、恢复或重试通过的运行不能成为来源。批准记录不可覆盖旧 revision，已受理运行保留原快照；本机重新启动后读取最新版。来源 manifest/图片或配置规则在预览后变化时，提交失败并要求重新预览。批准不代表来源运行的业务结果已验证，也不自动修改历史 verdict。此流程已通过 Mock/浏览器自动化；真实 App 多构建及双端视觉反例仍待验。

### 安全分享与证据清理（工程实现，试点待验）

归档导入也走同一容量准入：在保存派生或原件式导入材料前预留有界空间，终态释放；磁盘余量不明时不会先写一部分再将其显示为成功。

已结束的原始运行可展开“安全分享（派生包）”，显式勾选 PNG/XML、为截图填写 `x,y,width,height` 遮蔽区域，点击预览逐张检查，再勾选人工审查并下载派生 JSON（基础运行为 v2，带 runtime 契约的运行为 v4）。新的报告“分享”页默认提供冻结审查后的被动 HTML，见[报告阅读与离线分享](report-reading-and-sharing.md)；两种格式的范围分别核对。Viewer 使用本机持久化任务：预览/导出显示阶段进度，可取消转换；提交发布期间的取消不撤回已提交包。失败保留上次预览，不自动重试或重做。PNG 在受限 worker 中替换遮蔽像素并重新编码；XML 只输出节点角色，原文字、标识和值不进入包。YAML、参数、日志、录像、设备名、session 与私有 journal 默认不导出。每包最多 64 文件、单文件 4 MiB、总原始字节 16 MiB，导入请求最多 24 MiB。导出新建随机 shareId、新 hash 和本机私有来源映射，不改原运行。未遮蔽的图片像素仍会泄漏页面内容；工具**不保证自动发现所有敏感区域**，分享前必须人工确认。

本机 API 可选择 `POST /api/workbench/share/jobs` 提交 `{kind:"share-preview"|"share-export",requestId,runId,files,...}`，返回 `202` 与 `jobId`；随后 `GET /api/workbench/share/jobs/{jobId}` 查询、`POST .../{jobId}/cancel` 取消、`GET .../{jobId}/result` 取结果。预览结果的 `reviewToken` 有效 10 分钟，导出必须附同一选择/遮蔽的 token 和 `reviewed:true`。同一 requestId 只接受同内容重试。旧 `/api/workbench/share/preview|export` 仍返回原 JSON，在后台复用同一任务队列。状态记录不含来源输入或像素；提交完整性校验失败时拒绝下载。

“本机证据容量”先刷新占用与引用，再按天数/数量生成 10 分钟有效的 dry-run 预览。容量报告分类显示运行、隔离区、分享导出、基线和派生索引，并标明完整扫描的目录项数量；100,000 项/8 层/128 MiB 元数据/30 秒任一预算超限时拒绝局部扫描结果用于清理。新运行与分享导出先预留预算和 256 MiB 安全余量，未知容量或不足时拒绝新写入，历史读取仍可用。活跃运行、读/比较/导出任务、批准基线来源、套件/比较/分享来源、未完成或旧格式 Agent 受理、子运行和 pin 会被保护；已完成且有已核验终态 journal 的单流程 Agent 媒体可成为候选，但 requestId journal 永不随媒体清理，后续 status 明确降为证据不可用。套件媒体默认受保护；只有本机显式 `POST /api/suites/<suiteId>/release-evidence` 且正文为 `{"confirm":"RELEASE SUITE <suiteId>"}` 时，系统核验每个 attempt 的完整证据并持久化独立摘要，才允许其无其他引用的媒体进入候选。此操作不删除媒体；有合法清理 journal 的历史趋势保留原分母并标为 trashed/purged，journal 缺失则降为 inconclusive。索引损坏、symlink、扫描预算耗尽或引用变化时保守拒绝。确认后再次核对 generation/hash/owner，才将候选移入隔离区。移动只改变位置，**实际释放 0 字节**；可恢复。单独输入 `PURGE <完整 runId>` 才能不可逆清除隔离区对象；purge 持久化剩余文件清单并逐文件提交，中断后不自动继续，须再次明确确认且重验剩余内容。界面区分隔离区占用与实际释放量。自动清理和自动到期 purge 默认关闭。已用隔离目录做 move/restore/purge 进程 SIGKILL 回归；真实历史仍须先审查清单和引用，不要将 Mock 回归当成真实数据安全验收。

## YAML

```yaml
name: Demo · tap and verify
platform: ios
appId: com.example.mobilemirror.mock
---
- launchApp
- assertVisible:
    text: Hello, harness.
- tap:
    accessibilityId: action-card
- assertVisible:
    text: 1 actions received
- done
```

演示中的动作计数是会话内累计的。第二次运行应调整预期计数，或断开后重新连接演示设备；重跑不会静默清空应用数据。

真机推荐稳定 accessibilityId/id，文本和关系 selector 使用 AppClaw 原生语义。至少一个结构化断言；每文件最多 100 项，组合流程最坏展开不超过 500 个叶子步骤，单个 wait/条件等待最多 60 秒，总运行最多 10 分钟。支持结构化 type（公开文字）、tap、assert、assertVisible、assertNotVisible、assertCount、waitUntil、waitUntilGone；支持 launchApp、wait、方向 swipe、back、末尾 done。自然语言步骤、模型兜底、环境文件/任意表达式、安装、未注册代码和其他未接入命令会在开始动作前拒绝。

Android 第三方 App用例见 `examples/flows/sampleapp-android.yaml`，可复制到编辑器。它按实机页面结构使用首页/精选的 accessibilityId 和 `SAMPLE_FEATURED_PAGE` 页面标记；App 版本变化后需重新检查 selector。当前硬件兼容结果见[工作台验证记录](workbench-validation.md)。

声明已知遮挡：

```yaml
name: 页面检查
platform: ios
appId: com.example.sampleapp
blockers:
  - text:
      value: 跳过
      match: contains
---
- launchApp
- wait: 5
- assertVisible:
    text: 首页
- done
```

`blockers` 在每个断言的同次取证源树上检查；命中会保留截图并停止后续步骤。它不等价于通用视觉遮挡检测。

## 结果含义

| 结果 | 含义 |
| --- | --- |
| pass | 声明的 UI 条件与所有显式必需的业务/视觉条件通过，截图/结构与用例材料完整、hash 验证通过；未声明分项仍为 not-performed |
| fail | 原生断言或步骤失败 |
| cancelled | 用户取消；在途动作已等待收敛，但已发生动作不会回滚 |
| inconclusive | 执行器中断、必需材料丢失/损坏、保存失败或未能完整验收 |
| evidence-conflict | 引擎通过，但随后检查点中的同一断言不成立 |
| evidence-contaminated | 检查点出现声明的 blocker |

未配置业务 verifier 或 `assertVisual` 时，`pass` 不包含相应业务持久化或视觉外观验收。显式登记的视觉检查仅证明其批准基线和规则范围内的确定性像素条件，不证明未知遮挡或通用语义。配置必选 verifier 后，只有 UI、业务验证、清理与必需证据均通过才可 pass；各分项独立显示。截图保留可以辅助复核，但不能单凭图片文件存在证明数据已经保存到后台。

### 运行来源与严格模式

新运行在首个业务动作前冻结版本化 provenance，每个值明确标记为 `observed`、`declared` 或 `unknown`。Mock 可稳定观测模拟 App/OS/驱动/视口；Appium 只从已有会话返回的公开白名单字段采集，不会采集完整环境变量、UDID、密钥或主机绝对路径。历史记录不会因读取而被回填或改写。

可在受信的本机 test project 配置中声明构建上下文，并选择严格要求：

```json
{
  "provenance": {
    "sourceCommit": "0123456789abcdef",
    "backendEnvironment": "staging-a",
    "testDataVersion": "fixture-2026-09",
    "resetContractVersion": "reset-v2",
    "appVersion": "REDACTED_APP_VERSION",
    "appBuild": "1079",
    "required": ["appVersion", "appBuild", "sourceCommit", "backendEnvironment", "testDataVersion"]
  }
}
```

`required` 字段缺失时，运行在取得设备运行所有权和派发任何业务动作前拒绝。声明值始终保持 `declared`，不会伪装成实际观测值。比较报告会单独列出 App 版本/构建和运行环境差异。

退出浏览器不会停止服务器中的运行。退出工作台进程会取消活动任务；进程异常退出后，未完成记录在下次启动时变成 inconclusive。运行结束显示 session-retained：保留同一个设备会话继续观看。它不是所有 WDA/转发进程已结束的证明；退出运行实例沿用已有 Appium 清理边界。

## 开发验证

仓库门禁与真机探针见[维护参考](workbench-maintenance.md#开发验证)。软件/Mock、特定 Fixture 真机样本与独立用户效果分别验收；历史记录不代表当前构建重新通过。

## P0 补强：取证进度、耗时与恢复

步骤详情现在显示执行、定位/读树、坐标校验、设备动作、截图、源树、保存和复核耗时。执行包含设备调用与等待，不能把所有显示值简单相加；“等待与执行器开销”是执行减去设备阶段的差额，包含轮询、IPC 与计算。下一步会等上一检查点落盘后开始，慢取证时仍可切换主题、查看历史和取消。

PNG 与 XML 独立采集并保存。一个失败时仍保留另一个，运行不能通过；取消保留已完成材料，已派发设备操作会先收敛。主机意外退出后，重启会恢复已落盘未登记材料和可能不完整的临时文件，保留原始材料并标明“恢复材料”，结果为无法确认。恢复哈希描述现在找到的字节，不证明中断前材料完整。原有成功运行与重跑关系继续保留。

使用 managed/managed-once Appium 时，断开会核验并清理本次拥有的 Appium/WDA 进程；失败保留可重试的 owner。external/attached 的进程仍由外部 owner 管理。运行结束继续保留会话，不会为了清理而打断实时观看。整个宿主被 SIGKILL 后，材料可在重启时恢复，但不会自动接管遗留设备进程。

### 真机重复测量

同设备、同输入与同取证策略的重复测量参数和样本边界见[维护参考](workbench-maintenance.md#真机重复测量)。历史样本预算不是生产 SLO。

## 公开文字输入

```yaml
- type:
    into: {id: sample-text-input}
    text: '公开测试文本'
    mode: replace
```

`type` 必须使用结构化目标；默认 replace 替换，append 追加，replace 配合空字符串清空。最多 512 个 Unicode 字符、4 KiB，禁止控制字符和秘密插值。它使用当前会话的 provider 输入，重新检查目标唯一性、可编辑、可见、启用、非敏感与焦点；失败会停止，不回退到独立 ADB。YAML、截图及结构会保存原文，因此只填写明确授权的公开测试数据。

Android/iOS append 在同一次设备独占操作中读取目标现值，再写入合并值，避免重新聚焦后的选区影响。合并后的文本也受长度限制。AppClaw 的 Android `type` selector 使用短类名（如 `TextView`）；Inspector 的 `platformRole` 则保留完整类名，编写 YAML 时需转换。

第三方 App文字示例：[正例](https://github.com/qmkCamel/flowassert/blob/main/examples/flows/sampleapp-ai-text-android.yaml)、[故意失败反例](https://github.com/qmkCamel/flowassert/blob/main/examples/flows/sampleapp-ai-text-negative-android.yaml)。正例从首页/精选页开始，发送一条测试消息并保留在历史中；反例在已完成的对话页运行，不重复发送。结果只证明声明的 UI 条件及历史再打开，不宣称数据库持久化或模型答案正确。

## 随测试保存录像

连接设备、看到有效画面后，在工作台勾选 **同时保存录像（无声音）**，再点击 **运行并留证**。录像在 YAML 操作前开始，测试通过、失败或取消到达终态后自动结束，并存入本机对应 run 目录。默认不勾选；手动录屏尚未结束时会提示先结束，不会把已有录屏混入测试。

历史详情的 **运行录像** 可播放、下载；展开步骤后点击 **查看步骤录像** 跳转到步骤开始附近。时间位置由同机采集和步骤时间对齐，包含媒体延迟，属于近似定位。超出部分录像范围的步骤按钮不可点击。

- **完整录像**：本次采集覆盖流程至终态，文件已归档；不表示画面无丢帧或业务一定成功。
- **部分录像**：用户提前停止、页面隐藏、断开、编码异常或录制上限；已保存能取得的片段。
- **录像不可用 / 尚未归档**：编码、上传或保存未完成。保存失败可在当前页面重试；也可放弃归档并使用工具栏保留的本页下载。

保存录像时截图、主题等独立控件保持可用；等待保存期间不启动另一条录像任务。文件最大上传 136 MiB，兼容录制达到 128 MiB 时的末尾分片；仍有 10 分钟限制。文件及 SHA-256 存放在 run 的 `recording.webm`/`recording.mp4` 与独立 `video.json` 中，服务重启后可回放。视频读取先校验哈希，损坏时显示错误。

录像是辅助证据，状态单独显示，不覆盖原有 PNG/XML、UI 断言及 verdict。关闭/崩溃前尚未归档的 Blob 可能丢失，重新启动会标明未收到录像；旧记录不会补生成视频。详细验证见[视频历史验收](workbench-video-validation.md)。
