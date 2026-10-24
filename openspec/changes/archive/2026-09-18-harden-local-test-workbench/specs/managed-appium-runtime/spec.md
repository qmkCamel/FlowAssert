## ADDED Requirements

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
