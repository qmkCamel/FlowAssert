## Why

部分 iOS 页面可见文字不出现在可访问树中，单设备串行又限制跨平台变更验收效率。需要解决两个明确场景：在已声明区域核对文字，以及用本机两台设备执行可追溯的验收矩阵；不能由此宣称通用视觉理解或云设备平台。

本变更对应路线图第六项，依赖第四项验收对象和第五项来源契约，内部先完成 OCR，再完成设备矩阵。状态（2026-10-03）：工程实现及门禁完成，任务 33/39；OCR 评测／批准机制、显式检查点断言与双槽矩阵已实现，真实图像评测、生产 profile 批准、双真机业务与独立判读尚未验收。前置工程提交为 `REDACTED_REVISION`、`REDACTED_REVISION`，本项工程为 `REDACTED_REVISION`、`REDACTED_REVISION`、`REDACTED_REVISION`；证据见[离线验证](../../../artifacts/local-device-matrix/validation.md)，剩余条件见[六项总览](../add-change-acceptance-records/roadmap.md)。默认生产 OCR 仍关闭，合成识别和双 Mock 不替代真实质量。中文正文保留 OpenSpec 所需英文结构标记与协议标识符。

## What Changes

- 新增显式本机 OCR 适配器与受审查区域配置，首选 macOS Apple Vision；预检并记录操作系统、识别请求修订、语言支持和帮助程序摘要，不自动下载模型或外发截图。
- 新增限定范围的文字预览与 `assertTextInRegion`：冻结截图、区域、语言、匹配规则和识别结果；低置信、图像变化、超时和不支持一律不能产生通过。缺字不等于不存在。
- 支持已登记遮挡文字的正向告警，不把“没识别到遮挡”当作无未知遮挡证明。继续保留既有视觉评测的默认关闭和独立放行门槛。
- 新增本机设备矩阵：两个显式登记槽位、独立会话／端口／证据空间、排他认领、确定性任务分配、断线隔离、显式安全复跑和按维度归并。
- Viewer、CLI 和宿主共享控制与查询服务。界面提供每设备进度和取消，矩阵结果进入变更验收对象；所有子运行及失败保留，不因另一设备通过而转绿。

## Capabilities

### New Capabilities

- `local-region-text-verification`：本机区域文字识别、显式文字断言、来源留证与评测放行。
- `local-device-acceptance-matrix`：双设备资源分配、隔离执行、取消与中断恢复、矩阵结果及验收对象关联。

### Modified Capabilities

无。新矩阵服务组合独立的单设备运行时；不把既有单设备套件改成隐式并发。新断言为 opt-in，不改变旧 YAML 和既有像素比较含义。

## Impact

- 新增 OCR 帮助程序及封装、编译节点、证据类型、矩阵调度服务、注册配置、API、Viewer 与故障测试；更新 provider／运行时边界 ADR 后实施。
- 首期宿主 macOS，识别 Android/iOS 截图；设备矩阵验收要求两台真实设备，优先 Android＋iPhone。不宣称非 macOS OCR 或设备云支持。
- 继续通过 MirrorService/provider 执行，媒体留在本机 Viewer；不修改 Harness agent loop、不分享 Agent 全局权限、不增加另一条控制设备的 OCR 路径。
- 不做图中文字驱动的动作、通用无障碍判断、负向 OCR 成功断言、不受约束模型判断、自动跨设备迁移或多租户云调度。真实图片授权、冻结评测与双真机稳定性是上线验收依赖，不由 Mock 测试替代。
