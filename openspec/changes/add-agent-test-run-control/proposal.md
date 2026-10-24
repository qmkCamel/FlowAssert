## Why

双端固定回归、业务验证和有限恢复已有可回溯证据，但 Agent 只能直接观察/操作设备，不能通过统一工具管理已登记的测试。补充运行级契约，让 Codex/DSH 启动同一套确定性工作台并读取真实判定，避免模型重复生成逐步点击和自行猜测测试结果。

## What Changes

- 新增五个共享工具：test_catalog、run_start、run_status、run_cancel、run_evidence，统一加 mobile_mirror_ 前缀；支持已登记单流程和串行套件。
- LocalDeviceRuntime 持有唯一工作台协调器，Viewer、CLI、MCP/DSH 复用；保留 Appium/MirrorService 执行路径。
- 引入持久受理 journal、请求幂等、断连取消、重启只回查和有界证据投影；既有 verdict/CI 语义不改变。
- 对本工具创建的进程增加同设备 owner claim，第二进程失败关闭；首期不做共享 daemon 或多宿主同时控制。
- 默认不开启 Agent 测试入口；本机明确配置 project、允许的 flow/suite 和证据分享范围。工具参数不接受路径、YAML、代码或密钥。
- 默认不做历史兼容或 YAML 版本分支；保留历史证据原件，旧记录不会补造受理来源。

## Capabilities

### New Capabilities
- `agent-test-run-control`: 登记发现、幂等受理、状态/取消、证据读取、宿主一致性与生命周期。
- `local-device-owner-claim`: 本机各内置 runtime 对显式设备的互斥占用及失效确认。

### Modified Capabilities
无既有主规格替换；新增工具和 owner 约束作为上述增量能力，既有设备工具及运行判定保持。实现时同步工具枚举/安装契约和 ADR 0008；不重写历史验收数量。

## Impact

影响 LocalDeviceRuntime、ViewerServer 的工作台依赖注入、MobileMirrorCommands、tool-contracts、MCP 与 Cordis 注册、WorkbenchService/Suites 的受理时序、证据存储及配置。首期 Android/iOS 本机真机、一个显式设备和当前已验证 DSH 0.1.5-rc.2；不引入 PTC runtime、云服务或第二执行器。新增私有 owner/request journal；它是协作互斥而非对恶意同用户进程的安全沙箱。
