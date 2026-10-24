# 用例创作与运行分析：实施和验收记录

日期：2026-10-03。功能实现工作分支 `docs/workbench-usability-plan`，隔离工作树基线 `REDACTED_REVISION`。本页记录该基线上的软件验证；后续提交及 `dev` 集成结果以 Git 记录和单独集成验证为准。

验收范围：本机软件/Mock、冻结的旧契约、候选包与指定宿主；不是 Android/iPhone 真实业务或独立用户成效验收。

## 本轮交付

- 四项任务导航、保留草稿的非破坏性导航、受保护的替换和全局运行状态。
- 无需先写 YAML 的目标/步骤/预期表单、受支持标量编辑、无损原文、高级源码和 Inspector 显式交接。
- 公开数据确认、固定路径导出、10 分钟修订绑定校验、独立 Viewer durable acceptance、受理重试不重放、原录像归档路径。
- 应用自有用例库、不可变修订、CAS、幂等回执、容量准入、有界分页、复制、软归档/恢复；run 固定身份和输入，不随 head 变化。
- 独立分析深链、桌面三栏/窄屏页签、首失败与验证范围、历史图/结构/源码行/录像联动，缺证不使用实时画面。
- 明确基线审查、原比较/分诊/复核/安全派生分享、只读 investigation、旧 repair 授权交接和子运行复验。原报告/派生副本当前结果分开呈现，不自动推断根因。
- ADR 0015、用户指南、requirement 映射和两份主规范同步；change 保持活动，独立验收不归档。

## 验证结果

| 门禁 | 结果与范围 |
| --- | --- |
| `pnpm check` | 85 文件，730/730 通过；TypeScript、bundle contract、旧 golden hashes 与新增单测 |
| `pnpm test:e2e --workers=1` | 最终 66/66 通过（3.0 分钟），含新增比较取消后旧报告保留断言 |
| `pnpm build` / `pnpm pack:check` | 均通过；随后实际 pack 并对同一个解包候选执行探针 |
| OpenSpec | 本 change strict 通过，30 份主规范通过；无归档 |
| 同包探针 | Viewer、application、MCP/CLI、DSH rc.2、previous-reader/restart 均通过；详见下节 |

### 同包候选与宿主

候选：`flowassert-0.1.0-alpha.2.tgz`；SHA256：`68292319c12ad91894725be87eafafc18afa4948d3720605e6b28e2b5254c1d1`。构建 Node `24.19.0`、pnpm `11.7.0`。没有发布 npm、GitHub Release 或 tag。

| 探针 | 实际结果 |
| --- | --- |
| authoring-package-probe.mjs | 真实打包 Viewer 静态文件：保存→校验→执行→历史 step 2 截图→归档；无 pageerror；重开后固定 revision/原 verdict 可读 |
| plugin-runtime-probe.mjs | Mock 执行、只读 triage、来源不变、comparison shutdown 排空、store 重开、child/pin 引用通过 |
| mcp-runtime-probe.ts | 同包 stdio 17 工具、catalog/flow/suite/cancel/evidence/triage、打包 YAML、图像边界、本地化与信号退出通过；其中打包 CLI `test triage get`、`test triage start --wait` 退出 0，不代表所有 CLI 路径全覆盖 |
| dsh-clean-profile-probe.mjs | 实际 DSH `0.1.5-rc.2` clean profile、Native/PTC、17 工具、注册测试、图像投影和生命周期通过；未修改 agent loop |
| authoring-compatibility-probe.mjs | candidate 对干净构建的 previous `REDACTED_REVISION`：保护性 orphan 仍受保护；journal/manifest/catalog/revision 字节不变；新版本重开、相同请求返回原结果，不重复派发 |

解包候选在独立临时目录运行，复用 previous checkout 冻结安装的 node_modules；DSH 使用已安装的真实 rc.2 与新建 clean profile。本次未证明默认 npm 在任意空环境可安装：上游 prerelease peer 冲突的已知边界保留在 backend-validation。不要把依赖锁定后的运行通过写成该安装问题已解决。

