## ADDED Requirements

### Requirement: 物理屏幕内容必须经过显式策略授权

插件 SHALL 以 schema-backed 的 `agentScreenContentPolicy` 控制 agent 可读取的屏幕内容，默认值 MUST 为 `mock-only`。`mock-only` SHALL 只允许 Mock 的图片与结构；`structure` SHALL 允许 Appium 的规范化结构但禁止图片；`image-and-structure` SHALL 同时允许 Appium 结构和图片。Viewer 的本机显示 MUST NOT 因该策略改变。

#### Scenario: 默认策略使用 Mock observation

- **WHEN** 用户保持默认 `mock-only` 并在 Mock session 调用截图或界面检查
- **THEN** 插件 SHALL 返回对应的 Mock observation
- **AND** 结果 SHALL 使用与 Mock Viewer 相同的 screen model、viewport 和 action revision

#### Scenario: 默认策略拒绝物理设备 observation

- **WHEN** 用户保持默认 `mock-only` 并在 Appium session 调用截图或界面检查
- **THEN** 插件 MUST 拒绝调用并返回 `screen_observation_disabled`
- **AND** MUST NOT 请求 Appium screenshot、page source、window rect 或 orientation

#### Scenario: 结构策略不允许图片

- **WHEN** 用户配置 `structure` 并在 Appium session 调用 `mobile_mirror_inspect_screen` 且未请求图片
- **THEN** 插件 SHALL 返回规范化界面结构
- **AND** 当用户调用 `mobile_mirror_snapshot` 或设置 `includeImage=true` 时 SHALL 返回 `screen_image_sharing_disabled`

#### Scenario: 图片策略披露发送与留存边界

- **WHEN** 用户配置 `image-and-structure`
- **THEN** 配置说明和使用文档 MUST 明确屏幕 PNG 会保存为 DSH attachment 并发送给所选模型 provider
- **AND** MUST 明确插件的内存 TTL 不等于 DSH attachment 的删除期限

### Requirement: Observation 必须绑定同一 session 的有界捕获窗口

每次成功感知 SHALL 发布一个不可变 observation，包含不可猜测的 `observationId`、捕获开始/结束时间、过期时间、单调递增的 `frameRevision`、`screenEpoch`、viewport、方向及所请求通道的元数据。插件 MUST 在发布前确认 session generation 与 screen epoch 没有被 start、stop 或插件动作改变；图片和结构 SHALL 在一个受协调的捕获窗口内获取，但 MUST NOT 被描述为设备侧原子快照。

#### Scenario: 获取一张 fresh snapshot

- **WHEN** streaming session 中的策略允许图片且用户调用 `mobile_mirror_snapshot`
- **THEN** 插件 SHALL 从 provider 获取 fresh raster screenshot 并发布新的 observation
- **AND** SHALL 返回 `observationId`、捕获时间窗、过期时间、revision、viewport、方向和图片尺寸元数据

#### Scenario: 一次检查同时请求图片和结构

- **WHEN** 策略允许图片且用户调用 `mobile_mirror_inspect_screen` 并设置 `includeImage=true`
- **THEN** 插件 SHALL 在同一次核心 `observe` 中请求结构和 fresh screenshot
- **AND** 两种结果 MUST 共享同一个 `observationId`、revision、epoch 和捕获时间窗

#### Scenario: 捕获期间 session 或屏幕 epoch 改变

- **WHEN** observation 捕获尚未发布时发生 session stop、session 替换或成功动作
- **THEN** 插件 MUST 丢弃未发布结果并返回稳定的 stale/session 错误
- **AND** MUST NOT 把跨 session 或跨 epoch 的图片与结构组合成 observation

#### Scenario: 应用在捕获窗口内自行变化

- **WHEN** 应用动画或外部触摸在截图与 page source 请求之间改变屏幕，且插件无法观测该变化
- **THEN** observation SHALL 仍返回真实的 `capturedAt` 与 `captureEndedAt`
- **AND** 文档 MUST 说明插件不保证设备侧原子一致性，并要求高风险动作前重新观察

### Requirement: 单帧图片必须以模型可消费且无 Base64 文本的方式投递

`mobile_mirror_snapshot` SHALL 返回紧凑的 JSON observation 摘要，并在 DSH adapter 中通过 attachment store 保存有效 raster 图片，再通过 deferred plugin context 向 agent 投递一个 `ImageBlock`。图片原始字节、Base64、本机路径、临时 URL和完整 attachment 存储位置 MUST NOT 出现在 canonical JSON、普通文本日志或共享 `MirrorState` 中。

