# 内测材料与候选验证 — 2026-10-08

## 后续调整：直接使用 dev 分支

用户确认无需独立内测包。任务卡、README、宣传稿/demo、反馈模板与 OpenSpec 已统一为 dev 分支源码启动，依赖沿用仓库 lockfile，反馈记录提交 SHA 与本地修改情况。撤销本轮 package.files 四项增量；旧包保留为本机历史产物，不再作为推荐入口。下文包 hash 和安装结果只描述调整前的实际验证，不代表当前分发方案。验证完成时改动尚未提交；后续提交与推送状态以 Git 记录为准。

本次调整后验证：构建、pack:check、peer 检查、Mock Doctor、OpenSpec 单 change strict 和 diff 检查通过；宣传页/实际工作台三项 E2E 全部通过（43.0 秒），并重新检查宣传页截图中的 dev 入口。定向 `pnpm check` 的 TypeScript/契约通过，10 项测试中 9 通过，1 失败仍为下文既有历史路径 finding。日志保留在本机忽略目录 `artifacts/runtime/beta-branch/`。

通过 GitHub API 确认仓库为私有、dev 分支存在且指向下列基线。匿名 HTTPS Git 探针因缺少认证失败，不算新用户克隆验收；任务卡已明确仓库授权和 GitHub 认证前提，并用 `mise exec --` 固定运行 Node。尚未验证非作者授权、全新源码克隆安装或真人体验。

基线 `dev@REDACTED_REVISION`，原工作区干净。材料验证阶段未提交、推送、创建 tag/Release、发送邀请或操作手机。默认 cwd 的旧目录已无 Git，实际仓库为已迁移的 FlowAssert。

## 交付

- [任务卡](../../../docs/beta-start.md)：固定版本及安装、五步 YAML、正例/失败/新修订复验、离线报告、退出与反馈。
- [反馈记录](../../../docs/beta-feedback.md)：安装与操作时间分开、全部参与者分母、求助与未完成记录。3–5 位非作者仍待招募和执行，不把本轮作者自动化勾为独立研究。
- [宣传稿](../../../docs/communications/product-introduction.zh-CN.md)：完整长短版与 90 秒口播脚本；有限 AI 导航恢复与默认关闭的修复 Preview 分开。
- [交互演示](../../../docs/communications/mobile-mirror-demo.html)：默认单文件 Mock；失败→新记录复验→审查并下载模拟报告，旧失败保留；历史私人回放改成显式加载。
- 中英文 README、文档索引、安装指南、支持说明、两类 Issue 表单及 TODO/里程碑已同步。两类表单的 DSH 均改为 0.2.0-rc.2，并要求分支、提交 SHA 和本地修改情况。
- 五张新 Mock 截图及 14.16 秒 VP8 / 1280×900 无音轨浏览器录屏。录像是宣传页操作，不是真实工作台/手机录像或 90 秒配音成片。已检查截图、抽帧及编码信息。

## 固定候选（调整前历史）

本机忽略目录：`artifacts/runtime/beta-kit-2026-10-08/`。目录含安装清单、冻结依赖锁、tarball/checksum、candidate.json、SHA256SUMS、任务文档、离线 demo 和录屏；不含 node_modules、私人真机素材或 Git 历史。最终 zip 为相邻的 `mobile-mirror-beta-2026-10-08.zip`，只供本机审阅/小范围内测准备，不作为公开放行。

- 包：`flowassert-0.1.0-alpha.2.tgz`，2,060,922 bytes。
- 包 SHA256：`6713055351bdd7878c9964befa99ee639ab61768bb8eac362f733baf22eb0dd2`。
- 源码 lock SHA256：`0e611b7b462c0817685c02f10cfc7c692e3fbb6d238c850fc23c2dd59beceafa`。
- 安装 lock SHA256：`bd1deeebcbc9c30afe5d6fcfc4d54b83fcd32c114f20cc674528688d813d75fa`。

包只增加内测文档/演示 files 项，不修改设备控制代码或依赖声明。candidate.json 列出基线与未提交文件哈希；包内说明不写入自身 hash，避免循环。包生成后没有再修改其输入文件；后续仅补验证记录、支持表单与测试。源码 lockfile 无变动。

