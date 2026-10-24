# 确定性回归编排验收

更新：2026-09-18。未新增 YAML version 门槛。本报告区分自动化、受控 API、安装包和真机结果。当前 22/22：双端业务夹具及 4.4 编排矩阵均已验；探针增强和验收文档随本轮交付。下文早期失败与旧门禁保留为历史记录。

## 已验证的实现

- 参数、JSON 数据行、注册子流程、分支、有限重复；动态路径至少执行一个 UI 断言。
- AppClaw 自动补的块尾 done 不进入源步骤编号；全局编号、逻辑路径、源行与检查点屏障保留。每个块复用同一设备租约，未新增 Appium session。
- 注册扩展准备真实受控 HTTP 测试数据，读取接口独立核对、逆序清理；UI 通过但业务值错误仍 fail，清理失败不通过。
- 超时、非法输出、已知凭据泄漏、未注册引用、缺失参数、循环依赖、隐藏非法分支、预算溢出均拒绝或不确定。
- 取消扩展回收实际子进程；强杀准备宿主后 journal 保留、运行恢复为 inconclusive/cleanup pending，不自动重放写入。
- 单设备串行套件、参数行隔离、安全重试；首次失败再次通过为 flaky/CI 非零；取消不启动剩余数据行。
- 原快照重跑不受登记文件后续修改影响；条件查询错误不能转成 false 分支；根 blockers 继续约束子流程断言。

浏览器验证包括慢 prepare 期间进度、主题/画面保持可用，业务/清理分项、case/attempt 和源步骤路径；截图为 `artifacts/screenshots/mobile-mirror-orchestration-suite.png`，已打开检查。另修复关闭期间异步初始化可能留下证据目录锁的问题，慢失败场景已复验。

## 仓库外安装包

正式 tarball 安装至仓库外临时目录后，通过包导出的 Viewer 启动入口和正式 `flowassert test suite` CLI 执行含条件和代码扩展的套件。首轮 suite `71483021-a609-428c-b69a-507826704a6c`，exit 0；11 件材料逐件下载并核验 SHA-256。说明 bundle worker、扩展子进程、HTTP、CLI、JSON/JUnit 路径可在安装环境工作，不只是源码导入成功。最终 tarball 复验 suite `b63741fa-63f7-46a9-aa8c-736ac2d5f6c0` 同样 exit 0，11 件材料哈希核验通过，覆盖最终扩展模块解析限制。

## Android 真机

设备发现确认一台 Android USB 真机，ADB 版本读取正常。首轮 suite `64f95669-ad31-410e-b41b-521a3efb740f` 的两个正例均因设置页文本不可见失败，故意失败反例亦失败。PNG 为黑屏；随后只读系统诊断显示 Dozing、keyguard showing=true。**不计真机正例通过**，已请求解锁后补验。

材料仅本机：`artifacts/physical-validation/orchestration-android-2026-09-16T11-12-02-966Z/`，包括 suite/case/attempt、逐步 PNG/XML、快照和 report。首次探针配置参数错误发生在连接前，亦不计实测成功。

## 2026-09-16 当时尚待验证（后续状态见文末）

- Android 解锁后完成多数据、真假分支、循环、公共子流程、故意失败、取消队列与重启取证复验。
- iPhone 本轮设备发现均 unavailable，未运行本次编排真机验收。
- 尚未取得带独立测试接口的自研 App 配置。受控 HTTP API 验证证明扩展执行与判定机制，不代替真实 App 的 UI→业务持久化正例。
- 自然语言恢复、多设备并行、弱网/性能/音视频质量不属于本次实现。

## 最终门禁

2026-09-17 后续：新增[仓库测试 App + Server](business-test-fixture.md)，Android/iOS 真机准备→UI 提交→SQLite 独立校验→清理正反例通过，各 36 份证据重启复验，双端原生慢请求进度/Help 交互/超时保留成功结果通过。4.5 完成，当前 21/22；4.4 更广双端编排矩阵保持未完成。历史 Appium 超时不确定记录保留，不宣称稳定性修复。

- `pnpm check`：331 项测试 / 42 个测试文件通过，含新增 22 项组合、业务 API、取消、重试、强杀恢复等回归；类型与契约检查通过。
- `pnpm test:e2e`：42 项浏览器回归通过，新增套件慢准备、业务结果、历史/证据展示场景已保存并检查截图。
- `pnpm build`、`pnpm pack:check`：通过；运行包继续排除源码示例，仓库示例保留。
- OpenSpec：本变更及基础工作台 strict 通过；`git diff --check` 通过。
- 额外边界回归：根 blocker 传播到子流程、非 bundle 导入拒绝、一个资源清理失败后仍继续清理其他资源。

