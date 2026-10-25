# 证据驱动修复：Preview 使用指南

状态：**Preview（预览能力，默认关闭）**。任务状态以 [OpenSpec 清单](../openspec/changes/add-evidence-guided-repair-loop/tasks.md)和[实施记录](../openspec/changes/add-evidence-guided-repair-loop/implementation.md)为准；[2026-10-07 iPhone 导航与转发复验](physical-validation-2026-10-07.md)不代表完整真机修复闭环。以下命令需要本机已启动的 loopback Viewer、可信项目登记和对应权限；旧 `agentTestControl` 授权不自动授予修复权限。不要用生产账号或含危险副作用的业务流程试跑。

## 等级和责任边界

| 路径 | 当前能获得的最高证据 | 尚缺什么 |
| --- | --- | --- |
| 定位器维护 | Mock 下 `software-verified`，60 例安全语料与浏览器交互回归；Android 单独通过 10 个导航／拒绝探针 | 真机旧构建对照、完整审批修复复验及独立参与者复核；10 月 6 日 iPhone 会话受 Xcode Offline 阻塞，新的真机复验仍待完成 |
| 产品源码补丁 | `trusted-local` 仓库的受限补丁、两次独立软件检查；若有可信构建登记可产生制品清单 | 实际 Codex/DSH 宿主交接运行、真实业务源码与独立检查器 |
| 构建与安装 | 单 APK/iOS `.app` 的本机摘要协议、确切制品审批和 Mock 安装故障演练 | 真实 APK、已签名开发 iOS 包、Appium provider、可信 reset/cleanup、两次移动端复验和冻结回归 |

`repair verify` 默认要求 `device` 等级；软件通过或 Mock 安装不会使该命令退出 0。原失败 run、JUnit 和验收记录不会被修复任务改写。修复结果不能自行发布验收修订、提交代码、推送或合并。

## 可信项目登记

项目所有者先在本地项目 `repair` 配置中显式设置 `enabled`、`projectId`、`permissions`、允许的 flow/platform/App、导航范围和预算。源码路径还要登记 `source.repositoryId/root/oracleRoot/workspaceRoot/baseCommit/writablePaths/protectedPaths/checks/regressionChecks`；`isolation` 只有明确设为 `trusted-local` 才允许执行。`sandbox-required` 在没有真正沙箱时按能力不可用处理。`root`、独立 oracle 根及生成工作区根必须是互不嵌套的 canonical realpath；主工作区的 dirty 内容既不复制也不重置。若配置 `source.builds`，还必须登记至少一个不同于原失败 flow 的移动端 `repair.regressionFlows`；源码 `regressionChecks` 只验证软件，不算安装后回归。

可选 `source.builds` 每平台至多一项，需固定 `platform`、`appId`、`outputRoot`、`artifactPath`、`artifactKind`、`reserveBytes`、`maxArtifactBytes`、`command` 和 `identityCommand`。构建命令 argv 必须含独立参数 `%OUTPUT_ROOT%`；身份检查命令必须含 `%ARTIFACT%`。两者均是本地登记的绝对 executable、固定 argv/cwd、有限 env/时间/输出，不使用 shell。身份检查器应实际读取制品、核对包标识和签名，按 JSON 输出 `appId`、`buildMarker`、`version`、`signatureVerified: true`；插件绑定检查器可执行文件摘要，但不能替项目所有者认证检查器逻辑。不要在命令 argv 或项目文件中写签名密码、令牌或证书私钥。未准备的 iOS 签名不由插件自动申请或修改。

构建和证据根按设备卷 ID 合计预约并保留 256 MiB 余量；容量未知/不足在命令或设备副作用前拒绝。构建结束后还会在安装挑战、批准及派发前重新哈希制品；同名替换不能沿用旧审批。`.app` 目录中的 symlink、特殊文件和超限内容会被拒绝。当前 iOS/Android 测试 fixture 只验证协议，不证明真实签名/包格式。

## 本机流程

### 页面授权 v2 与兼容限制

导航登记必须给出真正的页面锚点和容器，而不是应用名字。例如 iOS Fixture：

```json
{
  "page": {
    "version": 2,
    "anchor": { "role": "text", "identifier": "recovery.page", "text": "Recovery navigation fixture" },
    "container": { "ancestorLevels": 1, "platformRole": "XCUIElementTypeOther" }
  },
  "allowedTarget": { "role": "button", "text": "Search" }
}
```

Android 同一 Fixture 的 anchor 使用 `name: "recovery.page"`（content-desc），container 为 `android.widget.LinearLayout`，按钮文字为实际 XML 的 `SEARCH`。从完整观察核对唯一锚点及目标的共同容器，不通过移除 scope、添加虚假 application 节点或扩大祖先层数绕过拒绝。旧 `{role:"application",name:...}` 仍可读取，但自动导航和候选准入一律拒绝；重新登记后旧冻结摘要及审批失效。

普通 recovery 的 `policy.page` 沿用其现有 selector 语法，但现在原定位器首次点击也受页面约束，持久化之后再重检；错页不会因原 locator 存在而放行。

