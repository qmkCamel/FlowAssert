## MODIFIED Requirements

### Requirement: 验收必须覆盖确定性契约、真实宿主和双平台物理设备

实现 SHALL 使用 Mock、Appium fake server、Viewer E2E、built/packed MCP、DeepSeek Harness `0.1.2-rc.1` clean profile 和 Android/iOS 物理设备分层证明 semantic actions。DSH clean profile SHALL 分别使用 Native/PTC 呈现同一九工具契约；PTC SHALL 通过宿主 `run_code` transport，不得在插件中复制 agent loop。Mock/fake server/宿主 schema 成功 MUST NOT 被报告为真机输入、真实图片模型或应用生命周期证明；真机验证 MUST 只使用用户批准的普通文本和非关键 app，并在结束时恢复/清理 session。

#### Scenario: DSH Native/PTC 完整语义动作闭环

- **WHEN** 隔离 DSH `0.1.2-rc.1` profile 在 Native 与 PTC 下执行 inspect、tap_node、re-inspect、replace、append、secure rejection、manage_app policy rejection、re-observe 和 stop
- **THEN** 两种呈现 SHALL 暴露相同九项工具和共享 parser/result 语义
- **AND** node/focus/text/app state、revision/epoch/stale、deferred image 与 cleanup SHALL 按共享模型确定性变化。

#### Scenario: Android/iOS 普通文本和应用管理真机验收边界

- **WHEN** 本次宿主升级没有重新运行某个平台的物理 semantic probe
- **THEN** 该平台 SHALL 保留最近一次真实验收状态和日期，不得因 DSH clean-profile 成功自动提升
- **AND** 新宿主适配不得改变 provider、session ownership、文本策略或 app policy。