上述为 2026-09-16 的门禁记录（当时 20/22）。2026-09-17 追加 Android 真实业务证据后为 21/22，详情见上方后续记录；本轮夹具代码尚未提交、未发布。

## 2026-09-18 Android 编排矩阵补验通过

使用已安装的 Mirror Fixture、PLA110 / Android API 36，复用 managed Appium session。只读取夹具 Ready 状态，不调用业务提交接口，也不使用模型；业务真值验收另见 4.5。命令入口：

```sh
MOBILE_MIRROR_EXPECTED_TEXT=Ready \
MOBILE_MIRROR_CAPABILITIES_PATH=/absolute/capabilities.json \
MOBILE_MIRROR_APPIUM_EXECUTABLE=/absolute/appium \
pnpm exec tsx scripts/workbench-orchestration-physical-probe.ts
```

需预先打开已安装 Fixture 的主页面；脚本不安装、不清空数据。探针生成有界 YAML、项目和数据快照；等待取消点最多 60 秒，失败明确退出。

正式材料（仅本机）：`artifacts/physical-validation/orchestration-android-2026-09-18T02-47-27-411Z/`，包括报告、suite/case/attempt、每步 PNG/XML 和已检查的 `viewer.png`。

| 场景 | 结果与证明 |
| --- | --- |
| 数据行 true | run `6196e065-6c0f-4ce7-b47d-b07487534d84` pass；true 条件、循环两次、4 个断言 |
| 数据行 false | run `a69e7311-54e8-4f51-8335-b04cfe3bff61` pass；false 条件、else 分支、3 个断言 |
| 嵌套子流程 | 两行均执行 `root/2:nested/1:common/1/1`，同一个 session |
| 故意失败 | run `6e6d6c51-15a3-4815-acfd-746549126505` fail；套件 `4f7f6222-917f-4d1d-964a-56e077b14ed6` exit 1 |
| 循环内取消 | run `045ac1ca-dfcc-4e98-9a3f-0fc0891d39e8` cancelled；取消套件 `b16cc169-6db0-42f4-898b-8fe857d3c990` exit 130，下一叶子未执行、下一 case skipped 且无 attempt |
| 重启回查 | 原 pass/pass/fail 和取消队列保持；正反例及取消运行共 50 份证据哈希通过；未自动续跑 |

首轮 `02-46-37-543Z` 正反例已符合预期，但探针错误使用 YAML 名称 assertVisible 统计内部 assert 步骤而误报，未执行取消段；修正探针后才得到上述完整结果。首轮材料保留，运行时代码未修改。结束时宿主 4723 无监听。

iPhone 16 Plus 在 Android 补验时为 unavailable；同日随后连接并完成下节矩阵，不借用此前业务或 AI 恢复证据代替。

本轮门禁：`pnpm check` 377 项测试 / 46 文件、浏览器 43/43、构建、打包、当前 change strict 与 diff 检查均通过；探针步骤名修正后类型检查再次通过。未改 Viewer 实现，真机 Viewer 截图随验收目录保留。

## 2026-09-18 iPhone 编排矩阵补验通过

设备 iPhone 16 Plus / iOS 26.2.1，预装 Mirror Fixture，采用同一探针和 Ready 条件。材料（仅本机）：`artifacts/physical-validation/orchestration-ios-2026-09-18T02-57-05-883Z/`。已打开检查 `viewer.png`，手机夹具及两组套件终态可见；每步 PNG/XML 保留。

| 场景 | 结果与证明 |
| --- | --- |
| 数据行 true | run `cf8a0091-b7da-4263-9fd1-a960df162a66` pass；true 分支、循环两次、4 个断言 |
| 数据行 false | run `42b05e5a-a83d-453c-aedb-93202c10c6e2` pass；false 分支、3 个断言 |
| 嵌套与会话 | 两行均走 nested→common，sameSession=true |
| 故意失败 | run `5443510f-1306-4007-bbcd-2b83112db909` fail；suite `abcf0735-0c6a-4072-bfa3-3c0d6f2ac189` exit 1 |
| 循环内取消 | run `afb9feeb-76a4-415a-9ce1-6003542066f1` cancelled；suite `41aed585-52e9-4244-9a61-ec2c75039a5f` exit 130；后续叶子未执行、下一 case skipped 且 attempts 为空 |
| 重启复验 | pass/pass/fail 与取消队列保持，50 份材料哈希通过，complete=true |

结束后 4723/8100/9100 无监听，devicectl 手机进程检查无 WebDriverAgent/xctest。双端任务 4.4 完成，change 22/22；旧设备 ADB 根因、更多 OEM/系统版本与跨进程所有权仍不在该完成结论内。iOS 补验未再修改运行时或探针，复用上节同版本工程门禁。
