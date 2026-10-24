## ADDED Requirements

### Requirement: Managed Appium 必须显式 opt-in 且只允许确定性 loopback 命令

配置 SHALL 提供 `appiumRuntimeMode=external|managed` 和 `appiumExecutablePath`；默认 external SHALL 保持现有行为。managed 模式 MUST 要求 executable 是显式绝对可执行文件、`appiumUrl` 是 HTTP loopback，并从 URL 派生固定 address/port/base-path 参数；MUST NOT 搜索 PATH、接受任意 shell 字符串/额外参数或自动安装升级 Appium/driver。

#### Scenario: External 模式保持兼容

- **WHEN** 用户没有配置 managed 模式并启动 Appium provider
- **THEN** runtime SHALL 直接连接既有 `appiumUrl`，行为与当前 external Appium 相同
- **AND** stop/dispose MUST NOT 向任何外部 Appium 进程发送 signal

#### Scenario: Managed 配置无效

- **WHEN** executable 为空/相对/不可执行，或 `appiumUrl` 为远程 host、HTTPS、带凭据或无效 URL
- **THEN** 配置或 start SHALL 在 spawn 前 fail closed 并返回稳定错误码
- **AND** MUST NOT 回显 executable path、URL credentials 或启动参数

#### Scenario: Managed 模式附着外部 session

- **WHEN** managed 模式的 start 输入包含外部 `sessionId`
- **THEN** runtime SHALL 在创建子进程前拒绝并提示改用 external 模式
- **AND** MUST NOT 探测、删除或接管该 session

### Requirement: Managed Appium 必须 lazy 启动并等待真实 ready

只有 `mobile_mirror_start(provider=appium)` SHALL 触发 managed Appium；插件/MCP server 初始化、Mock、list、status、doctor 和 config MUST NOT 启动子进程。runtime SHALL 先检查目标 listener 冲突，再以 `spawn(shell=false)` 创建唯一 child，并轮询有界 `/status`，只有 Appium 报告 ready 后才能创建 provider session。

#### Scenario: 首次 managed start 成功

- **WHEN** 目标端口空闲、显式 executable 启动并在 timeout 内返回有效 ready status
- **THEN** state SHALL 从 starting-appium 进入 provider connecting/streaming，并标记 owned managed child
- **AND** Viewer/status/progress 在启动超过 300 ms 时仍 SHALL 可见，其他只读 status 控件保持可响应

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
