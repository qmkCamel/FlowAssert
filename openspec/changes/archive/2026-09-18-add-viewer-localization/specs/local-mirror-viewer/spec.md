## ADDED Requirements

### Requirement: Viewer 必须支持完整的英文与简体中文界面

Viewer SHALL 支持 `en` 与 `zh-CN` 两个规范 locale，并通过同一翻译目录覆盖静态正文、动态生命周期、观察/控制进度、媒体状态、连接助手、策略摘要、已知错误、按钮、表单提示、页面标题、placeholder、title 和 ARIA 属性。翻译目录 MUST 具有相同 key 集；缺失翻译 MUST 回退英文，且不得向用户显示内部翻译 key、`undefined` 或空标签。产品名、协议/平台名、版本、用户输入和允许公开的稳定错误码 MAY 保持原值。

#### Scenario: 中文用户查看完整 Viewer

- **WHEN** 当前 locale 为 `zh-CN`，用户依次查看 Mock、Appium 连接助手、高级面板、运行进度、媒体回退和错误状态
- **THEN** 所有解释性界面文案、表单提示和辅助技术标签 SHALL 使用简体中文
- **AND** Android、iPhone、Appium、WDA、scrcpy、版本与稳定错误码 MAY 保持技术原值，但不得出现非预期英文句子或内部翻译 key。

#### Scenario: 英文兼容路径

- **WHEN** 当前 locale 为 `en`
- **THEN** Viewer SHALL 保持现有英文产品含义、控制名称、状态和连接流程
- **AND** 本地化实现 MUST NOT 改变现有 Viewer HTTP 或设备控制契约。

#### Scenario: 翻译缺失回退

- **WHEN** 运行时请求一个中文目录未提供但英文目录存在的展示 key
- **THEN** Viewer SHALL 显示对应英文文案
- **AND** 页面 MUST NOT 显示 key 名、`undefined`、对象字符串或空的交互标签。

### Requirement: Viewer 必须确定性选择并本地保存语言

Viewer SHALL 先读取有效的本地语言偏好，否则按浏览器首选语言选择；任一以 `zh` 开头的浏览器语言 MUST 归一为 `zh-CN`，其他或不支持的语言 MUST 回退 `en`。用户主动选择后，Viewer SHALL 只在版本化的专用 localStorage key 中保存规范 locale，并在刷新后恢复。存储读写失败 MUST 降级为当前页面内存状态，不得阻止 Viewer 启动或控制设备。

#### Scenario: 中文浏览器首次访问

- **WHEN** 没有有效的已保存偏好且浏览器首选语言包含 `zh-CN`、`zh-Hans` 或其他 `zh` 变体
- **THEN** Viewer SHALL 首次显示简体中文
- **AND** `<html lang>` SHALL 为 `zh-CN`。

#### Scenario: 已保存偏好覆盖浏览器语言

- **WHEN** 浏览器首选语言为中文但用户此前明确保存了 `en`
- **THEN** Viewer SHALL 显示英文
- **AND** 刷新后仍 SHALL 保持英文，直到用户再次选择。

#### Scenario: 不支持的浏览器语言

- **WHEN** 没有有效偏好且浏览器语言不以 `zh` 开头
- **THEN** Viewer SHALL 使用英文并设置 `<html lang="en">`。

#### Scenario: 本地存储不可用

- **WHEN** 浏览器拒绝读取或写入 localStorage
- **THEN** Viewer SHALL 继续在当前页面切换并渲染语言
- **AND** start、status、action、stop、媒体和连接助手 MUST 保持可用。

### Requirement: Viewer 语言切换必须保留运行态且不执行宿主工作

Viewer SHALL 提供始终可访问的语言选择器。切换语言 SHALL 只更新展示和 locale 偏好，不得发起 Viewer API 请求、执行 host/device command、重新创建或停止 session、消费连接助手授权、清空最后画面/报告、改变 busy/disabled 状态，或改写用户尚未提交的 session ID、capabilities、Team ID、WDA bundle ID 和确认字段。

#### Scenario: streaming 中切换语言

- **WHEN** Mock 或 Appium session 正在 streaming 且已有最后画面，用户切换语言
- **THEN** lifecycle、provider、session ownership、revision、画面、媒体 transport 和动作可用性 SHALL 保持不变
- **AND** 当前状态、元数据说明和操作标签 SHALL 立即使用新语言
- **AND** 切换本身 MUST NOT 产生 HTTP 请求。

#### Scenario: 连接检查进行中切换语言

- **WHEN** Android 或 iPhone 检查/连接超过 300 ms，页面显示局部进度时用户切换语言
- **THEN** 原操作 SHALL 继续且仍保持相同 busy/disabled 状态
- **AND** 进度标题、说明和完成后的结果 SHALL 使用新语言
- **AND** theme、advanced、status 和有效 stop 控件 SHALL 继续可用。

#### Scenario: 保留报告和未提交输入

- **WHEN** 页面已有连接助手报告、短期授权和用户尚未提交的签名或高级连接字段时切换语言
- **THEN** report、原时间戳、stale 状态、选中设备/runtime、确认状态和字段值 SHALL 保持不变
- **AND** Viewer MUST NOT 重新检查设备、消费授权或把这些值写入 locale 存储。

### Requirement: Viewer 本地化必须保持可访问性与隐私边界

Viewer SHALL 在每次语言变化时同步更新文档 `lang`、页面标题、可见标签、placeholder、title 与 ARIA accessible name。语言选择器 MUST 支持键盘操作并以当前语言说明用途，同时语言选项以其原生名称可识别。locale 持久化 MUST NOT 包含设备标识、session、capabilities、签名信息、用户输入、错误详情或画面数据；本地化 fallback MUST 延续现有脱敏边界。

#### Scenario: 辅助技术读取中文界面

- **WHEN** 用户选择简体中文并通过键盘或辅助技术浏览 Viewer
- **THEN** 文档语言、工作区/设备预览区域、主题控件、语言控件、输入和动作按钮 SHALL 提供匹配的中文 accessible name
- **AND** 焦点顺序和现有控件语义 MUST 保持可用。

#### Scenario: 检查语言持久化内容

- **WHEN** 用户在连接过设备、填写过短期签名字段或遇到 host 错误后选择语言
- **THEN** Viewer 的语言存储 SHALL 只包含 `en` 或 `zh-CN`
- **AND** DOM、控制台、截图与语言存储 MUST NOT 因本地化暴露 raw command output、路径、设备/session 标识、签名值或完整 capabilities。
