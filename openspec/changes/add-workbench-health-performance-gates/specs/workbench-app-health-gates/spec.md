## Purpose

让用户按指定 App、运行尝试及观察窗口声明健康门禁，并基于经过验证的崩溃或无响应事件来源作出可审计结论；区分没有违规事件、没有采集能力和采集不完整，避免无日志误判健康。

## ADDED Requirements

### Requirement: Explicit per-signal capability
健康门禁 SHALL 显式指定信号及窗口。系统 SHALL 在执行副作用前报告当前平台、provider 与版本组合支持的信号、来源和覆盖限制；必需信号不支持时 MUST 拒绝执行，不自动删除信号或改成可选。Android ANR 与 iOS hang MUST NOT 互相等同。

#### Scenario: Unsupported iOS hang source
- **WHEN** 用例要求 iOS hang 信号但当前环境没有验证过的来源
- **THEN** 预检返回 unsupported-capability，设备无动作，验收不可通过

### Requirement: Attributed observation window
健康观察 SHALL 在首个测试副作用前就绪，持续到业务验证结束及声明的尾部窗口完成；报告 SHALL 绑定 App、设备会话、run/attempt、进程世代、信号来源与窗口。窗口外旧事件和其他 App 事件 MUST NOT 被归因为本次违规；相关事件无法归因时 MUST 阻止健康通过。

#### Scenario: Stale or foreign crash
- **WHEN** 收到其他 App 或本次窗口前的崩溃事件
- **THEN** 不计为本次 App 崩溃，不把相关原始隐私日志公开到报告

#### Scenario: App process changes
- **WHEN** 测试中 App 重启导致 PID 变化
- **THEN** 系统按 App 身份与进程世代延续覆盖，不能只过滤旧 PID 后宣称无崩溃

### Requirement: No violation requires complete coverage
健康通过 SHALL 同时满足所有声明信号可用、窗口完整、来源可归因、尾部排空完成且无违规事件。有效归因的违规 SHALL 为 fail；掉线、溢出、权限丢失、迟到事件未排空、无法证明边界或 collector 故障 SHALL 为 inconclusive，且不能由空事件列表覆盖。

#### Scenario: Empty but disconnected stream
- **WHEN** 事件列表为空但采集中断
- **THEN** health 为 inconclusive，而非 pass

#### Scenario: Attributed crash during test
- **WHEN** 完整有效事件表明被测 App 在窗口内崩溃
- **THEN** health 为 fail，保留归因事实和证据引用，不因 UI 最后恢复而清除

#### Scenario: Buffered event after actions end
- **WHEN** 尾部排空阶段收到发生于声明窗口内的崩溃
- **THEN** 该事件参与最终判定，不提前发布健康通过

### Requirement: Lifecycle-aware observation without hidden suppression
正常显式 App 终止 SHALL 只在匹配本次授权生命周期操作及进程身份时被识别为预期退出。系统 MUST NOT 因出现 restart 步骤就屏蔽其附近所有健康事件；unexpected exit 本身 MUST NOT 在缺少可信事件时被描述为已确认崩溃。

#### Scenario: Crash near an expected restart
- **WHEN** 显式重启附近同时出现可归因的真实崩溃事件
- **THEN** 崩溃仍使 health 失败，不受正常终止标记豁免

### Requirement: Bounded private collector lifecycle
采集 SHALL 使用明确授权的本地能力、固定参数与有界时间/输出/队列；MUST NOT 执行用户任意 shell、清空全局日志、申请 root 或终止外部服务。原始材料 SHALL 默认本机私有，公开结果只包含安全事实及引用。取消、失败及宿主重启 SHALL 停止自有采集并保留中断事实，不自动恢复设备写入。

#### Scenario: Storage or buffer capacity exhausted
- **WHEN** 输出达上限或存储容量不足/未知
- **THEN** 停止接收并标记覆盖不完整，不丢日志后继续健康通过

#### Scenario: Collector ignores cancellation
- **WHEN** 自有采集进程未在取消预算内退出
- **THEN** 按受控回收策略处理并保留未完成状态，不释放槽位启动重叠采集或误杀外部进程