在仓库外第一个新目录从相对 tarball 生成安装 lockfile，第二个新目录用相同 tarball＋该 lock 执行 `pnpm install --frozen-lockfile --ignore-scripts`。两处 `pnpm peers check` 均无问题，没有使用 legacy-peer-deps 或依赖豁免。验证环境 Node 24.19.0 / pnpm 11.7.0 / macOS；网络下载使用公共 npm registry。

同包结果：CLI 版本为 alpha.2，Doctor v2 Mock ready；standalone Viewer loopback 启动、首页及两个浏览器派生模块均 200，SIGINT 退出 0；MCP 探针 20 工具、双 Mock、CLI/MCP、Viewer 本地化、信号清理、打包 YAML/证据 hash、Agent flow/suite/cancel/evidence/triage 均通过。没有本轮 DSH clean-profile、真实模型或真机新验证。

## 门禁与修正

| 检查 | 实际结果 |
| --- | --- |
| `pnpm check --maxWorkers=2` | TypeScript/契约通过；128 测试文件通过、1 失败；1,153 测试通过、1 失败。唯一失败是下述历史扫描 |
| 新增 E2E 定向三项 | 3/3 通过；宣传页两项＋实际工作台任务卡一项 |
| `pnpm test:e2e --workers=1` | 首轮 86 通过、2 失败、1 跳过；新增三项全部通过。失败现场保留，不称首轮全绿 |
| 首轮失败两项单独复跑 | Agent 来源通过；慢源树的懒加载可见性仍失败 |
| 测试修正后两项复跑 | 2/2 通过，未放宽超时、失败状态、材料保留或独立控件断言 |
| `pnpm build` / `pnpm pack:check` / 实际 `pnpm pack` | 均通过；冻结上列同一 tarball 后才执行新前缀验收 |
| `tsc --noEmit` | 新增测试后及最终测试修正后均通过 |
| OpenSpec 1.9.0 strict 单 change | `prepare-guided-beta-kit` 通过；没有宣称全库新版本 strict 通过 |
| `git diff --check` | 通过 |

Agent 来源测试首轮 trace 出现 `/inspection-query.js` 与 `/selector-adapter.js` HTTP 400；当时 pack:check 的构建重建 lib 与 E2E 重叠。停止构建并单独运行后通过，未修改该测试或业务代码。之后的打包/安装结论与这些动态测试分开保留。

慢源树测试：两轮 trace 都显示 `.wb-step` 已有 open、PNG 节点存在且 `loading=lazy`，但图片尚未进入滚动视口。原测试在滚动前要求可见。修正为先滚动到真实图片，再断言可见并新增 naturalWidth > 0 解码断言；原取消结果、部分证据、时序与控件可用性断言不变。不是删除断言或以 DOM 存在替代可读图片。无产品逻辑变动。

宣传页测试首轮 file URL route 拦截不生效，改为独立目录单文件后验证通过，详见[演示记录](../../../docs/communications/beta-demo-validation.md)。全量 E2E 生成的无关截图/报告已移入忽略目录留存，原跟踪截图恢复到基线；本轮只新增五张 beta 截图。

## 明确保留的阻塞

`public:check` 的既有 `absolute-home-path` 位于可达历史提交 `REDACTED_REVISION` 的 `openspec/changes/upgrade-dsh-020-rc2/merge-validation.md`。当前文件已经脱敏，但不改写历史、不增加扫描豁免，公开放行保持失败。门禁运行中刷新旧黄金截图曾额外产生 screenshot-hash-mismatch；恢复测试生成的原跟踪截图后重新检查，不用更新期望 hash 掩盖。

最终 `public:check` 退出 1，仅剩上述一条历史 finding；本轮文档链接和新工作区文件没有新增 finding。

非作者体验、扩大设备矩阵、真实外部业务/模型、真实修复闭环和公开分发治理继续待完成。本轮只把当前已授权、无需外部参与者的内测准备做成可审阅结果。
