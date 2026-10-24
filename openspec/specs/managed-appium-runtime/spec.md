# managed-appium-runtime Specification

## Purpose
定义显式启用的本机 Appium 运行时管理、命令来源校验和进程所有权；受管进程与外部现有服务必须区分，断开和失败恢复只清理由本工具可靠标识的资源。

## Requirements

### Requirement: Managed Appium 必须显式 opt-in 且只允许确定性 loopback 命令

配置 SHALL 提供 `appiumRuntimeMode=external|managed` 和 `appiumExecutablePath`；默认 external SHALL 保持现有行为。managed 模式 MUST 要求 executable 是显式绝对可执行文件、`appiumUrl` 是 HTTP loopback，并从 URL 派生固定 address/port/base-path 参数。作为唯一例外，loopback Viewer 的连接助手可以在用户显式检查并再次确认启动后，把已验证且未向客户端公开的绝对 Appium 路径装载为一次性 managed 候选。runtime 本身 MUST NOT 搜索 PATH、接受任意 shell 字符串/额外参数或自动安装升级 Appium/driver。

#### Scenario: External 模式保持兼容

- **WHEN** 用户没有配置 managed 模式、也没有确认一次性助手启动，并启动 Appium provider
- **THEN** runtime SHALL 直接连接既有 `appiumUrl`，行为与当前 external Appium 相同
- **AND** stop/dispose MUST NOT 向任何外部 Appium 进程发送 signal

#### Scenario: Managed 配置无效

- **WHEN** executable 为空/相对/不可执行，或 `appiumUrl` 为远程 host、HTTPS、带凭据或无效 URL
- **THEN** 配置或 start SHALL 在 spawn 前 fail closed 并返回稳定错误码
- **AND** MUST NOT 回显 executable path、URL credentials 或启动参数

#### Scenario: 连接助手装载一次性候选

- **WHEN** 用户消费一个未过期助手上下文并确认启动已通过版本与可执行检查的绝对 Appium 候选
- **THEN** runtime SHALL 仅为这次连接把该候选视为 managed executable
- **AND** 公共 state MUST NOT 暴露路径、发现方式或命令输出

#### Scenario: Managed 模式附着外部 session

- **WHEN** managed 模式或一次性 managed 启动的 start 输入包含外部 `sessionId`
- **THEN** runtime SHALL 在创建子进程前拒绝并提示改用 external 模式
- **AND** MUST NOT 探测、删除或接管该 session

### Requirement: Managed Appium 必须 lazy 启动并等待真实 ready

只有 `mobile_mirror_start(provider=appium)` 或 loopback Viewer 中经用户确认的助手连接 SHALL 触发 managed Appium；插件/MCP server 初始化、Mock、list、status、doctor、普通助手检查和 config MUST NOT 启动子进程。runtime SHALL 先检查目标 listener 冲突，再以 `spawn(shell=false)` 创建唯一 child，并轮询有界 `/status`，只有 Appium 报告 ready 后才能创建 provider session。

#### Scenario: 首次 managed start 成功

- **WHEN** 目标端口空闲、显式或一次性确认的 executable 启动并在 timeout 内返回有效 ready status
- **THEN** state SHALL 从 starting-appium 进入 provider connecting/streaming，并标记 owned managed child
- **AND** Viewer/status/progress 在启动超过 300 ms 时仍 SHALL 可见，其他只读 status 控件保持可响应

#### Scenario: 普通助手检查不启动进程

- **WHEN** 用户仅运行 Android 或 iOS 连接助手检查并查看 Appium/UiAutomator2 或 Appium/XCUITest 状态
- **THEN** runtime MUST NOT spawn Appium、占用 listener 或改变 owned 状态
- **AND** 只有后续独立的确认连接请求才可消费一次性候选

#### Scenario: 目标 listener 已被占用

- **WHEN** spawn 前目标 `/status` 已由健康 Appium listener 响应或端口被其他进程占用
- **THEN** managed start SHALL 返回稳定 listener-conflict 错误并建议 external 模式或更换 loopback port
- **AND** runtime MUST NOT attach、终止、重启或修改占用者

