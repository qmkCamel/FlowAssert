## 1. 配置、类型与契约基线

- [x] 1.1 在 Config/schema、bundle patch、MCP config allowlist 和测试 fixture 中增加 `viewerMediaMode`、Android scrcpy path/server path/size/fps/bitrate、iOS MJPEG port/fps/scale/quality；验证默认 `auto`、`polling` 兼容模式、数值边界、绝对路径和未知键拒绝。
- [x] 1.2 定义 `ViewerMediaState`、transport/phase、稳定 media error code、内部 `ViewerMediaContext`、source/packet/subscription 接口；确保公共 state 不含 UDID、端口、路径、capabilities 或上游 URL。
- [x] 1.3 扩展 `MirrorState` 与 DSH/MCP contract conformance fixture，证明 media 只增加有界 status 元数据，八项工具名称/输入和 snapshot/inspect image contract 不变。
- [x] 1.4 为 scrcpy framed protocol、H.264 SPS/PPS/key/delta/session packet 和 MJPEG multipart 建立最小二进制 fixture；fixture 不包含真实设备标识或用户路径。
- [x] 1.5 新增可注入的流式 host child/loopback port allocator 抽象，统一 `spawn(shell=false)`、stdout/stderr 有界环形缓冲、abort、退出等待和精确资源句柄。

## 2. 共享媒体协调器与生命周期

- [x] 2.1 实现 `ViewerMediaCoordinator`：从 provider 内部 context 协商 polling/scrcpy/WDA source，并维护 idle/ready/starting/live/fallback 状态。
- [x] 2.2 将 coordinator 接入 `MirrorService`，保证 Appium session + 首张兼容 frame 决定主 streaming，媒体只在 Viewer 订阅时惰性启动且不阻塞 start。
- [x] 2.3 实现单活动订阅、5 秒 idle grace、8 MiB/两个 packet 队列、首个有效 frame 状态更新和 fallback 后截图轮询恢复信号。
- [x] 2.4 实现 media start/stop/session replacement/dispose 的 abort 与 quiesce，固定 response/source/owned media/provider 的关闭顺序和幂等语义。
- [x] 2.5 增加 coordinator 单测，覆盖 polling/Mock、缺少 context、慢启动时 status/stop、首帧、断流、订阅取消、第二订阅 409、错误保留和重复关闭。
- [x] 2.6 增加回归测试，证明媒体 live/fallback 期间 `frame`、fresh `observe`、revision/epoch/stale action 和 owned/attached Appium session 语义不变。

## 3. Appium context 与 iOS WDA MJPEG

- [x] 3.1 扩展 Appium provider，仅在内部保存 platform、目标 device、ownership 和经过类型校验的媒体 hint；所有 stop/error/state 投影继续脱敏。
- [x] 3.2 实现 owned iOS auto port planner：请求级 `appium:mjpegServerPort` 优先，否则选择空闲非特权 loopback port；只对明确的 forwarding race 换端口重试一次。
- [x] 3.3 实现 attached iOS 规则：只读取 attached capabilities 明确提供的 MJPEG port，不创建 iproxy、不猜测 9100、不修改或关闭外部 forwarding。
- [x] 3.4 为 Appium provider 增加有界 Settings API 调用，设置 `mjpegServerFramerate`、`mjpegScalingFactor`、`mjpegServerScreenshotQuality`、`mjpegFixOrientation=true`；失败只标记媒体 fallback。
- [x] 3.5 实现流式 MJPEG parser，覆盖 quoted/random boundary、header/length 跨 chunk、无 length、JPEG magic/尺寸、8 MiB 上限、EOF 和 abort，并重新发布固定 boundary。
- [x] 3.6 实现 `IosWdaMjpegSource`，连接仅由 provider context 生成的 loopback URL，验证 `multipart/x-mixed-replace`，向 coordinator 发送最新完整 JPEG 且不缓存历史。
- [x] 3.7 扩展 Appium fake server 测试，覆盖 owned port/Settings、9100 冲突、attached 无 hint、有 hint只读、Settings/stream 失败、fresh screenshot 独立和 DELETE ownership。

## 4. Android scrcpy 4.1 视频源

- [x] 4.1 实现 scrcpy resolver/preflight：只接受显式绝对 executable/server path 或 executable 的 portable/prefix 推导，运行 `--version` 并仅允许 4.1；禁止 PATH 猜测、环境覆盖、下载和自动安装。
- [x] 4.2 实现唯一 scid、本机端口、ADB abstract socket 和远端 jar 名生成；所有 adb 调用使用已有 `adbPath`、精确 `-s` target、参数数组和有界诊断。
- [x] 4.3 实现 Android media start：push server、建立精确 forward、前台启动 adb shell scrcpy server，并固定 H.264/video-only/audio=false/control=false/frame+stream metadata 与 size/fps/bitrate 参数。
- [x] 4.4 实现 scrcpy 4.1 parser，支持任意 TCP 分片下的 codec id、rotation session packet、12-byte flags/PTS/length、config/key/delta 和 8 MiB 上限；未知 codec/flag/尺寸/长度 fail closed。
- [x] 4.5 实现 Annex-B config 处理：抽取 SPS profile/constraints/level 形成 `avc1.*`，保存最近 SPS/PPS，并在 key frame 前置 config 以支持新订阅/背压恢复。
- [x] 4.6 实现 Android stable HTTP envelope encoder，使用 big-endian versioned metadata/session/config/key/delta message，携带有界 codec、尺寸、PTS、relay timestamp 和不透明 media generation。
- [x] 4.7 实现写端背压：最多保留两个 packet/8 MiB，慢消费者丢 delta 并等待下一 config + key frame，rotation 时重置 decoder boundary。
- [x] 4.8 实现精确 Android cleanup：关闭 socket、等待/终止保存的本机 child handle、移除 owned forward 和唯一远端 jar；不得 `pkill`、扫描或删除其他实例资源。
- [x] 4.9 用 fake adb/child/TCP server 测试成功、版本/路径缺失、fragmentation、rotation、oversize、server exit、ADB forward 首个空连接重试、stop during push/forward/first-frame、cleanup partial failure 和 attached Appium 不删除。

