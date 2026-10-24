## Context

当前 `workbench-engine-adapter.ts` 只是 AppClaw 感知／选择器依赖接缝；现有分享包带 `not-revalidated` 语义，但不是通用外部测试报告。第四项提供验收对象及类型化来源解析边界，本项在其后实施。动机与边界见 [proposal.md](proposal.md)。

官方资料核对日期：2026-10-01。[Maestro 报告文档](https://docs.maestro.dev/maestro-flows/workspace-management/test-reports-and-artifacts)提供 JUnit 导出以及独立附件目录；这支持先做报告接入，但不保证任意版本的扩展字段一致。Appium 是驱动生态，报告由所用客户端测试框架生成，本项不假设存在统一的“Appium XML”。

## Goals / Non-Goals

目标：用户用已有工具运行测试，显式导入报告和附件后，即可在本机验收对象中核对来源、原始结论和缺口。至少支持两种已冻结来源样本，而不是只有接口无实现。

非目标：外部 runner 执行、自动安装／版本升级、用外部报告替代独立业务验证、远程下载附件、HTML 报告脚本执行。Maestro／Mobilewright 输入或报告不等于允许启动其设备控制栈。

## Decisions

### 1. 新资产类型，而非伪造原生运行

新增 `ExternalTestAsset`，含 contractVersion、UUID、导入时间、sourceDigest、报告生成时间（可未知）、adapter ID/version、用户声明的 engine/version、测试列表、附件索引、来源声明和解析告警。测试 ID 是结构路径＋classname＋name＋出现序号，不能仅用 name 去重；报告缺少提交／App／设备时保留 unknown。

每条测试保留 `reportedStatus`，取值 pass/fail/error/skipped/unknown，本地核查仅表达“解析通过／字节摘要核验”，不等于重做测试。验证维度使用 `not-provided / reported / locally-verified` 的来源分层，首期外部执行维度只可为前两者。文件哈希一致只证明导入的字节没变，不证明外部报告真实或业务正确。

未采用映射到旧 `TestRun` 的方案，避免虚构步骤、设备 session、检查点和清理状态；原生分享包导入仍独立存在。

### 2. 可替换报告适配器

`ExternalResultAdapter` 暴露固定身份、支持格式与 `parse(bytes, context, signal)`，只接收有界字节和公开声明，不接收设备、网络、shell、store 或发布权限。内建两个实现：受限 JUnit XML 与版本化 `external-results-v1` JSON。注册表仅由宿主启动配置注入受信 adapter，不从报告解析包名、路径或下载插件，不承诺第三方代码沙箱。

JUnit 是事实标准而非一个覆盖所有 runner 的强统一 schema，因此声明支持的子集：`testsuite` 或 `testsuites` 根、受限嵌套、testcase、failure、error、skipped、time、properties 和文本输出。允许正常 XML 声明、五种预定义字符实体及合法字符引用；禁止 DOCTYPE／自定义实体声明／外部实体／其他处理指令。已有 XML 解析依赖在专用 worker 中运行。

测试状态优先级 error > failure > skipped > 无失败子节点的 reported-pass；互斥终态并存标记冲突且不通过。无法理解的结果扩展、截断、解析失败、负耗时／非有限数、零 testcase 均不能得到整体通过。suite 汇总计数只作外部声明，和实际 testcase 不一致就返回告警及不完整结论；不得填造丢失用例。

`system-out`、堆栈和 properties 原字节保留在私有报告，不直接输出给模型或 PR。严格有界的解析摘要只含安全错误码。嵌套 suite 容器不重复计数；历史重试字段无法确定含义时保留告警，不能只拿最后 pass 消除先前 fail。

### 3. 文件输入与附件协议

导入是用户显式选择的报告＋附件列表，不接收压缩归档，也不递归扫描目录。浏览器上传字节，CLI 只读命令行明确给定的常规文件；每一级路径拒绝符号链接，打开后核对文件身份，拒绝设备文件／FIFO／越界路径与读取中变化。报告中的 href、路径、XML properties 不参与自动读取。

默认预算：报告 5 MiB、XML 深度 16、1000 个测试、单字段 4096 字符；附件最多 32 个、每件 16 MiB、合计 64 MiB；解析 10 秒、worker 128 MiB；单服务最多两项导入。超限返回稳定错误并不发布半成品。文件名映射为内部 UUID，重复用户名称保留显示标签但不覆盖。

允许 PNG／JPEG／纯文本／JSON／XML 附件；HTML、SVG、脚本、视频和未知可执行格式首期不接受。图像核对真实编码、尺寸上限 4096×4096，拒绝解码炸弹；文本下载为 attachment、nosniff，页面显示用文本节点，不渲染为 HTML。附件需用户显式绑定 testcase 或整份报告，无匹配证据时显示“未关联”，不按文件名猜测。

### 4. 预览、提交和生命周期

独立 `workbench-external-assets.ts` 经应用组装；接收容量预留后把输入写入私有 staging，再解析，生成预览摘要。确认请求绑定输入摘要、adapter 版本、映射、声明和预览 token；改变附件或映射必须重新预览。

将清单、原报告、附件、摘要作为不可变目录提交，fsync 后不可覆盖发布，再更新索引；发布前任何失败不出现可用资产。幂等键相同但内容不同返回冲突；相同内容的重复确认返回同一记录。取消清理本任务暂存文件，不删除既有记录。重启未完成任务标 interrupted，不自行重复执行 adapter 或发布。

外部资产的引用不能直接冒用只接受原生 run 的 `WorkbenchReferences.publish`。建立类型化外部资产引用索引，在同一外部资产 mutation gate 下复核源摘要、写引用和清理；复用协议思想而不是伪造 run ID。第四项 SourceResolver 调用外部 pin/read/unpin；未知／损坏引用必须阻断外部资产清理。用户废弃验收对象后只撤销该对象引用，原报告删除需要单独显式操作。

### 5. 用户入口与验收对象

- POST `/api/workbench/external-assets/preview`：受限上传并返回任务 ID；GET 同任务进度；POST confirm/cancel 分别确认／取消。
- GET `/api/workbench/external-assets` 和 `/:id`：分页与安全摘要；`/:id/attachments/:attachmentId`：摘要复核后下载，不接受路径。
- CLI `external-results preview/import/show`：import 可用明确确认参数完成同一流程，不隐藏预览告警；任何凭据和环境变量不写入默认报告。
- 新增只读 `mobile_external_result_get`，DSH/MCP 共用应用服务；Agent 不能让报告触发设备控制或任意本机文件读取。

验收对象把材料标为 external-result，展示外部 reported-pass、来源缺失和五维 not-provided；严格覆盖始终未满足，除非另外关联同场景／构建的本机验证运行。不能用外部 UI pass＋另一个 App 的业务 pass 拼通过。导入失败/取消仍保留旧列表和详情；进度区域不阻塞查看已存在的原生运行。

### 5.1 逐资产项目授权（用户已确认）

导入默认只在本机 Viewer/CLI 可见。另设显式授权／撤销操作，每条授权绑定资产 UUID、资产摘要、当前已登记项目身份和内容版本；项目变化后需重新审查授权。不接受报告内自称的项目权限，也不通过猜测资产 ID 获权。授权是独立可撤销记录，不改不可变报告。DSH/MCP 仅查询已授权资产的白名单状态、摘要及稳定告警，原始 testcase 名称、classname、文件名、日志和附件不进入 Agent。Viewer 授权显示项目指纹及清晰确认，不把批量导入变为批量授权。验收对象引用外部资产时，Agent 查询仍逐一核对资产授权，不能通过验收摘要绕过。

### 6. 真实兼容性样本与后续执行接缝

必须记录报告生产者、版本、生成命令、许可和采集时间；固定包含 pass/fail/error/skipped、重名、参数化、多 suite、Unicode 和缺图样本。至少验证 Maestro JUnit，以及一个实际使用 Appium 的客户端测试 runner 所生成的 JUnit；未取得真实样本时该项保持未完成。Mobilewright 只按确实拿到并验证的格式声明兼容，不据推测写兼容声明。

后续若要执行 adapter，需提供现有资产、目标平台和 owner 交接验收，再选受控 worker 与唯一设备会话方案。当前不扩展 AppClaw ABI seam 为虚假的通用执行接口，不重开 ADR 0006 的执行适配暂缓决定。

## Risks / Trade-offs

- 外部伪造 pass → 展示原报告结论而不授予本机 clean，通过门禁依据仍受控。
- 各 runner JUnit 方言不一致 → 支持列表＋固定真实样本，未知扩展告警，不全称兼容。
- 报告含敏感输出 → 原文仅本机私有存储，摘要白名单；导入授权不等于外发授权。
- 引用跨两种存储 → 分别持有 owner 与租约，先保护来源后发布验收修订，故障多保护而不漏保护。

## Migration Plan

前置第四项工程验收完成；依次完成契约／样本、解析与安全输入、持久化、验收对象关联、UI／CLI／宿主、全量门禁及真实报告验收。默认不扫描也不导入历史目录。回滚保留新资产和引用，未知版本不可用于判定通过。门禁包括四项项目命令、SIGKILL 与容量故障、宽窄屏实时交互截图、同包 DSH Native/PTC 和 MCP；未验证事项在任务中保留。
