# ADR 0002：宿主无关的 stdio MCP adapter

- 状态：Accepted
- 日期：2026-08-19

## 背景

FlowAssert 已经通过 DeepSeek Harness 暴露设备生命周期、单帧观察和安全动作，但 Codex 只是潜在宿主之一。若在每个宿主 adapter 内分别实现 Appium、Viewer、签名预检、observation TTL 和 session ownership，会产生行为漂移，也会让一个 adapter 的退出误删另一个宿主管理的 session。

MCP 适合离散工具调用，不适合连续视频。截图又必须真正进入支持图片的 MCP client 上下文，仅返回路径、URL 或 Base64 文本都不能证明宿主模型消费了图片。

## 决策

1. `LocalDeviceRuntime` 统一拥有 `MirrorService`、`ViewerServer`、iOS WDA preflight、共享命令层和关闭顺序；一个 adapter 进程只创建一个 runtime。
2. `MobileMirrorCommands` 和 `tool-contracts` 是宿主无关边界。DSH 与 MCP adapter 只做 schema/result 投影，不复制 provider、权限、TTL、坐标转换或 session ownership。
3. MCP server 只提供 stdio transport，默认不开放网络 listener；Viewer 仍只监听 loopback。
4. MCP 固定暴露八项 tools capability，不声明 resources、prompts 或 sampling。连续 Viewer 帧不进入 MCP。
5. `snapshot`/`inspect_screen` 的 canonical object 只包含有界元数据和结构；有图片时追加恰好一个 `image/png` content block。MCP 临时图片副本默认上限 8 MiB、硬上限 32 MiB。
6. 不提供 screenshot resource 或 bearer URL。它们会增加生命周期、访问控制和清理语义，却不能改善一次工具调用中的图片消费。
7. 超过 300 ms 的 MCP 调用发送 progress；调用取消、stop 和 server close 向核心/provider 传播中止。关闭顺序为 Viewer listener、活动操作、owned session。
8. SDK 固定为 `@modelcontextprotocol/sdk@1.30.0`，只使用 public exports。Codex 配置属于宿主接入说明，不进入核心实现或工具契约。

## 备选方案

- **Codex 专用插件逻辑：拒绝。** Codex 是一个宿主，不是设备核心；专用实现会复制 DSH 已验证的安全语义。
- **常驻 Local Device Bridge daemon：暂缓。** 当前单进程 runtime 足以复用核心且清理边界更清晰；多宿主并发共享同一设备时再设计认证、租约和仲裁。
- **Streamable HTTP MCP：拒绝作为当前默认。** 会新增监听、认证、TLS 和跨用户威胁面；本机宿主已有 stdio 子进程模型。
- **通过 MCP resource 连续发布截图：拒绝。** resource 仍不是视频协议，还会制造缓存、轮询和过期清理问题。
- **把图片编码进 structured JSON：拒绝。** 会膨胀日志/上下文，并绕过 MCP 的图片 content 类型。

## 影响

- DSH 继续通过 attachment/deferred context 投递图片；MCP 通过 image content 投递，二者复用同一个 observation 和错误码。
- Viewer 是可选的人类监督面板，不是 Codex 或 DSH 的产品替代物。
- 两个独立 adapter 进程目前不能安全共享同一个 owned Appium session；附着外部 session 时双方都不得删除它。
- 进程崩溃可能留下 owned Appium session，后续生产化需要孤儿 session 诊断/恢复机制。
- 新宿主只需实现薄投影层并运行 contract conformance，无需理解 Appium/WDA 细节。

## 2026-09-15：查询与本机检查扩展

当前在语义动作九工具基础上追加第十项只读 query，summary/query 保持 data 投影，不新增 MCP image/resource。Viewer 的一次性 PNG Base64 仅属于同源本机检查响应，不进入 MCP transport 或 Agent store；详见 [ADR 0007](0007-observation-query-viewer-inspector.md)。原 alpha 历史工具数不改写。
