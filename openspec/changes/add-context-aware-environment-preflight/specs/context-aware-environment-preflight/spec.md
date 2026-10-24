## Purpose

定义按使用入口、本次操作、设备 provider、平台与已选功能生成环境预检的行为契约，使用户只为实际需要的依赖处理问题，并将环境前提、人工确认与真实运行成功清晰分开，避免无关依赖阻塞或局部通过被误报为全部能力可用。

## ADDED Requirements

### Requirement: 预检必须由明确的使用上下文决定

系统 SHALL 根据入口 `viewer|mcp|dsh|cli`、操作 `runtime|report|mock|connect|test`、provider、所选平台和功能策略生成检查集合。`codex` SHALL 归一为 MCP 入口。系统 MUST NOT 因为安装了某个宿主、存在某环境变量或某目录中出现某个依赖而扩大检查范围。非法或互相冲突的选择 MUST 在任何命令或网络请求前拒绝。

#### Scenario: Codex 不依赖 DSH

- **WHEN** 用户选择 Codex/MCP 入口，无论机器是否安装 DSH 或其版本是否匹配
- **THEN** 预检 MUST NOT 执行 DSH 命令、读取 DSH profile 或展示 DSH 缺失、过期、不适用项目
- **AND** MCP 配置前提与设备/功能依赖 SHALL 只根据本次操作检查

#### Scenario: 未选择手机操作

- **WHEN** 用户选择基础运行、报告阅读或 Mock，且未选择任何需要外部依赖的功能
- **THEN** 预检 MUST NOT 请求 Appium、调用 ADB/scrcpy/Xcode/xcrun/security 或枚举真实设备
- **AND** 未安装或未连接这些依赖 MUST NOT 阻塞当前操作

#### Scenario: 显式选择平台

- **WHEN** 用户准备 Android 真机连接或测试
- **THEN** 预检 SHALL 只选择 Android 所需设备检查，不执行 iOS 命令
- **AND** iOS 选择 SHALL 对称地排除 Android 命令；只有显式选择 all 才检查两端

#### Scenario: 冲突输入不产生副作用

- **WHEN** 输入同时要求 Mock 和真机连接、给非 DSH 入口传 DSH 路径、提供未知功能或给报告操作选择手机平台
- **THEN** 系统 SHALL 返回稳定参数错误
- **AND** host command、HTTP、设备枚举和配置写入计数 MUST 均为零

### Requirement: 无关依赖与可选功能必须和必要条件分开判定

系统 SHALL 将功能选择分为 `off|preferred|required`。off 项 MUST 不执行、不展示；preferred 项失败 SHALL 只影响对应功能，保留已声明且安全的降级路径；required 项不能满足时 SHALL 阻止本次要求该功能的操作。报告 SHALL 分别表达阻塞、缺失确认、可用降级与尚未实测，不得用单一绿色标记覆盖未知状态。

#### Scenario: scrcpy 不阻塞基础 PNG 路径

- **WHEN** 用户选择 Android 基础连接，媒体为 preferred，scrcpy 不存在或不是受支持版本
- **THEN** 报告 SHALL 给出媒体不可用/PNG 降级提示而不阻塞已满足其他前提的基础连接
- **AND** 系统 MUST NOT 自动搜索、安装或执行其他 scrcpy

#### Scenario: 必需媒体与可选媒体不同

- **WHEN** 用户明确要求低延迟媒体且相应前提不可用
- **THEN** 当前媒体必需操作 SHALL 被阻止，不得悄悄降为 PNG 并宣称满足要求
- **AND** 用户取消该要求后 SHALL 能重新检查基础路径

#### Scenario: 已登记测试声明了必要扩展

- **WHEN** 已登记测试使用已批准 OCR 断言、必需录像或受控 AI 恢复
- **THEN** 有效计划 SHALL 合并测试与项目的必要前提，用户不能以 off 覆盖必需断言或录制要求
- **AND** 未选择这些扩展的其他测试和历史报告 SHALL 不受其缺失影响

### Requirement: DSH 检查必须指向实际选定宿主