新增可重跑脚本：`node scripts/authoring-package-probe.mjs <candidate>/lib/application.js`；`node scripts/authoring-compatibility-probe.mjs <candidate>/lib/application.js <previous>/lib/application.js`。其余使用仓库既有 application/MCP/DSH 探针，对所有命令传同一候选，不混用源码 lib。

### 故障和兼容证据

- `workbench-cases.test.ts`：六个 revision/head sync、rename、directory-sync 切点故障/ENOSPC 后重开，原 head 或已提交 head 一致，原请求可重试；不是电源断电实测。
- 1000 个 case × 100 修订元数据、32 MiB catalog 的合成预算测试；50 条分页和 generation 变化明确刷新，超过上限不截断。没有宣称十万实体文件性能。
- HTTP 公开性/同源/严格输入、错误 revision 摘要零派发、archive 不改原 manifest、固定修订关联；双窗口冲突另存副本。
- 真实子进程 SIGKILL 受理边界仍由 authoring/acceptance 专项验证，详细历史见 backend-validation，不把 Mock 设备写入称为真机。
- 浏览器 650 ms 保存/校验/导出/图片/比较/调查/取消故障，操作期间独立导航，编辑后迟到校验不启用运行，失败保留草稿/预览/上一比较报告。
- 旧及派生导入 fixture 在新分析可读；原结果不改。受控 repair 从旧入口和新分析入口均创建独立带 lineage 的运行，不削弱断言。

### 实际截图检查

已查看运行截图：`journey-authoring-desktop.png`、`journey-analysis-desktop.png`、`journey-analysis-narrow.png`、`journey-analysis-zoom-zh.png`、`journey-packaged-candidate.png`、`journey-mcp-candidate.png`（均在 artifacts/screenshots）。覆盖 1440×900、390×844 和中文 CSS 200% 缩放/键盘焦点。CSS zoom 验证不等于完整屏幕阅读器审计。

E2E 会更新旧 Viewer 截图；`mobile-mirror-streaming.png` 的新用例入口已人工查看，再更新 public-readiness 的对应 SHA256。原保留的 iOS 真机截图未替换为 Mock，也未用它证明本轮新功能已真机验收。

### 验证中发现并处理的问题

- 旧录像测试重载后又点击切换按钮，与新增 hash 恢复已打开状态冲突；测试改为仅隐藏时打开，录像/证据断言不放宽。
- 新派生分析原本只显示副本 inconclusive，补充独立的来源原报告结果，并保留 not-revalidated 标签；追加导入回归。
- 原侧栏 max-height 影响新编辑页，改为独立页面高度，并统一 checkbox 和筛选布局；源码按原 sourceLine 标记。
- 公开截图 hash 因实际 UI 变化不匹配，在查看新截图后更新清单；不是禁用发布检查。
- 新 E2E 的导入数组索引触发 TypeScript 可空检查，显式断言 fixture 存在；之后完整 check 730/730 通过。
- 之前共享受理阶段的 Worker 时序超时、安装 peer 冲突等历史仍保留在 backend-validation，不以本轮通过抹除。

## 明确未验收或未授权

- Android/iPhone 实际 App 的创建→执行→分析→修订→复验暂缓；5 人独立研究尚未执行，不能声称 4/5、10 分钟或 30 秒目标达成。
- 未增加模型/PRD 生成、实体触摸录制、云上传、多人协作、任意项目写回；原始证据可能含敏感 App 内容，必须显式留证确认。
- 原生结构只展示登记原文/诊断，不猜历史节点覆盖框；数字快捷键、桌面列表折叠未实现，见 design 实施边界。
- 功能验收时本地远端跟踪 `origin/dev` 为 `REDACTED_REVISION`，比本工作树基线多 11 个提交。本报告只证明该功能基线，合入后必须另行验证集成结果。
