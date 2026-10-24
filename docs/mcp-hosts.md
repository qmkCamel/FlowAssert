# MCP 宿主接入指南

FlowAssert 提供通用 stdio MCP server；Codex 是已支持的宿主之一，不是核心依赖。当前 DSH/MCP 共用 20 项默认工具，另有 5 项 opt-in Preview 修复工具。默认集合包括十项设备、五项默认关闭的已登记测试运行、诊断上下文／分诊，以及验收／外部结果／矩阵三个只读摘要。复用 `LocalDeviceRuntime`、Viewer、Workbench、observation TTL、语义动作策略和 Appium session ownership；[完整清单与边界](product-shape.md)以当前源码为准，不代表旧发布包已有全部工具。

## 构建与最小配置

准备 Codex/MCP 可运行 `flowassert doctor --target mcp --format json`。它只检查所选环境前提，不读取 DSH profile、不要求安装 DSH；只有显式选择 `--platform android|ios` 才检查相应手机工具链。无关项不显示“不适用”。[Doctor v2 范围与退出码](environment-preflight.md)。这不会注册新的 MCP 工具，报告通过也不代表完成 MCP 握手。

```bash
mise exec node@24.19.0 -- pnpm install --frozen-lockfile
mise exec node@24.19.0 -- pnpm build
```

创建只允许 Mock 的本机配置，例如 `mobile-mirror.mcp.json`：

```json
{
  "defaultProvider": "mock",
  "viewerHost": "127.0.0.1",
  "viewerPort": 3210,
  "agentScreenContentPolicy": "mock-only",
  "agentTextInputPolicy": "mock-only",
  "agentAppControlPolicy": "disabled",
  "agentAllowedAppIds": [],
  "allowHostDeviceDiscovery": false,
  "allowHostSigningDiagnostics": false,
  "iosWdaAllowProvisioningDeviceRegistration": false,
  "mcp": {
    "maxImageBytes": 8388608
  }
}
```

server command/args 是：

```text
command: node
args: /ABSOLUTE/PACKAGE/PATH/scripts/mobile-mirror-mcp.mjs --config /ABSOLUTE/CONFIG/PATH/mobile-mirror.mcp.json
transport: stdio
```

配置文件最大 64 KiB，只接受已声明字段。设备与权限参数写入显式 JSON，不通过未声明环境变量绕过策略。矩阵另需本机显式登记的项目／registry 路径，使用 `MOBILE_MIRROR_TEST_PROJECT`／`MOBILE_MIRROR_MATRIX_REGISTRY`，配置优先级和 Agent 白名单见[矩阵指南](local-device-matrix.md)；这些路径不由工具请求提供。建议将真实设备配置放在仓库外并限制文件权限。

可先直接运行自动探针：

```bash
mise exec node@24.19.0 -- pnpm run build
mise exec node@24.19.0 -- pnpm run test:mcp:probe --launcher ./scripts/mobile-mirror-mcp.mjs
```

默认探针验证 20 工具 schema、已登记测试、外部资产授权／撤销、验收查询与双 Mock 矩阵摘要；最新同包结果见[DSH 升级合并验证](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/upgrade-dsh-020-rc2/merge-validation.md)；修复 opt-in 工具另按[修复实施记录](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/add-evidence-guided-repair-loop/implementation.md)计证据。原 Mock `start → inspect → tap_node → focused re-inspect → replace/append → secure rejection → manage_app → re-observe → stop` 及 stale/mutation、SIGTERM 清理和 Viewer 端口释放仍保留。新增摘要不提供矩阵写操作或外部 runner 执行权限。

## Codex

Codex CLI、IDE extension 和桌面应用共享 MCP 配置。当前官方方式支持用 `codex mcp add` 注册本地 stdio server：

```bash
codex mcp add mobile-mirror -- \
  node /ABSOLUTE/PACKAGE/PATH/scripts/mobile-mirror-mcp.mjs \
  --config /ABSOLUTE/CONFIG/PATH/mobile-mirror.mcp.json

codex mcp list
```

