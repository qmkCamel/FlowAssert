## MODIFIED Requirements

### Requirement: 界面结构必须跨平台规范化并严格限界

`mobile_mirror_inspect_screen` SHALL 返回 viewport、方向和一个扁平的 `ScreenNode[]`。每个节点 SHALL 使用 observation 内局部 `nodeId`，并按可用情况包含 parent、规范化 role、平台 role、identifier、name、text、value、viewport bounds、sensitive 及 visible/enabled/actionable/focused/selected/checked 状态。Android password input 与 iOS secure text field MUST 标记 `sensitive=true`，并在结构发布前删除其 text/value。原始 Appium XML MUST NOT 进入工具结果或持久日志。

#### Scenario: 规范化 Android accessibility source

- **WHEN** Android Appium source 包含 UiAutomator 的 class、resource-id、text、content-desc、bounds 和交互布尔属性
- **THEN** normalizer SHALL 把白名单属性映射为扁平 `ScreenNode[]`
- **AND** 节点 bounds MUST 使用 observation viewport 坐标

#### Scenario: 规范化 Android password input

- **WHEN** Android source 节点声明 `password=true` 或明确 password platform role
- **THEN** normalizer SHALL 输出 `sensitive=true` 并删除该节点 text/value
- **AND** MUST NOT 以掩码字符替代内容或泄露内容长度

#### Scenario: 规范化 iOS XCTest source

- **WHEN** iOS Appium source 包含 XCTest type、name、label、value、x/y/width/height 和状态属性
- **THEN** normalizer SHALL 映射跨平台字段并保留有界的 platform role
- **AND** MUST NOT 虚构 source 中不存在的 visible、enabled 或 actionable 状态

#### Scenario: 规范化 iOS secure text field

- **WHEN** iOS source 节点为 `XCUIElementTypeSecureTextField` 或等价 secure role
- **THEN** normalizer SHALL 输出 `sensitive=true` 并删除该节点 text/value
- **AND** 其他 geometry/focus 状态 MAY 按白名单保留

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

现有不带 observation 的 viewport action SHALL 保持兼容。带 `observationId` 的 coordinate、node 或 text action MUST 校验当前 session generation、最新 frame revision、screen epoch、内存 TTL 和 15 秒动作 freshness；任何校验失败 MUST 拒绝动作，且 MUST NOT 自动降级为无 observation 的调用。`coordinateSpace=snapshot` MUST 依赖同一 observation 的图片/viewport 尺寸进行确定转换；node/text action MUST 依赖同一 observation 的 structure 和精确 nodeId。

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

#### Scenario: 节点动作使用同一 observation structure

- **WHEN** agent 使用 tap_node 或 input_text 并提供有效 observationId/nodeId
- **THEN** 插件 SHALL 只从该 observation 的不可变 structure 解析节点并执行语义校验
- **AND** MUST NOT 请求新 source、按 label/identifier 重定位或把 nodeId 解释为 Appium element id

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
