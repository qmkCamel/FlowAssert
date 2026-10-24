## ADDED Requirements

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