重新打开 Codex task 后，可用 `/mcp` 查看 server 和工具。首次执行 `mobile_mirror_start`、`mobile_mirror_action`、`mobile_mirror_manage_app`、`mobile_mirror_stop` 等写工具时，应检查并接受宿主的审批提示；工具 annotations 只提供保守风险提示，最终权限由 Codex 决定。官方配置说明见 [OpenAI Codex MCP 文档](https://developers.openai.com/codex/mcp/)。

非交互 `codex exec` 无法展示审批 UI，默认会取消这些写工具。仅在配置仍为 `mock-only` 的自动验收进程中，可以用一次性 CLI override：

```bash
codex exec --ephemeral --sandbox read-only \
  -c 'mcp_servers.mobile-mirror.default_tools_approval_mode="approve"' \
  '只使用 mobile-mirror 完成 Mock 观察、safe action、再观察并 stop'
```

该 override 不写入永久配置。不要把它用于包含真机 capabilities 的日常任务；真机 start/action/stop 应保留逐次人工审批。

回滚配置：

```bash
codex mcp remove mobile-mirror
```

这只删除 Codex 的 server 注册，不删除包、配置文件或外部 Appium session。若 server 正在运行，先调用 `mobile_mirror_stop`，再结束对应 task。

## 其他 MCP client

任何支持 MCP stdio 和 image content 的 client 都可以使用相同 command/args。宿主至少需要：

- MCP tools capability；
- `structuredContent` 或 JSON text fallback；
- `image/png` content block；
- progress notification 和 cancellation；
- 对控制设备工具的用户审批策略。

如果 client 只支持文本，它仍可调用生命周期和结构工具，但不能完成“模型实际看到 PNG”的视觉验收。不要把 Base64 从 JSON text 中转给此类 client。

## 物理设备授权

默认 `mock-only` 会在访问 Appium 屏幕端点前拒绝物理屏幕读取。按实际需要显式选择：

- `structure`：只允许规范化 accessibility 结构；
- `image-and-structure`：允许单帧 PNG 进入 MCP image content，同时允许结构；
- `allowHostDeviceDiscovery=true`：允许执行本机 `adb`/`xcrun` 发现；
- `allowHostSigningDiagnostics=true`：允许只读 Xcode/WDA 签名诊断；
- `iosWdaAllowProvisioningDeviceRegistration=true`：可能改变 Apple Developer 外部状态，除非用户明确授权，否则保持 `false`。

真机语义动作还要分别显式设置：

- `agentTextInputPolicy=non-sensitive`：只允许 fresh structure 中已聚焦的普通 input；secure/password 永久拒绝；
- `agentAppControlPolicy=session-app`：只允许当前 plugin-owned session target；
- `agentAppControlPolicy=allowlist` 加 `agentAllowedAppIds`：只允许最多 32 个精确、大小写敏感的 app id；
- attached session 永远不能调用 `manage_app`。

推荐顺序是 `inspect_screen → tap_node → inspect_screen(focused) → input_text → inspect_screen`。每次成功或可能已经 mutation 的失败都会让旧 observation stale；不要缓存 nodeId，也不要把页面 text/label 当 locator。

Appium 新建 session 由当前 MCP 进程拥有，stop/正常退出会删除；通过 `sessionId` 附着的外部 session 不会被删除。进程被强制终止时可能留下 owned session，需在 Appium 侧人工检查和清理。

## 协议边界

- stdout 只承载 JSON-RPC；脱敏诊断走 stderr。
- `snapshot`/`inspect_screen` 最多返回一个离散 PNG block，不返回连续视频。
- canonical object 不含 Base64、图片路径、URL、capabilities、UDID 或配置内容。
- text/app/element/session id 不进入 action/manage result、progress、status 或错误；宿主仍会持久化调用参数，因此只输入已明确可公开的 marker，绝不输入密码、token 或个人信息。
- Viewer 始终使用 loopback HTTP，承担人类监督和高频刷新；MCP 只承担控制、状态和离散观察。

## Observation 查询与 Viewer Inspector

当前追加第十工具 `mobile_mirror_query_screen`：先用 summary inspect，再对同一 observation 执行 find/get/subtree，无需重新采集或生成图片附件。历史节点仍受原严格动作时限约束。Viewer 可独立检查冻结截图、节点树与属性，不发布 Agent observation，也不修改分享策略。详见[使用与验收边界](inspector-validation.md)。
