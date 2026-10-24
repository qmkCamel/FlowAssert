# 内测演示验证 — 2026-10-08

本轮更新 `mobile-mirror-demo.html`，默认离线 Mock，支持正例、故意失败、保留旧失败的新运行复验、审查及下载模拟 HTML。原始本机真机回放保留为显式按需入口，默认不请求私人素材。

后续按用户确认将内测入口改为 dev 分支源码体验，取消独立内测包入口。调整后上述两份测试三项全部通过（43.0 秒），已重新检查宣传页截图中的分支入口；仓库访问权限和源码安装前提见[任务卡](../beta-start.md)。

验证脚本：`tests/e2e/beta-demo.spec.ts`。两项通过：单文件复制到独立临时目录，以 file URL 打开，默认无外部请求；缺素材不影响 Mock；失败、取消和案例切换状态正确；旧失败不覆盖；导出与预览字节一致；新运行清除旧确认；刷新清空模拟历史；390px 无横向溢出。

另有 `tests/e2e/beta-onboarding.spec.ts` 一项通过：直接提取任务卡中的 YAML，在真实 Viewer/MirrorService 的 Mock provider 上保存用例并执行 pass→fail→pass 三个修订，刷新后读取旧失败，导出实际工作台 HTML 并核对预览字节。它证明作者自动化路径可走通，不替代非作者研究，也不是真机验收。

已保留并目视检查五张 PNG：`artifacts/screenshots/beta-demo-failure.png`、`beta-demo-review.png`、`beta-demo-narrow.png`、`beta-workbench-failure.png`、`beta-workbench-share.png`。新截图分别标为宣传页模拟或实际工作台 Mock，均不含私人真机页面。预览取景先确认 iframe 已绘制，再截图，避免整页截图中出现空白预览。

首轮缺素材测试错误地依赖 Playwright route 拦截 file URL，实际读到了本机既有材料，因而期望“缺失”失败。已保留首轮现场在忽略目录，不将其作为共享资产；改为物理隔离的单文件副本后验证通过。未删除或改动原始私人素材。

本轮 Node 24.19.0、pnpm 11.7.0、Chrome 154.0.8037.98。定向三项最终通过，全量中的这三项也通过；完整门禁、既有失败与同包安装记录见源码 `openspec/changes/prepare-guided-beta-kit/implementation-validation.md`。

浏览器录像保留于本机忽略路径 `artifacts/runtime/beta-demo/offline-demo.webm`。它是宣传页模拟流程的实际录屏，无音轨，不是真实产品操作或手机验收，不作为运行性能指标。90 秒配音提纲见[介绍稿](product-introduction.zh-CN.md)；没有伪造真人口播或非作者体验。
