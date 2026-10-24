## Context

基线 REDACTED_REVISION，最小闭环采用 AppClaw 2.7.0。现有 WorkbenchDevice.capture 在 geometry→PNG→XML 全部成功后才返回；服务随后落盘。Store 的文件先直接写入最终路径，崩溃可能遗留半文件或无 manifest 的证据。managed Appium 的直接 ChildProcess 不包含 detached WDA。

## Goals / Non-Goals

完成三项 P0：精确资源回收、可解释耗时/重复测量、部分证据保真。保留每步 PNG/XML 策略、声明 UI 验证范围、运行后 session-retained。无需模型、录像、多设备 daemon、外部进程接管；进程崩溃恢复不自动继续手机动作。

## Decisions

1. managed 启动注入每次唯一的进程所有权标记，只继承到本次子进程。仅在显式 managed 模式使用有界 ps 扫描记录 PID/开始时间/命令身份和父子关系；对 WDA xcodebuild 用继承标记补充 detached/reparent 情况。清理前再次核对身份，已观察的可信后代不依赖 macOS 可能隐藏的 Apple 进程环境；仅由标记认领的孤立进程仍复核标记。先 SIGINT 后有界升级；不按名字或端口批量 kill，不扫描 external/attached 模式。清理失败保留可重试 owner 状态。标记、PID、命令和环境不进入公开结果。
2. 计时使用 performance.now，记录阶段、步骤索引和成功/失败；Worker 回传原生步骤单调耗时，等待与执行器开销分别解释，队列与取证不伪装成设备动作耗时。启动只取屏幕几何，纯树查询不取几何，点击在派发前取得新几何检查边界；检查点不需要几何，只取新 PNG/XML，不缓存证据或并行控制。
3. 检查点在设备排他队列内依次尝试 PNG、XML，每件成功后立即独立持久化并保存引用，即使另一件失败也保留；收集所有错误并 fail closed。取消或进程终止不撤销已写材料。因源树和截图非原子，保存各自时间和总捕获窗。
4. 证据写入独占临时文件，fsync 后通过不可覆盖的发布方式变成最终文件；manifest 原子替换并同步目录。重启枚举受限文件名的最终材料与遗留临时材料，保留原始损坏文件，恢复副本标记为 recovered/unverified，最终 inconclusive，不推断原断言通过。不信任符号链接，读材料必须校验哈希。
5. Viewer 显示步骤耗时/阶段、捕获中的状态、部分证据与恢复提示；新增字段可选，兼容 schemaVersion 1 历史记录。超过 300ms 的过程通过 run 进度可见，失败保留原图。

## Risks / Trade-offs

ps 身份中的时间粒度受操作系统限制，需同时比较命令和持有标记；对不确定归属不执行 kill。无法证明进程扫描或停止成功时返回失败，不能显示已清理。此方案覆盖 macOS/Linux 的本机 managed 进程；external WDA 仍归外部 owner 管理。设备 WDA runner 安装留存与进程留存分开验收。

逐件持久化保证保真但增加同步 I/O；优化只消除与该用途无关的几何/源树调用，实际收益用同设备/用例/证据策略的重复样本验证，先记录预算，再评价达标，不能把 Mock 耗时当真机指标。

## Migration Plan

保持 schemaVersion 1，新增可选 timing/capture/recovery 字段。更新 ADR 0004/0006 和 TODO。先故障/进程隔离/原生 worker 测试，再四项门禁和可用真机重复测量；无可用设备的验收明确保留未完成。
