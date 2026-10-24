# 开源前依赖、图片与旧缓存处理

日期：2026-10-24。基于 FlowAssert 新私有仓库的首个根提交；原工作区与旧 Git 历史不改写。这里的“处理”分为库版本修复、媒体内容审查、平台残留对象清理三类，不能相互替代。

## 依赖

修复前生产审计为 1 critical、14 high、19 moderate、2 low。修复后生产与完整开发依赖树的审计均为 0 项已知漏洞（本次公告数据库快照）。它们是已知库公告命中，不是已经证明本产品被利用。

- MCP SDK：1.30.0 → 1.32.0，保留工具名称及协议合同。
- sharp：0.33.5 → 0.35.5，涉及 native 图片实现，必须验证实际打包安装。
- Zod：3.25.76 → 4.6.6；给 13 个 record 显式添加 string key schema，修复预算用 prefault 保留旧版本的嵌套默认值。未转用含旧实现的 `zod/v3` 来绕开修复。
- fast-xml-parser：4.5.7 → 5.7.0；现有 XML/perception 与原生流程回归覆盖解析兼容。
- 同步更新 proxy-addr、fast-uri、body-parser、qs、hono、ip-address 等间接依赖；undici 限定到修复后的 6.29.1。
- 开发环境的 Vitest 升级至 4.1.12，Vite 8.2.1 → 8.3.5（同主版本修复版）；AppClaw 2.7.0 保持固定，只对已检查的 schema/图片/XML/MCP 依赖设置有范围的 override。Harness 保持 0.2.0-rc.2、Cordis 4.0.4，不修改 agent loop。
- 实际安装包探针增加干净 npm 安装后的生产依赖审计，防止仅 workspace override 生效而用户安装仍有漏洞。
- CI 和 Release 增加包含开发依赖的 `pnpm audit --audit-level=low`。这是联网公告检查，数据库变化可能导致未来失败，需要重新处置，不能关闭检查掩盖问题。

Zod 的迁移依据见[官方迁移文档](https://zod.dev/v4/changelog)；安全公告分别见 [Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)、[sharp](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)、[MCP SDK](https://github.com/advisories/GHSA-46jr-4wx8-v453)、[undici](https://github.com/advisories/GHSA-xjj6-f33q-929c)。

## 图片与媒体

审查清单为根目录的 `public-media-review.json`：169 PNG、3 SVG，没有跟踪的视频。旧 168 张 PNG 与先前 OCR 的来源快照逐字节一致，新增品牌图单独 OCR；169 张均提取成功，秘密/本机路径/组织关键词规则未命中。

历史图已全量缩略图筛查，20 张公开入口、真机、签名/账号提示、检查器与连接环境重点图逐张打开复核。SVG 源码没有脚本、嵌入图片或外链资源，内容为架构说明。PNG 没有文本块；两张图片的 EXIF 仅为颜色、尺寸、分辨率/方向，不含 GPS、账号或注释。

没有发现确认的账号、密钥、SSID 或真实设备标识。部分历史截图显示状态栏、旧品牌及截断的测试会话标识；作为历史验证材料保留，不代表本轮执行真机。图像工具对超长图片可能缩放，因此不把这项工作表述为每张图片原尺寸逐像素签字。OCR 与人工观察都有漏检可能。

`public:check` 现在核对所有图片/视频的审查清单、哈希、审查方法及保留理由。新媒体、替换字节、重复或失效条目会失败；维护者应审查内容后再更新清单，不能自动批量刷新哈希当作审查。该门禁约束当前文件，不能替代历史或平台缓存扫描。

## 旧 Release 与服务器缓存

登录后核实新旧库均私有，旧库 API 的 forks_count 为 0、PR 列表为空。旧 Release 的 3 个附件已在仓库外受限目录备份，实际安装包解出 61 个文件：Gitleaks 8.30.1 解码深度 3、归档深度 2 扫描为 0；私有内容规则同样没有命中。无需删除无确认问题的旧附件，也没有迁移它们。

旧库已移除的一张私人网络截图仍能通过有权限的 Git blobs API 读取；这不证明匿名可读。新库查询同一对象为 404，独立网络克隆不含该对象。对象定位信息与 GitHub Support 工单草稿只保留在本机私有审计目录，不在公开文档重复传播原引用。

工单尚未提交、服务器清理尚未获确认。按 [GitHub 官方流程](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)，这类残留需要平台协助；新提交或删除本地缓存不能替代服务端清理。原库继续私有；公开前应取得处理结果。

## 验证

最终本地验证结果：

- `pnpm check`：类型、合同、126 份文档检查通过；143 个测试文件、1,207 项测试通过。
- `pnpm test:e2e`：112 通过、2 既有可选项跳过；慢操作进度、无关控件交互、取消和失败结果保留通过运行中检查。
- `pnpm build`、`pnpm pack:check`：通过，包内 68 份 Markdown 的本地链接完整。
- `pnpm audit --json` 与 `pnpm audit --prod --json`：完整开发依赖树与生产依赖均为 0 项已知漏洞。
- `pnpm dlx @fission-ai/openspec@1.9.0 validate --all --strict --no-interactive`：55 项通过。
- 实际 `pnpm pack` 安装包 253 个条目；Gitleaks 扫描实际解出内容约 8.42 MB，0 命中。源码扫描仍仅有 `tests/doctor.test.ts:9` 的虚构测试序列号报警，原始退出码 1；人工复核为假阳性，没有宽泛屏蔽。
- `release-candidate-probe.mjs`：干净 npm 安装、实际安装依赖审计 0 漏洞、CLI、20 个 MCP 工具、双 Mock 矩阵、打包 YAML/证据哈希、测试/套件/取消/分诊、Viewer 本地化、信号清理全部通过。额外执行本机 Vision 对合成中英文图片的 OCR；不是实际业务、真机或模型验收。
- 安装包 SHA-256：`d72148f94b59d6ba2b7ed776dd6ca14d0d01210bebedc002e6434a6ac33ba070`。仅用于本地验收，没有发布 Release/npm。
- 本轮 123 个新生成 artifacts 保存在仓库外私有材料中，已逐路径恢复历史原件；新生成的运行中截图另存并打开检查，未将旧证据记为新执行。
- `pnpm public:check` 与 `git diff --check` 通过；媒体清单涵盖 169 PNG 和 3 SVG。

远端 CI 会对正常追加的安全修复提交重新执行；以该提交的 Actions 结果为准。首次新仓库 CI 的两个失败是等待默认轮询窗口和固定 50 ms 后读取持久化取消状态；已改为有界状态等待，且无论断言结果均释放阻塞的 child action，保留“取消阻止后续动作、shutdown 必须等子操作退出”的断言。

仅对 `src/viewer-workbench-runs-http.ts` 的显式 record key 迁移增加冻结合同哈希覆盖；未整体重建旧协议或证据 fixture。
