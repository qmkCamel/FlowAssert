## Context

动机与范围见 [proposal.md](proposal.md)。核对基线 `dev@REDACTED_REVISION`：`DoctorService.run(platform)` 无条件执行 Appium，再按 Android/iOS 执行平台检查；无参 CLI 默认为 all。连接助手已经有显式点击、120 秒不透明引用、平台隔离和可选 scrcpy 降级，不能以本变更为由退化这些机制。DSH 精确版本与 peer 拒绝现由仓库契约和 clean-profile 探针验证，用户 doctor 没有宿主上下文。

本设计跨 CLI、共享 runtime 与 Viewer，故保留独立设计文档。方案阶段不修改运行代码、主规格或现有验收复选框；后续实现不需要触碰 Harness agent loop。

## Goals / Non-Goals

**Goals：**

- 把检查选择与检查执行分离，使用纯计划测试证明“不相关命令真的没有被调用”，而非执行后隐藏错误。
- 各入口复用相同依赖判定；报告表达“本次前提已满足”，不承诺实际连接、图片理解或最终测试结果。
- 只读预检无安装、配置写入、账户或手机副作用，所有失败均有稳定、脱敏、可操作的原因。
- 预检不绕过或替代实际运行时的项目授权、设备 claim、MirrorService 会话与必要能力检查。

**Non-Goals：**

- 不实现自动安装/升级、自愈环境、设备抢占、云设备、远端宿主发现或通用任意诊断命令。
- 不新增 MCP/DSH 工具，不把预检变成第二套设备 owner，不更改连续视频路径。
- 不新增 AI/OCR/录像引擎、修复闭环总开关或未知驱动支持；只对已有能力提供作用域正确的检查与状态。
- 不默认连接真实 DSH profile、发送模型请求或执行业务用例。实际宿主/真机冒烟要单独登记，不从假命令通过推断。

## Decisions

### 1. 入口与操作采用正交上下文，先规范化再产生检查计划

建议新增 `EnvironmentPreflightContext`、纯 `planEnvironmentChecks(context)` 和可注入的 `EnvironmentPreflightService`，不把 DSH 判断散落在平台检查方法里。

上下文包括：`entry=viewer|mcp|dsh|cli`，`operation=runtime|report|mock|connect|test`，`provider=none|mock|appium`，`platform=none|android|ios|all`，以及功能策略、配置修订和可选的登记测试引用。`codex` 仅为用户命令别名，规范化为 mcp；不能因本机有 dsh 命令就推断 DSH 入口。

| 所选操作 | 检查范围 | 明确排除 |
| --- | --- | --- |
| runtime | Node、包自身及基础配置；MCP 额外验证本地 stdio 配置格式，DSH 额外检查选定宿主 | 手机发现、Appium、WDA、可选引擎 |
| report | 基础运行与指定只读报告/store 的可访问性；无路径只说明运行前提 | 手机、媒体采集、OCR/模型；不扫描整个磁盘 |
| mock | Mock 配置和已选功能的本机前提 | 真实 Appium、ADB、Xcode、手机和签名 |
| connect + Android | 既有 Appium/UiAutomator2、ADB、设备状态和明确选择的媒体 | DSH（除非入口为 dsh）、iOS 工具链 |
| connect + iOS | 既有 Appium/XCUITest、Xcode、设备及获授权签名前提 | Android 工具链 |
| test | 依据已登记 flow/suite 与项目策略推导上述 provider 和必要功能 | 执行 flow、运行业务 verifier、安装/编译或模型调用 |

无参 `doctor` 解析为 cli/runtime/none/none。仅传 `--platform android|ios|all` 时解析为 cli/connect/appium/对应平台；explicit all 表示主动检查两端，其分项失败不应被描述为另一个平台不能使用。test 必须有已登记引用；不得让 Agent 提交任意 YAML/路径扩大检查范围。相互矛盾的 provider/platform/operation 在任何 I/O 前拒绝。

替代方案：继续按平台全量跑完再过滤 UI。拒绝，因为这仍会执行无关命令、读取不必要的私密配置，并产生错误的阻塞结果。

### 2. 默认关闭可选检查，只有实际选择才增加依赖

`media / ocr / ai-recovery / recording` 分别采用 off、preferred、required。功能 off 不产生检查行；preferred 失败只给对应能力 warning 和可用降级路径；required 失败加入本次 blocked。不得由模型自行把必需功能改为 preferred。

