## 1. 前置收口与公共契约

- [x] 1.1 先归档已完成的 `add-guided-installable-beta`，同步其 main specs，并确认 alpha.1 tag/release、main CI 与 clean package 证据仍一致。
- [x] 1.2 在共享类型中增加 `ScreenNode.sensitive`、`tap_node`/`input_text` action、text mode、app operation/state/result、internal mutation marker 和公共 control progress 类型。
- [x] 1.3 增加 `agentTextInputPolicy=mock-only|non-sensitive`、`agentAppControlPolicy=disabled|session-app|allowlist` 与有界 `agentAllowedAppIds` schema/default/config 类型。
- [x] 1.4 同步 Cordis config、standalone MCP config allowlist、onboarding renderer/doctor config、示例与未知字段拒绝；证明升级默认不会开启物理文本输入或应用管理。
- [x] 1.5 定义 node/text/app/control 稳定错误码与固定脱敏文案，区分 request 前失败、unsupported、partial 和 state-unverified。
- [x] 1.6 把 `mobile_mirror_action` 改为五种 canonical variants：MCP 生成 object-root oneOf，DSH 生成 kind-required 的扁平参数投影，并新增 `mobile_mirror_manage_app` 第九工具 contract/output/保守 risk annotations。
- [x] 1.7 更新共享参数 parser，按 kind/operation 拒绝缺失、冲突、未知字段、无效文本与 app id，并保留原 tap/swipe/back 的有效输入和语义。
- [x] 1.8 增加 DSH 扁平 schema、MCP oneOf JSON Schema 与 parser round-trip/compatibility 测试，证明字段/枚举同源、逐分支接受/拒绝等价、九项工具可注册且原八项客户端不回归。

## 2. 敏感结构规范化

- [x] 2.1 扩展 Android normalizer，识别 `password=true` 和明确 password role，在节点发布前设置 sensitive 并删除 text/value。
- [x] 2.2 扩展 iOS normalizer，识别 `XCUIElementTypeSecureTextField`/等价 secure role，在节点发布前设置 sensitive 并删除 text/value。
- [x] 2.3 更新 output schema、freeze/summary 与 JSON size accounting，确保 sensitive 元数据可投影但 raw/masked 内容和长度不可泄露。
- [x] 2.4 增加 Android/iOS 恶意 source fixture，覆盖明文、掩码、超长值、大小写/role 变体和普通 input 非回归。
- [x] 2.5 增加 ObservationStore、DSH canonical JSON、MCP structured/text content 的端到端敏感字段扫描测试。

## 3. Core 节点与文本动作

- [x] 3.1 抽取 `requireFreshObservation`，统一 generation、latest revision、epoch、TTL 与 15 秒 freshness 校验，并保持原错误优先级。
- [x] 3.2 实现 observation-local node lookup，明确区分 structure/node 缺失与节点不可操作，禁止 source/locator/text fallback。
- [x] 3.3 实现 node bounds/viewport 正面积交集、中心计算和半开区间校验，并为完整、部分、负坐标、零面积、NaN/Infinity 增加单测。
- [x] 3.4 把 `tap_node` 解析为既有 viewport tap，成功后递增 epoch，证明旧 observation stale 且媒体/所有权不变。
- [x] 3.5 实现 text validator：512 code points、4 KiB、append 非空、replace 可空、禁止 C0/C1/CR/LF/tab/line/paragraph separator，且不 normalization/截断。
- [x] 3.6 实现 `agentTextInputPolicy`、input role/visible/enabled/focused/sensitive/bounds 校验，所有失败必须发生在 provider mutation 前。
- [x] 3.7 定义 core-to-provider text request，只传 mode/text/expected bounds；公共 state/result/lastAction 只保留 kind、mode、code-point count 和 epoch。
- [x] 3.8 增加 inspect → tap_node → re-inspect focused → replace/append → re-inspect 的 core 测试，以及排队后 stale、secure rejection 和无隐式 tap 测试。

## 4. 应用管理授权与 Core 状态

- [x] 4.1 实现 app id canonical validation、最多 32 项精确 allowlist、重复/通配/URL/slash/空白/控制字符拒绝和大小写敏感匹配。
- [x] 4.2 扩展 provider session 内部上下文，记录 platform、owned/attached 与 Android appPackage/iOS bundleId target，确保公共 state/result 不暴露 target/capabilities。
- [x] 4.3 实现 disabled/session-app/allowlist 授权解析，以及 Mock/owned Appium 允许、attached/unknown platform/target missing fail-closed。
- [x] 4.4 在共享命令层实现 `mobile_mirror_manage_app`，输出 operation、target scope、before/after state、outcome、epoch，禁止回显 app id。
- [x] 4.5 增加 disabled、session implicit/exact、allowlist exact、target mismatch、invalid id、attached session 和无 provider 测试，断言拒绝路径零 provider 请求。

## 5. Mutation fence 与控制进度