#### Scenario: 启动取消或提前退出

- **WHEN** child 在 ready 前退出、ready timeout 或 start signal 被取消
- **THEN** runtime SHALL 中止轮询、等待本次 child 静止并返回稳定脱敏错误
- **AND** 未完成 Appium provider session MUST NOT 发布为 streaming，后续 start SHALL 可安全重试

### Requirement: Managed Appium 必须精确拥有并清理唯一子进程

runtime SHALL 保存自己创建的 child handle、单一 in-flight start 和有界 stdout/stderr；公共 state 只能暴露 mode、phase、owned 和稳定 error code。正常 stop、start failure 与 dispose SHALL 按媒体 → provider-owned session → managed Appium child 顺序清理；attached/external process MUST NOT 受影响。

#### Scenario: 正常停止 managed session

- **WHEN** owned Appium session 正在运行且用户调用 stop
- **THEN** runtime SHALL 先停止媒体并删除 owned session，再向保存的 Appium child 发送 SIGTERM，超时后只对同一 handle 使用 SIGKILL
- **AND** stop 返回后该 child 与目标 listener SHALL 消失，状态 SHALL 回到 idle/not-owned

#### Scenario: Runtime dispose 与 stop 并发

- **WHEN** EOF/signal/dispose 与显式 stop 同时发生
- **THEN** cleanup SHALL 幂等汇合，只执行一次 provider 和 child 清理
- **AND** MUST NOT 扫描进程表、使用 pkill、按端口终止未知进程或删除系统安装

#### Scenario: Provider session 创建失败

- **WHEN** Appium 已 ready 但 W3C session 因 capabilities、WDA 或 UiAutomator2 失败
- **THEN** runtime SHALL 保留稳定 provider 错误供 status/Viewer 显示，并清理本次 managed child
- **AND** Viewer SHALL 保留上一可用画面，错误输出 MUST NOT 包含 capabilities、设备 ID、路径或 Appium 原始日志

### Requirement: Managed Appium 必须经过确定性生命周期测试

自动化 SHALL 使用可注入 fake executable/status server/process runner 覆盖 ready、慢启动、冲突、提前退出、取消、provider 失败、SIGTERM/SIGKILL、重复 stop 和 external no-op。真实 release gate SHALL 至少从 packed artifact 启动一个 loopback managed Appium，完成 Mock-independent status readiness 与精确关闭；物理 Android/iOS session 继续作为独立证据层。

#### Scenario: Fake 生命周期矩阵

- **WHEN** 单元/集成测试执行所有 managed/external 分支
- **THEN** 每个分支 SHALL 断言 spawn 参数、状态转换、进度、错误码和 child 清理次数
- **AND** 测试 MUST 证明没有 shell、PATH 搜索、宽泛进程清理或外部 listener 终止

#### Scenario: Release runner managed smoke

- **WHEN** release candidate tarball 安装到干净目录且 runner 提供显式 Appium executable
- **THEN** onboarding doctor SHALL 识别其版本，managed runtime SHALL 达到 ready 并在 stop 后释放 listener
- **AND** 该结果 SHALL 标记为 host-process/runtime 验收，MUST NOT 冒充物理设备、WDA 或 UiAutomator2 session 证明

### Requirement: 一次性 managed 候选必须被原子装载和清除

一次性 Appium 候选 SHALL 与未过期 `assistantId` 绑定，并由扩展既有 `AppiumRuntimeLifecycle` 的受控接口原子装载。候选 MUST 在首次 `ensureReady` 开始时、助手上下文过期时、显式取消时或 runtime dispose 时清除；失败重试需要重新检查和确认，且 MUST NOT 回退到 PATH 搜索。

#### Scenario: 并发连接争用同一候选

- **WHEN** 两个连接请求并发消费同一个一次性候选
- **THEN** 只有一个请求 SHALL 原子获得候选并进入启动流程
- **AND** 另一个请求 SHALL 在 spawn 前收到稳定 stale/consumed 错误

#### Scenario: 候选过期但尚未使用

