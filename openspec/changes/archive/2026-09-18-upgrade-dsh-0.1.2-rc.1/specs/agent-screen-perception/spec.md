## MODIFIED Requirements

### Requirement: DSH adapter 必须把 observation 图片保存为 attachment 并延迟注入上下文

DSH adapter SHALL 通过 `ctx.attachments.saveImage` 保存 observation 图片，通过 `createUserMessage` 创建来源明确的 deferred image context，并将宿主返回的完整 opaque attachment ref 原样用于 `ImageBlock`。如果 DSH 把输入图片归一化为另一种受支持格式、尺寸或 `originalDimensions`，adapter MUST NOT 把 attachment metadata 写回 ObservationStore 或用它改变原始 observation viewport、orientation、revision、node bounds 或动作坐标。

#### Scenario: Attachment provider 归一化图片

- **WHEN** `saveImage` 对原始 PNG 返回 JPEG/WebP、缩小后的 width/height 或 `originalDimensions`
- **THEN** deferred `ImageBlock` SHALL 携带该返回 ref，不拼接 Base64、路径或自造 attachment id
- **AND** canonical summary 与提示文本 SHALL 继续报告 capture 时的 observationId、revision、原始 viewport 和 orientation
- **AND** 后续 observation-bound action SHALL 只使用 ObservationStore 中的原始几何。

#### Scenario: Attachment 保存失败或取消

- **WHEN** attachment 保存失败，或调用在保存完成前被取消
- **THEN** 工具 SHALL 返回稳定失败且 MUST NOT defer 半发布上下文
- **AND** 最后可用 Viewer frame 与既有 observation state SHALL 保留。

### Requirement: 跨 Provider 验收必须区分确定性测试与物理设备证明

实现 SHALL 使用 Mock、Appium 假服务器和 DSH runtime probe 覆盖确定性契约，使用 DeepSeek Harness `0.1.2-rc.1` clean profile 证明 Native/PTC attachment/deferred context 与动作闭环。只有另行使用真实图片模型完成消费时，才可声明真实多模态模型验收；只有分别使用 Android/iOS 物理设备时，才可声明真实 screenshot、source、viewport、方向和安全动作链路。Mock、模拟器、Viewer 截图、attachment 保存、假服务器或仅完成图片序列化 MUST NOT 被报告为真实模型或物理设备验收通过。

#### Scenario: Mock agent 感知闭环

- **WHEN** runtime probe 使用 Mock 调用 start、snapshot、inspect、带 observation 的安全 action、再 observe、stop
- **THEN** 图片/结构 SHALL 反映共享 screen model 的 action revision
- **AND** stop 后旧 observation SHALL 被拒绝。

#### Scenario: Appium 假服务器契约

- **WHEN** 单测 server 返回 Android/iOS screenshot、rect、orientation、source 及异常/超限响应
- **THEN** 测试 SHALL 验证 endpoint、规范化、限制、错误码、脱敏、epoch、坐标映射和 session 清理
- **AND** 结果 MUST 标记为协议测试而非真机测试。

#### Scenario: rc.1 Native/PTC clean-profile 闭环

- **WHEN** 隔离 DSH `0.1.2-rc.1` profile 从同一 packed tarball 安装插件，并分别使用 Native 与 PTC 呈现执行 Mock lifecycle
- **THEN** 两种模式 SHALL 注册同样的九项工具、产生一次 deferred image context、观察递增 revision 并拒绝 stale observation
- **AND** PTC SHALL 通过宿主 `run_code` transport 调用同一 registry，而不是插件实现自己的代码执行或 agent loop。

#### Scenario: 文本模型不能冒充视觉验收

- **WHEN** 公共 DeepSeek V4 或其他只声明 `text` 的模型收到 snapshot 后的 deferred 图片上下文
- **THEN** Harness SHALL 在 provider dispatch 前把图片投影为稳定的 text-only omission placeholder，或明确拒绝图片
- **AND** clean-profile、首轮工具调用或 attachment 保存成功 MUST NOT 被报告为真实图片模型验收通过。

#### Scenario: rc.2 真实图片模型闭环

- **WHEN** 隔离 DSH `0.1.5-rc.2` profile 选择一个目录声明 `text,image` 且服务端真实接受图片输入的模型，并让 agent 对 Mock session 执行 `start → snapshot → visual-only description → observation-bound safe action → re-observe → stop`
- **THEN** 模型输出 MUST 正确描述至少一项 canonical JSON 和结构通道均未披露的 raster-only 特征
- **AND** agent MUST 使用 fresh `observationId` 执行安全动作、观察递增的 revision 并停止 session
- **AND** 验收证据 MUST 记录 Harness、adapter、provider 与 model 标识，但 MUST NOT 记录凭据、attachment bytes、本机绝对路径或 profile 私密配置。

#### Scenario: 物理 Android/iOS observation

- **WHEN** 已授权 Appium 屏幕内容且物理设备可用
- **THEN** 每个平台 SHALL 完成 `start → snapshot/inspect → agent 确认可见内容 → observation-bound safe action → re-observe → stop`
- **AND** 证据 SHALL 记录版本、非空有效 PNG、结构来源、坐标空间、动作后 revision 和插件自有 session 清理。