- 媒体：基础 Android PNG 不依赖 scrcpy；选择低延迟媒体时才检查显式 scrcpy 4.1。iOS MJPEG 是否真正可用必须在 session 建立后由现有媒体路径确认，预检不启动 WDA，不能仅有端口配置就宣称媒体已验证。
- OCR：仅调用现有只读 doctor/评测批准元数据检查；不调用 prepare/编译。不影响无 OCR 断言的用例。
- AI 恢复：只检查已登记策略、候选 backend 能力和凭据是否可用，不输出凭据、访问外部模型或消耗额度；明确“配置前提”而非“模型在线”。
- 录像：由浏览器检查录制 API/MIME 支持，不请求采集/开始录制；CLI/无头不能以服务器侧推断浏览器编码可用。required 浏览器录像与无头任务冲突时明确拒绝，不悄悄记成已录制。
- 已登记测试的必需视觉/业务/录制要求由原项目校验与解析结果合并，用户 off 不能降低测试约束；预检不执行这些断言或 hook。

替代方案：检查一切可选能力但只降级为 warning。拒绝，因为报告仍会充满无关问题，也会扩大元数据/凭据访问。

### 3. DSH 采用“显式目标 + 有限静态元数据”，不运行第二宿主

CLI 增加只用于 dsh target 的 `--dsh-executable` 和 `--dsh-profile-root`，均要求用户明确给出可信绝对路径。路径只存在于本机输入，不进入 report。先校验路径、权限和 canonical identity，再经 HostCommandRunner 调用固定 `--version`；正常退出、单一合法版本输出且精确等于 `0.2.0-rc.2` 才通过版本项，不用大于等于比较。

profile 检查读取显式根下有限的插件登记和 package 元数据，核对 FlowAssert、实际解析到的 attachment/llm/tools 精确版本与 Cordis 范围；基于该 profile 的解析根，不使用仓库 require 或全局依赖替代。package manager 的 symlink 只按标准解析到 package 元数据，限制读取对象、字节、深度及循环；不递归遍历依赖缓存，不 import/eval 模块，不读取模型密钥或完整配置输出。无法静态确定补丁启用状态、插件别名或有效依赖时返回 `dsh-profile-unverified`，不能绿灯。

有效 runtime/profile 识别作为适配器边界：不依赖未文档化的 `ctx.version`，不 patch Harness；没有可靠信息时保持 incomplete。检查本身不执行 `dsh web`、plugin add/update、`--dump-config` 或安装探针；后者可能组合配置或加载插件，不属于只读准备步骤。已有 clean-profile 脚本仍是独立验收机制。

实施核对补充（2026-10-07）：rc.2 的安装包 `dsh-app-boot` 实际采用 installation-first 的内置 peer 解析。因此“有效 peer”包含**显式 executable 对应的 canonical 安装目录**，而非另一全局安装或仅 profile 里同名包。定位宿主 package 向上最多 4 层，保留原字节预算；未知布局保持未确认。用户已确认：即使静态元数据匹配，插件启用状态仍独立实调验证，不读取完整配置。当前项目 schema 没有“必需录像”登记字段：保留现有严格 schema，显式 required 录像按浏览器入口检查，不虚构已从项目推导的录像要求；未来若加入该字段，需同步扩展归一化规则和测试。

DSH runtime 内 Viewer 的手机连接检查继续只负责连接，不在每次点击时重复启动 DSH CLI。宿主准备报告在实际选定环境中单独运行；已有 peer 装载拒绝仍是运行保护，不用可复制的预检报告绕过它。没有启动用户 DSH 宿主就不声称其实际运行版本已被验证。

替代方案：仅检查 package.json 固定值或执行 PATH 中的 dsh。拒绝，因为多安装、多 profile 与依赖混装会产生假阳性。另一个替代是自动跑 clean-profile；拒绝，因为安装/进程启动超出预检权限。

### 4. Doctor v2 显式区分 ready、blocked 与 incomplete

保留现有报告的稳定检查 id/code，新增 schemaVersion 2、context、checkedAt、分项依赖角色与 capabilities。检查状态仍表达 pass/warning/blocked/manual/skipped，并只为已选择但未完成的检查使用 skipped；无关检查完全不出现。

聚合规则：必要项确定失败 → blocked；必要项未知、取消以外的超时或等待人工确认 → incomplete；必要项均满足 → ready，允许 selected preferred 能力带 warning。退出码 ready=0，blocked/incomplete=2，输入/内部错误=1，用户取消=130。表明基础环境 ready 不代表手机 session ready；单独列出 WDA/MCP/DSH 实调的未验证边界，这些声明不是默认执行额外检查的理由。

检查时间使用实际完成时刻，不采用 UI 渲染时间。报告只作当时诊断快照；任何配置/路径/目标变化后都要重新检查，实际会话入口继续执行自身权限与身份校验。保留旧报告但标记旧范围，不能以旧 ready 激活新目标按钮。