- [x] 5.1 定义不可序列化的 provider mutation error/marker，明确 mutation request 发出前后和 unknown outcome 的构造边界。
- [x] 5.2 修改 `MirrorService`：成功或 may-have-mutated 失败都递增 epoch；preflight/validation 失败不递增；业务错误不得被 best-effort frame 失败覆盖。
- [x] 5.3 增加 `control { phase, startedAt, lastCompletedAt, lastErrorCode }` state，并把普通 action、node/text action 与 manage_app 映射到 acting/managing-app。
- [x] 5.4 让 control 与 observation 共用 exclusive queue，在执行时重新校验 freshness；status 保持同步，stop/dispose 先 abort 再等待静止。
- [x] 5.5 增加成功、request 前失败、clear 后失败、请求响应丢失、取消、排队 stale、并发 stop/dispose 测试，断言 epoch/progress/error/cleanup。
- [x] 5.6 审计所有 describe/error/state/result 路径，确保 text、node label/value、app id、element/session id、request body 和 raw provider response 不进入公共面。

## 6. Mock 语义模型

- [x] 6.1 扩展 Mock screen model，增加普通 input、secure input、focus、普通文本值和至少两个确定性 mock app state。
- [x] 6.2 让 Mock 的 node click 改变 focus/revision，并让 Mock text provider 支持 append/replace/clear 且永不接受 secure input。
- [x] 6.3 实现 Mock query/activate/terminate 与 owned session target，使 disabled/session/allowlist 和 epoch 规则无需物理设备即可验证。
- [x] 6.4 为 Mock 注入慢操作、取消和 partial mutation fault，覆盖 control progress、mutation fence、重观察和 stop 清理。
- [x] 6.5 更新 Mock Viewer/fixture 文案与确定性画面，避免在 retained screenshot 或工具结果中显示 secure fixture 原值。

## 7. Appium 文本输入

- [x] 7.1 实现 W3C active element id 解析与 element rect 请求，严格校验有限正面积矩形和 50% smaller-area overlap。
- [x] 7.2 实现 append 的单次 element value 请求（iOS 原 `{text}`；Android 按 2026-09-16 修正读取当前值、显式替换拼接值并核验），禁止 clipboard、ADB input、locator、execute-script 和 driver-specific fallback。
- [x] 7.3 实现 replace 的 clear → 同一 element send-keys 顺序；clear 后任何失败映射 `screen_text_input_partial` 与 may-have-mutated。
- [x] 7.4 对 unsupported endpoint、invalid element id/rect、target mismatch、HTTP error、timeout、abort 和 malformed response 做稳定脱敏映射。
- [x] 7.5 确保 Appium request/error helper 对 clear/value endpoint 不序列化 body/text/element id，并为上游回显 request 的恶意错误增加脱敏测试。
- [x] 7.6 增加 Android/iOS fake server 矩阵，断言 endpoint、method、payload 次数、overlap 边界、replace 顺序、partial error、取消和零 fallback。

## 8. Appium 应用生命周期

- [x] 8.1 实现 Appium app-state query 与内部 0–4 枚举校验，malformed/unknown response 返回稳定 state-unverified。
- [x] 8.2 实现 Android activate-app 与 terminate-app，前后 query 验证 foreground/not-running，已 foreground/已停止返回稳定 no-op outcome。
- [x] 8.3 实现 iOS background activate、not-running `mobile: launchApp` 和 terminate，禁止 arguments/environment/kill/remove 等未授权方法。
- [x] 8.4 为 mutation request 后 timeout/abort/HTTP error/after-state mismatch 标记 may-have-mutated，并保留原 operation 错误而不是伪造成功。
- [x] 8.5 增加 Android/iOS fake server 矩阵，覆盖 installed/running/background/suspended/foreground、launch 分支、no-op、state mismatch 和 attached 零请求。
- [x] 8.6 验证 terminate/activate 后 Appium session 仍可 status/observe/stop，且 session delete 与 managed Appium cleanup 保持现有 ownership 顺序。

## 9. DSH、MCP 与 Viewer 集成

- [x] 9.1 在 DSH Cordis effect/registry 中从共享 contract 注册第九工具，Native/PTC adapter 只调用共享命令并保持 `0.1.2-rc.1` attachment/deferred image 行为。
- [x] 9.2 在 MCP `tools/list`/call handler 中暴露等价九工具 schema/output，并为 manage_app 设置 destructive/open-world/non-idempotent annotations。
- [x] 9.3 扩展 MCP progress，把 action/manage_app started、300 ms phase、completed/failed 与共享 control state 对齐，progress/result 不含敏感字段。
- [x] 9.4 更新 Viewer state/API 投影，显示 generic acting/managing-app 进度，保留最后画面并保持 theme/status/stop 可交互。
- [x] 9.5 增加 Viewer 慢 text/app control E2E，验证并发安全控件、取消/失败恢复和无 text/app id DOM 泄露，保留并人工检查终态截图。
- [x] 9.6 更新 shared contract/DSH/MCP config/package tests，把预期工具数从八扩展为九，同时保留原八项顺序、名称和输入兼容断言。

