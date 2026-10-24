# local-mirror-viewer Specification

## Purpose
Define the loopback Viewer, its local media display and the boundaries for manual device control.

## Requirements

### Requirement: Loopback-only serving

The Viewer SHALL accept only loopback bind addresses in configuration and SHALL apply same-origin security headers, bounded JSON request bodies, and bounded continuous-media responses. Every POST endpoint that changes local state or executes host work MUST require an exact matching Origin before reading its body; media routes MUST NOT accept an arbitrary upstream URL/port, and browser requests with a missing or mismatched Origin where required, or a mismatched Referer, MUST be rejected before a device media source or host command is opened.

#### Scenario: Loading the Viewer

- **WHEN** the plugin starts with valid configuration
- **THEN** the Viewer is reachable on its loopback URL
- **AND** its API is not bound to a LAN address.

#### Scenario: Loading continuous media

- **WHEN** the current loopback Viewer requests its media stream
- **THEN** the response uses the same origin, no-store and existing CSP/nosniff/frame-denial policy
- **AND** no upstream device address, local forwarding port, Android serial, iOS UDID or machine path is exposed to the page or response metadata.

#### Scenario: Mutating request has no matching origin

- **WHEN** a POST request to start, stop, act, report media failure, check a device or connect through the assistant has a missing or mismatched Origin
- **THEN** the Viewer MUST reject it before reading the body or executing provider/host work
- **AND** the response MUST NOT disclose local configuration, device identifiers or command output.

### Requirement: Nonblocking long-action feedback

Every user-triggered Viewer action, connection-assistant operation or media startup that may exceed 300 ms SHALL immediately show action-local progress without blocking unrelated safe interaction. Assistant and media progress MUST be independent from the main mirror lifecycle and MUST NOT disable stop after the Appium session is usable.

#### Scenario: Connecting while changing the display theme

- **WHEN** a user starts a connection whose provider takes longer than 300 ms
- **THEN** the start area shows a connecting indicator immediately
- **AND** duplicate start/stop actions are disabled
- **AND** the theme control remains operable before connection completes
- **AND** the final streaming state refreshes without a manual reload.

#### Scenario: Checking a device while another control remains interactive

- **WHEN** a user starts an assistant check or guided connection that takes longer than 300 ms
- **THEN** only that assistant action SHALL show busy progress and reject its duplicate submission
- **AND** theme, current status, advanced-panel expansion and any valid stop action SHALL remain operable.

#### Scenario: Media starts after the control session

- **WHEN** the mirror is streaming and a Viewer media source takes longer than 300 ms to produce its first frame
- **THEN** the page shows media starting while retaining the compatibility frame
- **AND** theme, status, stop and safe Appium controls remain operable.

### Requirement: Preserve useful state on failure

The Viewer SHALL present actionable errors and preserve the last usable frame and last successful assistant report when a transient polling, assistant-check, media-source, parser or browser-decoder refresh fails. A low-latency media failure MUST automatically resume screenshot polling without changing a usable main session to error; an assistant refresh failure MUST mark retained diagnostic data stale rather than presenting it as current. Screenshot polling MUST keep at most one request in flight, bound each established-session polling probe to the lesser of the configured startup timeout and 5 seconds, exponentially back off repeated failures up to 10 seconds, enter degraded polling after three consecutive timeouts, and restore the configured interval immediately after a successful frame. The initial connection frame retains the full startup timeout.

On initial page load or session change, Viewer MUST render the retained compatible frame without issuing a second Appium screenshot command. When a scrcpy or WDA low-latency transport is waiting for its first painted frame and that compatible frame is already retained, Viewer MUST defer the first fresh PNG fallback probe until the 5-second media first-frame boundary. A successful media paint cancels that probe; an explicit media failure resumes polling immediately.

#### Scenario: Frame refresh fails after streaming

- **WHEN** a new polling frame request fails after at least one frame succeeded
- **THEN** the prior frame remains visible
- **AND** status exposes the refresh error
- **AND** stop or retry controls remain available.