替代方案：维持 v1 但重新解释 overall ready。拒绝，因为现有脚本可能把人工确认退出 0 或 platform=all 的结果当成所有功能已准备好。明确版本迁移比隐藏改变语义更可审查。

### 5. 复用检查叶子，安全上下文与交互状态不合并

从 `doctor.ts` 与 `connection-assistant.ts` 提取可注入的检查叶子/计划映射，避免复制两套版本判断。保留连接助手的设备引用、120 秒 TTL、single-use、同源校验、Android helper 确认、iOS 账户/签名授权及现有 MirrorService owner；doctor 不产生 deviceRef 或可重放连接授权。

新增内部只读计划执行入口供 doctor 与 Viewer 功能检查使用；若增加 HTTP route，必须经过现有 same-origin/mutation-origin 校验、有限 JSON schema 和 requestSignal。不能接受客户端任意 executable、任意命令、profile 根或伪造“由 DSH 启动”的标记；私密路径来自服务器已验证配置或显式本机 CLI。

Viewer 的报告页与 Mock 入口不增加“先把整个环境修好”的门槛。连接页只显示当前平台前提；功能未选时隐藏其检查，选择 required 时才增加对应局部门禁。每个动作独立 pending/进度/错误，失败保留上次材料；切换平台、operation 或功能策略增加 generation 并取消旧请求，晚到响应不能覆盖新状态。实现和 E2E 遵循全局 user-action-contract：至少 800 ms 的真实等待期间操作主题/历史，检查局部进度、结束刷新及失败保留。

替代方案：让 Viewer 自己根据字符串判断依赖和错误。拒绝，因为会与 CLI 语义分叉，并让客户端选择影响服务端授权。

### 6. 有界调度与结果脱敏优先于更多探测

默认最多 32 个去重检查、并发 3、总时限 60 秒；单命令上限 20 秒且沿用更短的已有上限，输出最大 1 MiB。测试须证明支持范围内的显式双平台与功能组合不超出计划预算；超限在执行前返回稳定错误。仅对不同资源的独立只读项并发；取消停止新派发并向自有命令传递 AbortSignal。检查失败仍可继续不依赖它的已选项，但不得因跳过必要下游而变为 ready。

所有命令为固定 argv，不拼 shell。仅连接范围允许访问已配置 loopback Appium `/status`；runtime/report/mock 不做任何 Appium HTTP。DSH 元数据最多 1 MiB/文件、总计 4 MiB；未知格式与预算超限保守返回稳定错误，不原样回显异常。报告保持只读：包管理、信任/配对、证书申请、进程接管和系统修改另需独立用户操作。

## Risks / Trade-offs

- [v2 输出及退出码改变] → 显式标记 breaking，更新帮助/安装/脚本与打包探针；不提供含糊的自动降级。
- [静态 profile 检查无法穷尽动态补丁] → 不执行宿主求值，返回 incomplete；用单独授权的真实 clean-profile 验证覆盖受支持格式。
- [预检与执行间环境变化] → 不把报告作为授权，实际启动继续重检其必要身份/能力；UI 按上下文失效旧报告。
- [不同入口选项被用于绕过权限] → 入口与实际操作由可信适配器/服务端规范化；项目必需能力合并优先，MCP 参数不新增降级权。
- [可选提示淹没必要问题] → off 不执行不展示，preferred 只在对应功能区解释降级，首页不列“不适用”的宿主列表。
- [基线公开检查已有 Git 历史路径阻塞] → 将该失败与本功能回归分开记录，不修改历史、不放宽扫描、不声称全绿。

## Migration Plan

1. 固定上下文/矩阵和 v2 schema，用 fake runner 的“禁止命令调用”断言建立红绿边界，再拆共享检查叶子。
2. 接通 CLI 显式上下文、DSH 只读检查和 doctor v2；更新全部现有 doctor 调用者/测试/探针，不保留隐式 all 默认。
3. 接通 Viewer 与既有功能门禁，保留连接助手的授权、TTL 与生命周期；不改 Agent 工具数量或 schema。
4. 运行类型/契约、全套测试、浏览器 E2E、build/pack，以及相同 tarball 的四类入口探针；在隔离环境验证缺 DSH/缺手机时的非相关路径。
5. 对当前选定 DSH 精确宿主执行独立干净 profile 验收；真机额外只读抽样验证另列，不能用假命令或旧设备记录代替。
6. 更新 README、doctor/MCP/DSH/Viewer/无头任务文档，列出 v2 迁移和检查不等于连接成功。本变更不迁移/重写原 run、证据、个人配置或签名；需要回退时停止自有预检任务，恢复原包及调用脚本即可。
