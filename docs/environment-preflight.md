# 按入口和操作的环境预检（Doctor v2）

规则：**无关项不检查、不显示；必要项失败才阻止对应要求；可选项缺失只影响对应能力。** 预检不安装、升级、启动 Appium/WDA/DSH Web、连接设备、申请签名、修改 profile 或调用真实模型。

## 选择范围

| 入口/操作 | 检查 | 不检查 |
| --- | --- | --- |
| 无参数 `doctor` | Node、包与基础配置 | 手机、DSH、可选引擎 |
| `--target mcp` / `codex` | MCP 基础配置及选择的操作 | DSH executable/profile |
| `--operation report` | 基础运行；可选 `--report-path` 的只读可访问性 | 手机、OCR、模型 |
| `--operation mock` | Mock 前提、显式选择的能力 | ADB、Xcode、Appium |
| `--platform android` / `ios` | 对应平台连接前提 | 另一平台；未选功能 |
| `--operation test --test-ref flow:<id>` / `suite:<id>` | 已登记项目的合法性、provider/platform、必需 OCR/恢复策略 | flow、业务 hook、模型调用 |
| `--target dsh` | 所选 executable 精确版本、profile 注册与 peer 元数据 | 自动安装、完整 profile/配置求值 |

入口是 `viewer|mcp|dsh|cli`；`codex` 归一为 mcp。入口不会因 PATH 中恰好安装了 DSH 而改变。`--platform all` 是用户明确要求双平台，不是默认值。相互冲突的参数在诊断 I/O 前拒绝。

```bash
flowassert doctor --target codex --format json
flowassert doctor --operation mock
flowassert doctor --operation report --report-path /ABSOLUTE/REPORT/STORE
flowassert doctor --platform android --media preferred --config /ABSOLUTE/CONFIG.json
flowassert doctor --operation test --test-ref suite:smoke --provider mock --config /ABSOLUTE/CONFIG.json
flowassert doctor --target dsh --dsh-executable /ABSOLUTE/DSH --dsh-profile-root /ABSOLUTE/DSH/PROFILE
```

测试引用只能是配置中登记的名称，不能传任意 YAML 或代码路径。项目来自可信配置 `agentTestControl.projectPath`；MCP/DSH 入口还验证 Agent 的项目 allowlist。CLI 的 provider 默认取运行配置，须与真正执行的连接一致；预检不会替代实际运行时的项目授权、设备 claim、会话 owner 或版本检查。附着其他 Viewer 时，应在该实例中检查，不拿本机 CLI 报告冒充目标实例。

## 可选能力

`--media`、`--ocr`、`--ai-recovery`、`--recording` 支持 `off|preferred|required`。默认 off，完全不运行相关检查。preferred 失败只显示能力提示；required 失败或未知时不能报告本次要求 ready。已登记测试的必要 OCR/恢复要求不能通过 off 降级。

- Android 基础 PNG 不依赖 scrcpy。显式媒体检查复用连接助手的固定 scrcpy 4.1 检查，不搜索替代命令。
- iOS MJPEG 在实际 session 中验证；只读阶段保持未确认。不要把 required 媒体预检作为启动 WDA 的理由。
- OCR 使用 `--ocr-cache /ABSOLUTE/PREPARED/CACHE`，只调用现有 doctor 与批准元数据校验，不编译。Viewer 使用该实例配置的缓存，未准备时提示对应功能不可用。
- AI 恢复需要已登记测试的策略和模型配置；仅检查凭据存在性，不发送图片、不验证模型在线、不产生额度消耗。
- 浏览器录像只检查 API/MIME；不开始录制。CLI/无头入口不能 required 浏览器录像；在 CLI 中声明 `--target viewer` 也不能凭空证明浏览器能力。HTTP 浏览器能力字段只作提示，不能授予后端权限。

## DSH：静态前提与实际启用分开

支持版本精确为 **0.2.0-rc.2**，不是“至少这个版本”。`--dsh-executable` 必须明确指向可信绝对路径，固定调用 `--version`；不回退 PATH 的另一份安装。`--dsh-profile-root` 指向选定 profile 的目录，其中应有 `package.json` 和安装依赖。

仅有限读取 package 元数据：核对 `dsh.profile.bundles` 中的 `flowassert`、解析到的 attachment/llm/tools 精确版本及 Cordis peer 声明。rc.2 内置 peer 以**选定 executable 对应的安装目录**为准，不拿 profile 中另一版本冒充有效依赖。标准 package-manager symlink 可以解析；仅向上至多 4 层定位宿主 package，每个文件最多 1 MiB、总计 4 MiB。不爬无关全局目录、不 import/eval 插件、不读取 patch 内的密钥或完整配置。非标准安装布局无法确认时保留 incomplete。

**当前已知限制（2026-10-25）：** `package.json` 已声明 Cordis `~4.0.5`，但 `preflight-dsh.ts` 仍要求插件 peer 字符串恰为 `~4.0.4`，可能将当前包误报为 `dsh_peer_mismatch`。这项检查需单独修复并回归；不要为通过 Doctor 修改已安装包或降级依赖。跟踪见 [PRODUCT_TODO](https://github.com/qmkCamel/flowassert/blob/main/PRODUCT_TODO.md)。

**即使版本/依赖元数据通过，插件实际启用仍是 `dsh-profile-unverified`，整体保持 incomplete。** profile 补丁、启动参数和热更新可能改变启用状态；按用户确认的安全边界，这部分用独立授权的真实宿主实调验收，不通过读取完整配置来推断。现有 peer 装载拒绝仍有效；不要将本报告当作 Native/PTC、模型图片或真机验收证据。

## v1 → v2 迁移

| 项 | v1 | v2 |
| --- | --- | --- |
| 无参数 | 隐式双平台 | 基础运行，无手机扫描 |
| JSON | `schemaVersion: 1` | `schemaVersion: 2`，增加 context/checkedAt/capabilities/role/scope |
| manual/必要项超时 | 可能仍退出 0 | incomplete，退出 2 |
| 状态 | ready/blocked | ready/blocked/incomplete |
| 取消 | 无独立保证 | 退出 130；停止后续派发 |

ready=0，blocked/incomplete=2，参数或内部错误=1。preferred 能力 warning 不阻止 ready。`checkedAt` 是本次检查完成时间；context 与配置/项目修订绑定。报告不包含命令原文、设备标识、账户、私密路径或凭据。环境前提通过不是设备已连接、MCP 已握手、DSH 已实调或模型已在线。

Viewer 检查使用局部进度、取消与代次隔离；过程中主题/历史等控件仍可用。失败保留上次报告，变更范围后旧结果仅供阅读。连接助手继续使用单次、120 秒有效的设备引用及原有确认流程。
