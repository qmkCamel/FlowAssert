# ADR 0006：原生 YAML 执行器与共享 Appium 会话

## 2026-10-01：外部报告不是第二执行 owner

新增 JUnit / external-results-v1 字节导入和受信启动 adapter 注册。它与 YAML 执行器接口分离：没有设备租约、网络下载、外部框架启动或报告内代码执行。原报告和附件独立存储为不可变资产，验收通过 asset/test 身份引用，不伪装为原生 run。默认本机可见；逐资产授权绑定当前项目身份/修订，DSH 0.1.5-rc.2 与 MCP 复用同一只读安全摘要及撤销规则。原生执行 owner 仍唯一，前述 Maestro 执行 adapter 暂缓决策不变。具体格式/隐私/真实兼容验收边界见 [外部测试资产](../external-test-assets.md)。

## 2026-10-01：本机 OCR 基础进程边界

新增可选的 `WorkbenchOcr` 候选识别服务，与设备 provider 无关。只有用户显式 prepare 才编译随包 Swift；doctor 验证源码/产物/OS/语言身份。解码与裁剪在有界 worker，Apple Vision 在所属本机子进程通过有界 stdin/stdout 传递 PNG 和严格 JSON，不接收路径、工具调用或网络端点。取消等待进程退出再释放两个识别槽位；不宣称 OS 沙箱。当前没有生产断言/人工放行或矩阵接入，默认生产禁用，旧视觉 no-go 与单设备 owner 不变。来源/配额及未完成范围见 [区域 OCR](../local-region-ocr.md)。

- 状态：Accepted（最小闭环）；硬件验收状态见工作台验证记录。
- 日期：2026-09-14

## 决策

2026-09-17 补充：显式 recover 导航包装由父层编译为独立段，原定导航使用租约内确定性 selector。模型只输出候选，由同一 WorkbenchDevice 复核并派发；正常原生 worker 段仍按下述规则执行。设备写入登记派发状态，未知写入封锁后续动作但允许只读取证。recovered 为独立结果，CI 默认非零，原 failed step 不删除。[当前实现与验收边界](../ai-recovery.md)：真实 Codex/双端恢复未验收，不增加历史格式兼容或版本门槛。
选用固定 `@appclaw/core@2.7.0` 原生 `parseFlowYamlString` / `runYamlFlow`。它的结构化 selector 直接读取 source，通过坐标工具执行，无需单独启动 AppClaw SDK 或 appium-mcp。因此，本次采用源码调研已列出的“有限工具 facade → MirrorService”方案，取代暂定的 Maestro 独立 worker 优先顺序。

工作台不重写通用 YAML 解释器，不把 AppClaw YAML 转译为 Maestro，不启动第二个 Appium/WDA。pnpm 覆盖移除未使用的 `appium-mcp` 传递依赖；不降低供应链保护以安装它的 Git 子依赖。固定执行器在 worker 中运行，worker 无模型配置，fetch 禁用；自然语言、环境文件、插值、安装、任意代码和不支持命令在派发前拒绝。

## 2026-09-18：Maestro fork adapter 暂缓

当前没有需要迁移的 Maestro YAML 用例库，现有 AppClaw YAML、MirrorService/Appium、证据归档和业务验证链路已经覆盖近期固定回归目标。因此暂不立项或排期 Maestro fork adapter，也不为它预先增加 engine 抽象、YAML 转译、第二执行器依赖或设备控制权交接逻辑。已有 iPhone 真机 fork PoC 继续作为调研证据保留，不代表产品 adapter 已接入。

只有出现以下任一明确需求时才重新评估：

- 团队已有规模化 Maestro 原生 YAML 资产，迁移成本高于维护独立 adapter；
- 当前 AppClaw 执行器无法满足已确认的关键流程语义，且 Maestro 已在目标 Android/iOS 真机矩阵验证可用；
- 外部使用方明确要求原生 Maestro 流程作为输入或执行产物。

重新评估必须先形成独立 OpenSpec change，并验证固定 fork/driver 版本、Android/iOS 真机、单设备唯一 owner、Appium/Maestro 控制权交接、取消与清理、证据导入和升级责任。未满足这些条件前，Maestro 仅作为可借鉴的流程设计与历史 PoC，不进入当前架构执行路径。

MirrorService 的运行租约在同一个 runtime 中排他；其他 Viewer/DSH/MCP 控制入口均拒绝插入。取消终止 worker，并等待已派发 provider 请求收敛后释放租约。因设备操作不能撤回，取消不是回滚。若已派发动作报错且结果不确定，后续控制被封锁，必须断开重连。运行结束保留原有会话供实时观看和后续用例使用，状态明确为 `session-retained`；用户断开连接/关闭工作台进程时沿用原有 runtime 清理。多个独立宿主进程不能自动共享这份内存租约，需避免对同一设备另开控制服务。

## 验收与证据
每一步结束后保存原图、源树和捕获起止时间，下一次设备调用等待证据完成；断言在检查点源树上重复验证。`blockers` 只覆盖用户已声明的可访问树遮挡条件。引擎成功但检查点不符为 `evidence-conflict`，blocker 命中为 `evidence-contaminated`，取证/磁盘/进程失败为 `inconclusive`。最终读取文件验证 SHA-256 后提交 manifest。

