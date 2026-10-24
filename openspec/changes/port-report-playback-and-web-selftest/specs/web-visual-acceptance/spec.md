## ADDED Requirements

### Requirement: Isolated browser visual acceptance
视觉验收 SHALL 使用固定版本的 agent-browser 和独立浏览器会话，在获授权的精确目标范围内运行。默认 SHALL 使用只读合成夹具，不依赖用户浏览器身份或手机会话。现有访问拒绝 MUST NOT 通过新工具、代理或复制受限数据绕过。

产品自举阶段的只读约束 SHALL 作用于被测端 B；控制端 A 可通过显式授权入口管理本次 Web 验收运行及材料，但浏览器执行器 MUST NOT 操作 A。阶段准入、双方隔离与独立校验遵循 `web-self-hosted-testing`，不得把外部试点完成标为产品自举完成。

#### Scenario: Default fixture run
- **WHEN** 用户发起默认视觉验收
- **THEN** 仅启动独立合成数据和自有会话，服务端拒绝设备/运行等写操作，意外写请求被记录为失败

#### Scenario: Existing target denied
- **WHEN** 请求目标存在尚未解除的访问限制
- **THEN** 报告 blocked，保留原因且不改用其他通道访问同一目标

### Requirement: Evidence-based bounded visual scenarios
验收 SHALL 以命名场景、明确视觉检查项和状态条件执行，覆盖首屏、回放、导航、动作对照、缺图恢复、慢加载、语言/窄屏和键盘/缩放。执行 SHALL 有界、可取消，并保留失败前已有材料。

#### Scenario: Slow evidence and navigation
- **WHEN** 图像加载延迟且用户切换步骤
- **THEN** 保存加载和最终选择状态的截图，检查提示及独立导航，迟到图不得被当作当前正确画面

#### Scenario: Budget or cancellation
- **WHEN** 场景超时、超过操作预算或被取消
- **THEN** 停止后续操作，保留已有截图和日志，以 incomplete/cancelled 记录而不是通过，仅清理自有会话

### Requirement: Separate execution and visual verdicts
系统 SHALL 分别记录执行状态、确定性检查、视觉复核和基线比较。整体通过 MUST 要求必需检查和实际视觉复核均完成。CLI 成功、存在截图或没有基线 MUST NOT 被解释为视觉通过。

#### Scenario: Capture without visual review
- **WHEN** 自动流程采集了全部截图但尚无人或 Agent 按清单复核
- **THEN** visualReview 为 needs-review，整体验收保持 incomplete

#### Scenario: Pixel change or incompatible environment
- **WHEN** 图片与批准基线有差异，或环境/尺寸不兼容
- **THEN** 分别记录 changed 或 incomparable，保留证据，不自动批准新基线或直接宣称产品缺陷

### Requirement: Traceable evidence and fault calibration
验收 SHALL 保留每次独立目录、源码及环境身份、场景步骤、命名成功/失败/恢复截图和问题证据引用。原始截图 MUST 保持不变。能力声明 SHALL 基于正常对照及已知故障的重复校准，不以单次成功外推稳定性。

#### Scenario: Known defect calibration
- **WHEN** 对遮挡、溢出、重试入口隐藏和标记错位夹具做重复验收
- **THEN** 保存每轮结论及证据并报告检出/误报，未达到设计的校准门槛时不得声明可靠视觉门禁

#### Scenario: Retain and share artifacts
- **WHEN** 一次验收完成、失败或取消
- **THEN** 证据保持可追溯，本机私有材料默认不入 Git 或云端，仅经审查的合成材料可纳入共享制品
