# 变更验收工程验证记录

> 历史记录：下文保留 10 月 1 日和 10 月 3 日快照及当时待合并状态。六项后续已合入 dev，关联任务于 10 月 5 日增至 90/103；当前缺口见[产品 TODO](../PRODUCT_TODO.md)，不能再用下文 14 项代表当前剩余量。

日期：2026-10-01。代码基线 `REDACTED_REVISION`，隔离分支 `feat/change-acceptance-roadmap`。原工作区及其未提交改动没有参与实现。

后续状态说明（2026-10-03，`REDACTED_REVISION`）：下文保留本阶段当日结果及当时的“第五／六项仍是方案”记录，不作为当前实施状态。第五项现已完成逐资产项目授权及外部资产工程，第六项已完成 OCR／双槽矩阵工程；当前六项状态、14 项剩余验收及真机／材料／人员依赖见[总览](../openspec/changes/add-change-acceptance-records/roadmap.md)。第四项真实业务与非作者验收仍未完成。

## 已执行

| 检查 | 实际结果 |
| --- | --- |
| `pnpm check` | 78 个文件、685 项测试通过，类型检查及宿主契约检查通过 |
| `pnpm build` | 通过 |
| `pnpm test:e2e --workers=1` | 58/58 通过；构建与浏览器套件串行 |
| `pnpm exec playwright test tests/e2e/change-acceptance.spec.ts --workers=1` | 增加历史切换断言后 1/1 通过 |
| `pnpm pack:check` | 通过，包含新 Viewer 模块、服务、CLI 和使用文档 |
| `pnpm test:application:probe` | 公共 application 入口、Mock 运行、来源字节不变和关闭链通过 |
| `pnpm public:check` | 通过 |
| OpenSpec 严格校验 | 三个中文变更均通过；不代表三个实现完成 |

第一次 `pnpm check` 有两处失败：新 CLI 测试误把未启动 session 的 `null` 写成 `undefined`；新工作树尚未构建浏览器静态资源，既有 Inspector 测试请求失败。修正断言并显式构建后重跑通过。没有把失败隐去或用跳过测试替代。

新增确定性覆盖包括：完整提交／制品／参数／环境匹配、必需维度缺失、跨 App 拒绝、恢复与显式复验、取消优先级、恶意标签、原数据不外泄、不可变字节、预览过期、同键并发确认、期望版本冲突、磁盘未知／不足、引用前后及修订／索引边界四个真实 SIGKILL 切点、保守恢复、读取与清理竞争、未知引用、废弃重试及损坏 tombstone。Agent 测试验证当前项目归属、跨 App 拒绝和权限撤销，不仅检查工具注册。

## 安装包与宿主

同一包：`/tmp/mobile-change-acceptance-release.bzhjjm/mobile-mirror.tgz`。

SHA-256：`b293b4475350fa87f6ee9d0f3b5355fdfea25e16daf067cca12bffa23685b1c6`。

实际执行：

```sh
pnpm pack --out /tmp/mobile-change-acceptance-release.bzhjjm/mobile-mirror.tgz
node scripts/release-candidate-probe.mjs --tarball /tmp/mobile-change-acceptance-release.bzhjjm/mobile-mirror.tgz --checksum /tmp/mobile-change-acceptance-release.bzhjjm/SHA256SUMS
```

结果：校验和通过、独立安装目录、CLI `0.1.0-alpha.2`、MCP 18 工具、Viewer 双语、退出信号清理和原登记运行生命周期通过。新增探针实际发布来源不完整的验收对象、经 MCP 读取安全元数据，并使用安装包 CLI 导出，验证退出码 2；未知对象拒绝。

同包 DSH 命令：

```sh
node scripts/dsh-clean-profile-probe.mjs --dsh /tmp/mobile-acceptance-dsh.n9vi07/node_modules/.bin/dsh --tarball /tmp/mobile-change-acceptance-release.bzhjjm/mobile-mirror.tgz
```

结果：DSH `0.1.5-rc.2` 干净配置、18 工具、Native/PTC 原生命周期及新增验收查询均通过。两个模式实际读取同一 runtime 已发布验收对象，验证不完整结论和无媒体输出；原图像能力／纯文本模型投影边界通过。未修改 Harness agent loop。

## 界面证据

保留并查看 [桌面截图](../artifacts/change-acceptance/desktop.png) 与 [窄屏截图](../artifacts/change-acceptance/narrow.png)。截图来自实际 Viewer＋Mock，不是设计稿。检查后修复复选框尺寸与表格挤压，表格在窄栏内水平滚动，不拉宽页面。

浏览器测试在慢预览期间操作原生运行历史和语言切换；检查固定核查时间、失败保留已发布结果、取消后迟到响应隔离、下载 JSON/Markdown 实际字节和私密字段排除。

## 未完成与下一步

- 真实业务代码变更、Android/iPhone 对应构建、服务端真值和两位非作者评审尚未提供，第四项外部验收不勾选、不归档。
- 第五项外部资产授权模型需要用户确认：推荐逐资产显式授权给当前项目，默认仅 Viewer/CLI 本机可见；备选是项目级统一授权。外部报告不存在原生执行 journal，不能直接套用第四项运行归属授权。
- 第五／六项仍是方案，未实现；按顺序不越过权限决策去写入宽泛授权或默认外发行为。
- 尚未推送或合入 `dev`。本记录只报告已实际执行的软件工程检查，不宣称发布就绪。