#### Scenario: Repeated Appium screenshot timeouts

- **WHEN** PNG polling receives three consecutive session-command timeouts
- **THEN** Viewer SHALL retain the last frame, mark polling degraded and issue at most one 10-second liveness probe at a time
- **AND** status/stop and a new explicit control request SHALL remain operable without waiting behind additional Viewer-created screenshot requests

#### Scenario: A control succeeds but its visual refresh fails

- **WHEN** Appium acknowledges tap、swipe 或 back，但后续 Viewer screenshot 超时
- **THEN** control SHALL complete without synchronously waiting for that screenshot, and Viewer SHALL request visual refresh asynchronously
- **AND** the successful action MUST NOT be reported as failed or automatically retried; frame error and last-good image SHALL remain independently visible

#### Scenario: Appium server and session health differ

- **WHEN** Appium `/status` is reachable but a device-session command times out
- **THEN** Viewer SHALL expose a stable session-command-timeout code/message distinct from server-unreachable
- **AND** MUST NOT expose the session URL、session id、device id or raw driver stack

#### Scenario: Assistant refresh fails after a successful check

- **WHEN** a new assistant check fails after at least one check succeeded
- **THEN** the prior report remains visible with its original timestamp and a stale indicator
- **AND** the new stable error and retry action SHALL be shown without exposing raw host output.

#### Scenario: Continuous media fails after its first frame

- **WHEN** scrcpy H.264 or WDA MJPEG ends, becomes invalid or cannot be rendered after at least one media frame succeeded
- **THEN** the last rendered frame remains visible until a new screenshot polling frame loads
- **AND** the page shows a stable fallback reason, resumes polling within 2 seconds, and keeps action/stop controls available.

### Requirement: Viewer must select a renderer by negotiated media transport

The Viewer SHALL use a WebCodecs/canvas renderer only for a supported Android H.264 transport, a same-origin image renderer for iOS MJPEG, and the existing image polling renderer for Mock/fallback. It MUST NOT start Android media before runtime H.264 decoder support is confirmed and MUST close decoded `VideoFrame` objects after painting.

#### Scenario: Android WebCodecs is supported

- **WHEN** media state offers scrcpy H.264 and `VideoDecoder.isConfigSupported` accepts the advertised codec
- **THEN** the Viewer SHALL open the framed stream, decode config/key/delta packets and paint the current frame to canvas
- **AND** it SHALL switch away from polling only after the first frame is painted.

#### Scenario: Android WebCodecs is unsupported

- **WHEN** `VideoDecoder` is absent or the advertised H.264 config is unsupported
- **THEN** the Viewer SHALL remain on screenshot polling and explain the compatibility fallback
- **AND** it MUST NOT request the Android continuous stream or load a hidden software decoder.

### Requirement: Viewer 必须提供引导连接并保留高级入口

Viewer SHALL 默认显示一个渐进式 Android/iOS 连接助手，依次呈现平台选择、显式检查、脱敏结果、设备选择、连接方式、平台专属人工/副作用确认、外部或一次性受管 Appium 选择和连接确认。主按钮 SHALL 为“连接设备 / Connect device”，连接方式默认“查看当前画面”，另可显式选择“打开系统设置”。当 iOS profile 缺少必要签名默认值时，Viewer SHALL 要求补充受限的短期签名字段；Android MUST 展示 ADB 授权、UiAutomator2 helper APK 和 hidden API compatibility 边界，并把 scrcpy 作为可选媒体状态。现有 raw capabilities 与 sessionId 表单 SHALL 保留在默认折叠的“高级”区域，且其 start 行为和校验规则 MUST 保持兼容。

#### Scenario: 默认连接与明确选择设置

