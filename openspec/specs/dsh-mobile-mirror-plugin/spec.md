# flowassert Specification

## Purpose
Define the installable DeepSeek Harness adapter and its documented tool-registration boundary.

## Requirements

### Requirement: Installable DeepSeek Harness bundle

package SHALL 声明一个插入schema校验Cordis插件行的bundle patch，且只通过documented effects/registries注册行为。当前验证宿主包 MUST 精确固定为 `0.2.0-rc.2`，直到后续版本完成同等clean-profile验收。经过校验的GitHub prerelease tarball SHALL 无需源码构建即可安装；带有新查询能力的发布 MUST 使用新的版本和asset，不替换既有alpha资产。缺少匹配可安装npm包的新源码tag MUST 不被声明为支持宿主。

#### Scenario: Installing the current bundle in an rc.2 profile

- **WHEN** 用户将当前预构建包通过 `dsh plugin --profile <name> add <package>` 安装到隔离的DSH `0.2.0-rc.2` profile
- **THEN** bundle list SHALL 包含该包，dump-config SHALL 包含mobile-mirror行
- **AND** Native/PTC SHALL 各注册当前二十项canonical工具，dispose SHALL 关闭所拥有的宿主资源

#### Scenario: Installing the semantic-actions prerelease

- **WHEN** 用户安装历史semantic-actions版本到它已验证的精确宿主
- **THEN** 其已发布schema/viewer/runtime SHALL 按该版本的九工具契约完成原Mock闭环
- **AND** MUST NOT 为新查询功能重写旧asset或把历史证据改成十工具验收

#### Scenario: Installing the alpha prerelease

- **WHEN** 用户下载0.1.0-alpha.1的prerelease tarball、验证SHA256并安装到历史rc.8 profile
- **THEN** DSH SHALL 按历史版本从tarball加载schema/viewer/runtime并完成原Mock闭环
- **AND** 安装 MUST 不要求Git checkout、仓库构建或npm publish

#### Scenario: Detecting Harness version drift

- **WHEN** 依赖、lockfile、peer、当前文档或runtime/clean-profile probe不再指向0.2.0-rc.2及native/ptc
- **THEN** contract validation MUST 失败
- **AND** 新预览版 MUST 完成精确版本安装、Native/PTC与package门禁后才成为支持基线

#### Scenario: Reviewing a newer unpublished source tag

- **WHEN** GitHub存在更新tag但对应root/subpackages无法从公共registry安装
- **THEN** 文档 SHALL 将其源码观察与已验证支持矩阵区分并标注时间/tag
- **AND** peer与runtime probe MUST 保持已完成可复现验收的精确版本


#### Scenario: New runtime rejects an incompatible bundle

- **WHEN** 当前插件安装到不满足其精确 DSH peer 的宿主
- **THEN** 兼容检查 MUST 标记不兼容，默认 MUST NOT 激活插件
- **AND** 当前支持声明 MUST NOT 依赖版本豁免绕过验收

#### Scenario: Live and startup-only profile lifecycle

- **WHEN** 隔离宿主以默认 live HMR 或明确禁用 HMR 的 startup 配置启动并运行 Mock 探针
- **THEN** 二十工具及图片上下文 MUST 保持一致，SIGTERM 后监听和插件自有设备会话 MUST 清理
- **AND** 默认 live 配置的有效插件设置变更 MUST 生效，失败配置 MUST 保留上一个可用实例

### Requirement: Compact agent tools

插件 SHALL 暴露device discovery、iOS preflight、start、status、snapshot、screen inspection、screen query、action、app management与stop共十工具；canonical结果 SHALL 有界，不携带continuous media或秘密文本。动作、应用管理、summary投影和query SHALL 使用共享command/core；DSH adapter MUST 不定位节点、查询原始source、持久保存输入、授权app id或直接访问Appium。query SHALL 返回JSON data，MUST 不调用saveImage或deferContext。

#### Scenario: Running the Mock semantic lifecycle

- **WHEN** Agent在Mock中观察、执行tap_node/input_text、管理mock app、读status并stop
- **THEN** 原revision/epoch/control进度与输入/app id不回显规则 SHALL 保持兼容
- **AND** Native/PTC SHALL 使用相同十工具contract且不要求物理设备

#### Scenario: Running the Mock lifecycle

- **WHEN** Agent启动Mock、读状态、执行tap并停止
- **THEN** 状态 SHALL 经过connecting/streaming/idle并包含原Viewer URL、session ID、帧时间与last action
- **AND** 不要求物理设备

#### Scenario: Existing eight-tool calls remain compatible

- **WHEN** 旧客户端以原参数调用最初八工具或后续增加的manage_app
- **THEN** canonical JSON、原inspect默认full、attachment/deferred context、ownership和错误 SHALL 保持兼容
- **AND** 新query MUST 不导致旧名称、action kind或已发布版本历史计数被改写

#### Scenario: 摘要观察与纯查询

- **WHEN** Native/PTC执行summary inspect且不请求图片，再执行find/get/subtree
- **THEN** 初始结果 SHALL 不含nodes，query SHALL 只返回匹配的有界结构
- **AND** 全链 SHALL 不生成图片附件或额外deferred context；共享parser负例 SHALL 在两种模式中等价拒绝

### Requirement: Cancellation and failure visibility

Provider calls SHALL honor the tool cancellation signal and a configured timeout, and failures SHALL remain visible in status.

#### Scenario: Provider startup fails

- WHEN the Appium server is unreachable or startup is cancelled
- THEN the start tool fails with an actionable message
- AND status becomes error rather than streaming
- AND no provider-owned session is leaked.
