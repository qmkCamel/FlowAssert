## MODIFIED Requirements

### Requirement: Bounded verified run import
测试工作台 SHALL 允许用户主动选择 mobile-mirror-run v1 原件式 JSON 归档或 v2 脱敏派生 JSON 包并导入完成态记录。系统 MUST 在持久化前校验格式、完成状态、文件名、文件数量、单文件/总大小、证据引用、字节数与 SHA-256；导入 MUST 分配新的 runId，并保留步骤错误和来源信息。

v1 SHALL 保持既有原 verdict 和证据完整性语义。v2 SHALL 明确 source=derived、reportedVerdict 与 verification=not-revalidated；来源报告结果不等于本机已验证通过，可信判定为 inconclusive，不能作为自动成功基线。v2 included refs 必须存在，未共享材料只能显式列为 withheld，不虚构 hash 或内容。私有来源映射不得默认进入共享包。

系统 MUST 拒绝任意本机路径、未完成运行、录像、大型或不完整归档、未引用文件及哈希不匹配。失败导入不得出现在历史中，也不得控制设备。仅支持明确 v1/v2 版本，不猜测其他历史格式。默认最多 64 文件、单文件 4 MiB、总原始文件 16 MiB，并限制 JSON 请求大小。

#### Scenario: Import a sanitized failed run
- **WHEN** 用户选择合规的 v1 脱敏失败归档
- **THEN** 工作台保存一个新的 imported run，历史中显示原失败结论，失败步骤默认展开并可读取通过哈希校验的截图和结构。

#### Scenario: Reject tampered or excessive archive
- **WHEN** 归档存在哈希错误、缺失/多余文件、路径型文件名、未完成 manifest 或超过任一上限
- **THEN** 导入在历史可见前失败，本次随机运行目录被清理，既有历史与设备会话不变。

#### Scenario: Import derived reported success
- **WHEN** v2 来源 reportedVerdict 为 pass 但材料经过脱敏转换
- **THEN** 显示来源曾报告通过且当前材料未重验证，当前可信判定 inconclusive，不升级成本机执行成功。

#### Scenario: Withheld required image
- **WHEN** v2 显式列出未共享截图且 included 文件均合规
- **THEN** 可导入为有缺口的派生记录，清楚显示 withheld 与无法确认，不伪造截图或隐去缺口。