#### Scenario: Native Mode 获得图片上下文

- **WHEN** attachment 校验/保存成功且 snapshot 由 Native Mode 直接调用
- **THEN** 工具 SHALL 返回 `image.delivery=deferred-context` 的摘要
- **AND** 工具结果之后 SHALL 追加恰好一个包含该图片和 observation 元数据的 plugin-sourced user context

#### Scenario: Code Mode 获得图片上下文

- **WHEN** snapshot 作为 `run_code` 子调用成功执行
- **THEN** canonical JSON SHALL 返回给 code runtime
- **AND** 图片 deferred context SHALL 由外层调用传递并在 `run_code` 结果之后进入 agent 上下文，而不是作为 Base64 进入 SDK value 或日志

#### Scenario: attachment 校验或保存失败

- **WHEN** 图片超过 attachment 限制、格式无效或 attachment store 保存失败
- **THEN** 工具 SHALL 返回 `screen_attachment_failed` 或 `screen_observation_too_large`
- **AND** MUST NOT 追加图片上下文或把失败图片报告为已投递

#### Scenario: 模型 provider 不支持图片输入

- **WHEN** 当前 DSH 模型 provider 不支持图片输入
- **THEN** 图片端到端验收 MUST 保持未通过并报告宿主能力阻塞
- **AND** Viewer 人工可见或 attachment 保存成功 MUST NOT 被当作模型已消费图片的证据

### Requirement: 界面结构必须跨平台规范化并严格限界

`mobile_mirror_inspect_screen` SHALL 返回 viewport、方向和一个扁平的 `ScreenNode[]`。每个节点 SHALL 使用 observation 内局部 `nodeId`，并按可用情况包含 parent、规范化 role、平台 role、identifier、name、text、value、viewport bounds 及 visible/enabled/actionable/focused/selected/checked 状态。原始 Appium XML MUST NOT 进入工具结果或持久日志。

#### Scenario: 规范化 Android accessibility source

- **WHEN** Android Appium source 包含 UiAutomator 的 class、resource-id、text、content-desc、bounds 和交互布尔属性
- **THEN** normalizer SHALL 把白名单属性映射为扁平 `ScreenNode[]`
- **AND** 节点 bounds MUST 使用 observation viewport 坐标

#### Scenario: 规范化 iOS XCTest source

- **WHEN** iOS Appium source 包含 XCTest type、name、label、value、x/y/width/height 和状态属性
- **THEN** normalizer SHALL 映射跨平台字段并保留有界的 platform role
- **AND** MUST NOT 虚构 source 中不存在的 visible、enabled 或 actionable 状态

#### Scenario: 应用没有暴露可访问性语义

- **WHEN** provider 返回合法但信息稀少或空的 accessibility tree
- **THEN** 工具 SHALL 如实返回空/最小结构和 `truncated=false`
- **AND** MUST NOT 使用 OCR、视觉猜测或伪造 label 来填充节点

#### Scenario: source 达到安全上限

- **WHEN** 原始 source 超过 4 MiB，XML 深度超过 64，节点超过 500，字段超过 512 Unicode code points 或规范化 JSON 超过 256 KiB
- **THEN** 插件 MUST 停止继续收集或拒绝无界响应
- **AND** 在仍可安全返回部分结构时 SHALL 标记 `truncated=true` 和稳定原因，否则 SHALL 返回稳定错误

#### Scenario: source 无效或包含外部实体

- **WHEN** Appium source 是无效 XML、实体扩展输入或超限响应
- **THEN** parser MUST fail closed 且不得解析外部实体
- **AND** 错误 MUST NOT 包含原始 XML、屏幕文本、sessionId、UDID 或 capabilities

### Requirement: 基于 Observation 的动作必须防止陈旧与坐标误用

现有不带 observation 的 viewport action SHALL 保持兼容。带 `observationId` 的 action MUST 校验当前 session generation、最新 frame revision、screen epoch、内存 TTL 和 15 秒动作 freshness；任何校验失败 MUST 拒绝动作，且 MUST NOT 自动降级为无 observation 的调用。`coordinateSpace=snapshot` MUST 依赖同一 observation 的图片/viewport 尺寸进行确定转换。

#### Scenario: 对最新 observation 执行 viewport tap