仅 DSH 入口 SHALL 允许读取用户显式登记的本机 DSH executable 与 profile 范围，检查精确版本 `0.2.0-rc.2`、有效运行依赖及 FlowAssert 插件登记。缺少目标、版本不匹配、依赖混装、元数据不可解析或目标身份不确定 MUST NOT 被报告为 DSH ready。系统 MUST NOT 使用仓库开发依赖、PATH 中另一份 dsh 或未执行的历史探针证明该宿主兼容。

#### Scenario: 精确版本通过

- **WHEN** 显式选定的 executable 返回精确支持版本，所选 profile 的有效插件及所需依赖均匹配
- **THEN** 报告 SHALL 显示 DSH 环境前提通过以及期望/观察到的公开版本
- **AND** SHALL 明确这不证明 Native/PTC 工具实调、模型图片消费或真机操作已成功

#### Scenario: 多份安装与 prerelease 不匹配

- **WHEN** PATH 上的 dsh 正确，但用户选定 executable 返回旧 rc、未来 alpha、正式版或混有额外未识别内容的输出
- **THEN** 预检 SHALL 根据选定 executable 拒绝或报告未确认，不回退到 PATH
- **AND** 该结果 MUST NOT 阻塞独立 Viewer、MCP 或 CLI 操作

#### Scenario: 只有 CLI 版本匹配但 profile 未确认

- **WHEN** executable 版本正确，但所选 profile 无插件、其有效 peer 不匹配或缺少可验证的登记元数据
- **THEN** 报告 SHALL 将缺项独立列出并保持 blocked 或 incomplete
- **AND** MUST NOT 通过生成 profile、安装插件、执行 config dump 或启动另一个宿主来假装检查完成

### Requirement: 预检必须只读并保留既有授权边界

预检 MUST 使用有界、可取消、无 shell 的命令边界，只允许固定只读命令及明确授权的有限元数据读取。默认总时限 SHALL 不超过 60 秒，单命令不超过 20 秒、输出上限 1 MiB，并发最多 3 项；未开始的后续检查在取消后 MUST NOT 派发。预检 MUST NOT 安装/升级依赖、编译 OCR、启动 Appium/WDA 或 DSH Web/Agent 宿主、创建设备 session、申请签名、修改 profile 或调用真实模型。显式 DSH 目标的固定 `--version` 查询属于允许的只读命令，不属于启动第二个运行宿主。

#### Scenario: 慢检查或取消

- **WHEN** 必要检查超时或用户取消正在进行的检查
- **THEN** 必要结果 SHALL 保持未完成/失败，不能因为缺少返回结果而变成 ready
- **AND** 系统 SHALL 中止自有命令、停止后续派发，且不影响外部服务或其他用户会话

#### Scenario: 签名诊断未授权

- **WHEN** 用户选择 iOS 但未授权签名诊断
- **THEN** 系统 MUST NOT 读取签名私密材料或启用 provisioning
- **AND** 报告 SHALL 列出待人工确认项，实际连接继续遵循现有授权与确认路径，不用预检替代确认

#### Scenario: 输出包含敏感字段

- **WHEN** 依赖输出、路径、异常或 profile 元数据包含设备标识、账号、签名、token、绝对路径或堆栈
- **THEN** 对外报告及日志 SHALL 仅保留稳定代码、公开版本、数量、布尔值和静态处理建议
- **AND** 超限、格式错误及异常 MUST NOT 原样回显

### Requirement: 预检结果必须绑定范围而非授予执行权限

报告 SHALL 包含规范化上下文、检查完成时间、分项作用范围及原始完成状态；ready SHALL 仅说明本次已选前提可用。旧结果 MUST NOT 作为跨平台、跨 provider、跨配置修订或跨宿主的执行授权；实际操作 SHALL 继续执行设备/项目权限、会话所有权、版本身份和必需能力校验。

#### Scenario: 检查后目标改变

- **WHEN** 用户切换平台/provider、修改 DSH executable/profile 或选择另一个已登记测试
- **THEN** 旧报告 SHALL 只可作为历史结果阅读，不得启用新目标操作
- **AND** 延迟返回的旧检查 MUST NOT 覆盖新目标报告或恢复旧按钮状态

#### Scenario: 环境前提不是运行验收

- **WHEN** 只读检查均通过
- **THEN** 页面及 CLI SHALL 将状态描述为所选环境前提通过
- **AND** MUST NOT 把 WDA 未启动、MCP 未握手、DSH 工具未调用或模型未发请求标为已验证
