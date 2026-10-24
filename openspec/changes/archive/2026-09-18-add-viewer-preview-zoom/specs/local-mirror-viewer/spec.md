## ADDED Requirements

### Requirement: Viewer 必须提供设备整体预览缩放控制

Viewer SHALL 在设备预览工具栏提供适应窗口、缩小、当前比例和放大控制。初始模式 MUST 为适应窗口；手动倍率 MUST 采用 50%、75%、100%、125%、150%、175%、200% 的有界离散步长，且缩小/放大控件 MUST 在对应边界禁用。100% MUST 表示当前预览区的 fit 基准，而不是固定像素高度。双击非媒体设备外框 SHALL 恢复适应窗口，媒体表面 MUST NOT 消费该双击。

#### Scenario: 首次打开 Viewer

- **WHEN** 用户首次加载 Viewer 且未进行缩放操作
- **THEN** 设备外框 SHALL 使用适应窗口模式并在当前预览区完整可见
- **AND** Viewer MUST NOT 从 localStorage、profile 或设备 session 恢复缩放值。

#### Scenario: 使用离散步长缩放

- **WHEN** 用户从 100% 依次点击放大或缩小
- **THEN** 当前比例 SHALL 依次变为相邻的规定步长
- **AND** 50% 时缩小、200% 时放大 SHALL 禁用，倍率不得越界。

#### Scenario: 恢复适应窗口

- **WHEN** 用户点击适应窗口或双击设备非媒体外框
- **THEN** Viewer SHALL 立即恢复当前预览区的完整适配尺寸
- **AND** 在媒体画面内双击 MUST NOT 触发该复位。

### Requirement: 缩放必须使用真实布局几何并保留完整画面

Viewer SHALL 通过改变设备外框真实布局宽高实现缩放，MUST NOT 使用仅改变合成层的 `transform: scale()`。适应窗口尺寸 SHALL 同时受预览区可用宽度和高度约束并保持既有 phone aspect ratio。手动放大超过预览区后，预览区 SHALL 提供完整可达的内部滚动范围；舞台工具栏和设备动作栏 MUST 保持在滚动区域之外且可操作。

#### Scenario: 放大超过预览区

- **WHEN** 用户选择的手动倍率使设备外框宽度或高度超过预览区
- **THEN** 对应轴 SHALL 出现可滚动范围，并能到达设备外框的起点与终点
- **AND** toolbar、缩放控件和 Back/Test tap/Test swipe MUST NOT 被设备外框覆盖或随其滚动。

#### Scenario: 宿主窗口尺寸变化

- **WHEN** 浏览器宽度或高度变化
- **THEN** fit 基准 SHALL 按新的预览区重新计算
- **AND** 当前 fit/manual 模式与 manual 倍率 SHALL 保持不变，不得被重置为默认值。

#### Scenario: 三种媒体 renderer 随布局缩放

- **WHEN** PNG polling、WDA MJPEG 或 scrcpy WebCodecs canvas 正在显示且设备外框尺寸变化
- **THEN** 可见媒体元素的 CSS box SHALL 始终等于 `.phone-frame` 的布局 box并保持完整比例
- **AND** Android canvas MUST 在首个后续视频帧按新的布局尺寸与受限 devicePixelRatio 更新 backing store，不得拉伸比例、清空最后画面或产生持续黑帧。

### Requirement: 缩放必须与设备和运行态完全隔离

缩放、复位、预览区滚动和因窗口变化发生的 fit 重算 SHALL 只修改当前页面的展示状态。它们 MUST NOT 发起 Viewer API、Appium、宿主或设备命令，不得创建/停止 session、请求 screenshot、重启媒体、改变 observation/revision/epoch，或清空最后可用画面。session 生命周期、媒体 fallback、错误、进度和语言切换 MUST 保留当前缩放状态；页面刷新 SHALL 重置为 fit。

#### Scenario: streaming 中缩放

- **WHEN** Mock 或 Appium session 正在 streaming 且用户缩放或滚动设备预览
- **THEN** provider、session ownership、revision、最后画面、媒体 transport 和动作可用性 SHALL 保持不变
- **AND** 操作 MUST NOT 产生任何新的 Viewer API 请求或设备命令。

#### Scenario: 状态和语言更新

- **WHEN** Viewer 周期刷新状态、媒体在 live/fallback 间切换、发生可恢复错误或用户切换语言
- **THEN** 当前 fit/manual 模式、manual 倍率和有效滚动位置 SHALL 保持
- **AND** 切换语言只可更新缩放控件文案和 accessible name。

#### Scenario: 页面刷新

- **WHEN** 用户在任意手动倍率下刷新页面
- **THEN** 新页面 SHALL 回到适应窗口模式
- **AND** 浏览器持久存储、MirrorState 和任何 host profile 中 MUST NOT 出现缩放状态。

### Requirement: 缩放控制必须支持双语、键盘和辅助技术

Viewer SHALL 通过现有英文/简体中文翻译目录提供缩放 group、适应窗口、缩小、当前比例和放大控件的可见或辅助文本。所有控制 MUST 能按标准键盘顺序聚焦和激活；当前倍率 SHALL 以非打断式 live region 更新。窄屏时 toolbar MAY 换行，但缩放控制的顺序、可触达性和最小点击区域 MUST 保持，且不得造成页面横向溢出。

#### Scenario: 中文键盘操作

- **WHEN** locale 为 `zh-CN` 且用户只使用键盘浏览和操作缩放控件
- **THEN** group 与全部控件 SHALL 提供对应中文 accessible name并按适应、缩小、比例、放大的逻辑顺序到达
- **AND** 比例变化 SHALL 通过 polite live region 反映，但窗口 resize MUST NOT 产生重复高频播报。

#### Scenario: 窄屏显示

- **WHEN** Viewer 宽度不超过 520px
- **THEN** 标题、zoom group 和主题控件 SHALL 在 toolbar 内重排且保持完整可用
- **AND** 页面 body MUST NOT 因缩放工具栏产生横向滚动。
