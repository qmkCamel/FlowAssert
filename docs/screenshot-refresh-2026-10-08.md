# 文档截图刷新与验证（2026-10-08）

## 范围与结论

基于 `dev@REDACTED_REVISION`，重新运行浏览器测试，刷新此前留在工作区的 20 张文档／验收示例截图。保留现有文件名，README 和各专题文档的图片引用继续有效。截图包含当前用例导航、环境预检入口和结果展示；没有直接提交旧 stash 中的图片。

这些文件是**可更新的界面示例，不是历史验收的不可变原始证据**。专题验收文档原有的日期、设备、版本和结论仍属于对应历史验证，不因图片刷新而成为本日真机复验。需要复现历史图片时应查看对应 Git 提交。

全部图片均来自 Mock、合成媒体或仓库内脱敏测试夹具。没有连接手机、调用真实模型、验证 DSH 插件实际启用状态，也不关闭任何真机／独立业务验收缺口。

## 截图与生成来源

下列图片均位于 `artifacts/screenshots/`；测试位于 `tests/e2e/`。

| 图片（省略 `mobile-mirror-` 前缀） | 生成测试 | 展示内容与边界 |
| --- | --- | --- |
| `agent-run-source.png` | `agent-run-control.spec.ts` | Mock 运行的 Agent 来源标记；不是 Codex／DSH 宿主实调 |
| `ai-recovery.png` | `recovery.spec.ts` | 注入候选规划器的恢复记录及保留的原始失败；不是实际模型决策 |
| `android-media-final.png` | `viewer.spec.ts` | 合成 Android 媒体渲染；不是手机帧率／延迟实测 |
| `capture-narrow.png` | `capture.spec.ts` | 窄屏截图、录像导出入口；纯色媒体为测试夹具 |
| `inspector-final.png` | `inspector.spec.ts` | 冻结截图、节点树和选中节点 |
| `inspector-zoom.png` | `inspector.spec.ts` | 中文、缩放及保留的选中状态 |
| `inspector-refresh-failed.png` | `inspector.spec.ts` | 人工注入抓取失败，仍保留旧截图与选择 |
| `inspector-recovered.png` | `inspector.spec.ts` | 重试成功后的冻结检查状态 |
| `inspector-narrow.png` | `inspector.spec.ts` | 窄屏节点树、详情与草稿区域 |
| `orchestration-suite.png` | `workbench.spec.ts` | 夹具套件、验证扩展及步骤记录 |
| `run-comparison.png` | `workbench.spec.ts` | 历史运行差异和确定性诊断上下文；不是 AI 根因结论 |
| `workbench-baseline-preview.png` | `workbench-baselines.spec.ts` | 合成基线候选图、摘要及显式审核入口 |
| `workbench-evidence.png` | `workbench.spec.ts` | README 主图：Mock 运行结果、来源和实时画面；业务与视觉验证显示未执行 |
| `workbench-imported-failure.png` | `workbench.spec.ts` | 脱敏历史导入失败；原图已替换为 1 像素占位，不是原始手机画面 |
| `workbench-partial-evidence.png` | `workbench.spec.ts` | 源树获取中断／取消后，保留 PNG 与不完整取证说明 |
| `workbench-text-input.png` | `workbench.spec.ts` | Mock 公共输入字段、YAML 和执行后画面；不是第三方 App输入实测 |
| `workbench-video-history.png` | `workbench-video.spec.ts` | Mock 运行录像的真实浏览器解码、重启后回放与步骤定位 |
| `workbench-video-narrow.png` | `workbench-video.spec.ts` | 同一历史录像的窄屏展示；不含音轨 |
| `zh-cn.png` | `viewer.spec.ts` | 合成 iPhone 检查结果及中文连接引导；未执行真实签名 |
| `zh-cn-narrow.png` | `viewer.spec.ts` | 同一连接引导的窄屏布局 |

逐张检查可读内容、状态和隐私边界。Inspector 的 Mock 截图使用几何块表示内容，节点语义在树中显示，并非真实手机字体渲染失败。没有将检查用拼接缩略图作为提交资产。

## 截图取景修正

- Agent 来源：固定截图视口、滚动到 `Started by Agent`，增加视口内断言并使用视口截图，避免仅 DOM 可见或整页截图重排后拍不到来源。
- Inspector：桌面截图改为整页，保留新增导航下方的节点详情和 YAML 草稿。
- 部分取证：在步骤摘要进入视口后截图，避免整页截图调整页面尺寸导致内部滚动区回到顶部。

以上仅修改测试取景与断言，没有改动产品逻辑。

## 验证记录

环境：Node.js `24.19.0`、pnpm `11.7.0`、Chromium `151.0.7922.34`，headless、单 E2E worker。

| 检查 | 结果 |
| --- | --- |
| `pnpm check --maxWorkers=2` | 类型与 Harness 契约通过；单元／集成 1,153 通过、1 失败，见下述历史问题 |
| `pnpm test:e2e --workers=1` | 85 通过、1 默认跳过（1,000 条报告目录性能专项） |
| `pnpm build` | 通过 |
| `pnpm pack:check` | 通过；这是打包清单检查，不代表宿主安装验证 |
| `pnpm exec tsc --noEmit` | 通过；截图测试修改后补验 |
| `pnpm test:e2e tests/e2e/agent-run-control.spec.ts tests/e2e/inspector.spec.ts tests/e2e/workbench.spec.ts --workers=1` | 19 通过；取景修正后复跑 |
| `pnpm test:e2e tests/e2e/agent-run-control.spec.ts --workers=1` | 1 通过；Agent 最终改用固定视口截图后再次复跑，并目视确认来源标记入图 |
| `pnpm public:check` | 仅下述 1 项历史路径问题；没有新增发现 |
| `git diff --cached --check` | 通过 |

唯一已知 `check` 失败来自可达 Git 历史中的 `absolute-home-path`：提交 `REDACTED_REVISION` 的 `openspec/changes/upgrade-dsh-020-rc2/merge-validation.md`。本轮未改写历史、未放宽扫描规则，不将整体门禁报告为全绿。

慢操作运行时检查随 E2E 完成：抓取中可切换主题、缩放和取消；Inspector 刷新失败保留旧图；恢复规划等待期间主题与历史刷新可用；录像慢保存期间截图与主题仍可用，上传失败保留本地下载并允许重试；源树取证中断仍保留 PNG。这些结论来自交互断言，不单靠静态截图判断。

## 提交边界

只提交上述 20 张图片、相关截图测试修正和本文／索引。全量测试额外生成的无关截图、临时报告和缓存不混入提交；原始真机材料及本机配置仍留在本地。刷新前的已跟踪材料已在仓库外备份，原 stash 保留。