- **WHEN** 用户完成任一平台检查并直接点击“连接设备”
- **THEN** Viewer SHALL 提交对应平台 current-screen；只有用户显式选择设置时才提交旧 Settings 预设
- **AND** 页面 SHALL 说明首次自动化启动可能短暂切换画面，不承诺保留连接前的每一个前台像素

#### Scenario: 连接方式与操作状态一致

- **WHEN** 用户切换语言、检查暂时失败、切换平台或开始慢连接
- **THEN** 语言切换/检查失败 SHALL 保留当前方式；切换平台/清除 SHALL 重置为 current-screen；连接中 SHALL 禁用目标选择和重复提交并显示对应方式的进度
- **AND** 主题、状态和高级面板仍可交互；设备 `settingsAvailable=false` 时 SHALL 禁用 Settings 选项而不阻止当前画面连接

#### Scenario: iOS 首次使用且 Appium 未运行

- **WHEN** 用户完成检查，系统发现可用 Appium/XCUITest 和 iPhone，但 loopback endpoint 未启动
- **THEN** Viewer SHALL 展示“启动并连接”的明确确认项及不会自动安装/注册设备的说明
- **AND** 未确认前 MUST NOT 启动进程或创建 session

#### Scenario: Android 首次使用且 Appium 未运行

- **WHEN** 用户完成 Android 检查，系统发现 Appium/UiAutomator2、已授权设备和 Settings 目标，但 loopback endpoint 未启动
- **THEN** Viewer SHALL 展示“启动并连接”、UiAutomator2 helper APK 可能安装/更新、当前 hidden API compatibility 策略和 scrcpy 可选状态
- **AND** 用户未确认 managed 启动及 helper APK 副作用前 MUST NOT 启动进程或创建 session

#### Scenario: 使用高级 capabilities

- **WHEN** 熟悉 Appium 的用户展开高级区域并提交原有 capabilities JSON 或 sessionId
- **THEN** Viewer SHALL 继续通过既有 `/api/start` 和 MirrorService 流程连接
- **AND** 引导助手 MUST NOT 改写、回显或持久化该原始 JSON

### Requirement: Viewer 不得把连接助手变成 Agent 权限开关

连接助手 SHALL 只简化本地 Viewer 到 Appium/Android/iPhone 的连接，不得修改 `agentScreenContentPolicy`、文本输入策略、应用管理策略、MCP 工具注册、Android hidden API compatibility 默认值或 iOS provisioning 授权。页面 SHALL 显示当前 Agent 分享策略及平台兼容策略的只读摘要，并明确 Viewer 可见不等于 Agent 可见。

#### Scenario: 默认 Agent 画面策略仍为 mock-only

- **WHEN** 用户通过助手连接真实 Android 或 iPhone，而 profile 的 Agent 画面策略仍为 `mock-only`
- **THEN** Viewer SHALL 可以按现有本地策略显示设备画面
- **AND** MCP/Harness snapshot 或 structure MUST 继续按原策略拒绝真实设备内容

### Requirement: Viewer 必须提供正式本地启动与安全快速连接

包 SHALL 提供正式的 `flowassert-viewer` 命令，并让 `pnpm dev`/`pnpm start` 复用同一 runtime 组合。命令默认从仓库外的本机私有路径读取 Viewer 配置，只允许绝对 `--config` 覆盖和 loopback port 覆盖；读取配置或页面加载 MUST NOT 搜索 PATH、执行主机诊断、枚举设备或启动 Appium。公开 Viewer state 只能暴露持久化是否可用以及已保存的平台偏好，不得返回 Appium 路径、Team ID 或 bundle ID。

#### Scenario: 使用已保存配置启动 Viewer

- **WHEN** 用户运行正式 Viewer 命令且本机配置有效
- **THEN** runtime SHALL 使用保存的 validated defaults 并输出 loopback URL
- **AND** 在用户点击连接前 MUST NOT 启动 Appium、调用 ADB/Xcode 或创建 session

#### Scenario: 唯一设备可快速连接

