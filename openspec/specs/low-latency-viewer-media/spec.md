# low-latency-viewer-media Specification

## Purpose
为本机 Viewer 提供可量化、可回退的 Android scrcpy H.264 与 iOS WDA MJPEG 低延迟画面，同时保持 Appium 作为唯一语义控制与单帧 agent observation 来源，并对媒体传输、资源所有权和清理施加明确限制。
## Requirements
### Requirement: 连续媒体必须与控制和 agent observation 隔离

系统 SHALL 只把连续媒体提供给 loopback Viewer。Android scrcpy 和 iOS WDA MJPEG MUST NOT 成为第二套设备控制、session ownership 或 agent observation 来源；DSH/MCP 工具结果、attachment、ObservationStore、日志和持久化文件 MUST NOT 包含连续媒体 payload、上游 URL 或媒体历史。

#### Scenario: Viewer 与 agent 同时使用设备

- **WHEN** Viewer 正在消费连续媒体且 agent 调用 `mobile_mirror_snapshot`、`mobile_mirror_inspect_screen` 或 action
- **THEN** agent 调用 SHALL 继续通过 `MirrorService` 与 Appium provider 获取 fresh PNG、结构和执行 W3C action
- **AND** 连续媒体帧 MUST NOT 被发布为 fresh observation 或自动进入模型上下文

#### Scenario: Android Viewer 发送动作

- **WHEN** Android scrcpy 媒体处于 live 且用户从 Viewer 触发 tap、swipe 或 back
- **THEN** action SHALL 只通过现有 Appium action 路径发送
- **AND** scrcpy control、keyboard、clipboard 和 audio socket MUST 保持禁用

### Requirement: 媒体来源必须按平台协商并安全回退

`viewerMediaMode=auto` 时，系统 SHALL 为 Android Appium context 优先选择已显式配置且验证通过的 scrcpy H.264，为 iOS Appium context 优先选择可达的 WDA MJPEG；Mock、不支持的平台、缺失依赖、attached context 不充分或协商失败 SHALL 使用现有 Appium/Mock screenshot polling。`viewerMediaMode=polling` MUST NOT 探测或启动低延迟媒体。

#### Scenario: Android 未配置 scrcpy

- **WHEN** Android session 已 streaming 但 `androidScrcpyPath` 为空或验证失败
- **THEN** 主 session SHALL 保持 streaming 并使用 Appium screenshot polling
- **AND** 状态 SHALL 返回脱敏的 fallback transport 与稳定 media error code，不执行 PATH 搜索或下载

#### Scenario: iOS MJPEG 不可用

- **WHEN** iOS session 的 MJPEG port 无法连接、协议无效或流在首帧前结束
- **THEN** Viewer SHALL 继续显示或恢复 Appium screenshot polling
- **AND** 系统 MUST NOT 因媒体失败删除一个已经可用的控制 session

#### Scenario: 显式兼容模式

- **WHEN** `viewerMediaMode=polling`
- **THEN** Android MUST NOT 执行 scrcpy/adb 媒体命令，iOS MUST NOT 为媒体规划新端口或调整 MJPEG settings
- **AND** Viewer SHALL 保持变更前的 `/api/frame` 行为

### Requirement: 连续媒体必须惰性启动并暴露独立状态

媒体源 SHALL 在 Viewer 建立媒体订阅后启动，MUST NOT 阻塞 Appium session 达到 `streaming`。状态 SHALL 区分 `idle`、`ready`、`starting`、`live` 和 `fallback`，并只包含 transport、时间、尺寸、目标帧率和稳定错误码等脱敏元数据。最后一个订阅断开后，媒体源 SHALL 在有界 idle grace 内停止。

#### Scenario: 首帧仍在启动

- **WHEN** Viewer 请求媒体且来源启动超过 300 ms
- **THEN** media phase SHALL 为 `starting`，主 mirror lifecycle SHALL 保持 `streaming`
- **AND** screenshot polling、status、stop、主题和安全控制 SHALL 继续可用

#### Scenario: 第一帧成功转发

- **WHEN** 来源已连接且 runtime 成功解析并向同源 response 写入第一张 MJPEG 或 H.264 帧
- **THEN** media phase SHALL 变为 `live` 并记录 first-frame 时间、尺寸和 transport
- **AND** Viewer SHALL 只在自己的 renderer 实际呈现第一帧后停止兼容帧轮询

#### Scenario: Viewer 离开

- **WHEN** 最后一个媒体 response 被取消或页面断开并超过 5 秒 idle grace
- **THEN** runtime SHALL 停止该媒体源并释放它拥有的 stream/process/port 资源
- **AND** Appium session SHALL 保持原 ownership 和 streaming 状态

### Requirement: Android 媒体必须使用版本锁定的 scrcpy 视频协议

