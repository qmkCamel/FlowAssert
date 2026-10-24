## Why

第三方 App双端工作台已形成最小闭环，但 WDA xcodebuild 的 detached 启动会绕过直接子进程清理；取证遇到源树错误会丢掉已成功截图；目前缺少可解释的步骤性能分解和可恢复的部分证据。需要实现 PRODUCT_TODO 的三项 P0，让结果可信且可以重复计时。

## What Changes

- managed Appium 的显式启动授权扩展为本次进程谱系的记录与精确回收，包含 detached WDA；external/attached 会话不扫描或杀外部进程，运行结束仍保留 session，断开/启动失败/关闭时清理。
- 每步提供定位源树、动作、等待、几何、PNG/XML、落盘和复核耗时；去掉纯源树/启动/非坐标操作不需要的几何读取，保留所有必需新截图与源树。
- 截图和源树独立尝试与落盘，错误、取消、磁盘失败和中断保留已有材料；原子发布证据和 manifest，重启恢复孤立材料但不补造通过。
- Viewer 展示计时、取证进度和恢复材料，保持历史/主题/媒体交互；更新双端可复用探针与验证记录。

## Capabilities

### New Capabilities
- `workbench-reliability`: 工作台取证、计时与异常恢复补强，承接 active local-test-workbench。

### Modified Capabilities
- `managed-appium-runtime`: 对本次拥有的宿主进程明确记录、回收和失败状态。

## Impact

涉及 streaming-host-process、managed-appium-runtime、workbench device/service/store、Viewer、测试/真机探针及 ADR 0004/0006。不增加模型、控制栈、任意 YAML 代码或自动发布；DSH 仍固定 0.1.2-rc.1。过程身份只留本机，工具结果不含 PID/命令/环境或连续媒体。
