# FlowAssert 开源前审计（2026-10-24）

## 结论

当前源码与已清洗 Git 历史的规则扫描没有发现已确认的真实密钥。独立的新私有仓库已建立，后续依赖与图片审查见[安全修复记录](security-remediation-2026-10-24.md)。旧仓库服务器残留对象尚未清除，公开发布仍未执行。下列迁移前扫描数量保留为历史基线。

用户选择 **FlowAssert** 作为新名称。新候选来自远端最新 dev 的独立网络克隆和跟踪文件快照；原仓库本地 checkout 与远端发生历史分叉，因此没有合并旧历史、reset 原工作区或从工作目录复制忽略文件。原 Git 引用和 SHA 对照只保留在本地审计材料中，不随新仓库迁移。

## 隐私检查

| 检查 | 本次结果 | 边界 |
| --- | --- | --- |
| 远端 Git 引用 | 10 个分支、1 个带注释标签；105 个可达提交 | 不包含平台内部 refs、旧缓存或他人克隆 |
| 内置 public:check | 1,329 个当前文件、105 个可达提交通过，无历史豁免 | 规则扫描，不是完整信息泄露证明 |
| 独立 Gitleaks 8.30.1 历史扫描 | 对全部 refs 运行，工具报告 93 个产生扫描 diff 的提交；1 项虚构测试值 | 与 105 个可达提交计数口径不同 |
| 独立 Gitleaks 源码快照扫描 | 1 项相同虚构测试值 | 解码深度 3、归档深度 2 |
| Gitleaks 命中复核 | `tests/doctor.test.ts:9` 是手写虚构设备序列号，无真实凭证 | 未使用宽泛目录排除压制报警 |
| 作者、提交者、标签身份 | 网络新克隆全部为维护者 GitHub noreply | 原工作区默认 Git 身份仍需避免用于新提交 |
| 已知私有图片对象 | 网络新克隆中对象不存在 | 不代表旧平台缓存已删除 |
| 168 张当前 PNG | 缩略图逐页初筛、本机 Vision OCR 全量提取成功；家目录、邮箱、组织关键词、设备 ID/密钥形状规则未命中 | OCR 会漏字；不是所有图片原尺寸逐像素签字 |
| 原尺寸图片抽查 | iOS 系统设置、iOS Viewer、Android 锁屏、MCP iOS 设置 | 系统界面未见账号/SSID/密钥；状态栏和会话标识仍是公开必要性审查对象 |

没有把历史真实应用结论改记成 Fixture 新验收，没有将图片重命名或文字脱敏视为真实设备重新执行。保留的历史 artifacts 原字节不改；新品牌界面证据单独记录。

## GitHub 与迁移边界

登录完成后已通过 GitHub API 核实：新旧仓库均为私有；旧仓库没有 fork，PR 列表为空。旧 Release 的 3 个附件已下载到仓库外的私有审计目录，独立秘密扫描及私有内容规则扫描没有发现确认的问题，没有将这些资产迁入新库。

旧库曾移除的一张含私人网络信息的图片，仍能通过有权限的 Git blobs API 读取；这不是匿名访问证明。新库同一对象查询为 404，干净网络克隆也不含该对象。GitHub 支持工单草稿仅保存在本机私有材料中，尚未提交、尚未收到平台清理确认。
迁移使用独立 `git init`，仅导入已审查的跟踪文件，保留 MIT 原版权和第三方 NOTICE；本地提交使用 noreply。不得 mirror push、复制 `.git`、导入旧 tags 或 fork 原仓库。原配置路径、工具协议、存储 schema 保留兼容，避免品牌修改破坏已存在的运行记录。

新远端为私有的 `qmkCamel/flowassert`，默认分支 `main`。首个 root commit 已推送，并通过干净网络克隆核对。新仓库不继承旧 CI、Release、Issue/PR 或附件；没有公开发布。

## 修复前依赖审计（历史基线）

`pnpm audit --prod --audit-level=high` 本轮失败：**1 critical、14 high、19 moderate、2 low**。这是依赖库公告命中，不表示已经证明本产品存在可利用路径。

| 依赖 | 当前版本 | 公告给出的高风险修复门槛 | 下一步 |
| --- | --- | --- | --- |
| proxy-addr（MCP/Express 间接依赖） | 2.0.7 | 2.0.8 | 核对信任代理路径，更新依赖树并验证 |
| fast-uri（MCP/AJV 间接依赖） | 3.1.5 | 3.1.7 | 更新补丁并验证 URI/协议输入 |
| sharp | 0.33.5 | 0.35.5 | 升级涉及 native 图像实现，需要截图、OCR、打包回归 |
| @modelcontextprotocol/sdk | 1.30.0 | 1.32.0 | 保持 MCP 工具合同，验 stdio/HTTP、连接、输入界限 |
| zod | 3.25.76 | 4.6.6 | 属于跨主版本；评估 AI SDK、AppClaw 和 schema 兼容后迁移 |
| body-parser | 2.3.0 | 2.4.0 | 随 Express 依赖树处理 |
| undici | 6.28.1 | 6.29.1 | 处理 AI SDK 间接依赖并验证请求失败边界 |