Android 低延迟源 SHALL 只执行显式绝对路径配置的 scrcpy，支持版本 MUST 为 4.1，codec MUST 为 H.264。runtime SHALL 通过现有 `adbPath` 对 Appium context 的目标设备启动唯一媒体 server，保留 codec、rotation session、config/key/delta 和 PTS frame metadata，并限制 max size、fps、bit rate 与 packet 大小。

#### Scenario: 启动兼容 scrcpy

- **WHEN** Viewer 订阅 Android 媒体且配置的 scrcpy 报告 4.1
- **THEN** runtime SHALL 使用随机 scid、唯一远端 jar 和精确 owned ADB forward 启动 video-only server
- **AND** 启动参数 MUST 禁用 audio/control，并限制为配置范围内的 H.264/max-size/max-fps/bit-rate

#### Scenario: scrcpy 版本不匹配

- **WHEN** 配置程序报告非 4.1、server 与 client version 不一致或协议 header 无效
- **THEN** 媒体 SHALL 以 `viewer_media_scrcpy_version_unsupported` 或 `viewer_media_protocol_invalid` 回退
- **AND** runtime MUST NOT 猜测协议、改用 scrcpy control 或影响 Appium session

#### Scenario: Android 旋转或消费者落后

- **WHEN** parser 收到新的 rotation session packet，或下游队列达到限制
- **THEN** runtime SHALL 更新媒体尺寸并在 config + 下一 key frame 建立可解码边界
- **AND** 慢消费者的 delta frame SHALL 被丢弃直到下一 key frame，MUST NOT 建立无界缓冲

### Requirement: iOS 媒体必须使用受控的 WDA MJPEG

owned iOS session 在 auto mode 下 SHALL 使用 request 明确端口或 runtime 规划的空闲端口创建 WDA MJPEG forwarding，并通过 Appium Settings API 应用有界 framerate、scaling、quality 和 orientation fix。attached session MUST NOT 创建、替换或删除外部 forwarding；只有 capabilities 明确给出可达端口且流验证通过时才可只读订阅。

#### Scenario: 默认 9100 已被占用

- **WHEN** owned iOS session 启动且本机 9100 已被其他进程占用，request 未指定 MJPEG port
- **THEN** runtime SHALL 规划另一个空闲 loopback port 并让 Appium/WDA 使用该端口
- **AND** 当前 session 的媒体不得连接或关闭占用 9100 的外部进程

#### Scenario: attached iOS session 没有媒体信息

- **WHEN** runtime 附着外部 iOS Appium session，capabilities 未提供可验证的 MJPEG port
- **THEN** Viewer SHALL 使用 screenshot polling
- **AND** runtime MUST NOT 创建 iproxy、修改 settings 或猜测默认 9100 属于该 session

#### Scenario: agent 请求截图

- **WHEN** WDA MJPEG 正在 live 且 agent 请求 snapshot
- **THEN** Appium provider SHALL 继续调用独立 screenshot endpoint 获取 fresh PNG
- **AND** runtime MUST NOT 设置 `appium:mjpegScreenshotUrl` 或返回缓存 MJPEG frame 作为 fresh observation

### Requirement: 本机媒体传输必须同源、有界且不持久化

ViewerServer SHALL 只通过当前 loopback origin 暴露一个不接受任意 upstream 参数的媒体 stream endpoint。上游 MJPEG/H.264 SHALL 被解析为稳定的内部 envelope，施加 4 KiB metadata、8 MiB 单帧/packet、一个活动订阅和 8 MiB/两个 packet 队列上限；响应 SHALL no-store 并沿用 CSP/nosniff/frame denial。任何媒体内容 MUST 只存在于有界内存和活动 response 中。

#### Scenario: 跨源页面请求媒体

- **WHEN** browser media 请求携带与 Viewer 不匹配的 Origin 或 Referer
- **THEN** ViewerServer SHALL 拒绝请求且不得连接设备媒体源
- **AND** response MUST NOT 披露 upstream port、path 或失败命令

#### Scenario: MJPEG frame 超限

- **WHEN** upstream boundary 内的 JPEG 超过 8 MiB、尺寸无效或 boundary 无法有界解析
- **THEN** parser SHALL 终止该媒体订阅并报告 `viewer_media_frame_too_large` 或 `viewer_media_protocol_invalid`
- **AND** Viewer SHALL 保留最后画面并恢复 screenshot polling

#### Scenario: 第二个连续订阅

- **WHEN** 一个 runtime 已有活动连续媒体订阅且另一个客户端请求同一 stream
- **THEN** 第二个请求 SHALL 被有界拒绝并继续允许 state/frame polling
- **AND** runtime MUST NOT 为同一 session 启动第二个 scrcpy/WDA media source

