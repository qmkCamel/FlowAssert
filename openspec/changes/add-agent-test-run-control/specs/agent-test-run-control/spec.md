## Purpose

允许 Agent 经相同宿主无关契约发现并运行本机已授权测试、查询及取消执行和按需读取证据，复用原工作台判定，保证重试不会重复派发业务动作，也不会把受理成功误认为测试通过。

## ADDED Requirements

### Requirement: Registered test discovery and authorization
系统 SHALL 提供 mobile_mirror_test_catalog、mobile_mirror_run_start、mobile_mirror_run_status、mobile_mirror_run_cancel、mobile_mirror_run_evidence 五个共享工具。入口 MUST 默认禁用，启用后仅暴露本机配置允许的项目、流程、套件、平台和 App；不得接受 YAML、代码、路径或凭据作为启动参数。

#### Scenario: Project changed after discovery
- **WHEN** start 的 catalogRevision 与当前允许项目快照不同
- **THEN** 返回 project_changed，未创建新的设备动作或扩展调用

#### Scenario: Unregistered target
- **WHEN** Agent 指定未登记或未授权目标
- **THEN** 返回稳定拒绝，不读取任意路径或执行代码

### Requirement: Durable idempotent acceptance
系统 MUST 在任何执行副作用之前持久化 requestId、规范化请求、冻结计划与 executionId 到 runId/suiteId 的关联。同项目同 requestId 同参数 SHALL 返回原执行，不重复派发；不同参数 MUST 返回 request_conflict。start SHALL 返回受理状态，不等待完整测试。

#### Scenario: Lost response and repeated start
- **WHEN** 首次启动响应丢失后以同 requestId 重试
- **THEN** 返回原 executionId，可按 requestId 查询，prepare 与设备动作最多受理一次

#### Scenario: Crash after durable acceptance
- **WHEN** 受理已持久化而宿主在运行记录落盘前崩溃
- **THEN** 重启展示 interrupted/inconclusive，不自动重新执行，幂等记录保留

### Requirement: Shared execution and bounded status
同 runtime 的 Agent、Viewer 与 CLI SHALL 复用一个工作台协调器和现有运行租约；忙时新请求 MUST 拒绝而非隐式排队。状态 MUST 保留 run/suite/case/attempt、阶段、分项、verdict、exitCode 和证据校验状态，分页并限制响应大小，不在每次轮询读取全量原始材料。

#### Scenario: Recovered execution
- **WHEN** 原运行判为 recovered
- **THEN** Agent 状态保留 recovered、原失败和非零退出码，不投影为 pass

#### Scenario: Slow acceptance
- **WHEN** 用户触发的受理超过 300ms
- **THEN** 宿主和 Viewer 显示进度，保留此前结果，非冲突只读控件可用

### Requirement: Explicit cancellation and host lifetime
显式取消 SHALL 冻结后续派发并进行有界清理，重复取消或已终态取消 SHALL 返回当前状态。单次 status/evidence 查询取消 MUST NOT 取消测试；受理后的 start 调用取消、MCP transport 关闭或 DSH 插件销毁 MUST 请求取消所属运行。进程强杀后 MUST NOT 自动续跑或宣称回滚。

#### Scenario: Cancel during nested execution
- **WHEN** 已受理测试执行中被取消
- **THEN** 后续叶子和后续 case 不执行，保留在途动作事实与清理结果，终态可回查

#### Scenario: PTC call returns
- **WHEN** 启动测试的 PTC 程序正常返回而插件仍存活
- **THEN** 测试继续由工作台管理，可以后续调用查询或取消

### Requirement: Scoped evidence disclosure
证据 SHALL 默认只返回有界元数据和判定摘要；原始文本/XML、日志、历史图必须有显式本机分享授权，且校验执行归属、历史 App 范围与原件哈希。MUST NOT 返回任意路径、私有 cleanupToken、凭据或连续视频。图片 SHALL 通过宿主图片附件返回，JSON 不含二进制，并保留原件与缩放派生件的独立哈希。

#### Scenario: Corrupted evidence
- **WHEN** 读取证据发现哈希不符
- **THEN** 拒绝投递材料，持久记录证据失败，运行按现有规则变为 inconclusive，后续查询不能继续宣称干净通过

#### Scenario: Evidence from another execution
- **WHEN** 提供的 artifactId/runId 不属于指定 execution
- **THEN** 拒绝读取，不泄漏另一执行的内容

### Requirement: Host parity and bounded outputs
MCP 与 DSH Native/PTC SHALL 使用同一输入契约及领域结果；metadata JSON 最大 64 KiB、列表默认 20/最大 50、文本单项最大 16 KiB、图片单次一张且满足产品与宿主较小上限。超限 MUST 分页、标明截断或明确拒绝，不静默提供不完整成功结果。

#### Scenario: Same scenario through two adapters
- **WHEN** 相同已授权场景分别通过 MCP 与 DSH 运行
- **THEN** verdict、取消、错误分类和证据身份语义一致，只有图片投递适配不同