公告来源：[proxy-addr](https://github.com/advisories/GHSA-jqcg-44mw-7w3h)、[fast-uri](https://github.com/advisories/GHSA-qw65-cvwx-89v3)、[sharp](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)、[MCP SDK](https://github.com/advisories/GHSA-46jr-4wx8-v453)、[zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)、[body-parser](https://github.com/advisories/GHSA-27r3-jxmh-p828)、[undici](https://github.com/advisories/GHSA-xjj6-f33q-929c)。

后续已升级直接依赖，并对固定 AppClaw 执行器的依赖做有范围的兼容迁移；修复后的审计和回归见[安全修复记录](security-remediation-2026-10-24.md)。

## 名称与兼容

品牌改为 FlowAssert，npm package 名及命令采用 `flowassert`、`flowassert-mcp`、`flowassert-viewer`。README、Viewer、帮助文本、安装示例、DSH bundle、工作流和仓库链接同步。已有 `mobile-mirror.*` 配置文件、存储路径、协议名称和源文件名暂不迁移；这些兼容标识不等于旧 Git 历史。

2026-10-24 查询 npm `flowassert` 返回 404；GitHub 仓库名搜索没有同名精确项目，但有 FlowAssertions。SQLDelight 历史上存在 [FlowAssert 测试 API](https://github.com/sqldelight/sqldelight/issues/1416)。本次是搜索初查，不是名称保留、域名或商标许可证明。

## 验证记录

迁移前源码：`public:check`、`pnpm build`、`pnpm pack:check` 通过；浏览器 E2E **112 通过、2 既有可选项跳过**。第一次完整 check 与 E2E 同时执行，发生截图哈希被 E2E 改写和一个嵌套取消场景轮询超时；这是本轮执行冲突，已恢复原取证文件并串行复核：这两份测试文件的 38 项全部通过；仍保留第一次运行失败记录，不冒充原源码完整门禁一次通过。

### FlowAssert 本地候选

- `pnpm check`：142 个测试文件、1,203 项测试通过，包含类型、合同与 125 份文档检查。
- `pnpm test:e2e`：112 项通过，2 项既有可选测试跳过（独立性能测量、需批准真实回放材料）。
- 截图复核后补齐两处大写旧名称；`pnpm exec vitest run tests/mock-provider.test.ts tests/public-readiness.test.mjs tests/workbench-authoring-contracts.test.ts tests/mcp-stdio.test.ts`：4 文件、12 项通过；工作台运行/证据/重启保留的定向 Playwright 复跑：1 项通过。
- `pnpm build`、`pnpm pack:check`：在最终文字修正后通过；包内 68 份 Markdown 的本地链接完整。
- `pnpm pack`：生成 `flowassert-0.1.0-alpha.2.tgz`，253 个条目；对实际解包内容运行 Gitleaks（解码深度 3、归档深度 2），0 项命中。
- `node scripts/release-candidate-probe.mjs --tarball <候选包> --checksum <校验清单>`：干净临时目录安装通过，CLI 版本正确，20 个 MCP 工具、双 Mock 矩阵、打包 YAML 与证据哈希、注册测试/套件/取消/证据/分诊、Viewer 本地化及信号清理通过；未请求 OCR，未执行 DSH clean-profile 或真机。
- `pnpm docs:check`、`pnpm public:check` 和 `git diff --check`：最终文档与当前候选通过，1,332 个文件、1 个可达提交，无历史豁免。
- 最终 1,332 个源码文件重新独立扫描：仍只有 `tests/doctor.test.ts:9` 的同一虚构测试序列号，原始 Gitleaks 退出码为 1，经人工复核归类为假阳性；不是工具零报警。实际包扫描为退出码 0。
- 安装包 SHA-256：`63b1a14ab95196c46a9765593cedbd163624a780cfc32a52b435a6ff3bc3a0f4`。这是本地验证产物，没有发布到 GitHub 或 npm。

运行中交互检查覆盖：长流程/慢取源树/慢文字输入/慢准备期间可见进度，主题、历史及刷新保持可用，取消阻止后续动作，失败保留前次成功记录或已取得的 PNG。它们均来自本次通过的浏览器回归，不依靠静态代码推断。

新截图 [`flowassert-workbench.png`](../artifacts/screenshots/flowassert-workbench.png) 来自本次 Mock 运行，已原尺寸查看；工作台、Mock 设备内容、运行结果和本地演示标识可见，未见账号或凭证。哈希固定在 `public-readiness.config.json`。本轮生成的 123 个历史 artifact 变动保存在本地审计目录，已逐路径恢复，避免覆盖旧取证材料。

隐私门禁补充环境文件变体（如 `.env.production`）、二进制签名材料（p12/pfx/jks/keystore/mobileprovision）以及新品牌本机配置文件的准入拦截；当前与历史扫描都有测试。没有依据内容可读性或字符串长度放行这些文件。

冻结合同只为两处已经审阅的品牌改动增加精确哈希：MCP 帮助命令与 DSH 安装包查找路径。协议、schema、旧运行结果及取证 fixture 没有整体重建基线。

原真机、真实业务、OCR 授权及独立验收没有因改名或软件回归而升级。


## 本地 Git 交付状态

候选分支为 `main`，只有一个无 parent 的根提交；作者与提交者为维护者 GitHub noreply。无旧 tags、分支或 remote；旧源提交和已知私有图片对象不在候选对象库。原许可证逐字节保留，全部历史 artifacts 与源快照比较无字节变化。

新仓库已创建并推送，初始提交为 `37c3616f179f3740a8f23bfbd807690bc83c8df3`，当时本地与远端 SHA 一致；干净网络克隆核对为单 root commit、没有旧 tags/对象。后续安全修复使用正常追加提交，不重写这个已推送的根。仓库继续私有，没有发布 Release/npm。
