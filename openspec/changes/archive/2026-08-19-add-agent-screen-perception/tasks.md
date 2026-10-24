## 1. 配置、依赖与公共契约

- [x] 1.1 在 `package.json` 中增加与固定 Harness 版本匹配的必需 attachment/LLM 直接 peer dependencies，并在 workspace 关闭 peer 自动安装；引入锁定版本的 `saxes` 流式 parser，通过可注入 adapter fixture 避免复制宿主 dev graph，更新 lockfile 与 pack contract。
- [x] 1.2 在 `Config` 中增加 `agentScreenContentPolicy` 三态 schema，默认 `mock-only`，并为 Mock、Appium 结构及图片授权编写配置单测。
- [x] 1.3 定义 `ScreenObservation`、安全摘要、geometry、node、structure、revision、coordinate space 和 observation progress 类型，保证核心类型不导入 DSH/MCP 包。
- [x] 1.4 建立稳定的 screen observation 错误类/错误码及脱敏映射，覆盖 disabled、capture、structure、size、expiry、session、coordinate 和 attachment 失败。

## 2. ObservationStore 与 session 协调

- [x] 2.1 实现只在内存中工作的 `ObservationStore`：128-bit 随机 ID、每 session 最多 4 条、60 秒 TTL、32 MiB 总图片字节硬上限、容量/时间逐出和 best-effort buffer 清零。
- [x] 2.2 为 store 增加 fake clock 单测，验证 TTL、容量、session generation 隔离、start/stop/dispose 清理及不暴露 bytes/路径/URL 的安全摘要。
- [x] 2.3 实现单 session operation coordinator，使 action/observe 串行，status 无锁可读，stop 能通过 session abort signal 中止正在捕获的 observation。
- [x] 2.4 为 coordinator 增加竞态单测，覆盖 capture 期间 action、stop、session 替换、调用取消和任务完全 quiesce。

## 3. Mock 屏幕模型与 raster observation

- [x] 3.1 抽取 `MockScreenModel`，统一维护 viewport、action count、last action 和 screen revision，使 Viewer SVG、结构和 agent PNG 使用同一状态源。
- [x] 3.2 实现无平台原生依赖的确定性 PNG encoder/简单绘制器，并验证 magic bytes、CRC、尺寸、内容上限和不同 action revision 的稳定变化。
- [x] 3.3 为 Mock provider 实现 geometry/source 或等价的规范化结构入口，返回稳定的角色、文本、bounds 和 actionable 状态。
- [x] 3.4 增加 Mock `start → snapshot/inspect → observation-bound action → re-observe → stop` 单测，验证图片/结构 revision 一致及 stop 后 observation 失效。

## 4. Appium geometry、source 与跨平台 normalizer

- [x] 4.1 扩展 Appium provider：创建 session 时保存 platform，附着 session 时从 capabilities 恢复 platform，并实现 window rect、orientation 和 source 请求。
- [x] 4.2 为 Appium response reader 增加 endpoint 级字节上限和协作式 abort，确保 `/source` 超过 4 MiB 时不执行无界 `response.text()`。
- [x] 4.3 实现禁用外部实体的流式 XML normalizer，应用深度 64、节点 500、字段 512 code points 与规范化 JSON 256 KiB 限制。
- [x] 4.4 实现 Android UiAutomator 属性映射与 role/bounds/actionable 规则，并用嵌套、空树、超限、恶意 XML fixture 覆盖。
- [x] 4.5 实现 iOS XCTest 属性映射与 role/bounds/actionable 规则，并验证缺失布尔值保持 unknown、不伪造语义。
- [x] 4.6 扩展 Appium 假 W3C server 测试，验证 screenshot/rect/orientation/source endpoint、附着 session、错误分类、取消和原始 XML/设备信息不泄漏。

## 5. MirrorService observation 与安全动作

