# 前三项产品迭代：工程验证记录

日期：2026-09-30。实现基线 `origin/dev@REDACTED_REVISION`，隔离分支 `feat/guided-mobile-acceptance`。原 dev 工作目录及其已有截图/未提交 OpenSpec 未修改。

2026-10-05 增量：`feat/physical-validation-oct@REDACTED_REVISION` 合入 dev，Android/iPhone 合成 Fixture 的 readiness／助手／业务 child 核查已完成，5.1 已勾选，5.2 独立研究仍未完成。修复 iOS 丢弃 provider-attested focus；正反例和原始失败样本保留。详细真机及合并门禁见[当前验收记录](physical-validation-2026-10-05.md)。下文保留 9 月 30 日工程快照及当时未验结论，不将其误作当前状态。

## 交付范围

1. 首次验收助手：设备入口、模板、Inspector 确认交接、版本绑定校验、明确运行与结果核对、可复用项目/业务模板下载。
2. 创作维护：精确语义目标与父级作用域、只读就绪等待、操作前复核、焦点输入、类型化失败、原断言证据复核、现有逐次运行夹具与修复关联机制。
3. 可执行诊断：事实与缺口、有限核查建议及支持/反证条件、显式同 App/平台子运行比较、原始/有效结果与五维结果保留。

设计与约束见 [连续验收指南](guided-mobile-acceptance.md) 和 `openspec/changes/add-guided-mobile-acceptance/`。不包含路线图第四至第六项。

## 本轮验证

环境：Node 24.19.0、pnpm 11.7.0、Playwright 1.62.1；真实浏览器 + Mock 手机、模拟 Android/iOS XML、受控本机 HTTP 业务夹具。

| 检查 | 结果与边界 |
| --- | --- |
| `pnpm check` | TypeScript、契约检查、75 个测试文件 / 648 项通过 |
| `pnpm test:e2e --workers=1` | 57 项覆盖；最近全量运行 56 通过，既有 capture 下载等待一次超时；不是一次全绿 |
| `pnpm test:e2e tests/e2e/capture.spec.ts tests/e2e/workbench-acceptance.spec.ts tests/e2e/workbench-investigation.spec.ts --workers=1` | 8/8 通过，包含上述超时项及两项新流程；未修改既有 capture 用例或实现来规避问题 |
| 两项新 E2E 最后一次定向运行 | 2/2 通过；以可视区域断言约束截图，桌面/390px 窄屏都实际检查 |
| `pnpm build`、`pnpm pack:check`、`pnpm pack --pack-destination …` | 通过；仅允许五个固定业务模板进入 tarball，其他 examples 与本机配置继续排除 |
| `pnpm test:application:probe` | 构建产物中 ready 输入/断言、只读调查、模板下载、原 manifest 不变、正常关闭通过 |
| `node scripts/plugin-runtime-probe.mjs <extracted-package>/lib/application.js` | 同一 tarball 解包入口再次通过；此项依赖复用工作目录 node_modules，不冒充独立安装 |
| DSH 干净 profile 探针 | 同一 tarball，DSH **0.1.5-rc.2** / 230 个精确版本家族包；Native/PTC 注册流程执行 `fillReady` + `assertReady` 均通过；17 工具、图片能力投影边界、生命周期退出通过；未修改 Harness 循环 |
| OpenSpec 1.9.0 `validate add-guided-mobile-acceptance --strict` | 通过；规划完整不代表独立验收已完成 |
| `git diff --check` | 通过 |
| `pnpm public:check` | 通过：743 文件、72 个可达历史提交；本机配置与其他回归截图未纳入暂存范围 |

DSH 探针使用 `scripts/install-dsh-probe-runtime.mjs` 安装隔离的精确家族版本，再运行 `scripts/dsh-clean-profile-probe.mjs --dsh <pinned executable> --tarball <candidate>`；未替换用户全局 DSH（本机默认仍为 0.1.0-rc.8）。

本轮验证 tarball SHA-256：`a7af34bfef95bc140c0834ca5b2430c11f8c1f325fc3d8e7f523d011137be31a`。未发布 npm/GitHub release。

## 已验证反例与修正

- 重复目标、敏感目标、截断树、缺失父级作用域、隐藏/禁用/持续移动、焦点超时、观测期间取消、意图落盘后目标变化，均不能产生不受控写入；结果未知的写入只发生一次。
- Mock XML 检查点保留父子关系，作用域断言由归档材料复核，不能仅靠执行时的一次命中就算通过。
- 编辑 YAML/参数期间迟到校验不能确认新草稿；取消交接保留旧草稿；失败保留上一份校验或核查计划。
- 最初的全量回归暴露了详情切换窗口：当前选中运行改变但旧详情尚未更新。核查入口增加当前身份检查，E2E 明确等待详情 runId，避免对错对象生成计划。
- 证据损坏、业务不符、导入/recovered、无关/未结束/跨 App/跨平台复验均有合成负例；原 manifest 对比前后逐字节不变。
- 旧例禁止打包规则已收敛为五个精确文件白名单，不开放整个 examples 目录。实际 tarball 和下载探针验证模板存在。

## 运行截图（全部为 Mock）

- [首次验收：桌面](../artifacts/guided-mobile-acceptance/mock-acceptance-desktop.png)
- [首次验收：窄屏](../artifacts/guided-mobile-acceptance/mock-acceptance-narrow.png)
- [核查计划：桌面](../artifacts/guided-mobile-acceptance/mock-investigation-desktop.png)
- [核查计划：窄屏](../artifacts/guided-mobile-acceptance/mock-investigation-narrow.png)

截图保留实际滚动视口，不把超长侧栏误截为顶部编辑器。回归改写的其他历史截图不属于这次提交。

## 未被软件验证替代的验收

- Android/iPhone 真机及获授权真实业务后端的联合验收：本轮未执行。
- 60+60 独立标注分诊语料与五名非作者研究：本轮未完成，不声称诊断准确率、节省时间或首次成功时长。
- 无新增云端上传、跨设备调度、全视觉恢复或自动根因承诺。既有分诊的实验标签保留。

OpenSpec 的独立验收任务 5.1/5.2 保持未勾选，变更不归档为完成发布验收。