### Requirement: 浏览器必须按能力解码并可恢复

Android Viewer SHALL 仅在 `VideoDecoder` 存在且 H.264 config probe 成功后连接 H.264 stream，使用 Annex-B config/key/delta packet 解码并在 canvas 绘制后关闭 `VideoFrame`。iOS Viewer SHALL 消费同源 MJPEG。decoder、HTTP 或绘制失败时 SHALL 保留最后呈现画面，并在新的 polling frame 成功加载后平滑替换。

#### Scenario: 浏览器不支持 WebCodecs

- **WHEN** Android Viewer 检测不到 `VideoDecoder` 或 H.264 config 不受支持
- **THEN** 页面 SHALL 显示 compatibility fallback 并继续 screenshot polling
- **AND** MUST NOT 下载 WASM decoder 或启动无消费者的 scrcpy server

#### Scenario: H.264 decoder backlog

- **WHEN** `decodeQueueSize` 超过有界阈值或 packet writer 产生背压
- **THEN** Viewer/runtime SHALL 丢弃 delta data 并等待 config + key frame 恢复
- **AND** stop、action 和状态刷新 MUST NOT 被 decoder backlog 阻塞

#### Scenario: 活动流意外断开

- **WHEN** live stream EOF、source child 退出或浏览器 decoder 报错
- **THEN** media phase SHALL 变为 `fallback` 并记录稳定错误码
- **AND** Viewer SHALL 在 2 秒内重新显示可用 screenshot polling，主 session 保持可控

#### Scenario: Android 浏览器在订阅后解码失败

- **WHEN** 当前 H.264 订阅的 WebCodecs configure、decode 或 canvas render 失败
- **THEN** Viewer SHALL 只用当前不透明 media generation 和固定失败枚举通知同源 server，server 验证后 SHALL 终止该 source 并进入 fallback
- **AND** client MUST NOT 上报任意错误文本、旧 generation 或上游媒体地址

### Requirement: 媒体资源必须先于控制 session 精确清理

stop、session replacement 和 runtime dispose SHALL 先拒绝新订阅、取消媒体启动和关闭活动 stream，再清理该 runtime 精确拥有的 Android child/forward/remote jar 或由 owned iOS session 管理的 forwarding，最后执行既有 provider ownership stop。清理 MUST 幂等、有超时，MUST NOT 使用宽泛进程匹配或删除 attached/其他 runtime 的资源。

#### Scenario: Android 媒体启动时停止

- **WHEN** stop 在 adb push、forward、server launch 或首帧等待期间发生
- **THEN** signal SHALL 传播到启动任务，runtime SHALL 等待任务 quiesce 并清理已经创建的精确资源
- **AND** provider stop SHALL 只在媒体清理步骤完成或超时后执行

#### Scenario: attached session 停止

- **WHEN** runtime 在 attached Appium session 上使用只读媒体后停止
- **THEN** runtime SHALL 关闭自己的订阅和 Android media resource（若有）
- **AND** MUST NOT DELETE Appium session、关闭外部 iOS forwarding 或终止不属于本 runtime 的进程

#### Scenario: 重复关闭

- **WHEN** EOF、SIGTERM、Viewer stop 和显式 close 汇合到同一关闭路径
- **THEN** 每个媒体 response、child、forward、远端文件和 provider stop SHALL 最多清理一次
- **AND** 重复调用 MUST NOT 产生额外外部副作用

### Requirement: P1 验收必须量化实时性和回退

自动化 SHALL 覆盖协议分片、旋转、异常帧、背压、浏览器能力、端口/ownership 和清理；真机 SHALL 分别记录 Android scrcpy 与 iOS WDA MJPEG 的首帧、活动帧率、host receive-to-paint、断流回退和资源释放，不得用官方宣传值、截图轮询或模拟 server 代替物理媒体证明。

#### Scenario: Android 物理媒体验收

- **WHEN** scrcpy 4.1/H.264 在 Android USB 真机的持续变化画面运行 10 秒
- **THEN** 首次可绘制帧 SHALL 不超过 5 秒、绘制帧率 SHALL 至少 15 fps、host receive-to-paint p95 SHALL 不超过 100 ms
- **AND** 断流后 2 秒内 SHALL 恢复截图，stop 后不得留下该 runtime 的 child/forward/远端 jar

#### Scenario: iOS 物理媒体验收

- **WHEN** WDA MJPEG 在 iOS USB 真机的持续变化画面运行且默认 9100 已占用
- **THEN** runtime SHALL 使用非冲突端口，首次可见帧 SHALL 不超过 5 秒且活动窗口 SHALL 至少 8 fps
- **AND** 断流后 2 秒内 SHALL 回退，owned stop 后对应 forwarding SHALL 释放
