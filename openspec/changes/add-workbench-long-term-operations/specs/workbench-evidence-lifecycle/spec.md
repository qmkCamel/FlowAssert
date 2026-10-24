## Purpose

为本机长期保存的测试证据提供人工审查的派生分享、引用保护、容量管理和可恢复清理，确保并发任务、进程中断与永久删除后仍能解释材料状态并保持执行幂等性。

## ADDED Requirements

### Requirement: Reviewed immutable sanitized exports
导出 SHALL 显式选择完成态运行和材料类别，执行本机脱敏建议、预览及确认后生成独立 v2 派生包，原件不可覆盖。默认不含录像、凭据、cleanup token、绝对路径、设备标识或幂等 journal。已知敏感测试集 MUST 无原文泄漏，但规则检测不得声称完整隐私保证。

#### Scenario: Sensitive pixels and text
- **WHEN** 用户确认遮蔽截图区域及日志/XML 字段后导出
- **THEN** PNG 像素实际替换并去元数据，文本字段移除/替换，导出字节可复验且原件保持不变

### Requirement: Derived archive provenance and bounded import
v2 包 SHALL 携带随机 shareId、派生标记、来源报告结果、未重验证状态、规则版本、材料审查列表、变换说明、新 hash 及 withheld 列表；默认不外带私有来源关联/敏感摘要。 included refs MUST 全部可解析，无多余文件、路径或录像，受 64 文件、单文件 4 MiB、总原始字节 16 MiB 及序列化请求预算约束。

#### Scenario: Correct hash but redacted assertion evidence
- **WHEN** 导入 v2 副本 hash 全部正确但原断言内容已遮蔽
- **THEN** 来源报告结论单列，当前可信判定为 inconclusive/未重验证，不用副本作为自动成功基线

#### Scenario: Oversized or broken references
- **WHEN** 导出/导入超过预算或 included 引用缺失
- **THEN** 操作失败并保留原数据，不静默删材料以假装完整

### Requirement: Reference-aware retention with durable idempotency
删除 SHALL 保护活跃 run、读/比较/导出 lease、pin、批准基线、比较报告引用和未完成受理，并在 store mutation gate 内重验计划 generation/hash/owner。证据清理 MUST 不删除 requestId 幂等 tombstone；存储不足无安全候选时阻止新任务，不能驱逐活跃证据。

#### Scenario: New reader after preview
- **WHEN** 预览后材料被读任务占用或加入基线引用
- **THEN** 确认删除时拒绝 stale plan 或受保护对象，不按旧扫描结果删除

#### Scenario: Duplicate request after cleanup
- **WHEN** 已完成运行的媒体已清理后 Agent 重发相同 requestId
- **THEN** 返回原受理/已清理状态，不再次执行设备动作

### Requirement: Recoverable deletion with explicit purge
自动清理 SHALL 默认关闭。删除需有对象/大小/保护原因预览与确认，先移入隔离 trash 并记 journal/tombstone，默认至少保留 7 天；提前彻底删除需独立确认，到期 purge 需已明确启用的政策并重验引用。未启用到期政策时不得仅因时间到期删除，材料仍在则可恢复。系统 MUST 区分 trash 占用与实际释放字节，拒绝任意目录、路径穿越和符号链接。

#### Scenario: Crash while moving to trash
- **WHEN** 移动和索引提交之间进程中断
- **THEN** 重启依据 journal 显示可恢复状态，不把缺文件当完整成功删除或破坏幂等记录

#### Scenario: Restore collides with existing identity
- **WHEN** 恢复对象与当前同 ID 数据冲突
- **THEN** 拒绝覆盖并保留两处数据，不自动改 ID 或丢失已有数据

### Requirement: Responsive lifecycle operations
扫描/预览/转换/清理 SHALL 为有界后台任务，局部进度、防重复、取消、完成刷新容量/历史/领域时间；失败保留原件和上一有效报告。取消不可逆 purge 后不得声称已回滚已删除字节。

#### Scenario: Slow export fails
- **WHEN** 导出进行中用户查看历史，随后转换失败
- **THEN** 历史可用，原运行和上一成功导出仍在，当前显示可恢复错误

### Requirement: Durable bounded share operations
预览/导出 SHALL 提供显式 opt-in 的异步任务提交、查询、取消与结果读取；原同步接口响应格式保持兼容。任务 MUST 有身份、阶段、进度和领域时间，相同请求身份及内容至多创建一个任务，内容冲突拒绝。每个证据库最多 1 个分享转换并发、2 个排队任务；排队最多 30 秒、实际处理最多 30 秒，人工审查等待不占转换计时。每包受 64 文件/单文件 4 MiB/总文件 16 MiB/序列化 24 MiB 限制，PNG 最大 4096×4096，并有可终止计算和内存预算。超限不得静默丢材料或发布不完整产物。

#### Scenario: Duplicate submission and overload
- **WHEN** 用户重复提交同一任务或已有并发/队列达到上限
- **THEN** 相同身份/内容 SHALL 返回已有任务，冲突内容或新增超额请求明确拒绝；不会重复转换或操作设备