Managed Appium 的 WDA/MJPEG USB host forwarding 由自有子进程 preload 限定为 `127.0.0.1`；暂只支持经过指纹审计的 XCUITest `10.19.1`。未知版本或源码变化拒绝加载，需要重新审计，不能自动退回全网卡监听。不会修改全局安装文件；external Appium 不受此 hook 控制，须由其所有者独立配置并验证网络范围。这里只限制 Mac 上的 USB 转发，不保证手机端 WDA 或无线连接的网络范围。

### 创建与审批

在 Viewer 的失败 run 下创建修复任务，或使用 CLI：

```sh
flowassert test repair create --url http://127.0.0.1:3210 --source-run RUN_UUID --flow FLOW_ID --route product-code --repository-id REGISTERED_ID
flowassert test repair get --url http://127.0.0.1:3210 --id CASE_UUID
```

范围、补丁执行和安装是三个不同确认点；CLI 确认必须在交互式本机终端完成，输入屏幕显示的确切摘要。源码补丁由 MCP/Cordis `mobile_mirror_repair_submit` 或受同源保护的本机 Viewer API 交接；Agent 无批准工具。Viewer 可审查完整补丁和制品清单。

```sh
flowassert test repair approve --url http://127.0.0.1:3210 --id CASE_UUID --expected-revision N --level scope
# 宿主提交受限补丁后，读取新的 revision，再批准 execution。
flowassert test repair approve --url http://127.0.0.1:3210 --id CASE_UUID --expected-revision N --level execution
flowassert test repair verify --start --url http://127.0.0.1:3210 --id CASE_UUID --expected-revision N
```

如果已登记并成功构建，case 转为 `awaiting-approval / resumePhase=installing`，此时没有设备租约。核对 `artifactDigest`、目标 App/platform 和 `targetDeviceBinding` 后再批准安装。当前只有 Mock provider 支持维护协议；Appium 会明确返回能力不可用，不会绕过现有会话所有权自行调用 ADB/Appium。

```sh
flowassert test repair approve --url http://127.0.0.1:3210 --id CASE_UUID --expected-revision N --level installation
flowassert test repair install --url http://127.0.0.1:3210 --id CASE_UUID --expected-revision N
flowassert test repair verify --url http://127.0.0.1:3210 --id CASE_UUID --required-grade device
```

安装可能完成但回执丢失、取消或进程退出时，case 保留 `unknown` intent 和围栏。只能显式连接受控会话后执行只读核查；核查结果不自动恢复验证、重装、回滚或升级等级。

```sh
flowassert test repair inspect-install --url http://127.0.0.1:3210 --id CASE_UUID --expected-revision N
```

## 停用与恢复演练

停止新的修复任务须关闭项目 `repair.enabled`；宿主 `repairToolsEnabled=false` 仅隐藏 Agent 修复工具，不等于关闭 Viewer/CLI 修复入口。二者默认均为 `false`，实际执行仍受项目登记、权限和精确审批约束。统一运行时总开关与 Viewer 一键开关尚未实现，不能把工具隐藏当作全局停用。

对活跃任务用 `cancel` 请求终止，等待子进程/设备操作真正退出并观察 journal 的终态。`close()` 等待活跃执行排空；若写入或设备结果不明，不把“收到取消请求”当作已安全退出。保留原 run、case journal、制品与未知安装状态，不能通过删除文件来清除围栏。仅在新鲜项目授权、完整证据与明确人工判断后创建新的修复任务；旧审批不得用作新补丁或新制品的授权。实机恢复与清理流程仍待验收。

## Preview 范围与升级门槛

Preview 指上述新修复闭环，不降级原有固定流程，也不把页面授权校验、初次 recovery 页面约束或 owned forwarding 的 loopback 安全限制变成可选项。当前 DSH 精确 `0.2.0-rc.2` 的基础宿主兼容已有[同包验证](../openspec/changes/upgrade-dsh-020-rc2/merge-validation.md)，但不替代真实 Codex/DSH 修复补丁交接验收。`trusted-local` 不是安全沙箱；仅适合项目所有者控制的试验仓库和非生产账号。

退出 Preview 前应按现有 OpenSpec 补齐并评审以下证据，不以勾选数或合并代替验收：

- 定位器路径：旧构建失败、精确审批、受控修复、可信 reset 与两次独立移动端复验、冻结回归和拒绝场景。
- 源码路径：实际两宿主交接、受限补丁、独立检查器；真实 APK/签名 iOS 开发包、Appium 维护适配和安装身份核验。
- 安全与恢复：取消/撤权/崩溃/未知安装回执的真机证据，保留原失败及审批链；统一运行时总开关与 Viewer 开关仍为[产品待办](../PRODUCT_TODO.md)，不能写成已交付。
- 可采用性：非作者独立复核、文档可操作性、升级/停用/恢复边界；未支持的平台或场景继续显式拒绝。

这些是升级评审口径，不新增发布承诺，也不勾选尚未执行的验收。当前可使用范围始终以上表与逐项任务为准。
