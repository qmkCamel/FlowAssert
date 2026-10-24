## Purpose

给未编写用例的开发与测试人员提供一眼可理解、逐层可核对的失败摘要和证据导航，同时让命令行及不同 Agent 宿主获得同一套事实、限制和安全检查建议，避免界面或模型各自重新定义失败结论。

## ADDED Requirements

### Requirement: Progressive failure brief
Viewer SHALL 在失败运行详情提供显式分诊入口，默认展示原判定与当前有效性、处理方向、已确认事实/待核对原因、最早可检查步骤、材料缺口和下一步检查。详细事实/反证、原步骤与证据逐层展开；默认摘要不得要求用户先理解 JSON、选择一个成功基线或阅读全部日志。

#### Scenario: Non-author opens failed run
- **WHEN** 非作者打开失败记录并生成分诊
- **THEN** 同屏可区分原失败、建议处理方向和判断限制，并可从每项关键事实定位已登记证据；无材料时明确说明原因

### Requirement: Optional comparison without hidden work
用户 SHALL 可以显式选择已有比较来补充分诊；系统显示比较双方身份、范围和限制，不隐式扫描全历史或新建比较。无可用比较时只显示可选引导，不能阻塞单运行摘要；选择变化产生新版本报告而不覆盖旧分析依据。

#### Scenario: Comparison points to another run
- **WHEN** 用户或调用者提供的 comparisonId 的候选运行不是当前 targetRunId
- **THEN** 请求被拒绝并保留旧摘要，不拼接不同对象的证据

### Requirement: Action-local asynchronous UX
超过 300ms 的生成、刷新、证据加载和复核保存 SHALL 提供局部状态、防重复提交、失败保留与完成刷新；可取消的分析必须可取消。工作期间历史导航、主题或其他无关控件保持可操作，迟到响应不能覆盖新选择，生成时间/有效性检查时间不得使用渲染时间替代。

#### Scenario: Switch runs during slow analysis
- **WHEN** 用户在慢分诊任务中切换运行，旧请求稍后成功或失败
- **THEN** 当前运行不被旧结果覆盖，旧任务仍有可追踪状态，已有摘要和草稿不丢失

#### Scenario: Refresh fails
- **WHEN** 用户刷新已有报告而新分析失败或取消
- **THEN** 原报告保持可见并标出其版本/有效性，局部显示错误和重新尝试入口，不显示虚假的最近成功时间

### Requirement: Shared read-only host projection
Viewer、CLI、新 MCP/DSH 只读入口 SHALL 消费同一版本化分诊投影。既有 Diagnostic Context v1 和比较工具参数/行为保持不变。Agent 新入口只读已生成报告与受权证据元数据，不创建任务或隐式回钻原始媒体，不启动模型调用或设备会话。

#### Scenario: Host parity
- **WHEN** Viewer、CLI、MCP 和 DSH Native/PTC 读取同一报告且证据权限相同
- **THEN** 方向、事实标识、限制、原 verdict 和当前有效性一致，不因宿主或语言改变判定

### Requirement: Evidence authorization and export minimization
新分诊入口 SHALL 复用项目/运行授权与证据种类权限，默认随 Agent test control 关闭；不可因提供 reportId 绕过 App、平台、用例或证据权限。摘要使用字段白名单和有界模板，不包含自由路径、秘密参数、设备私有标识、原始错误正文或默认媒体 URL；拒绝访问必须避免泄露对象是否存在。

#### Scenario: Report known but evidence forbidden
- **WHEN** Agent 知道报告 ID 但缺少对应运行或证据权限
- **THEN** 系统拒绝或将受限分项显示 withheld，不通过分类文本、URL、ID 列表或下一步建议泄露原文；用户仍可在授权的本机界面查看

### Requirement: Independent human review
用户 SHALL 可显式保存多标签复核意见和依据，记录 reviewer alias、时间、报告 digest 与修订链；该信息与系统规则结果并列，不修改原报告/run，不进入自动判定或自动训练。Agent 不得写复核意见；人工文字默认不进入 Agent 摘要或公开分享，旧 digest 的提交必须拒绝。

#### Scenario: Reviewer disagrees with routing
- **WHEN** 用户认为系统建议方向不正确并提交新意见
- **THEN** 系统保留原建议、复核意见及各自依据，报告显示存在分歧，不伪装为系统已经验证的根因
