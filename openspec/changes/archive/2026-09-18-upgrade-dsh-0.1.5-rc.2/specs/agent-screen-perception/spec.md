## MODIFIED Requirements

### Requirement: 跨 Provider 验收必须区分确定性测试与物理设备证明

实现 SHALL 使用 Mock、Appium fake server 和 DeepSeek Harness `0.1.5-rc.2` clean profile 覆盖确定性契约、Native/PTC attachment/deferred context 与动作闭环。模型目录声明、attachment 保存或图片序列化成功 MUST NOT 单独报告为真实图片理解；真实模型与物理设备证据 SHALL 分开记录。

#### Scenario: Mock agent 感知闭环

- **WHEN** runtime probe 使用 Mock 调用 start、snapshot、inspect、带 observation 的安全 action、再 observe、stop
- **THEN** 图片/结构 SHALL 反映共享 screen model 的 action revision
- **AND** stop 后旧 observation SHALL 被拒绝。

#### Scenario: Appium 假服务器契约

- **WHEN** 单测 server 返回 Android/iOS screenshot、rect、orientation、source 及异常/超限响应
- **THEN** 测试 SHALL 验证 endpoint、规范化、限制、错误码、脱敏、epoch、坐标映射和 session 清理
- **AND** 结果 MUST 标记为协议测试而非真机测试。

#### Scenario: rc.2 Native/PTC clean-profile 闭环

- **WHEN** 隔离 DSH `0.1.5-rc.2` profile 从同一 packed tarball 安装插件，并分别使用 Native 与 PTC 呈现执行 Mock lifecycle
- **THEN** 两种模式 SHALL 注册同样的十项工具、产生 deferred image context、递增 revision 并拒绝 stale observation
- **AND** PTC SHALL 通过宿主 `run_code` 调用同一 registry。

#### Scenario: 模型图片能力边界

- **WHEN** clean-profile probe 检查宿主模型目录和 deferred 图片上下文
- **THEN** 探针 SHALL 按模型声明区分 text-only 与 `text,image`
- **AND** 未发起真实 provider 请求时 MUST NOT 声称完成图片理解验收。

#### Scenario: rc.2 真实图片模型闭环

- **WHEN** 隔离 DSH `0.1.5-rc.2` profile 选择一个目录声明 `text,image` 且服务端真实接受图片输入的模型，并让 agent 对 Mock session 执行 `start → snapshot → visual-only description → observation-bound safe action → re-observe → stop`
- **THEN** 模型输出 MUST 正确描述至少一项 canonical JSON 和结构通道均未披露的 raster-only 特征
- **AND** agent MUST 使用 fresh `observationId` 执行安全动作、观察递增的 revision 并停止 session
- **AND** 验收证据 MUST 记录 Harness、adapter、provider 与 model 标识，但 MUST NOT 记录凭据、attachment bytes、本机绝对路径或 profile 私密配置。

#### Scenario: 文本模型不能冒充视觉验收

- **WHEN** 公共 DeepSeek V4 或其他只声明 `text` 的模型收到 snapshot 后的 deferred 图片上下文
- **THEN** Harness SHALL 在 provider dispatch 前把图片投影为稳定的 text-only omission placeholder，或明确拒绝图片
- **AND** 首轮工具调用成功、attachment 保存成功或 Viewer 可见 MUST NOT 被报告为真实图片模型验收通过。

#### Scenario: 物理 Android/iOS observation

- **WHEN** 已授权 Appium 屏幕内容且物理设备可用
- **THEN** 每个平台 SHALL 完成 `start → snapshot/inspect → agent 确认可见内容 → observation-bound safe action → re-observe → stop`
- **AND** 证据 SHALL 记录版本、非空有效 PNG、结构来源、坐标空间、动作后 revision 和插件自有 session 清理。
