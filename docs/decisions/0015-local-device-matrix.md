# ADR 0015：本机双槽设备矩阵

状态：工程实现；真实双设备验收待完成。对应 `add-local-ocr-and-device-matrix`。不改变单设备默认入口，不修改 Harness agent loop。

## 所有权与运行时

父协调器只有持久调度和私有 IPC 能力。每槽独立子进程拥有单设备运行时、MirrorService、WorkbenchApplication、可写 Store 和 Appium 会话。两槽最大并发 2、每槽串行、固定 FIFO，矩阵最多 100 个单元。父子消息绑定 matrixId、slotId、attemptId、generation、单调 sequence。输入只能引用本机登记项，HTTP 不接受进程路径或任意工作目录。

启动分为 prepare 和 execute：两槽先认领明确 UDID、预检端口和私有目录、校验冻结项目并预留容量；全部准备成功后才创建会话并执行。实际控制仍经 MirrorService/provider。进程退出不等于设备动作已确认结束；未知写入或清理结果必须隔离，禁止自动重放、迁移或抢占。

## 储存与恢复

协调器发布输入快照、逐 attempt 日志和不可覆盖的终态版本。各子 Store 由一个进程写入，发布 `matrix:attempt` 引用保护材料；只读访问走登记 storeId，不接受任意路径。在线通过子 owner 读取，离线读取获得互斥 owner 后仅调用无恢复写入的读取 API。原失败、取消与复验不能相互覆盖。

断线仅阻断该槽；全局取消停止新派发，单槽取消保持另一槽工作。父／子崩溃保留 interrupted 和未知资源，不自动释放不能确认的 claim。显式复跑必须确认先前会话结束、有注册的安全重置契约，另建 attempt。PID、启动身份、nonce 和 generation 一起判断 owner，不能只按 PID 杀进程。

## 入口

Viewer／CLI 可在明确本机授权后启动、取消、复跑。MCP 和 DSH 仅共享只读矩阵摘要；旧单设备工具不得转向任意槽位。媒体只在选择的槽位由本机 Viewer 消费，不进入工具结果。

## 验证

双 Mock、伪 Appium、真实子进程和故障注入证明工程隔离；不能替代 Android＋iPhone 的真实业务／断线／重连质量验收。真实条件不足时不归档、不宣称生产验证完成。
