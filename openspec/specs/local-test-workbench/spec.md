# local-test-workbench Specification

## Purpose
定义本机确定性 YAML 用例执行、逐步证据归档、结果判定和历史回看的基本行为；执行与设备控制保持明确所有权，证据不完整或业务验证未执行时不能被误报为完整通过。

## Requirements

### Requirement: Native deterministic YAML execution
工作台 SHALL 使用固定 AppClaw 原生解析器与执行器执行受支持的结构化叶子步骤；统一 YAML 上层允许类型参数、注册子流程、有界控制流和可信注册扩展，环境插值、未知命令或自然语言能力 MUST 在设备动作前拒绝。用例 MUST 包含至少一个明确断言，末尾 done 不得跳过剩余步骤。

显式 recover 包装 SHALL 使用租约内确定性导航步骤和受控候选恢复；默认关闭，不允许任意自然语言步骤，具体权限与预算遵循 bounded-ai-recovery 规格。正常固定步骤不得调用模型。
#### Scenario: Unsupported flow
- **WHEN** 用户提交自然语言、未注册代码或不支持的步骤
- **THEN** 返回可读校验错误，设备没有动作。

### Requirement: Shared session and exclusive control
运行 MUST 复用已有 MirrorService provider 与媒体，运行租约期间其他入口不得控制设备或替换会话。取消 MUST 终止 worker 并排空在途操作后释放租约。
#### Scenario: Watch and cancel
- **WHEN** 慢步骤运行中用户观察、浏览历史或取消
- **THEN** Viewer 和历史保持可交互，取消有进度，旧 worker 不再发出后续动作，原有会话保留。

### Requirement: Durable evidence and scoped verdict
系统 SHALL 保存 YAML、引擎版本、会话信息、步骤时序、原始截图与页面树以及 SHA-256。最终 pass MUST 要求所有步骤与声明断言通过、声明遮挡条件未命中、必需证据提交成功，并显示仅验证声明 UI 条件的范围。

实际发生有限 AI 恢复的运行 MUST 保留原 failed step，只有原定断言、后续业务验证、清理及证据均通过才标 recovered；recovered 不属于 pass，不能隐藏原定位失败。
#### Scenario: Missing or conflicting evidence
- **WHEN** 引擎通过但原图缺失、检查点断言不匹配或 blocker 命中
- **THEN** 最终结果分别为 inconclusive、evidence-conflict 或 evidence-contaminated，已有证据保留。

### Requirement: Persistent history and retry lineage
系统 SHALL 在重启后恢复运行历史，将未完成记录标记 inconclusive；重跑创建新记录并保留前次关联。证据读取 MUST 防止路径穿越并验证内容 hash。
#### Scenario: Restart and retry
- **WHEN** 用户重启工作台后重跑旧用例
- **THEN** 原结果仍可查看，新结果链接旧 run，缺失或篡改证据不会作为完整证据显示。

### Requirement: Bounded verified run import
测试工作台 SHALL 允许用户主动选择 `mobile-mirror-run` v1 JSON 归档并导入完成态运行。系统 MUST 在持久化前校验格式、完成状态、文件名、文件数量、单文件/总大小、证据引用、字节数与 SHA-256；导入 MUST 分配新的 runId，并保留原 verdict、步骤错误和证据完整性语义。

系统 MUST 拒绝任意本机路径、未完成运行、录像、大型或不完整归档、未引用文件及哈希不匹配。失败导入不得出现在历史中，也不得控制设备。首期不兼容其他历史归档格式。

#### Scenario: Import a sanitized failed run
- **WHEN** 用户选择合规的脱敏失败归档
- **THEN** 工作台保存一个新的 imported run，历史中显示原失败结论，失败步骤默认展开并可读取通过哈希校验的截图和结构。

#### Scenario: Reject tampered or excessive archive
- **WHEN** 归档存在哈希错误、缺失/多余文件、路径型文件名、未完成 manifest 或超过任一上限
- **THEN** 导入在历史可见前失败，本次随机运行目录被清理，既有历史与设备会话不变。
