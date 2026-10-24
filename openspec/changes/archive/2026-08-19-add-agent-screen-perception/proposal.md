## Why

当前插件只能把设备画面提供给本机 Viewer，agent 工具只能读取状态并盲发坐标，无法基于同一时刻的屏幕内容形成可验证的“观察 → 决策 → 动作 → 再观察”闭环。现在需要先建立宿主无关、可审计且不承载连续视频的离散屏幕感知契约，才能安全复用于后续 DSH 与 Codex/MCP adapter。

## What Changes

- 新增 `mobile_mirror_snapshot`，按需获取一张当前屏幕图像；核心层只做短期内存持有，DSH adapter 在显式允许物理屏幕内容共享后将其提升为受控图片附件，不把连续帧或无限制 Base64 写入文本日志。
- 新增 `mobile_mirror_inspect_screen`，返回当前屏幕尺寸、方向、可见文本和有界的可访问性元素树；Android/iOS 通过 Appium page source 获取结构，Mock 提供确定性结构。
- 为每次观察分配不可变的 `observationId`、`frameRevision` 和时间戳，并把图像、结构、坐标空间与设备 session 绑定。
- 扩展动作输入，允许携带 `observationId`；对过期、跨 session 或坐标空间不匹配的动作给出稳定错误，防止根据旧画面误操作。
- 增加观察结果大小、元素数量、文本长度、TTL、并发和错误回退边界；物理设备屏幕内容默认不发送给 agent，启用后图片遵循 DSH 附件留存策略，原始图片字节、page source、能力参数和 bearer URL 不进入普通文本日志。
- 保持 Viewer 连续媒体通道不变；agent observation 是按需离散能力，不取代 Viewer，也不把视频带入 DSH/MCP 控制面。

## Capabilities

### New Capabilities

- `agent-screen-perception`: 定义单帧图片、结构化界面检查、观察版本一致性、坐标绑定、隐私留存和跨 provider 一致性。

### Modified Capabilities

无。仓库当前没有已归档的主规格；既有插件、Appium provider 和 Viewer 行为作为兼容约束保留。

## Impact

- 核心契约：`MirrorProvider`、`MirrorService`、frame cache、观察资源生命周期和动作校验。
- DSH adapter：新增两个工具及可消费的图片/JSON 输出渲染；现有工具保持兼容。
- Provider：Appium 增加窗口尺寸、方向和 page source 读取，Mock 增加确定性结构数据。
- 本机服务：增加不落盘、无目录/list API、带 TTL 的 observation 内存 store；工具不返回图片路径或 bearer URL，Viewer 继续使用原有 `/api/frame`。
- 测试：增加契约、大小边界、过期观察、跨 session、失败保留、工具渲染、Appium 假服务器和真实设备验收。
- 平台边界：Android/iOS 的可访问性树质量由被测应用暴露情况决定；本变更不引入 OCR、视觉模型、远程上传、连续视频或多 session。
