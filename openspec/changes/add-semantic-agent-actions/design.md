## Context

当前 `ScreenNode.nodeId` 由 normalizer 按 observation 内的扁平顺序生成（`n0`、`n1`……），只在同一不可变 observation 中有意义；`ObservationStore` 已保存完整结构，并提供 generation、revision、epoch、60 秒 TTL 与 15 秒 action freshness 校验。`MirrorService.action()` 当前可以把 snapshot 坐标转换为 viewport 坐标，但不会解析节点，也没有文本输入或应用生命周期接口。

Appium provider 已直接实现 W3C screenshot/source/geometry/pointer/back 协议，因此新增能力仍应位于共享 core/provider 边界，而不是 DSH、MCP 或 Viewer 各自调用 Appium。Appium 3 的 [WebDriver 协议](https://appium.io/docs/en/3.3/reference/api/webdriver/)提供 active element、element clear/send keys，[Appium 扩展协议](https://appium.io/docs/en/latest/reference/api/appium/)提供 app state/activate/terminate；Android [UiAutomator2 driver](https://github.com/appium/appium-uiautomator2-driver) 与 iOS [XCUITest execute methods](https://appium.github.io/appium-xcuitest-driver/latest/reference/execute-methods/) 的实现存在差异，尤其 iOS 对未运行应用需要固定参数的 `mobile: launchApp`。设计以当前已验收的 Appium 3.2.0、UiAutomator2 6.8.0、XCUITest 10.19.1 为基线，并在升级 driver 时重跑真机契约。

文本本身会作为 DSH/MCP tool input 进入模型和宿主调用历史。插件可以保证 `input_text` 调用自身的公共 state、结果、错误和日志不回显 payload，却无法撤销宿主已经持久化的调用参数。后续由用户授权发起的 structure observation 或 retained 屏幕截图仍可能看到普通输入框当前值；因此真机验收只使用固定公开 marker，密码、验证码、API key、token 与其他秘密不能通过本能力输入。

`add-guided-installable-beta` 已实现并发布 `0.1.0-alpha.1`，但其 OpenSpec change 仍应先归档。实现本 change 时必须保留 alpha.1 的 CLI、managed Appium、release 与 clean-package 契约，并以新版本发布，不能覆盖既有 release。

## Goals / Non-Goals

**Goals:**

- 让 agent 可以从 fresh structure 精确引用节点，不再自行重复换算节点 bounds。
- 在非敏感、明确聚焦的 input 上提供有界、可取消、可审计的 append/replace 文本输入。
- 在独立高风险工具与默认关闭的核心策略下提供应用激活/启动和终止。
- 把所有新动作纳入现有 session ownership、operation serialization、stale protection、epoch invalidation、progress 和脱敏模型。
- 保持 DSH 与 MCP 使用同一 contract/command/core/provider 实现，并用 Mock、fake Appium、packed runtime、真实宿主和双平台真机分层验收。
- 保持既有 `tap`、`swipe`、`back` 调用完全兼容。

**Non-Goals:**

- 不按 label、text、identifier、XPath、OCR 或视觉相似度重新定位节点；`nodeId` 只引用当前 observation。
- 不支持密码、验证码、token、API key、支付信息或其他 secret input，也不提供“我确认这是密码”的旁路字段。
- 不提供剪贴板注入、ADB `input text`、shell、任意 `executeScript`、键盘快捷键、Enter/submit、IME 控制或语音输入。
- 不安装、卸载、升级、清数据、授予权限、打开 deep link、发送 Android intent 或修改 iOS launch environment/arguments。
- 不为 attached Appium session 提供应用生命周期管理，不改变其外部所有权。
- 不修改 DeepSeek Harness agent loop，不把连续 Viewer 媒体放进工具结果。

## Decisions

### 1. 节点点击和文本输入扩展现有 action；应用生命周期使用第九个工具

`mobile_mirror_action` 的 `kind` 增加：

```ts
type SemanticMirrorAction =
  | { kind: 'tap_node'; observationId: string; nodeId: string }
  | {
      kind: 'input_text'
      observationId: string
      nodeId: string
      mode: 'append' | 'replace'
      text: string
    }
```

现有 coordinate action 类型和参数保持不变。`tap_node`/`input_text` 不接受 `coordinateSpace` 或坐标字段，解析层按 kind 拒绝不相关字段。共享 contract 以 canonical variant definitions 保存每种 kind 的字段、类型、枚举与实际 parser 规则；MCP object input 使用 discriminated `oneOf` 精确表达分支必填/禁用字段。

DSH `0.1.2-rc.1` 的 `ParameterSchemaSpec` 是隐式开放的扁平 object root，不能把根对象本身声明为 `oneOf`。因此 DSH 投影 SHALL 把所有 variant properties 合并到参数表，只把所有分支共同需要的 `kind` 标为 schema-required，并在字段 description 中说明适用 kind；真正的分支必填、冲突字段和 unknown-field 校验仍由同一 canonical parser 执行。不得为了得到根级 oneOf 把 DSH 输入改成 `{ action: {...} }`，因为这会破坏现有调用。自动化必须证明 MCP oneOf、DSH 扁平投影和 parser 的字段/枚举来源一致，并对每个分支运行正负样例；“等价契约”指实际可接受输入与行为等价，不虚构两个宿主的模型可见 schema 形状完全相同。

应用生命周期新增：

```ts
mobile_mirror_manage_app({
  operation: 'activate' | 'terminate',
  appId?: string,
})
```

选择独立工具而不是继续增加 `action.kind`，因为它操作应用进程、无需 observation 坐标，并需要静态 `destructiveHint=true`、`openWorldHint=true` 和独立核心授权。工具总数由八项增加为九项；DSH Native/PTC、MCP `tools/list`、runtime probes 和文档必须同步。应用管理结果只返回 operation、target scope、before/after state、outcome 和 screen epoch，不返回 app id 或平台原始响应。

### 2. `tap_node` 只解析 observation 中的精确节点

`MirrorService` 抽取统一 `requireFreshObservation(observationId)`，复用当前 generation、最新 revision、screen epoch、store TTL 与 15 秒 freshness 校验。随后在该 observation 的 `structure.nodes` 中按 `nodeId` 精确查找；不得访问新的 page source，也不得按 identifier/text 做第二次 locator 查询。

可点击节点必须同时满足：

- structure 存在，nodeId 精确命中；
- `visible === true`、`enabled === true`、`actionable === true`；
- bounds 的 x/y/width/height 为有限数，width/height 大于零；
- bounds 与 observation viewport 有正面积交集。

核心计算 node bounds 与 viewport 的交集，并点击交集矩形中心。该规则允许部分滚入视口的节点，但不是静默 clamp：原始 bounds、交集和最终点都必须通过有限数与 viewport 半开区间校验。节点缺失、状态未知/false、无 bounds 或无可见交集均返回稳定错误，绝不降级为普通 tap。成功后继续使用 provider 的 W3C pointer action并递增 epoch。

选择 observation-local 精确解析而不是 accessibility locator，是因为当前 nodeId 不是 Appium element id，重新按 label/identifier 查询会遇到重复文案、本地化、树变化和跨平台 locator 差异，反而破坏 observation 绑定语义。

### 3. 结构规范化显式标记并清除敏感字段

`ScreenNode` 增加可选 `sensitive: boolean`。normalizer 在以下输入上设为 true：

- Android `password=true`，以及平台 role 明确属于 password input；
- iOS `XCUIElementTypeSecureTextField` 或等价 secure role。

当节点敏感时，normalizer 必须在写入 `ScreenStructure` 前删除 `text` 与 `value`，保留 role、bounds、visible/enabled/focused 等非内容元数据。工具 output schema 允许 `sensitive`，但 raw XML 仍不得进入结果/日志。Mock 需要同时提供普通 input 和 secure input，以证明安全字段从 normalize、store、summary、DSH/MCP 到 JSON 序列化均不泄露值。

不采用“返回掩码值”方案，因为不同平台的掩码字符和长度可能泄露秘密长度，也可能由 driver 错误返回明文。插件只报告该节点敏感，不报告内容。

### 4. 文本输入必须显式授权且不隐式点击

配置新增：

```ts
agentTextInputPolicy: 'mock-only' | 'non-sensitive'
```

默认 `mock-only`。Mock 可以用于无凭据验收；Appium 只有在用户显式选择 `non-sensitive` 且 `agentScreenContentPolicy` 已允许 structure 时才接受 `input_text`。

`input_text` 在 core 中要求：

- fresh observation 与精确 nodeId；
- node `role === 'input'`；
- `visible === true`、`enabled === true`、`focused === true`；
- `sensitive !== true` 且 platform role 不属于已知 secure/password 类型；
- 有效正面积 bounds；
- `text` 最多 512 Unicode code points 且 UTF-8 不超过 4 KiB；
- 拒绝 NUL、C0/C1 控制字符、CR/LF、tab 和 Unicode line/paragraph separator；不做 Unicode normalization；
- `append` 要求非空文本；`replace` 允许空文本，空字符串明确表示清空普通输入框。

文本输入不自动先执行 `tap_node`。推荐流程固定为：

```text
inspect -> tap_node -> re-inspect(focused=true) -> input_text -> re-inspect
```

这样点击导致的 epoch 变化会强制 agent 获取新的 observation，避免“点击后焦点落到其他控件但继续输入”的组合动作。若应用在 observation 后自行改变焦点，provider 的 active-element 复核会再次 fail closed。

### 5. Appium 文本输入使用 active element + rect 复核

Appium provider 为 `input_text` 执行以下协议：

1. `GET /session/{id}/element/active` 获取 W3C active element id；
2. `GET /session/{id}/element/{elementId}/rect` 获取当前 element rect；
3. active rect 与 observation node bounds 均须有效，二者交集面积至少覆盖较小矩形的 50%；否则返回 `screen_text_input_target_mismatch`；
4. `replace` 先 `POST /session/{id}/element/{elementId}/clear`；
5. `append` 或 clear 成功后，通过 `POST /session/{id}/element/{elementId}/value` 发送唯一 `{ text }` payload；
6. provider 不读取/回传输入后的 element value，agent 必须通过新的 structure observation 验证结果。

采用 W3C active element/clear/send keys，而不是从 XML 生成 locator，是为了保留 focus 语义和跨平台公共协议。provider 不使用剪贴板、ADB input、driver-specific replaceElementValue 或 setValueImmediate fallback；如果 pinned driver 不支持公共端点，返回稳定 unsupported/failed 错误并保留坐标动作，不静默走安全性更弱的路径。

### 6. 应用管理使用默认关闭的 owned-session 精确策略

配置新增：

```ts
agentAppControlPolicy: 'disabled' | 'session-app' | 'allowlist'
agentAllowedAppIds: string[]
```

默认 `disabled`。allowlist 最多 32 项，每项为 1–255 个 ASCII 字符，只允许字母、数字、点、下划线和连字符；拒绝空值、重复、通配符、前后空白、slash、URL 和控制字符。匹配为区分大小写的精确匹配。

Appium provider 在 session 创建成功后从有效 capabilities 内部记录平台、session ownership 和 session target app id：Android 读取 `appium:appPackage|appPackage`，iOS 读取 `appium:bundleId|bundleId`。这些信息不进入公共 `MirrorState`。应用管理只允许 Mock 或 runtime-created owned Appium session；attached session 始终返回 `app_control_attached_session_forbidden`。

- `session-app`：省略 appId 时解析内部 session target；显式 appId 必须与 target 完全一致。
- `allowlist`：必须显式提供 appId，且精确命中配置 allowlist。
- target 缺失、platform unknown、未安装或未授权都在发送 mutating request 前失败。

这两个配置是核心授权；DSH/MCP annotations 只帮助宿主展示审批，不能代替策略。应用 id 可以出现在用户配置与 tool input，但插件的 result/state/error/log 不重复输出它。

### 7. `activate` 规范化为 foreground-or-launch，`terminate` 不清数据

provider 先调用 Appium app-state endpoint 获得 before state，使用 0–4 的稳定内部枚举。

- `activate`：未安装返回稳定错误；已在 foreground 返回 `already-foreground`；Android 调用 Appium activate-app；iOS 对 not-running 使用官方 `mobile: launchApp`，对 background/suspended 使用 activate-app。禁止透传 arguments、environment、intent 或 arbitrary execute script。完成后必须再次 query，只有 foreground 才成功。
- `terminate`：not-running 返回 `already-stopped`；其他状态调用 Appium terminate-app，使用固定有界 timeout，不接受 agent options。完成后再次 query，只有 not-running 才成功。

Appium 公开 app-management endpoint 与 XCUITest `mobile: launchApp` 是唯一平台分支。应用安装、卸载、清数据、权限、deep link、startActivity、killApp 和 removeApp 均不暴露。

### 8. 引入 mutation fence，失败也能正确使 observation 失效

文本 replace 至少包含 clear 和 send keys 两个 mutating request；应用管理也可能在网络超时后已经完成。因此 provider 错误需要携带内部、不可序列化的 `mayHaveMutated` 标记：

- 参数、策略、freshness、node/active-element/rect 校验在 mutating request 前失败：`mayHaveMutated=false`，epoch 不变；
- clear/keys/activate/terminate 请求已经发出，或服务端成功但 after-state 验证失败：`mayHaveMutated=true`；
- 操作成功：视为已改变或可能改变。

`MirrorService` 在成功或 `mayHaveMutated=true` 的失败上都递增 screen epoch，并使旧 observation 立即 stale。失败仍返回稳定错误而不是伪造成功；Viewer 保留最后可用帧并 best-effort 请求新 frame，frame 失败不得覆盖原业务错误。`lastAction` 只记录 kind、mode 和 code-point count，不记录 text/node label/app id。

该机制不改变现有单步 coordinate action 的失败语义；如果后续证明 Appium pointer failure 也存在高概率部分执行，再通过独立兼容 change 扩展 mutation fence。

### 9. 所有控制操作串行、可取消并具有独立 progress

新增公共、脱敏的 control state：

```ts
control: {
  phase: 'idle' | 'acting' | 'managing-app'
  startedAt: string | null
  lastCompletedAt: string | null
  lastErrorCode: string | null
}
```

node/text/app 操作与 observation、现有 action 共用 `MirrorService` exclusive queue。执行时才做 freshness 校验，因此排队期间被其他操作改变的 observation 会失败。status 始终同步可读；stop/dispose 先 abort session signal，再等待当前操作静止并按既有媒体/provider/Appium ownership 顺序清理。

core 在操作开始立即更新 control phase，完成/失败恢复 idle；Viewer 对超过 300 ms 的进行中状态显示本地进度，但不禁用 status/theme/stop。MCP 在存在 progress token 时发送 started、超过 300 ms phase、completed/failed；DSH 继续依赖共享 state/Viewer 和现有 tool execution。取消后的 mutating unknown 必须遵循 mutation fence。

### 10. 错误码与输出必须脱敏、稳定且可重试

新增稳定错误至少包括：

- `screen_node_not_found`
- `screen_node_not_actionable`
- `screen_text_input_disabled`
- `screen_text_input_invalid`
- `screen_text_input_not_focused`
- `screen_text_input_sensitive`
- `screen_text_input_target_mismatch`
- `screen_text_input_unsupported`
- `screen_text_input_failed`
- `screen_text_input_partial`
- `app_control_disabled`
- `app_control_attached_session_forbidden`
- `app_target_unavailable`
- `app_target_not_allowed`
- `app_not_installed`
- `app_activate_failed`
- `app_terminate_failed`
- `app_state_unverified`

错误 message 使用固定文案，不拼接 text、node name/value、app id、element id、session id、capabilities、request body 或 Appium response。Appium request helper 对 value/clear/app-management endpoint 禁止 body logging；即使上游异常包含 request，也必须在边界重映射。

文档必须明确：DSH/MCP/Codex 等宿主可能记录 tool input，因此 `input_text` 只用于可公开的普通文本。秘密输入继续由人在本机 Viewer/设备上接管，或未来使用不经过模型历史的专门 secret channel。

### 11. Mock 和 adapter 保持确定性、宿主无关

Mock screen model 增加普通 input、secure input、focus 状态、文本值和两个 mock app state。`tap_node` 解析仍发生在 core；Mock provider 实现 active-target 文本输入与 app management，使无设备 probe 可以证明：

- inspect -> tap_node -> stale rejection；
- re-inspect focused input -> replace/append -> re-inspect；
- secure input 被拒且值不出现在 summary；
- app policy disabled/session/allowlist 与 owned/attached 分支；
- terminate/activate 后 epoch 变化；
- cancellation/partial mutation 与 progress。

DSH adapter 与 MCP adapter只投影共享 contract/result，不保存文本、解析 node 或调用 Appium。MCP `tools/list` 与 DSH registry 必须得到同样的九项名称和同源字段/枚举；MCP 使用根级 oneOf，DSH 使用兼容 `0.1.2-rc.1` 的扁平参数表，二者由共享 parser 保证实际接受/拒绝语义等价。连续媒体与 observation image contract 不变。

### 12. 分层验收与发布

确定性验收包括：

- parser/schema/unknown-field 和旧 action 兼容测试；
- Android/iOS source 的 sensitive detection/redaction；
- ObservationStore freeze/TTL/stale 和 node lookup；
- fake Appium active/rect/clear/value/app-state/activate/launch/terminate、timeout、cancel、partial mutation、body/error redaction；
- Viewer 慢 control progress E2E 并保留截图；
- built/packed MCP 九工具闭环；
- `0.1.2-rc.1` clean-profile Native/PTC 九工具 Mock 闭环；
- tarball 内容与敏感扫描。

真机验收必须分别在 Android/iOS 的用户批准、非关键应用或系统设置搜索框中输入文档声明的固定公开 marker，完成：

```text
inspect -> tap_node -> re-inspect focused
-> replace -> re-inspect -> append -> re-inspect
-> clear/restore -> stop
```

应用生命周期使用用户明确批准的 app id，记录 query-before、activate/terminate、query-after、epoch 和 session cleanup；不得使用安装/卸载/清数据替代。retained 截图只能包含该公开 marker 和已审查画面，不得包含用户真实输入或其他秘密。若某平台/driver 的 active element 或 app API 不可用，物理验收保持未通过，不能用 Mock、fake server、Viewer 手动输入或旧截图替代。

实现合并前版本升级到后续 alpha（预期 `0.1.0-alpha.2`），先通过 main CI，再由既有 release workflow 的新 tag 在 clean runner 生成 tarball/checksum/release notes；不得覆盖 `0.1.0-alpha.1` asset。

## Risks / Trade-offs

- [accessibility 状态缺失导致节点被安全拒绝] → 语义动作要求显式 true；用户仍可使用现有 coordinate action，但结果不得描述为 node-safe。
- [observation node 与 Appium active element rect 存在平台偏差] → 使用 50% smaller-area overlap，并以双平台真机固定；不放宽为 label/坐标猜测。
- [文本已进入宿主 tool history] → 硬拒绝 sensitive node，默认 Appium 输入关闭，文档禁止 secrets；真正秘密输入留给未来独立通道。
- [replace clear 成功而 send keys 失败] → 返回 partial error、递增 epoch、要求重新 observe；不自动重试，避免重复文本。
- [应用 activate 在 OEM 上打开 resolver 或未到 foreground] → before/after query 强制验证；失败按 may-have-mutated 处理并要求重观察。
- [terminate 中断当前 AUT 或影响 WDA/UiAutomator2 session] → 仅 owned session、默认 disabled、精确 allowlist、独立高风险审批，并在真机矩阵验证 session 仍可用/可清理。
- [工具数量由八变九破坏硬编码客户端] → 保留原八项名称/参数，更新 DSH/MCP contract tests、probes、docs 与 package version；这是 additive contract change，不静默复用 action 名称隐藏进程操作。
- [active beta change 与本 change 的 DSH delta 冲突] → 先归档 `add-guided-installable-beta`，再实现/归档本 change；本 delta 保留 alpha prerelease 和当前精确 DSH `0.1.2-rc.1` 语义。

## Migration Plan

1. 先归档已完成的 `add-guided-installable-beta`，确认主 specs、main CI 和 `0.1.0-alpha.1` release 仍一致。
2. 增加类型、配置、schema、错误码和 sensitive normalizer；默认策略确保升级后物理设备没有新增写权限。
3. 实现 core node resolution、mutation fence、control progress 与 Mock，完成确定性单测。
4. 实现 Appium active-element 文本输入和应用管理协议，再接入 DSH/MCP 第九工具与 Viewer progress。
5. 完成 fake server、built/packed、DSH `0.1.2-rc.1` Native/PTC clean-profile、Viewer E2E 和全仓门禁。
6. 在显式授权下分别完成 Android/iOS 普通文本和应用生命周期真机验收；未通过的平台必须单独报告。
7. 升级至后续 alpha 版本并创建新的 checksum-verified prerelease；保留 alpha.1 供用户回滚。

回滚时恢复前一 commit/package，用户可继续使用 alpha.1 的八项工具；默认关闭的新策略不需要迁移用户数据。已经输入到第三方宿主历史的普通文本不由插件删除，release notes 必须再次说明这一边界。

## Open Questions

无阻断开发的问题。secret input、Enter/submit、selector re-location、应用安装/deep link、attached-session app control 和批量复合动作均明确留给后续独立 change。

### 2026-09-15 真机修正：iOS 焦点来源

SearchField 纳入 input。iOS XML 缺少 focused 时，不能根据键盘可见或一次点击推断焦点；observation 通过 provider 显式 resolveFocus 读取源树前后 active-element id/type/rect。稳定、完整源树、唯一可见启用输入节点及类型一致才发布 focused=true，XML 舍入允许 1 个逻辑点边缘差；否则不授予焦点。接口失败不丢弃可用结构，取消仍传播。工作台继续读取原始 XML，不启用这组额外请求。执行输入时仍重新复核 active element/rect，secure 拒绝与 strict freshness 不变。

### 2026-09-16 Android hint 追加修正
真机设置搜索框暴露 UiAutomator2 server 9.11.0 默认追加逻辑的缺陷：内部先 clear，若 getText 返回 hint 就丢弃原值。Android provider 在已有 active-element/rect 校验后，读取同一元素 text/hint，验证拼接值仍满足公开文本限制并重新核对焦点 ID，再以显式 replace:true 一次派发拼接值并读回核验；不使用 locator、剪贴板、ADB input 或 execute fallback。文本等于非空 hint 时不能区分实际值与提示，先拒绝 unsupported；无法读取或超限拒绝且不修改。写入后不符标记失败及 epoch 失效，不自动重试。iOS 路径保持原协议。