## 5. Viewer 媒体 HTTP 与渲染器

- [x] 5.1 为 ViewerServer 增加 `GET /api/media/stream`，按当前 source 返回 H.264 envelope 或重发布 MJPEG；拒绝 upstream 参数、跨源 Origin/Referer 和第二活动订阅。
- [x] 5.2 增加 `POST /api/media/client-failure`，只接受当前 generation 与固定 decoder/render 枚举，拒绝任意文本、旧 generation、超限 body 和跨源请求。
- [x] 5.3 给媒体 response 补齐 no-store、nosniff、CSP/frame denial、abort/backpressure 传播；验证 route 不泄漏 port、UDID、sessionId、path 或 command。
- [x] 5.4 扩展 Viewer UI，展示 media starting/live/fallback、transport 和兼容说明；媒体启动时保留上一帧，主题、stop 和安全动作保持可用。
- [x] 5.5 实现 Android H.264 fetch parser、`VideoDecoder.isConfigSupported` probe、Annex-B `EncodedVideoChunk`、canvas 绘制与 `VideoFrame.close()`；首帧绘制前继续 polling。
- [x] 5.6 实现 Android decoder backlog/错误恢复：限制 `decodeQueueSize`、丢 delta 等 key frame、向当前 generation 回报固定失败码并在 2 秒内恢复 polling。
- [x] 5.7 实现 iOS 同源 MJPEG renderer，第一帧可见后停止 polling；stream error 时保留最后媒体画面，待新 PNG 成功加载再替换。
- [x] 5.8 增加前端 teardown，页面隐藏/卸载、session stop/replacement 和 renderer 切换时取消 fetch、关闭 decoder/frame/object URL，不留下后台订阅。

## 6. 安全、打包与文档

- [x] 6.1 更新安全文档，记录外部 scrcpy server、ADB/WDA 媒体权限、loopback 同源、内存/帧限制、无 recording/attachment/MCP video、crash orphan 风险和 `polling` 回滚。
- [x] 6.2 新增 ADR 0003（或完整更新 ADR 0001），记录 scrcpy 4.1 framed H.264 + WebCodecs、WDA MJPEG、Appium 单一控制栈、惰性订阅和被拒绝的 SDL/raw/Tango/ffmpeg/MCP 方案。
- [x] 6.3 更新 README、architecture、product-shape、milestones 和双平台设备说明，提供个人 profile 占位符、scrcpy 4.1 官方安装/校验、非标准 server path 与故障排查；不得提交个人路径/端口/标识。
- [x] 6.4 更新 build/pack contract，确保新的 Viewer 脚本/媒体模块/文档进入 tarball，scrcpy binary/server、设备媒体、临时文件和个人配置不进入包。
- [x] 6.5 增加日志/状态脱敏测试，覆盖上游 URL、port、UDID、server path、adb/scrcpy args、原始 stderr 和浏览器任意错误文本。

## 7. 自动化与运行时验证

- [x] 7.1 扩展 ViewerServer/Vitest 集成测试，覆盖 H.264/MJPEG streaming、同源、单订阅、backpressure、取消、fallback、last-frame preservation 和关闭顺序。
- [x] 7.2 扩展 Playwright E2E：Mock polling 基线、Android WebCodecs supported/unsupported、iOS MJPEG、慢首帧期间主题/stop、decoder/stream 失败后 2 秒恢复；留存并人工检查最终截图。
- [x] 7.3 运行 DSH Native/Code 和 MCP in-process/built stdio probes，证明八工具与单帧 image content 不变、媒体 status 无 payload、进程关闭后 Viewer/media 端口释放。
- [x] 7.4 运行 `pnpm check`、`pnpm test:e2e`、`pnpm build`、`pnpm pack:check`、`openspec validate --strict` 和 `git diff --check`，区分全量门禁与物理媒体指标。

## 8. Android/iOS 真机 P1 验收

- [x] 8.1 在目标 Mac 显式安装或指定官方 scrcpy 4.1（runtime 不自动安装），记录 executable/server 版本与校验结果，不把绝对路径提交到仓库。
- [x] 8.2 在 Android USB 真机持续变化画面运行 10 秒：验证 H.264 首帧 ≤5 秒、绘制 ≥15 fps、host receive-to-paint p95 ≤100 ms、Appium action 与 fresh observation 并发可用。
- [x] 8.3 主动中断 Android media，验证 2 秒内恢复 screenshot polling；stop 后核对 child、owned ADB forward、唯一远端 jar 和 Appium owned session 均按各自 ownership 清理。
- [x] 8.4 在 iOS USB 真机且默认 9100 已占用的条件下运行 WDA MJPEG：验证选择非冲突端口、首帧 ≤5 秒、持续变化 ≥8 fps、Appium action/fresh PNG/structure 不受影响。
- [x] 8.5 主动中断 iOS MJPEG，验证 2 秒内回退；owned stop 后对应 forwarding/8100/Appium listener 清理，既有占用 9100 的 Simulator WDA 不被终止。
- [x] 8.6 留存 Android/iOS 最终 Viewer 截图和脱敏指标 JSON，人工检查方向、缩放、无黑帧/错误残留，并把事实回填 validation/milestones；只有两端真机指标均通过才关闭 P1 媒体项。
