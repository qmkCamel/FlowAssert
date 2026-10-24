## Why

dev@REDACTED_REVISION 已有可信执行、Inspector 草稿、证据分诊与引用治理，但创建和分析混在窄长面板里，用户仍需理解 YAML、文件名和内部状态。需要先把已有能力连接成“创建可验证用例→执行→理解失败→审查修改→新运行复验”的连续体验，而非新增一套执行引擎。

## What Changes

- 新增按任务分区的 Viewer 导航：用例、运行记录、设备、管理；保留原设备预览和旧 API。
- 首测向导选择目标、建立可审查草稿、展示验证范围、校验准确修订版本，并在明确确认后执行；Inspector 显式交接，非空草稿不静默覆盖。
- 先审查并选择性适配 `feat/guided-mobile-acceptance@REDACTED_REVISION` 的引导、revision 校验、项目导出与 investigation 模块；该分支未进 dev，历史测试结果不作为本次集成验收。
- 新增本机用例草稿库、不可变修订与运行关联；首版只存应用自有目录，项目文件以显式下载导出，不接受任意路径写入。
- 从 Agent journal 抽取 host-neutral 持久受理组件，Agent/Viewer 分别保留授权和请求命名空间；不自动注册草稿、不开放 Agent 任意 YAML 权限，重启只恢复受理事实、不重放设备动作。
- 新增独立运行分析视图：首失败摘要、历史步骤证据联动、可信结果与验证范围、可比基线、审查修复与子运行复验。
- 长动作局部反馈、错误保留、迟到响应隔离、键盘导航和窄屏模式为交付条件。
- 完整操作录制、自然语言/PRD 生成、共享团队用例管理仅列后续方案，不在本 change 实现或默认为可用。

## Capabilities

### New Capabilities

- `workbench-authoring-journey`: 首测引导、草稿修订、Inspector 交接、校验/执行绑定、受限用例库和导出。
- `workbench-run-analysis`: 独立分析导航、事实摘要、历史证据联动、比较及受控复验、可理解与可访问的呈现。

### Modified Capabilities

无替换既有主规范要求；上述为附加体验契约，沿用 local-test-workbench、viewer-node-inspector、结果投影、引用与生命周期契约。旧用例、旧结果与宿主工具行为保持不变。

## Impact

- Viewer：workbench.js、inspector.js、结果/比较/分诊/修复/录像模块、导航与样式；新模块只负责展示和用户意图，不重做业务规则。
- Core：应用层新增受限用例库与校验 token；复用 compilePlan、WorkbenchService、Store gate、容量准入和 evidence lease。记录可选 caseId/revision 关联，不改原始 verdict。
- HTTP：同源本机 draft/case/validation API；新 authoring/run 绑定准确修订与校验身份。旧 POST /api/runs 契约不变，旧客户端不强制走向导；兼容读取器单独测试。
- Android/iOS 共用流程，mock 验证软件行为；真实设备连通、定位稳定性和用户采用指标仍需独立验收，按用户要求暂缓。
- 不新增外部模型请求、任意主机命令、默认云上传、插件容器或依赖框架。DSH/MCP 不改 agent loop、不承载连续视频。
