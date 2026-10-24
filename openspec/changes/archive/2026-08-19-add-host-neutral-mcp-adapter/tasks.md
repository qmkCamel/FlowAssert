## 1. 依赖、配置与公共契约

- [x] 1.1 固定并安装 `@modelcontextprotocol/sdk@1.30.0` 运行时依赖，更新 lockfile，并验证其 Node 22/24 与 ESM public exports 可用。
- [x] 1.2 定义共享的八项工具名称、描述、input/output JSON Schema、保守风险 annotations 和 command result 类型，保证 contract 模块不导入 DSH 或 MCP 类型。
- [x] 1.3 抽取 `capabilitiesJson`、provider、sessionId、action、observationId 与 coordinateSpace 的共享输入解析器，并为非法 object/枚举/有限数/缺参补齐单测。
- [x] 1.4 实现独立 MCP JSON 配置 loader：64 KiB 上限、顶层 allowlist、复用 Schemastery Config、`mcp.maxImageBytes` 默认 8 MiB/上限 32 MiB、无效配置 fail closed。
- [x] 1.5 为安全默认值、未知键、非 loopback host、无效 JSON、超限文件/图片及不回显路径/内容增加配置测试。

## 2. Local Device Runtime 与生命周期

- [x] 2.1 新增 `LocalDeviceRuntime`，统一拥有 MirrorService、ViewerServer、iOS WDA preflight、配置和幂等 listen/close 状态。
- [x] 2.2 调整 ViewerServer 支持注入共享 MirrorService，并将 HTTP listener 关闭与 service dispose 的职责分层，确保关闭期间不再接受新 Viewer 控制。
- [x] 2.3 将 DSH `apply()` 切换为在 Cordis effect 中创建/监听/关闭 LocalDeviceRuntime，不改变 tools/attachments 注入或热替换语义。
- [x] 2.4 增加 runtime 单测，覆盖 listen/close 重入、端口冲突、慢操作中止、Viewer/service 单实例和 owned/attached session 清理。

## 3. 共享命令层与 DSH 兼容迁移

- [x] 3.1 实现 `MobileMirrorCommands`，通过 runtime 提供 list devices、iOS preflight、start、status、snapshot、inspect、action 和 stop 八项调用。
- [x] 3.2 让 snapshot/inspect 返回内部 ScreenObservation，其余命令返回脱敏 object；扩展 summary delivery 类型支持 `mcp-image-content` 而不把 adapter 类型带入核心。
- [x] 3.3 重构 DSH `registerTools` 仅负责 DSH schema/renderer、attachment 保存和 deferred context，所有参数校验与业务调用委托给共享命令层。
- [x] 3.4 增加 DSH 回归测试，证明八个名称、原参数、canonical JSON、Native/Code Mode deferred image、错误、取消和 session ownership 不变。
- [x] 3.5 增加 DSH/MCP contract conformance fixture，逐工具比较名称、描述、字段、枚举、必填规则、成功 canonical object 和已知核心错误码。

## 4. 通用 MCP server 与结果投影

- [x] 4.1 使用 SDK `Server` 和公开 request schemas 实现 MCP initialize/tools capability、`tools/list` 与 `tools/call`，不声明 resources/prompts/sampling。
- [x] 4.2 注册八项共享工具 schema/annotations，将成功 object 同时投影为 `structuredContent` 与确定性 JSON text fallback，并验证 output schema 一致。
- [x] 4.3 实现 snapshot/inspect MCP projector：追加恰好一个 `image/png` block、标记 `mcp-image-content`、执行 8 MiB 默认限制，并确保其他结果层不含 Base64/bytes/路径/URL。
- [x] 4.4 实现稳定 MCP error projector：保留已知 screen/WDA code，未知异常映射 `mobile_mirror_operation_failed`，设置 `isError=true` 且不泄漏 stack/provider/config 数据。
- [x] 4.5 将 MCP request cancellation 传播到除 status 外的共享命令/provider，并在 server close 时中止所有活动 adapter 请求。
- [x] 4.6 为 list/preflight/start/snapshot/inspect/action/stop 实现 progress-token 通知，覆盖开始、超过 300 ms phase、完成和失败，且 status/stop 并发保持可用。

## 5. stdio 进程、exports 与发布包

