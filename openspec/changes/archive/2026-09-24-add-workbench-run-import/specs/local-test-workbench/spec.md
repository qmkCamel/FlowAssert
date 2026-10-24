## ADDED Requirements

### Requirement: Bounded verified run import
测试工作台 SHALL 允许用户主动选择 `mobile-mirror-run` v1 JSON 归档并导入完成态运行。系统 MUST 在持久化前校验格式、完成状态、文件名、文件数量、单文件/总大小、证据引用、字节数与 SHA-256；导入 MUST 分配新的 runId，并保留原 verdict、步骤错误和证据完整性语义。

系统 MUST 拒绝任意本机路径、未完成运行、录像、大型或不完整归档、未引用文件及哈希不匹配。失败导入不得出现在历史中，也不得控制设备。首期不兼容其他历史归档格式。

#### Scenario: Import a sanitized failed run
- **WHEN** 用户选择合规的脱敏失败归档
- **THEN** 工作台保存一个新的 imported run，历史中显示原失败结论，失败步骤默认展开并可读取通过哈希校验的截图和结构。

#### Scenario: Reject tampered or excessive archive
- **WHEN** 归档存在哈希错误、缺失/多余文件、路径型文件名、未完成 manifest 或超过任一上限
- **THEN** 导入在历史可见前失败，本次随机运行目录被清理，既有历史与设备会话不变。
