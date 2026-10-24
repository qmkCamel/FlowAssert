## Purpose

为移动工作台提供有明确时间范围、采样边界与证据来源的 UI 和业务断言，让持续状态、App 重启后持久性及显式重复提交的唯一性可被复验，同时保留设备所有权、取消与失败语义。

## ADDED Requirements

### Requirement: Explicit bounded temporal predicates
系统 SHALL 接受 `assertEventually` 与 `assertStable`，只包装单个受支持的结构化 UI 断言，不接受动作、任意脚本或自然语言谓词。用户 SHALL 声明正数有界时间和采样周期，系统 MUST 在设备动作前拒绝无效或无法满足采样预算的配置。旧断言语义 MUST 保持不变。

#### Scenario: Invalid predicate
- **WHEN** 用户将 tap、任意脚本或嵌套时间断言作为 predicate
- **THEN** 编译失败并定位源步骤，设备不执行动作

#### Scenario: Infeasible sample budget
- **WHEN** duration、采样周期、最大样本量或剩余运行预算无法共同满足声明窗口
- **THEN** 系统拒绝开始该窗口，不缩短窗口后返回通过

### Requirement: Eventual success before a monotonic deadline
`assertEventually` SHALL 使用单调时间，在截止时间前取得有效且成立的观测才通过。完整有效采样覆盖下始终不成立 SHALL 为 fail；采集失败、缺样、模糊目标、敏感节点或截断导致无法判定 SHALL 为 inconclusive，不作为 false 或成功。迟到结果 MUST NOT 改写结论。

#### Scenario: Delayed value becomes correct
- **WHEN** 元素属性先不符合、随后在截止时间前的有效观测中符合预期
- **THEN** 断言通过并保留成立观测、时间与采样序列

#### Scenario: Negative predicate on incomplete tree
- **WHEN** 不存在断言只得到截断的元素树或缺失的声明父范围
- **THEN** 断言不确定而非通过

#### Scenario: Late success
- **WHEN** 符合预期的读取在截止时间后才完成
- **THEN** 不将该结果作为窗口内成功，保留超时或不确定的原因

### Requirement: Stable sampled window without hidden reset
`assertStable` SHALL 从首个有效观测开始覆盖完整声明时长，首个样本及其后每个有效样本均须成立，至少两个样本且最大实际样本间隔不超过声明界限。任一有效反例 SHALL 为 fail，缺样或间隔超界 SHALL 为 inconclusive；MUST NOT 自动重新计时直至获得一段通过窗口。报告 SHALL 明确这是采样稳定性而非连续时间证明。

#### Scenario: State flickers
- **WHEN** 窗口中先成立、出现一次有效反例、随后恢复
- **THEN** 该次断言失败，不通过滚动窗口消除反例

#### Scenario: Host stalls during stable observation
- **WHEN** 宿主暂停使有效观测间隔超过配置上限
- **THEN** 标记采样缺口并返回不确定，即使首尾截图一致

### Requirement: Authorized app restart with post-restart verification
`restartApp` SHALL 只终止并启动本次授权 App，保留其数据，通过现有设备所有者串行执行并使旧观测失效。系统 MUST 验证终止和启动后的状态；动作结果不确定时 MUST 停止后续派发且不自动重试。重启成功本身 MUST NOT 作为持久性通过依据。

#### Scenario: Persistent value after restart
- **WHEN** 重启前后独立断言匹配显式预期且所需业务事实和证据完整
- **THEN** 对声明的 App 重启场景判定通过，不声称已验证设备重启或卸载重装

#### Scenario: Uncertain termination
- **WHEN** 终止请求已可能送达但响应超时
- **THEN** 不继续启动或重复终止，运行不确定且保留变更防护状态

#### Scenario: Unsupported or unauthorized restart
- **WHEN** provider 不支持所需生命周期操作或目标不在当前授权范围
- **THEN** 预检拒绝，不触碰其他 App 或重建外部会话

### Requirement: Bounded read-only business checks inside a flow
`assertBusiness` SHALL 只引用预登记、声明只读和可重复观测的 verify 扩展，固化输入、代码身份与显式预期；每个样本 SHALL 包含 expected、actual、source、查询范围与证据。默认 once SHALL 只执行一次并保留其失败；显式 eventually SHALL 仅对明确业务不匹配轮询，并遵守模块登记的 allowedModes；异常、非法输出或缺少可信来源 MUST 使结果不确定，不重试有副作用模块。步骤业务结果 MUST 与 header verify 一同聚合，任何必需业务检查失败不得被后续通过覆盖。

#### Scenario: Business count converges
- **WHEN** 针对本次关联标识的只读查询在期限内从 0 条变为预期的 1 条
- **THEN** 业务检查通过，保留查询范围及各次观测，不使用全局总数替代本次事实

#### Scenario: Verifier fails to read
- **WHEN** 查询超时、报错或输出不符合登记 schema
- **THEN** 结果不确定，迟到 pass 不生效且不自动重复写入

#### Scenario: Stable uniqueness verifier cannot be retried into success
- **WHEN** 用户对只允许 once 的业务稳定窗口 verifier 声明 eventually
- **THEN** 编译拒绝，不能通过重新开始窗口隐藏重复记录的反例

### Requirement: Explicit persistence and duplicate-submission recipes
系统 SHALL 提供前后固定预期的持久性模板及最多两次显式提交的幂等性模板；后者使用同一已声明业务键与隔离测试数据，并查询唯一性和必要业务字段。模板 MUST NOT 以第一次实际结果自动生成预期，不借用套件自动重试替代第二次提交；不支持安全测试的 App MUST 不执行该模板。

#### Scenario: Two actions create duplicate records
- **WHEN** 同一测试业务键的两次显式提交产生两条记录而预期为一条
- **THEN** 业务失败并保留两次动作及查询证据，即使两次 UI 均显示成功

#### Scenario: Retry only hides an original failure
- **WHEN** 独立套件重试第二次通过
- **THEN** 原失败保留且仍为 flaky，不被解释成幂等性验证通过

### Requirement: Evidence completeness and cancellation
时间断言 SHALL 保留源步骤、参数摘要、单调相对时间、观测身份、完整性、样本判定和可复验材料；证据缺失/损坏、会话漂移或容量未知/不足 MUST 阻止通过。取消 SHALL 终止轮询与子进程并保留已有材料，停止下一动作；宿主重启 MUST 标记中断而非自动恢复剩余窗口。至少一个 UI 断言的既有要求仍 SHALL 成立。

#### Scenario: Cancel before the next sample
- **WHEN** 用户在采样间隔取消运行
- **THEN** 不开始下一次查询或设备动作，执行有界清理，已保存样本可查看

#### Scenario: Evidence removed after execution
- **WHEN** 已报告通过的样本材料在读取时缺失或哈希不符
- **THEN** 当前可信投影降为不确定，保留原始 reported verdict 而非仍显示干净通过

### Requirement: Temporal result presentation
所有出口 SHALL 共享最终断言和运行语义，并显示采样窗口、覆盖、失败/不确定原因与证据引用。长时间运行 SHALL 遵循项目引用的 user-action-contract；等待期间可查看历史，失败保留已有结果，完成更新领域完成时间。

#### Scenario: Long stable assertion in Viewer
- **WHEN** 稳定性检查运行超过 800 ms 且用户查看历史
- **THEN** 历史交互仍可用，局部进度显示当前采样窗口，不能重复启动冲突的设备写入
