# 连续验收、就绪操作与可执行诊断

这次按产品优先级完成前三项：首次验收路径、用例创作/维护、失败核查与关联复验。定位是“有证据、可复验的移动业务验收工作台”，不是自动根因系统，也不是新的底层设备驱动。第四项 PR 验收对象、第五项多引擎接入、第六项视觉/多设备调度不在本次范围。

## 1. 首次验收

Viewer → 测试工作台 → **首次业务验收**。依次检查/连接设备、选择 App 和预期页面文字、生成模板或从 Inspector 送入草稿、校验、明确运行、核对各结果维度、下载项目。

- 校验绑定 YAML 和参数版本；修改草稿后旧结果会标记过期，迟到响应不能重新变成“通过”。校验只是结构有效，不是设备/业务验收。
- Inspector 传递草稿不执行设备动作，替换非空编辑器须确认。运行仍使用原有留证同意、设备租约和取消机制。
- 自包含流程下载为固定路径 tar，包含原 YAML、单次串行套件、公开参数和 README。下载前明确审查，不上传、不读出项目模块或凭据。依赖已登记子流程/验证器/视觉配置的用例须使用原项目，不能伪装为自包含导出。
- “业务验证与清理能力”展示已登记名称/角色/输入形状。独立的业务夹具下载包含仓库已审查的 prepare/verify/cleanup 样例；需配置获授权测试后端、App 和本机凭据，不是开箱即用的真实业务验证。
- UI、业务、视觉、清理、证据分别核对；UI pass 不等于业务已独立验证。

## 2. 就绪定位与维护

新增语法是显式选择；旧 AppClaw `tap`/`type`/`assertVisible` 的行为不变：

```yaml
name: Public search acceptance
platform: ios
appId: com.example.testapp
---
- launchApp
- fillReady:
    target: {testId: search-input}
    text: public query
    mode: replace
    timeoutMs: 5000
- tapReady:
    target: {role: button, name: Search, within: {testId: search-panel}}
    timeoutMs: 5000
- waitFor:
    target: {testId: loading}
    state: hidden
- assertReady:
    target: {testId: search-results}
    state: visible
- done
```

`testId` 对应 Android resource-id 或 iOS accessibility name；`role` 是 Inspector 的归一化角色；`name` 对应无障碍名称，`text` 对应屏幕结构文字。组合字段精确、区分大小写匹配，`within` 限定唯一父节点的后代。不会自动选第一个重复控件。Inspector 优先推荐唯一 testId，再推荐 role+name/text，显示目标后由用户点击加入；这是当前快照候选，不承诺跨版本稳定。

点击/输入等待唯一、明确可见、已启用且正面积目标，并要求连续两次观测身份/边界不变；默认 5 秒/150 ms，最大 60 秒，轮询间隔 50–1000 ms。`fillReady` 只允许非敏感输入框，必要时点击聚焦一次，确认焦点后输入；不自动重复写操作。操作意图落盘后再次核对目标，结果未知的写入禁止后续动作。

`waitFor`/`assertReady` 支持 visible/hidden/enabled；仅 `assertReady` 计入必须执行的 UI 断言，其结果仍由归档 XML 独立复核。结构截断、敏感控件或歧义均拒绝，未知 visible/enabled 不算就绪。不存在像素级遮挡检测、动画预测或跨窗口点击保证。因 500 节点上限导致结构截断的页面需提高 App 可测试性或保留旧显式流程，不静默放宽检查。

负向断言也必须先找到唯一父级作用域；父级缺失会等待并报告 `readiness-timeout-scope-missing`，不会把进入错误页面当作“目标已隐藏”。Mock 的 XML 检查点保留父子结构，供相同的作用域规则独立复核。

主要原因码：`readiness-timeout-missing/hidden/disabled/unstable/unfocused/still-visible`、`ambiguous-target/scope`、`readiness-target-changed`、`readiness-incomplete-tree`、`sensitive-target`。取消、驱动异常、未知写入和断言不符不混为一个成功重试。

业务夹具继续采用 [HTTP 业务模板](workbench-business-template.md)：每次运行独立 prepare → UI → verify → 逆序 cleanup；每个 case/重试有独立资源，不引入共享可变 suite fixture。失败、取消和部分准备也处理已登记清理 token。修复沿用证据绑定提案、人工确认、新草稿及 parentRunId；不覆盖原 YAML/失败，不弱化断言，也不声称新语义语法已支持自动定位器修复。

## 3. 下一步核查与复验

完成运行后显式点击“生成核查计划”。共享 `WorkbenchApplication.investigation` 只读服务取得证据读租约，读取原始 manifest 并验证本机文件，生成有限的核查建议，不调用设备、模型或外部接口，不写原运行。

| 已记录现象 | 优先核查 | 不允许的推断 |
| --- | --- | --- |
| 定位目标缺失/重复/变化 | 页面/前置状态 → 定位器身份 → 可见与就绪 | 直接宣布 App 缺陷或自动改第一个控件 |
| 隐藏/禁用/移动/焦点超时 | 结构与截图就绪条件、窗口映射 | 延长等待即证明修复 |
| 类型化连接/驱动错误 | 连接、WDA/Appium、依赖时间窗 | 盲重放结果未知写入 |
| 业务不符 | 本轮 correlation ID 独立查询 | UI 提示代替业务结果 |
| 证据缺失、摘要失败、导入材料 | 恢复材料或明确本机复验 | 在材料不足时归因产品/定位器 |
| 清理失败 | 本轮 token 和残留资源 | 批删其他用例数据 |

每项标记“待执行”，附事实、证据引用及支持/反证条件；最早失败提供步骤、原始行号、路径。自由文本错误不会成为指令。最多两项本机检查并发；manifest 4 MiB、2000 步、5000 条诊断，证据总量 64 MiB、单文件 16 MiB；超限不会误报已验证。

显式选一个已完成、同 App/平台、`parentRunId` 指向原运行的复验；拒绝无关/未完成/导入运行。对比原始/有效结果及 UI/业务/视觉/清理/证据维度，标明 YAML、参数、环境、App 构建是否变化。`recovered`、材料不完整和未复验导入不是 clean pass。一次复验通过不证明因果，原失败保持不变。界面提供本地进度和取消，失败保留旧计划，切换历史不会串入另一运行的结果。

## 接口与边界

- `GET /api/workbench/acceptance/capabilities`
- `POST /api/workbench/acceptance/export`：`{yaml, params, reviewed:true}`
- `POST /api/workbench/acceptance/fixture-template`：`{reviewed:true}`
- `POST /api/workbench/investigation`：`{runId, followupRunId?}`

沿用 loopback / same-origin / 显式 mutation-origin 限制。新增服务位于共享核心；DSH/MCP 可以通过已登记用例执行新语法，未增加新的 Agent 工具或改变控制/连续视频边界。Harness 兼容契约保持 **0.2.0-rc.2**，没有修改其 agent loop。

## 验证口径

新增 readiness、acceptance、investigation 单元/集成测试与 Viewer E2E；合成矩阵覆盖正反例、歧义、延迟、取消、未知写入、业务不符、证据损坏、导入/recovered 和无关复验。工程门禁与运行截图在本次交付记录中列明。

这些测试不是诊断准确率或节省时间的实测。Android/iPhone 真实业务夹具验收、已有 60+60 独立标注语料及五名非作者研究仍未由本次软件回归完成。已有“实验”分诊标签不移除，未扩大到生产或自动根因承诺。