#### Scenario: Cancel or restart before commit
- **WHEN** 转换取消、超时，或进程在产物提交前中断后重启
- **THEN** 本次产物 SHALL 不可下载，任务显示 cancelled/failed/interrupted；原运行和上一成功导出仍可读，中断任务不自动重做

#### Scenario: Cancellation during commit
- **WHEN** 用户在已开始不可分割提交时取消
- **THEN** 系统 SHALL 告知提交正在完成并以实际提交结果报告终态，不能同时报告已取消和发布新产物

### Requirement: Frozen review and atomic export publication
人工审查 SHALL 绑定来源 manifest、精确材料集合、遮蔽规则及输出 hash，有效期最多 10 分钟。任何变更或过期 MUST 重新预览。下载内容 MUST 与所审查输出一致，私有来源映射及产物提交成功后才能发布下载入口。重启后仅可恢复完整提交且 hash 可核对的产物。

#### Scenario: Mask edited after review
- **WHEN** 用户勾选确认后又修改文件选择或 mask
- **THEN** 审查确认 SHALL 失效，导出被阻止直至重新预览确认

#### Scenario: Crash between archive and mapping writes
- **WHEN** 归档与来源映射持久化之间进程中断
- **THEN** 未完成共同提交的产物 MUST NOT 可下载或显示成功，已有完整产物不受影响

### Requirement: Consistent ownership and reference publication
证据库 SHALL 只有一个可验证的写 owner；读取材料的任务 MUST 持有读 lease，引用登记和清理资格重验必须一致序列化。未知/损坏引用、无法验证的 owner 和不完整扫描 MUST 保守阻止破坏性清理。基线、分享映射、比较、套件、子运行、pin 和未完成受理均属于受保护消费者；引用解除不得隐式删除消费者事实。

#### Scenario: Owner or references change after preview
- **WHEN** owner generation 改变、进程重启或预览后新增引用/读 lease
- **THEN** 旧清理计划 SHALL 失效；重新检查前不执行移动或 purge

#### Scenario: Second process reads or deletes evidence
- **WHEN** 另一运行进程尝试绕过证据库 owner 直接接受清理任务
- **THEN** 操作 SHALL 在修改材料前拒绝，不以过期计时或 PID 单一判断夺取活动 owner

### Requirement: Write-ahead lifecycle recovery
移动、恢复和 purge SHALL 在文件变更前持久记录具体对象、身份摘要、授权和意图，再提交终态。重启 MUST 根据意图与 live/trash 实际材料共同判断；两处冲突、无材料且无有效 purge 意图、摘要不符均保持 recovery-required。跨盘移动 MUST 拒绝。批次 SHALL 逐对象返回已完成/失败/待处理，不能伪称整批回滚或全成。

#### Scenario: Move or restore interrupted after rename
- **WHEN** rename 已发生但终态提交前进程被终止
- **THEN** 重启 SHALL 校验目标身份后补记对应已移动/已恢复状态，不重复移动、覆盖原件或丢弃幂等记录

#### Scenario: Purge interrupted with remaining files
- **WHEN** purge 只删除部分登记材料后进程中断
- **THEN** 重启 SHALL 显示 purge-interrupted 和剩余材料，继续删除需新确认；不自动继续、不宣称取消已回滚字节

#### Scenario: Partial multi-run cleanup
- **WHEN** 清理多个运行时在第一个提交后取消或失败
- **THEN** 结果 SHALL 明示已移动对象可恢复及其余对象状态，不将已有提交隐藏为零操作

### Requirement: Media cleanup preserves accepted execution facts
完成运行的媒体只有在原 requestId 受理、参数身份、execution/run 身份、终态及证据可用性已独立持久保存且无其他保护时才 SHALL 可清理。媒体清理 MUST NOT 删除这些幂等事实；旧记录缺少安全转换能力时继续保护。

#### Scenario: Purged media followed by the same request
- **WHEN** 媒体 purge 后重启，再提交相同 requestId 与参数
- **THEN** 系统 SHALL 返回原受理和明确的已清理证据状态，设备调用数为零，原结果不冒充仍可完整复验

### Requirement: Bounded capacity scan and write admission
容量报告 SHALL 区分 run/trash/export/baseline/index 并报告覆盖范围。扫描超 100,000 目录项、深度 8、128 MiB 元数据读取或 30 秒时 MUST 标明未完成且不允许依据部分结果删除。新写入任务 SHALL 检查并预留已有证据预算与默认 256 MiB 安全余量；空间不足或无法确认时拒绝新写入，历史读取和容量治理入口仍可用。运行中磁盘写满仍 MUST 保留已存证据并阻止错误通过。

#### Scenario: Insufficient space with only protected evidence
- **WHEN** 空闲容量不足且所有现有材料被保护
- **THEN** 新运行/导出 SHALL 明确失败，不自动驱逐受保护证据，用户仍可读取历史并查看空间来源
