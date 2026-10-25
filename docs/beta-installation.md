# 开发候选安装与发布包回滚

> 迁移说明：本页含迁移前的安装与验收记录；FlowAssert 尚无已发布 Release。旧仓库资产没有迁入。当前只使用源码安装，以下 Release 下载命令须等新仓库重新打包并验收后使用。

本轮受邀用户直接从 **main 分支**按 [小范围内测任务卡](https://github.com/qmkCamel/flowassert/blob/main/docs/beta-start.md) 启动，不需要单独的内测包。下文保留维护者完整配置与未来发布模板，不作为本轮内测前置步骤。

当前源码包版本为 `0.1.0-alpha.2`，DSH 适配基线为 `0.2.0-rc.2`。迁移前 2026-10-07 的同包安装与宿主结果见[历史验证](https://github.com/qmkCamel/flowassert/blob/main/openspec/changes/upgrade-dsh-020-rc2/merge-validation.md)；旧 alpha.1/rc.8 不作为 Workbench 数据降级目标。具体格式和回滚限制见[兼容边界](https://github.com/qmkCamel/flowassert/blob/main/docs/workbench-compatibility.md)。

当前体验使用源码路径：`pnpm install --frozen-lockfile` → `pnpm build` → `pnpm start`。生成本机候选用 `pnpm pack --pack-destination /ABSOLUTE/CANDIDATE_DIR`，另算 SHA256 并记录源码 SHA；不会自动发布或安装平台依赖。完整源文档见[文档索引](https://github.com/qmkCamel/flowassert/blob/main/docs/README.md)，安装包只携带选定指南。

## 1. 下载并校验

仅在对应 tag/Release 已核验发布后下载三个 asset；以下 alpha.2 文件名和命令是发布后模板，不是当前可下载入口：

- `flowassert-0.1.0-alpha.2.tgz`
- `flowassert-0.1.0-alpha.2.sha256`
- `0.1.0-alpha.2.md`

使用 GitHub CLI 的可复制命令：

```bash
gh release download v0.1.0-alpha.2 \
  --repo qmkCamel/flowassert \
  --pattern 'flowassert-0.1.0-alpha.2.tgz' \
  --pattern 'flowassert-0.1.0-alpha.2.sha256' \
  --pattern '0.1.0-alpha.2.md'
shasum -a 256 --check flowassert-0.1.0-alpha.2.sha256
```

Linux 也可以使用 `sha256sum --check`。校验失败时不要安装；重新下载两个文件并再次核对 Release tag 与 commit。

## 2. 独立前缀安装候选包

以下是维护者验证本机候选的步骤。迁移前 rc.2 候选曾通过新前缀安装、peer 检查和同包宿主探针；当前构建仍须使用自己的 SHA256 重新验证，不能沿用历史结果。peer 检查失败时停止，不用版本豁免绕过。

```bash
MOBILE_MIRROR_PREFIX="$PWD/.mobile-mirror-alpha2"
mkdir -p "$MOBILE_MIRROR_PREFIX"
pnpm --dir "$MOBILE_MIRROR_PREFIX" add --ignore-scripts \
  "$PWD/flowassert-0.1.0-alpha.2.tgz"
pnpm --dir "$MOBILE_MIRROR_PREFIX" peers check
```

只有 peer 检查通过后才继续：

```bash
MOBILE_MIRROR_PACKAGE="$MOBILE_MIRROR_PREFIX/node_modules/flowassert"
node "$MOBILE_MIRROR_PACKAGE/scripts/mobile-mirror-cli.mjs" --version
node "$MOBILE_MIRROR_PACKAGE/scripts/mobile-mirror-cli.mjs" --help
```

CLI 只读：`doctor` 不安装、启动或修复依赖，`config` 只向 stdout 输出模板。需要文件时由用户显式重定向并审阅。

## 3. Doctor

Doctor v2 无参数只检查基础环境，不扫描手机或 DSH。显式检查双平台（包括配置的 external/managed Appium 前提）：

```bash
node "$MOBILE_MIRROR_PACKAGE/scripts/mobile-mirror-cli.mjs" \
  doctor --platform all --format human
```

使用独立 JSON 配置并生成机器可读报告：

```bash
node "$MOBILE_MIRROR_PACKAGE/scripts/mobile-mirror-cli.mjs" \
  doctor --platform android \
  --config "$PWD/mobile-mirror.mcp.json" \
  --format json
```

v2：`ready` 返回 0，`blocked` 或必要项待人工确认/超时的 `incomplete` 返回 2，参数或内部错误返回 1，取消返回 130。只有 preferred 能力缺失时不阻塞基础路径；off 项不检查也不显示。报告不包含设备 ID、签名身份、可执行文件路径、端口或原始命令输出。旧 JSON 消费者必须按 `schemaVersion: 2` 迁移；[完整选项、四入口边界与示例](environment-preflight.md)。

## 4. DeepSeek Harness 0.2.0-rc.2

本节针对本次已验证的本机候选；旧 tarball 的相同包版本不证明支持新版宿主。先确认宿主精确版本；备份已有 profile，或选择独立测试 profile，再从已校验 tarball 安装。下例 web 是 profile 示例，不应覆盖个人配置；新版通过 HMR 插件控制 patch 监听；不再写入旧 patchReload 字段。默认 live 与显式禁用 HMR 的 startup 配置分别验收，见 [0.2.0 适配验证](dsh-020-validation.md)。

```bash
dsh --version
dsh plugin --profile web add "$PWD/flowassert-0.1.0-alpha.2.tgz"
dsh --profile web --dump-config
```

生成完整、安全的 DSH patch 供人工审阅：

```bash
node "$MOBILE_MIRROR_PACKAGE/scripts/mobile-mirror-cli.mjs" \
  config --target dsh --platform mock > "$PWD/mobile-mirror.dsh.patch.yml"
```

模板保持 Mock、loopback、external Appium，并设置 `agentScreenContentPolicy=mock-only`、`agentTextInputPolicy=mock-only`、`agentAppControlPolicy=disabled`、空 allowlist；同时关闭 host discovery、签名诊断和 provisioning mutation。Android/iOS 模板中的占位符不会自动授权真机屏幕读取、文本输入或应用管理。

## 5. 语义动作策略

Mock 可以直接验证 `tap_node` 与普通文本 append/replace。真机必须在个人配置中显式开启，并先授权结构共享：

```json
{
  "agentScreenContentPolicy": "structure",
  "agentTextInputPolicy": "non-sensitive",
  "agentAppControlPolicy": "session-app",
  "agentAllowedAppIds": []
}
```

`input_text` 只允许 fresh observation 中已聚焦的普通 input；password/secure 节点硬拒绝。应用管理只允许 plugin-owned session；`allowlist` 模式还要求传入与最多 32 项精确列表之一完全相同的 app id。先 `inspect_screen`，再 `tap_node`，重新 inspect 确认 focused，最后 input；每次成功或不确定 mutation 后都要重新观察。

## 6. 通用 MCP 与 Codex

生成 standalone MCP JSON：

```bash
node "$MOBILE_MIRROR_PACKAGE/scripts/mobile-mirror-cli.mjs" \
  config --target mcp --platform mock > "$PWD/mobile-mirror.mcp.json"
```

任意 MCP host 都应以 stdio 启动同一发布包中的 launcher：

```text
command: node
args:
  - /ABSOLUTE/PACKAGE/PATH/scripts/mobile-mirror-mcp.mjs
  - --config
  - /ABSOLUTE/CONFIG/PATH/mobile-mirror.mcp.json
```

Codex 可让 CLI 输出 shell-safe 注册命令，审阅后再执行：

```bash
node "$MOBILE_MIRROR_PACKAGE/scripts/mobile-mirror-cli.mjs" \
  config --target codex \
  --package-root "$MOBILE_MIRROR_PACKAGE" \
  --config-path "$PWD/mobile-mirror.mcp.json"
codex mcp list
```

## 7. External 与 managed Appium

### Viewer 双平台向导

启动 adapter 后打开其 loopback Viewer，把 Provider 切到 **Appium · real device**。选择 Android 或 iPhone，再显式点击检查；页面只显示脱敏 readiness、通用设备序号、连接方式和可选 runtime。点击“连接设备”默认查看当前画面，也可明确选择打开系统设置。首次自动化初始化可能短暂切换画面。Android 连接前必须确认 UiAutomator2 helper APK 副作用；iOS 只在 profile 缺失时接受本次 Team ID/WDA bundle ID。超过 300 ms 的检查/连接有局部进度，平台切换、主题、状态、高级面板和有效 Stop 保持可用。

向导不安装 Node/Appium/driver/ADB/scrcpy/Xcode/WDA，不配对或解锁设备，不登录 Apple，不启用 provisioning/device registration，也不更改 Agent sharing/text/app-control policy。短期引用 120 秒过期且单次消费；页面本身不使用浏览器持久化。raw sessionId/capabilities 仍在默认折叠的 **Advanced Appium connection**，其 `/api/start` 行为保持兼容。

包含正式 Viewer launcher 的构建可以直接运行 `flowassert-viewer`。首次连接时显式勾选“记住这台 Mac”，会在 spawn/session 前把重新验证的 Appium、平台偏好和必要 WDA 默认值保存到仓库外 `0600` 配置；设备 ID、capabilities、证书/凭据和副作用确认不会落盘。下次启动只显示脱敏平台摘要，用户点击“检查并连接”后仍会重新检查；只有唯一设备、零阻塞和零缺失字段时才继续。详细命令、默认路径和恢复方式见[本机 Viewer 指南](local-viewer.md)。

`external` 是默认兼容模式：用户自行启动 Appium，插件只连接 `appiumUrl`，从不终止外部 server；attached `sessionId` 也只 detach，不删除外部 session。

要显式启用 managed 模式，先在个人 JSON/DSH patch 中审阅并设置：

```json
{
  "appiumRuntimeMode": "managed",
  "appiumExecutablePath": "/ABSOLUTE/PATH/TO/APPIUM",
  "appiumUrl": "http://127.0.0.1:4723",
  "appiumSessionStartupTimeoutMs": 120000
}
```

managed 模式只接受绝对可执行文件和 HTTP loopback URL。首次 `mobile_mirror_start(provider=appium)` 才使用固定的 address/port/base-path 参数启动 child；已有 listener 会被拒绝，不会接管。正常 stop/dispose 先清理媒体与插件自有 session，再只终止保存的 child handle。managed 模式不支持 attached `sessionId`。

## 8. 安全回滚

先停止活跃 mirror，再移除宿主注册：

```bash
codex mcp remove mobile-mirror
```

DSH 侧使用 `0.2.0-rc.2` 的 plugin 管理命令移除 `flowassert`，或恢复安装前保存的 profile；执行前先用 `dsh plugin --profile web --help` 核对当前 CLI 的 remove 语法。然后可以删除第 2 节创建的独立安装前缀和下载的三个 asset。

```bash
dsh plugin --profile web remove flowassert
```

需要回到 alpha.1 时，重新校验 `flowassert-0.1.0-alpha.1.sha256`，再把宿主注册指向 alpha.1 tarball；不要复用 alpha.2 的未审阅策略配置。alpha.2 不覆盖或重写 alpha.1 Release/tag。

回滚不应删除或改动：

- 用户自己的 MCP/DSH 配置备份；
- external 或 attached Appium session；
- 系统级 Appium、UiAutomator2、XCUITest、scrcpy、Xcode、WDA；
- Apple Developer 证书、provisioning profile、设备信任或 Developer Mode。

若进程在 managed Appium 正常清理前被强杀，可能残留 Appium 或下游设备资源；不要使用 `pkill` 或端口扫描批量终止。先核对进程来源和 session 所有权，再按宿主/Appium 官方方式处理。
