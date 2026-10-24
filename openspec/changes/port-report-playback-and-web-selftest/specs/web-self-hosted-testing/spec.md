## ADDED Requirements

### Requirement: Web typed record boundary
系统 SHALL 使用 executionKind=web 的独立 WebTestRun 契约，复用现有 caseId/revisionId、运行目录、/api/runs 和证据地址。Web 内容仅接受 synthetic-viewer、scenarioVersion=1 及登记场景；不得填充手机 sessionId、deviceName、appId、YAML 或 XML。原生专用读取 SHALL 明确拒绝 Web。

#### Scenario: Web case starts through the existing run service
- **WHEN** 用户启用可选能力并确认启动已保存的 Web 修订
- **THEN** WorkbenchService 占用统一运行槽位并持久化类型化记录，手机运行不可同时占用该槽位
- **AND** 报告明确标识合成 Web 验收，未复核时为 inconclusive

#### Scenario: A restarts after an interrupted Web attempt
- **WHEN** 持久化 Web 运行没有 finished 终态
- **THEN** 读取恢复为 inconclusive 和 cleanup-pending，保留原租约和材料，不自动重放或杀死旧 PID

### Requirement: Pilot gated product integration
产品内 Web 自举测试 SHALL 以外部 VA-01/04/05 三场景试点为前置。三个正常场景及对应遮挡、标记错位、重试入口隐藏故障 SHALL 各有三轮可追溯尝试和实际复核。A → B 门槛 MUST 检查正常通过、故障检出、证据完整、预算/取消/缺证据保守判定及无越界副作用；不得仅根据产品自报通过进入产品集成。

#### Scenario: Pilot incomplete
- **WHEN** 三场景存在未复核、故障漏检、正常误报或缺少必需证据
- **THEN** 产品集成保持未开始，先修复并以新 attempt 复验，不静默降低门槛

#### Scenario: Pilot accepted
- **WHEN** 人工或独立检查器完成有证据的 A → B 门槛复核
- **THEN** 可开始产品内最小自举，保留门槛记录关联；八场景扩展不作为这一阶段的前置，也不得因此标为已完成

### Requirement: Isolated controller and target instances
自举 SHALL 使用控制端 A 和被测端 B 的独立进程、精确 origin、数据根目录、会话和控制凭据（若启用），并分别记录构建身份。浏览器执行器 SHALL 只操作 B；第一期执行深度 MUST 固定为 A → B。B SHALL 使用实际 Viewer 前端和合成历史数据，禁止运行/设备等写操作。

#### Scenario: Overlapping instances
- **WHEN** A/B origin 相同、目录经真实路径解析后相同或互相包含，或执行器尝试导航控制端
- **THEN** 准入或操作被拒绝，无测试动作派发，报告明确隔离失败

#### Scenario: Recursive run attempt
- **WHEN** 浏览器尝试在 B 启动运行或进一步自举
- **THEN** 服务端拒绝请求并保留副作用审计，不创建子执行，不控制手机

### Requirement: Optional typed Web execution adapter
产品 SHALL 通过默认关闭、显式启用的 Web 适配器复用既有用例修订、运行生命周期、步骤证据、历史和报告。Web 用例 SHALL 采用有版本的明确执行类型和登记的有界场景；未知类型或任意 shell/eval MUST 在动作前拒绝。手机路径 SHALL 保持原有原生执行语义，agent-browser 缺失 MUST NOT 阻断产品启动或手机流程。

#### Scenario: Browser tooling unavailable
- **WHEN** Web 工具缺失、版本不合规或目标授权不足
- **THEN** Web 启动预检失败并给出恢复说明，不自动安装、不改用手机执行器，现有手机能力不受影响

#### Scenario: Genuine product execution
- **WHEN** 用户在 A 显式启动登记的 Web 验收用例
- **THEN** A 调用适配器、记录实际步骤并提供局部进度和取消，历史导航可用，不以导入既有外部报告冒充本次执行

### Requirement: Browser specific evidence and conservative results
Web 运行 SHALL 明确保存 URL/origin、浏览器/视口/语言、步骤身份、真实截图、页面快照类型、时间、hash 和采集限制。不得虚构 appId、原生设备或 XML。总体 pass MUST 要求必需检查、证据、实际视觉复核与独立检查全部通过；未复核或不完整为 inconclusive，明确缺陷为 fail，取消遵循既有 cancelled 语义。未支持的比较/导入/分享/修复/设备健康能力 MUST 明确不适用或不支持，不回退成虚假的手机能力。

#### Scenario: Read a Web self-test report
- **WHEN** A 展示验收 B 合成历史的结果
- **THEN** 报告明确区分 Web 验收与 B 中合成手机记录，显示分项及限制；截图存在或 CLI 成功不自动得到 pass

#### Scenario: Retry after a detected defect
- **WHEN** B 的重试入口隐藏导致失败，恢复后用户显式重跑
- **THEN** 创建与原失败关联的新 attempt，保留原失败证据与结果，不覆盖或倒改前次记录

### Requirement: Owned cancellation and restart safety
自举 SHALL 登记自有 worker、浏览器、被测端及资源租约。取消 MUST 停止新命令并排空或终止自有执行后落盘，保留材料；不得关闭共享或用户进程。中断重启 MUST 保守显示 inconclusive 和清理待处理，不自动继续动作，迟到成功不得覆盖终态。

#### Scenario: Controller interrupted
- **WHEN** A 在浏览器执行中被终止并重启
- **THEN** 未完成运行不能显示通过，证据可读取，待处理资源可审查，不自动点击或递归重跑

### Requirement: Independent self-test verification
自举 SHALL 保留独立 Playwright/Vitest 门禁。测试侧检查器 SHALL 根据冻结期望、实际页面状态/请求和原始证据核对 A 的结果，不复用产品结果判定函数或以报告 pass 文本为真值。相同构建的 A/B 不得宣称已经获得独立正确性证明。

#### Scenario: False success is injected
- **WHEN** 已知故障事实与原始材料不变而 A 的报告被测试夹具改为 pass
- **THEN** 独立检查器发现结果矛盾，阻止验收通过并保留对照证据，不接受自报结论

#### Scenario: Persisted self-test evidence
- **WHEN** 最小自举成功、失败、取消或重启回看
- **THEN** 保留 A 控制页面与 B 被测页面对应的命名截图、双方身份和阶段 A 门槛引用，未完成的真实页面/真机/扩展场景保持未验
