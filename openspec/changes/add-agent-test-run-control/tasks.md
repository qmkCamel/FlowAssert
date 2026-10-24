## 1. 协调器与配置

- [x] 1.1 引入默认关闭的 Agent 测试配置、登记目标与分享白名单；验证路径/YAML/密钥/未知字段拒绝及 catalogRevision 漂移。
- [x] 1.2 将工作台/套件创建与关闭集中到 runtime 协调器，注入 Viewer/CLI/命令层；验证同实例、互斥和关闭顺序，无第二 worker owner。
- [x] 1.3 实现本机显式设备 claim；用两个不同 runsDir 的进程验证竞争、PID 复用、nonce 释放、清理失败及旧 claim 不能误删新占用。

## 2. 持久受理与生命周期

- [x] 2.1 实现冻结计划、预分配 ID 和 execute gate；保证 journal/初始 manifest 前无 prepare 或设备副作用。
- [x] 2.2 实现 requestId 索引与冲突规则；覆盖并发重试、响应丢失、项目修改后的同请求回查、busy 零派发。
- [x] 2.3 对每个受理落盘边界注入崩溃，验证重启只回查/inconclusive、不自动重放，幂等 tombstone 保留。
- [x] 2.4 接入显式取消、调用取消、MCP 断连与 DSH dispose；验证查询取消不停止运行、PTC 正常返回不误取消、强杀不宣称回滚。

## 3. 共享工具和证据

- [x] 3.1 增加五个共享 schema/命令及 catalog/status 分页投影，保留全部 verdict/exitCode/分项与来源；验证状态查询不全量读取原始文件。
- [x] 3.2 增加按 execution/attempt 授权的 artifact 读取，验证跨运行拒绝、哈希损坏持久降级、元数据/文本限额与私有字段不外泄。
- [x] 3.3 增加历史图分享权限与有界图片派生，保留原图/派生哈希；验证旧 App 授权、MCP image 与 DSH attachment 路径及 JSON 无 base64。
- [x] 3.4 注册 MCP 与 Cordis 五工具，更新生成 schema、工具枚举及 probe；测试 Native/PTC/MCP 领域结果与错误一致。

## 4. 界面、安装包与真机

- [x] 4.1 Viewer 显示 Agent 受理/取消及执行来源，使用同一历史；慢受理时保留画面且另一只读控件可用，保存并检查截图。
- [x] 4.2 同 tarball 干净安装验证 MCP 与 DSH rc.2 Native/PTC 的发现/启动/查询/取消/证据链；安装环境不依赖源码路径。
- [x] 4.3 Android/iPhone Fixture 各完成单流程、数据套件、业务反例、取消与重启复验，保留 suite/run/request 关联和关键截图；宿主串行接入。
- [ ] 4.4 分别验证两宿主真实图片消费；附件已返回、模型已理解与断言通过分别记录，未取得模型证据则保留待办。

2026-10-05：Android 再跑单流程/正负套件/取消与重启证据摘要通过；iPhone stdio MCP 新返回有效图片/结构。当前 Codex 未挂载 FlowAssert 工具，真实模型和完整 DSH 生命周期未由直接探针证明，4.4 保持待办。见 `docs/physical-validation-2026-10-05.md`。
- [x] 4.5 执行 pnpm check、test:e2e、build、pack:check 和 strict specs；同步 ADR 0008、使用指南、TODO、能力表与验收报告，只按实际证据更新状态。