- [x] 5.1 实现 stdio server main，保证 stdout 只由 MCP transport 使用，`--help`/`--version` 与 MCP 模式互斥，诊断统一走可注入脱敏 stderr logger。
- [x] 5.2 实现 EOF、SIGINT、SIGTERM 和显式 close 汇合的 `closeOnce()`，按 listener → operation abort/quiesce → service dispose 顺序清理且重入无副作用。
- [x] 5.3 增加 `./mcp` package export、`flowassert-mcp` shebang launcher 与 tsdown 多入口构建，保持现有 `.` DSH export/bundle 不变。
- [x] 5.4 更新 contract checker、`files` 和 pack assertions，验证 MCP build/bin/Viewer/文档被打包，个人配置/真机标识/临时 observation 不进入 tarball。

## 6. MCP 自动化与进程验收

- [x] 6.1 使用官方 SDK Client 与 in-process transport 测试 initialize、capability、八项 tools/list schema 和未知 surface/tool 拒绝。
- [x] 6.2 完成通用 MCP Mock `list/start → snapshot/inspect → observation-bound action → re-observe → stop` 测试，验证 PNG、结构、revision/epoch、坐标与 stale rejection。
- [x] 6.3 覆盖 `mock-only`/structure/image 策略、image size、已知/未知错误、text/structuredContent 等价和 image block 唯一性/无旁路泄漏。
- [x] 6.4 用受控慢 provider 覆盖 progress、请求取消、捕获时并发 status、stop 中止、旧帧保留和 server 继续服务。
- [x] 6.5 用真实 built bin 子进程覆盖 stdin/stdout JSON-RPC、stdout 纯净、stderr 脱敏、EOF/signal 退出、端口释放和 close 重入。
- [x] 6.6 用 Appium 假服务器覆盖 MCP 新建/附着 session 的 start/stop/进程关闭请求序列，证明只删除 adapter-owned session。

## 7. 架构、宿主接入与安全文档

- [x] 7.1 新增 ADR 0002，记录共享 runtime、stdio-only MCP、单帧 image content、无 screenshot resource 和 Codex 非核心依赖的决策/替代方案。
- [x] 7.2 更新 README、architecture 与 product-shape，将 Future MCP 改为已实现能力，并明确 DSH/Codex/其他 MCP 宿主的相同核心与 Viewer 角色。
- [x] 7.3 新增 MCP host 配置指南，给出最小通用 command/args 与按当时官方方式实测的 Codex 示例、配置 rollback、Mock 首跑和显式物理屏幕授权。
- [x] 7.4 更新 security 文档，记录 stdio 信任边界、stdout/stderr、MCP Base64 临时副本、8 MiB 限制、配置文件、进程崩溃孤儿 session 和无远程 transport。
- [x] 7.5 更新 validation/milestones，区分协议传输、真实宿主模型视觉、Android/iOS 物理设备和持续媒体四层证据。

## 8. 完整验证与宿主验收

- [x] 8.1 运行 MCP/runtime/DSH focused tests 与 DSH runtime probe，记录新增测试数量和兼容结果。
- [x] 8.2 运行 `pnpm check`，确认类型检查、contract lint 与全部 Vitest 通过。
- [x] 8.3 运行 `pnpm test:e2e`；由于 Viewer/runtime 生命周期会调整，留存并人工检查一张新的运行时最终状态截图。
- [x] 8.4 运行 `pnpm build`、`pnpm pack:check` 和 `git diff --check`，并从 packed artifact 启动一次通用 MCP Mock probe。
- [x] 8.5 将 packed MCP bin 注册到 Codex，完成 Mock snapshot 图片内容识别、结构核对、observation-bound safe action、re-observe revision 变化和 stop；保存脱敏验收证据。
- [x] 8.6 探测当前 Android/iOS 物理设备与屏幕授权；可用时分别通过 MCP 重跑 `start → snapshot/inspect → safe action → re-observe → stop`，不可用时明确记录外部缺口且不得用 Mock/旧截图替代。
- [x] 8.7 汇总 DSH、通用 MCP client、stdio 子进程、Codex、Android/iOS 六层证据，逐条回填 tasks；工程门禁和任何未满足的外部验收层必须分开报告。