`pass` 表示声明的 UI 条件通过且必需材料完整，不自动证明视觉无遮挡或业务持久化。界面和 manifest 明确 `visualVerification/businessVerification: not-performed`。通用视觉判断和独立业务读取不属于本次最小实现。已识别的广告假阳性通过声明 blocker 处理，不能据此声称未知系统通知也能自动识别。

## 兼容边界
- 支持结构化 tap/assertVisible/assertNotVisible/assert/assertCount/waitUntil/waitUntilGone，及 launchApp/wait/方向 swipe/back/末尾 bare done。
- Android/iOS 使用现有 provider 的坐标系、session 与媒体。真实设备结果只在实际验证后记录，Mock 不替代硬件验收。
- 本地用户点击运行是对 YAML 动作与本地证据留存的明确授权；不改变 Agent 的屏幕/输入/应用管理政策，不在工具结果传输连续媒体。
- DSH 已测试版本基线保持 `0.1.2-rc.1`，未修改 Harness 循环。Inspector、视频录制、输入和代码验证器后续按独立变更交付；Maestro adapter 按上述重审条件暂缓。

## 2026-09-14 P0：计时、检查点屏障与材料恢复

原生步骤回调通过 SharedArrayBuffer 确认屏障等待宿主处理完成，只阻塞独立 worker。下一步动作及固定等待不会在上一检查点仍未提交时开始；步骤执行使用单调时钟，排除前一步取证队列。记录 geometry/locate/action/png/xml/persist/verify 阶段、固定等待与执行器剩余耗时（明确是差额，包含轮询/IPC/计算开销）。初始化只读几何，纯定位只读源树，点击派发前读取新几何，检查点只获取新 PNG/XML；不缓存或省略必需证据。

PNG/XML 在设备排他队列内各自尝试并逐件保存，一件失败后仍尝试另一件。持久化使用临时文件、fsync、不可覆盖发布与目录同步；manifest 原子替换。重启枚举未登记的最终材料与临时材料，保留原始损坏 manifest/临时字节，恢复材料标记 recovered，临时材料还标记 incomplete；恢复哈希只能证明当前字节，不证明中断前完整性，最终结果为 inconclusive。读取拒绝 symlink 并复核 hash。保留 schemaVersion 1，新增字段均可选。

每个部分有独立捕获时间窗；屏幕持续变化时仍不是原子图片/树快照。Viewer 显示取证阶段、部分材料、计时与恢复提示；未知视觉遮挡和业务持久化继续为 not-performed。受控关闭等待当前调用结束；取消不派发后续步骤但会保存已取得材料。宿主 SIGKILL 的测试验证的是证据恢复，设备资源的自动回收只承诺存活 managed owner 的受控清理路径。

## 2026-09-15 公开文字输入

新增结构化 type，通过原生 selector 定位和聚焦，mode 扩展在本机保存，不改 AppClaw 源码。父进程核对当前步骤并将已审核 selector/text/mode 交给 WorkbenchDevice，在租约内重新验证目标与焦点后使用 provider.inputText。任何 facade 错误均终止 worker，不回复可触发 AppClaw 独立 ADB 回退的失败结果；输入失败也采集步骤证据。兼容旧流程，仍不支持敏感输入、任意键盘命令与独立设备栈。

## 2026-09-16：本机辅助视频归档

工作台显式选择后复用 Viewer 的浏览器录制器，先录制再派发 YAML，测试终态后上传至绑定 run。录制不新增 Appium 控制或媒体订阅，不经过 DSH/MCP。run 初始 manifest 保存 captureId/session/开始时间；异步上传写不可变媒体文件和独立原子 video.json，避免与 worker 的步骤 manifest 更新竞争。

视频是辅助材料，完整/部分/未收到单独显示，不能替代每步必需截图/源树或业务验收。内容读取验证 SHA-256 后支持 Range，步骤按同机时间近似对齐。上传同源、限额、互斥、超时且幂等；服务关闭等待在途写入后释放目录 owner。页面强关可能丢失未上传视频，本期不承诺浏览器崩溃无损录像。既有 run schemaVersion 1 的可选字段保持兼容。

## 2026-09-16：发布包执行器依赖边界

仓库级 pnpm override 不会传递给安装插件的宿主，直接发布对 `@appclaw/core` 的运行依赖会重新引入未使用的 `appium-mcp` 与其 Git 子依赖。改为构建时固定 core 2.7.0，打包实际引用的模块；保留其其余外部运行依赖为本包 dependencies，不修改上游执行语义。解析与执行共用一个 worker URL：源码使用开发 worker，发布包使用 `lib/workbench-worker.js`。许可证及来源随包分发。仓库开发安装仍使用原 override，不要求用户降低安装保护。