- **WHEN** 助手上下文到期且 Appium 尚未启动
- **THEN** runtime SHALL 清除保存的绝对路径和授权
- **AND** 后续普通 Appium start SHALL 继续遵循持久配置中的 external/managed 模式

### Requirement: Appium server ready 与设备 session cold start 必须使用独立 timeout

配置 SHALL 提供独立的 `appiumSessionStartupTimeoutMs`，默认 120 秒，用于 Appium provider 创建 Android/iOS 真机 session；既有 `startupTimeoutMs` SHALL 继续约束 managed Appium `/status` ready、Mock start 与首次兼容帧。session 建立后的 screenshot/action/media timeout MUST NOT 因 cold-start 上限而放宽，所有阶段仍必须响应取消信号。

#### Scenario: iOS 首次 WDA 启动超过 server ready timeout

- **WHEN** managed Appium 已在 `startupTimeoutMs` 内 ready，但 XCUITest 首次编译/安装 WDA 用时超过该值且未超过 `appiumSessionStartupTimeoutMs`
- **THEN** MirrorService SHALL 继续等待 session 创建而不是在 30 秒处终止 owned child
- **AND** Viewer SHALL 保持局部 connecting 进度、stop/取消能力与脱敏状态

#### Scenario: session cold start 超过独立上限

- **WHEN** Appium session 创建超过 `appiumSessionStartupTimeoutMs` 或用户取消
- **THEN** 系统 SHALL 中止本次 provider start、清理 owned session/child 并返回稳定脱敏错误
- **AND** MUST NOT 自动重试可能产生副作用的 session 创建

### Requirement: owned managed Appium 停止必须提供最终清理边界

停止 SHALL 先关闭 Viewer 媒体并尝试删除 provider-owned session，再停止本次 runtime 明确拥有的 managed Appium child。若 session DELETE 失败但 owned child 在有界时间内成功静止，系统 SHALL 以 child shutdown 的 active-session cleanup 作为最终清理边界并返回 idle；若 child 停止失败则仍 MUST 返回稳定错误。external Appium 不具备该替代边界，任何 owned session DELETE 失败仍 SHALL 报告且 MUST NOT 终止外部 listener。

#### Scenario: managed session DELETE 与停止竞争

- **WHEN** provider-owned session DELETE 在 managed stop 期间失败，但本次 owned Appium child 随后成功静止
- **THEN** MirrorService SHALL 返回无残留错误的 idle 状态
- **AND** 旧 Viewer frame 请求 MUST NOT 在 stop 后重新写入 session-command 错误

#### Scenario: external session DELETE 失败

- **WHEN** external Appium 上由 FlowAssert 创建的 session 无法删除
- **THEN** MirrorService SHALL 保留稳定停止错误供用户处理
- **AND** MUST NOT 终止或接管 external Appium listener

### Requirement: Owned descendant cleanup
显式 managed Appium SHALL 记录本次创建的宿主进程身份和 detached WDA 归属，在断开、启动失败/取消、服务关闭时有界清理这些资源。每次发送信号前 MUST 核对进程身份；外部或不确定归属进程不得被终止。清理错误 MUST 可见并保留重试能力。
#### Scenario: Detached WDA outlives Appium
- **WHEN** 本次 xcodebuild 已 detached 或父进程已退出
- **THEN** 用已记录身份及本次继承标记确认归属后停止它，未归属的同名进程继续运行。
#### Scenario: Reused identity or discovery failure
- **WHEN** PID 已复用或无法完成归属复核
- **THEN** 不发送破坏性信号；无法证明清理完成时报告失败。
#### Scenario: macOS hides the WDA environment
- **WHEN** 已观察到 WDA 属于经标记确认的 Appium 进程谱系，而 macOS 不向 ps 暴露 WDA 环境
- **THEN** 可以在复核已记录 PID、开始时间、命令身份后清理该后代；未观察到谱系且无法确认标记的同名进程不得认领。
#### Scenario: External owner
- **WHEN** 用户使用 external Appium 或附着 session
- **THEN** 不启用宿主进程扫描/回收，保留既有会话清理边界。