- **WHEN** 用户点击“检查并连接”，且检查发现唯一设备、零 blocked、无需补充签名字段，并可由已保存配置确定 runtime
- **THEN** Viewer SHALL 在同一可见状态机中完成 check 后提交 connect，并依次显示 checking 与 connecting 进度
- **AND** iOS SHALL 复用已保存 WDA 默认值；Android SHALL 在按钮文案/说明中明确该次点击确认 UiAutomator2 可能安装或更新 helper APK
- **AND** 快捷连接 SHALL 固定使用对应平台 current-screen，不复用之前的 Settings 选择；检查期间用户切换平台或取消时 MUST NOT 继续自动提交连接

#### Scenario: 快速连接存在歧义

- **WHEN** 检查发现多个设备、缺少字段、runtime 无法确定、存在 blocked 项或连接失败
- **THEN** Viewer SHALL 停在完整脱敏报告，允许用户选择/修复/重试
- **AND** MUST NOT 自动选择设备、循环重试 mutation、隐藏副作用或丢弃最近一次可用结果

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

### Requirement: 检查模式必须保持既有媒体和展示控件独立

Viewer SHALL 在既有stage中集成只读Inspector，保持PNG、MJPEG和WebCodecs的媒体状态机独立运行。Inspector MUST 使用自己的contain截图表面，不修改实时renderer的cover/contain语义、媒体订阅数量、fallback状态或解码器。Fit、50%–200%缩放、语言和主题 SHALL 只重排当前检查表面，不重捕获或改变设备状态。

#### Scenario: Android或iOS视频期间进入检查

- **WHEN** 已有H.264或MJPEG可用且用户进入Inspector
- **THEN** inspection SHALL 显示独立冻结截图，原media流 SHALL 在独立表面继续更新
- **AND** 进入/退出检查 MUST 不调用media重连或改变Agent observation

#### Scenario: 检查期间媒体失败

- **WHEN** 后台连续媒体失效
- **THEN** 原Viewer路径 SHALL 保留最后画面并按原规则回退PNG，检查图/树 SHALL 保持来自原inspection
- **AND** 返回实时后 SHALL 展示当前可用live/fallback状态，不展示残留overlay

#### Scenario: 展示操作不发设备请求

- **WHEN** 用户缩放、滚动、选节点、展开树或切换语言/主题
- **THEN** Inspector SHALL 只执行本地计算与DOM更新
- **AND** 扣除既有实时轮询后新增capture/source/action/session请求计数 MUST 为零

### Requirement: 检查上下文必须只通过 Viewer 投影提供

Viewer `/api/state` SHALL 增加仅本机使用的inspectionContext，streaming时包含不透明generationToken与screenEpoch，其他状态为null；Agent MirrorState/DSH/MCP状态结果 MUST 不因此增加检查身份、节点或截图。Viewer SHALL 以该上下文丢弃跨session结果，且在state失败时不把旧检查称作当前设备状态。

#### Scenario: session被其他入口停止

- **WHEN** Agent停止session且Viewer随后收到非streaming或新的generationToken
- **THEN** Viewer SHALL 清除inspection数据与overlay，不得映射到新session
- **AND** 既有普通实时Viewer最后画面的保留规则 SHALL 不变

### Requirement: 检查静态资源必须在源码和打包入口中一致可用

共享纯查询/几何模块 SHALL 编译为固定同源browser asset。源码dev启动 MUST 自动准备该asset，发布包 MUST 包含其编译结果；Node与browser构建 MUST 不相互清除产物。server MUST 只暴露固定文件而非任意lib路径，browser bundle MUST 不含Node、DSH、MCP或Appium依赖。

#### Scenario: 干净源码与发布包打开检查

- **WHEN** 从没有旧lib产物的源码启动dev，或从临时前缀安装同次tarball启动Viewer
- **THEN** `/inspection-query.js` SHALL 成功加载且与服务端采用等价规则
- **AND** 检查 SHALL 不依赖开发机缓存、外部CDN或未打包文件