验收必须在仓库外安装同一 tarball，运行 MCP、Viewer、原生 YAML worker 与 DSH 0.1.2-rc.1 Native/PTC；仅源码测试或安装成功不足以证明 worker 可用。安装包探针逐份下载并校验运行证据 SHA-256。详见 [打包运行验收](../packaged-runtime-validation.md)。

同轮宿主实测修正 DSH 输出 schema 投影：联合类型根省略冗余 `type`，保留各分支，兼容 rc.1 编译器；MCP 使用原 JSON Schema。只涉及宿主适配，不改变设备控制边界。

## 2026-09-16：确定性流程编排、代码验证和串行套件

按用户调整，直接扩展当前 YAML，不添加 version: 2 门槛或旧格式兼容分支。上述“禁止插值/仅原生 YAML”的历史限制调整为：只允许类型参数与公开输出的完整字段绑定、注册子流程、有限分支/循环；叶子继续由固定 AppClaw 原生 parser/runner 执行。子块自动合成的 done 在 worker 回调边界过滤，源步骤按全局序号和逻辑路径留证。

WorkbenchService 保持一次 attempt 的设备租约；套件在服务内独占调度、逐 case 执行，不增加 session owner。可信注册扩展通过独立 Node 子进程执行 prepare/verify/cleanup，产物是自包含 bundle，模块解析仅允许 bundle 与 node: 内置模块；不宣称 OS 沙箱。私有资源 journal 支持部分准备失败后的逆序清理；取消回收进程树，强杀后标记待处理而不自动重放写入。

pass 增加已声明必选 verifier 和资源清理约束；没有 verifier 仍为 businessVerification: not-performed。重试默认关闭；显式安全重试必须重置且前次清理成功，重试通过标为 flaky，CI 默认非零。RunStore schemaVersion 1 增加可选字段，保留证据文件读取兼容；证据协议版本与 YAML 语法版本是两件事。

运行快照包括登记流程、数据、扩展 bundle/sha256、公开参数；原快照重跑和编辑后按当前项目运行是两个明确入口。套件提供 JSON/JUnit、CLI 退出码及 Viewer case/attempt 历史；见[使用](../test-orchestration.md)、[验收](https://github.com/qmkCamel/flowassert/blob/main/docs/test-orchestration-validation.md)。

## 2026-09-17：恢复前的内容区域校验

用户授权修复 Android 状态栏变化导致的误拒绝。恢复派发前改为比较解码像素：有唯一可信原生 `android:id/content` 时仅比较该全宽内容容器，上边距不得超过视口高度 20%、下边距不得超过 10%，且目标完整位于其中、没有可见异包节点。无法确定范围及 iOS 使用整屏。区域、图片尺寸与哈希一并进入 observation 证据；完整 PNG/XML 保留，所有源树/App/session/新鲜度门禁保持。实现位于 WorkbenchDevice 的派发门禁，不增加 provider 或设备 owner。

此规则减少系统区域噪声，不承诺未知遮挡检测；内容内任一像素变化仍阻止旧建议，系统覆盖层若进入源树也会触发拒绝。ADB 命令链路间歇超时另行排查，不能通过放宽预算或画面校验掩盖。

## 2026-09-25：显式视觉包装与受控修复

`assertVisual` 是 Workbench 编译层的显式包装节点，不修改 AppClaw agent loop 或原生步骤语义。缺登记 profile 在动作前拒绝；登记参考 PNG、审批、revision 和像素规则随项目快照冻结。执行使用既有 `MirrorService` 租约和该步骤检查点 PNG，视觉 pass/fail/inconclusive 独立于结构 UI 与业务 verifier。旧 YAML 仍是 visual not-performed；未完成视觉条件不能靠结构通过掩盖。主题或构建无法可信比较时保守 inconclusive，不缩放图片或自动替换基线。此边界未增加第二媒体订阅、设备 owner 或模型请求。

受控修复只用已保存的成功基线与失败 XML，在同一计划、非敏感文本/角色唯一锚定且新旧 ID 关系可证时提出 `tap` 定位器替换。用户确认得到新草稿，显式复跑生成新 run 并记录来源；旧失败和断言不改。无法安全推断时保留失败。这是保守的工程能力，不代表已完成真实 App 两次构建变更验收。

## 2026-09-26：视觉基线版本冻结

Viewer 显式预览与批准的视觉基线保存在 WorkbenchStore 下的不可变 revision 记录中；候选不会自动提升为批准。项目参考图仍是受信配置入口，运行证据只能从原始干净成功且完整的本地运行选择。批准时绑定来源图像/manifest、规则摘要、允许目标构建和审批身份，并在 store mutation gate 内重验。来源运行的保护与批准记录同一提交边界生效。新运行在编译前读取最新版；已受理套件/运行沿用冻结快照，不因后来批准而改变。视觉像素比较在单独的有界 Node worker 中执行，最多 10 秒，运行取消会终止 worker；worker 只收到冻结图片/规则，不持有设备服务。比较继续使用同一个设备租约的步骤截图，不引入第二 provider、Harness 改动或通用模型判定。当前浏览器/Mock 工程验证通过，物理设备与真实 App 多构建反例仍待完成。