- **WHEN** agent 使用当前最新、未过期且 epoch 未变化的 `observationId` 和 viewport 坐标调用 tap
- **THEN** 插件 SHALL 在边界校验后执行原始 viewport 坐标动作
- **AND** 成功动作 SHALL 递增 screen epoch，使该 observation 不再可用于后续严格动作

#### Scenario: 把 screenshot 坐标转换为 viewport 坐标

- **WHEN** agent 使用 `coordinateSpace=snapshot`、有效 observation 和图片像素坐标调用 tap 或 swipe
- **THEN** 插件 SHALL 先校验图片坐标处于 `[0,width)` / `[0,height)` 半开区间，再按 `floor(pixel * viewportSize / imageSize)` 转换每一个点
- **AND** SHALL 在转换后执行有限数、非负和 viewport 半开区间校验，且 MUST NOT 静默 clamp

#### Scenario: snapshot 坐标缺少 observation

- **WHEN** action 指定 `coordinateSpace=snapshot` 但没有有效 `observationId`、图片尺寸或 viewport 尺寸
- **THEN** 插件 MUST 返回 `screen_coordinate_space_invalid`
- **AND** MUST NOT 猜测缩放比例或执行动作

#### Scenario: observation 已过期或不是最新 revision

- **WHEN** action 引用超过 TTL/15 秒 freshness、已被更新 observation 取代或 epoch 已变化的 observation
- **THEN** 插件 MUST 返回 `screen_observation_expired` 或 `screen_observation_stale`
- **AND** MUST NOT 执行动作

#### Scenario: observation 属于旧 session

- **WHEN** session 已停止/替换后 action 引用旧 observation
- **THEN** 插件 MUST 返回 `screen_observation_session_mismatch`
- **AND** MUST NOT 将旧 observation 映射到新设备 session

#### Scenario: 旧调用不提供 observation

- **WHEN** 现有调用以默认 viewport 坐标执行 tap/swipe 且不提供 `observationId`
- **THEN** 插件 SHALL 保持当前参数和执行语义
- **AND** 结果/文档 SHALL 不得暗示该调用获得 stale protection

### Requirement: Observation 资源必须短期、内存化并与 DSH attachment 分层

核心 ObservationStore SHALL 只在内存中保留每个 session 最多 4 个 observation，默认 TTL 为 60 秒，总图片字节硬上限 MUST 为 32 MiB。start、stop、dispose、session 替换、TTL 和容量逐出 MUST 使对应 observation 不可再使用，并 best-effort 清零被逐出的图片 buffer。核心 store MUST NOT 写入磁盘、提供目录/list API 或向工具返回本机文件路径/bearer URL。

#### Scenario: observation TTL 到期

- **WHEN** observation 超过 60 秒核心 TTL
- **THEN** store SHALL 移除其图片字节并拒绝后续动作引用
- **AND** 已发布的摘要 MUST NOT 被重新解释为仍可访问的图片资源

#### Scenario: store 达到图片字节上限

- **WHEN** 新 observation 会使 store 图片总量超过 32 MiB
- **THEN** store SHALL 先清理过期项并按最旧 observation 顺序逐出，直到同时满足条目与字节上限
- **AND** 单张图片自身超过 32 MiB 时 MUST 返回 `screen_observation_too_large`，不得发布该 observation

#### Scenario: session stop 清理 observation

- **WHEN** 插件停止或替换当前 session
- **THEN** store MUST 立即失效该 session generation 的全部 observation
- **AND** attached Appium session 的外部所有权语义 SHALL 保持不变

#### Scenario: 图片已经保存为 DSH attachment

- **WHEN** DSH adapter 已成功将某个 observation 图片保存为 attachment
- **THEN** 核心 store 仍 SHALL 按自身 TTL 清理内存 bytes
- **AND** 文档 MUST 明确 attachment 的恢复、fork、保留和删除遵循 DSH 自身策略，插件不得声称 TTL 会删除它

### Requirement: 感知进度与失败必须可见且保留最后可用结果

观察可能超过 300 ms 时，`MirrorState` SHALL 暴露独立 observation phase、开始时间、最后完成时间和稳定错误码，而主 mirror lifecycle MUST 保持 `streaming`。状态读取和 stop SHALL 在捕获期间保持可用；Viewer SHALL 保留最后成功帧。fresh observation 失败 MUST NOT 覆盖上一条成功 observation，也 MUST NOT 把旧 observation 静默返回为 fresh/actionable。