## 10. Runtime、打包与模型验收

- [x] 10.1 扩展 credential-free runtime probe，完成 Mock inspect → tap_node → focused re-inspect → replace/append → secure rejection → manage_app → re-observe → stop。
- [x] 10.2 扩展 built stdio MCP probe，验证九工具 list/schema、semantic lifecycle、progress、stale/mutation error 和进程退出清理。
- [x] 10.3 扩展 packed/clean-prefix probe，确认 tarball 中的 DSH/MCP/onboarding/Viewer 均使用新 contract，且不包含 text fixture、host report 或临时 observation。
- [x] 10.4 在隔离 DeepSeek Harness `0.1.2-rc.1` profile 中验证 tarball 安装、Native/PTC 九工具 Mock 闭环和 dispose。
- [x] 10.5 使用已支持图片的真实 provider/model 让 DSH 或 Codex 根据 fresh structure/image 选择 tap_node、输入固定普通 marker、re-observe 并 stop；无凭据时保持该外部层未通过。
- [x] 10.6 保留公共 DeepSeek V4 text-only 负向契约，确保工具数升级不把 text-only route 报告为视觉验收通过。

## 11. 真机探针与双平台验收

- [x] 11.1 扩展物理 observation probe，使用显式环境授权、文档声明的固定公开 marker、批准 app id 和清理动作；stdout/JSON 不得记录 text/app/device/element/session id 或 raw source，retained 截图只允许出现该公开 marker 和已审查画面。
- [x] 11.2 在 Android 已解锁普通输入框完成 inspect、tap_node、focused re-inspect、replace、append、结果 re-inspect、clear/restore 和 owned stop，保留命名终态截图与脱敏证据。
- [x] 11.3 在 Android 对批准 app 完成 query、activate/launch、query、terminate、query，验证 epoch、session 仍可用、UiAutomator2/Appium/媒体精确清理。
- [x] 11.4 在 iOS 已解锁普通输入框完成同一文本闭环，验证 WDA active element/rect/clear/value、secure rejection、owned stop 与命名终态截图。
- [x] 11.5 在 iOS 对批准 app 完成 query、background/not-running activate/launch、query、terminate、query，验证 epoch、WDA session 与 forwarding 清理。
- [x] 11.6 分别记录 Mock/fake/DSH/MCP/Android/iOS 证据，任一物理 API 或用户授权缺失时明确保留该层未通过，不以手工输入、Viewer 可见或旧截图替代。

- [x] 11.7 修复 Android hint 导致追加丢字，覆盖有提示已有值、提示歧义零写入、超限、焦点变化及写后不符；设置搜索框真机复验。

## 12. 文档、版本与交付门禁

- [x] 12.1 新增语义动作 ADR，记录 nodeId observation-local、active-element 输入、secret hard reject、app policy、mutation fence 和不采用 locator/clipboard/shell 的理由。
- [x] 12.2 更新中英文 README、MCP host、Android/iOS、security、architecture、product-shape 和 milestones，说明九工具、配置默认值、推荐动作流程、宿主 history 风险与回滚。
- [x] 12.3 更新 validation，分层记录 deterministic、Viewer、packed DSH/MCP、真实模型、Android/iOS 文本与应用生命周期结果，并保留未通过边界。
- [x] 12.4 将 package/release contract 升级到后续 alpha（预期 `0.1.0-alpha.2`），更新 tag/version/checksum/release notes/workflow，禁止覆盖 alpha.1 或执行 npm publish。
- [x] 12.5 运行 `pnpm check`、`pnpm test:e2e`、`pnpm build`、`pnpm pack:check`、built/packed/DSH probes、`git diff --check` 与全部严格 OpenSpec 校验。
- [x] 12.6 对 staged diff、tarball、runtime JSON、日志和 retained screenshots 做敏感扫描，确认除声明的公开 marker 外没有用户输入、secure fixture、app/device/element/session id、capabilities、token 或本机路径。
- [ ] 12.7 提交并推送实现，等待 main CI 绿色，核对本地/远端 SHA、ahead/behind 与 clean worktree。
- [ ] 12.8 仅在获得明确发布授权后创建新 alpha tag，等待 release workflow 生成 tarball/SHA256/notes，并从发布资产重跑 clean install 与 DSH/MCP Mock semantic smoke。

2026-09-15 iPhone 11.5 通过；11.4 首轮发现搜索框类型/焦点信息缺失，修复后 replace/append/clear、真实密码框 secure rejection 和 owned stop 均通过。见 [iPhone 验收记录](../../../docs/ios-acceptance-2026-09-15.md)。


2026-09-16：Android 11.2/11.7 修复 hint 追加后真机通过，完整 marker 核验并清空；本次新增 11.7 后总数 76，完成 74，交付/发布两项保持待办。见 [Android 报告](../../../docs/android-acceptance-2026-09-16.md)。
