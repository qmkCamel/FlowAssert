## Purpose

为移动端固定测试提供显式启用、有预算和动作边界的 AI 定位恢复能力，在不重放业务写入、不放宽原验收条件的前提下处理导航目标变化，并保留完整原失败、模型建议、执行及独立验证证据。

## ADDED Requirements

### Requirement: Explicit recovery eligibility
系统 SHALL 默认关闭恢复，仅接受引用可信策略且声明确定性后置断言的单个导航 tap 包装。系统 MUST 仅在目标未找到且可证明没有派发设备写入时调用模型；正常步骤成功不得调用模型。

#### Scenario: Eligible missing navigation target
- **WHEN** 显式启用步骤的导航目标未找到且动作未派发
- **THEN** 系统在策略范围内开始一次恢复并保留原失败

#### Scenario: Ineligible failures
- **WHEN** 发生业务断言失败、歧义定位、设备超时、权限拒绝、证据故障或动作派发状态未知
- **THEN** 系统不调用恢复模型且不重试设备写入

#### Scenario: Invalid configuration
- **WHEN** 包装缺少后置断言、引用未知策略或包含提交/输入等非导航动作
- **THEN** 用例在执行前被拒绝并报告具体配置错误

### Requirement: Restricted proposals and disclosure
模型 SHALL 只返回当前 observation 的允许候选 nodeId 的单个 tap 建议或弃权。系统 MUST 拒绝额外动作、代码、URL 和坐标。截图外发 MUST 获得模型端点和 App/页面范围授权，密钥不得进入证据；页面内容不得充当指令。

#### Scenario: Prompt injection or invalid proposal
- **WHEN** 页面诱导模型提交订单，或模型返回候选范围外节点
- **THEN** 系统拒绝派发并记录原因

#### Scenario: Missing model or disclosure scope
- **WHEN** 没有真实多模态模型配置或当前页面未被授权外发
- **THEN** 系统不外发截图，保留原失败并记录恢复不可用原因

#### Scenario: Suggest only
- **WHEN** 策略为 suggest 且模型提出合法建议
- **THEN** 系统归档建议但不执行设备动作，原失败不转为通过

### Requirement: Single owner and fresh actions
恢复 MUST 使用当前测试的同一设备控制所有权，在原执行段静止后开始，不重放前序动作、准备数据或已完成的循环迭代。派发前 MUST 重新观察、确定性绑定唯一目标并检查会话、App、页面变化及 15 秒新鲜度。

#### Scenario: Page or session changes
- **WHEN** 模型返回后页面或会话已变化
- **THEN** 原建议不得执行；页面变化可在预算内重新规划，会话变化必须终止恢复

#### Scenario: Unknown mutation outcome
- **WHEN** 恢复动作已派发但执行结果未知
- **THEN** 系统判定 inconclusive，封锁后续设备动作及下一用例直到控制状态重新确认

#### Scenario: System strip changes with stable App content
- **WHEN** Android 的唯一原生 App 内容容器满足全宽与窄边距约束、无可见异包节点，且仅该范围之外的系统像素变化
- **THEN** 系统 SHALL 比较该容器内的解码像素并记录范围、图片尺寸与哈希；仅当目标完整处于该范围且其他派发门禁仍通过时允许执行建议

#### Scenario: Content changes or unverifiable region
- **WHEN** 内容像素、区域、图片尺寸或源树发生变化，或无法确认可信的 Android 内容范围
- **THEN** 变化 SHALL 阻止旧建议执行；无法确认范围时 MUST 使用整屏比较；iOS MUST 使用整屏比较；原始整屏证据 MUST 保留

### Requirement: Bounded execution and cancellation
系统 SHALL 将每次 run 限制为一次恢复尝试、一个设备动作、两次模型请求、30 秒总恢复期限和每请求 10 秒；第二请求只用于执行前页面变化后的重新规划。每请求 MUST 限制为一张不超过 2 MiB 的图片、100 个候选和 1024 输出 tokens。取消或到期后 MUST 禁止新动作，丢弃迟到结果，保留独立 cleanup 期限。

#### Scenario: Late response after cancellation
- **WHEN** 取消后模型仍返回合法动作
- **THEN** 系统丢弃该建议、不派发动作并继续必要清理

#### Scenario: Budget exhausted before dispatch
- **WHEN** 无动作派发时预算耗尽
- **THEN** 系统保留原 fail 和预算终止原因，不继续调用模型

### Requirement: Independent verdict and CI behavior
系统 SHALL 在原定后置断言、后续测试、独立业务验证、cleanup 与证据核验均通过后才将实际自动恢复的运行判为 recovered。原失败 MUST 保留。recovered SHALL 与 pass 和 flaky 分开，默认 CI 退出码为 1，JUnit 为 recovered failure，套件不得因 recovered 自动重试。恢复失败为 fail；协议损坏或未知动作结果为 inconclusive；现有取消、证据异常和业务失败不得被恢复成功覆盖。

#### Scenario: Navigation recovers but business verification fails
- **WHEN** AI 导航恢复成功而独立 API 查询业务金额不符合原预期
- **THEN** 最终运行仍为 fail，不能修改预期或以图片解释替代验证

#### Scenario: Fully verified recovery
- **WHEN** 自动恢复及所有原验收、清理和证据检查通过
- **THEN** Viewer 和套件显示 recovered，保留原 failed step，并产生非零 CI 结果

### Requirement: Auditable and responsive recovery
系统 SHALL 保存原失败、动作派发事实、输入截图/结构及哈希、策略与模型版本、结构化输出、拒绝原因、动作前后观察、独立断言、清理及实际可得的耗时/用量，不保存隐式思维链。Viewer MUST 对超过 300ms 的恢复显示进度和取消入口，保留失败前可用画面且允许不冲突控件交互。

#### Scenario: Restart and inspect
- **WHEN** 重启 Viewer 并打开恢复历史
- **THEN** 能回溯原失败、建议、动作及最终验证并核验附件哈希，重新运行不会重放旧模型动作

#### Scenario: Slow model request
- **WHEN** 模型响应较慢或失败
- **THEN** 用户能看到阶段进度、查看历史并取消，最后可用画面保持可见