- [x] 5.1 在 `MirrorService` 实现一次性 `observe({ image, structure })`，捕获 generation/epoch/时间窗并仅在全部请求项成功且仍一致时原子发布。
- [x] 5.2 增加独立 observation progress state，使慢捕获不改变主 `streaming` lifecycle，status/stop 可用且 Viewer 保留最后成功帧。
- [x] 5.3 为成功 action/start/stop/session 替换维护 screen epoch 与 generation，并保证 fresh capture 失败不覆盖上一条 observation 或伪增 revision。
- [x] 5.4 扩展 action 输入支持可选 `observationId` 和 `coordinateSpace`，实现 generation/latest revision/epoch/TTL/15 秒 freshness 校验。
- [x] 5.5 实现 snapshot-to-viewport 的 tap/swipe 坐标转换、确定取整和严格边界检查，保留不带 observation 的旧 viewport action 兼容语义。
- [x] 5.6 增加 service 单测，覆盖有效动作、expired/stale/session mismatch、缺尺寸、越界、方向、并发、取消、失败保留和旧调用兼容。

## 6. DSH 工具、attachment 与模型上下文

- [x] 6.1 把 `attachments` 加入 Cordis 注入并更新测试 fixture，确保插件在依赖缺失时启动失败而不是运行期静默降级。
- [x] 6.2 注册 `mobile_mirror_snapshot` 与 `mobile_mirror_inspect_screen`，声明精确 canonical JSON schema、参数、超时和纯文本 renderer；现有六个工具保持兼容。
- [x] 6.3 实现 DSH observation projector：按 attachment limits 校验/save PNG，创建带 plugin/notice 来源的图片 user message，并通过 `exec.deferContext` 恰好追加一次。
- [x] 6.4 验证纯结构调用不保存 attachment，图片保存失败不 defer context，工具 JSON/日志/state 不包含 bytes、Base64、路径、原始 XML、sessionId/UDID 或 attachment 存储位置。
- [x] 6.5 使用 DSH 工具执行 fixture 覆盖 Native Mode 与 Code Mode：canonical value 可用、图片上下文位于工具/`run_code` 结果之后、调用取消不留下半发布 context。

## 7. Viewer、运行探针与文档

- [x] 7.1 在 Viewer 中显示 agent observation 捕获进度和稳定错误，不阻塞 stop/本地无关控制，并保留失败前最后画面；更新 Playwright E2E 并留存检查运行时截图。
- [x] 7.2 扩展 `dsh-runtime-probe`，执行 Mock start、snapshot、inspect、带 observation 的安全 action、re-observe、stop，并只打印脱敏摘要。
- [x] 7.3 更新 README、配置说明、安全模型、架构、产品形态、里程碑和验证文档，明确三态授权、DSH attachment 留存、模型图片支持、非原子捕获与旧动作无 stale protection。
- [x] 7.4 更新 bundle/pack contract，确认新工具、直接依赖、运行探针与用户需要的文档进入发布包，且仓库默认 patch 不启用物理屏幕共享。

## 8. 完整验证与真机验收

- [x] 8.1 运行 `pnpm check`，确认类型检查、契约检查及全部单测通过，并单独记录 observation/normalizer/attachment 新增用例数量。
- [x] 8.2 运行 `pnpm test:e2e`、`pnpm build`、`pnpm pack:check` 和 `git diff --check`，检查 Viewer 运行时截图与 tarball 内容。
- [x] 8.3 探测当前 DSH provider 的图片输入能力；支持时运行真实 Native/Code Mode 探针并证明模型实际收到图片，不支持或缺少凭据时记录外部阻塞并明确保持图片端到端验收未通过。
- [x] 8.4 探测物理 Android；可用时完成 `start → snapshot/inspect → agent 确认可见内容 → observation-bound safe action → re-observe → stop` 并记录版本/PNG/source/viewport/session 清理证据，不可用时记录设备验收缺口且不得用假服务器替代。
- [x] 8.5 探测物理 iPhone；可用时完成同一闭环并记录 Xcode/Appium/XCUITest/iOS、WDA PNG/source/方向/坐标/session 清理证据，不可用时记录缺口且不得用既有 Viewer 截图替代 agent 消费证明。
- [x] 8.6 汇总 Mock、假服务器、DSH runtime、Android 真机和 iOS 真机五层证据，逐条回填本 OpenSpec tasks；工程实现任务可完成，但任何未满足的外部验收层必须与仓库门禁通过项分开报告。