#### Scenario: 慢速 screen inspection

- **WHEN** page source 捕获超过 300 ms
- **THEN** 状态 SHALL 显示 observation 正在捕获且主 lifecycle 仍为 `streaming`
- **AND** 状态读取及停止控制 SHALL 保持可响应

#### Scenario: 并发 observation fail fast

- **WHEN** 同一 session 已有 observation 正在捕获且收到第二个 observation 请求
- **THEN** 第二个请求 MUST 立即返回 `screen_observation_in_progress`
- **AND** MUST NOT 在后台排队另一个 screenshot 或 page source 请求

#### Scenario: fresh capture 失败且存在旧帧

- **WHEN** provider 的 fresh screenshot/source 请求失败但 Viewer 或 store 中已有最后成功结果
- **THEN** Viewer SHALL 继续显示最后成功帧，store SHALL 保留旧 observation 直到正常逐出
- **AND** 当前工具调用 SHALL 返回稳定失败，不得把旧 observation 标记为新 revision 或可用于严格动作

#### Scenario: stop 中止正在进行的 observation

- **WHEN** 用户在 observation 捕获期间停止镜像
- **THEN** stop SHALL 通过 session abort signal 中止捕获并继续执行既有 session ownership 清理
- **AND** 被中止 observation MUST NOT 发布或追加图片上下文

### Requirement: 核心感知契约必须保持宿主无关

provider、normalizer、ObservationStore 和 `MirrorService.observe` MUST NOT 导入 DSH attachment、message/content block 或 MCP 类型。DSH adapter SHALL 只负责工具 schema、canonical JSON 投影、attachment 保存和 deferred context；未来 MCP adapter SHALL 能从同一核心 observation 生成离散 image/resource 结果。持续 Viewer 媒体 MUST 保持在本机媒体路径之外，不进入 observation 工具或 MCP 控制结果。

#### Scenario: DSH adapter 消费核心 observation

- **WHEN** DSH 工具请求截图或结构
- **THEN** adapter SHALL 调用 `MirrorService.observe`，而不是直接访问 Appium endpoint 或 Viewer `/api/frame`
- **AND** session、revision、TTL、策略和错误规则 SHALL 由核心实现

#### Scenario: Viewer 继续独立轮询

- **WHEN** Viewer 在 agent observation 前后请求 `/api/frame`
- **THEN** Viewer SHALL 继续通过既有本机 frame 接口显示画面
- **AND** 高频 Viewer 帧 MUST NOT 自动创建 DSH attachment、observation 工具结果或模型上下文

#### Scenario: 未来 MCP adapter 投影图片

- **WHEN** MCP adapter 消费内部 observation 图片
- **THEN** 它 SHALL 使用 MCP 自己的离散 image/resource contract 和相同的安全策略
- **AND** MUST NOT 把 DSH attachment id 当作跨宿主公共协议或复制 provider/session 逻辑

### Requirement: 跨 Provider 验收必须区分确定性测试与物理设备证明

实现 SHALL 使用 Mock、Appium 假服务器和 DSH runtime probe 覆盖确定性契约，并分别使用 Android/iOS 物理设备证明真实 screenshot、source、viewport、方向、图片模型输入和安全动作链路。Mock、模拟器、Viewer 截图或假服务器 MUST NOT 被报告为物理设备验收通过。

#### Scenario: Mock agent 感知闭环

- **WHEN** runtime probe 使用 Mock 调用 start、snapshot、inspect、带 observation 的安全 action、再 observe、stop
- **THEN** 图片/结构 SHALL 反映共享 screen model 的 action revision
- **AND** stop 后旧 observation SHALL 被拒绝

#### Scenario: Appium 假服务器契约

- **WHEN** 单测 server 返回 Android/iOS screenshot、rect、orientation、source 及异常/超限响应
- **THEN** 测试 SHALL 验证 endpoint、规范化、限制、错误码、脱敏、epoch、坐标映射和 session 清理
- **AND** 结果 MUST 标记为协议测试而非真机测试

#### Scenario: 物理 Android/iOS observation

- **WHEN** 已授权 Appium 屏幕内容且物理设备可用
- **THEN** 每个平台 SHALL 完成 `start → snapshot/inspect → agent 确认可见内容 → observation-bound safe action → re-observe → stop`
- **AND** 证据 SHALL 记录版本、非空有效 PNG、结构来源、坐标空间、动作后 revision 和插件自有 session 清理
