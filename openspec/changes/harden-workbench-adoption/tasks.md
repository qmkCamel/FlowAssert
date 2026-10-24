## 1. C0 公共契约（其他阶段集成前置）

2026-10-07 续验：REDACTED_REVISION 初轮双端 9 项受控故障、旋转/driver/server 终止和新会话恢复、宿主 SIGKILL/no-replay 通过；Android 锁屏失败及原手工解锁超时保留，后来观测解锁后新会话恢复。新基线 REDACTED_REVISION Android 9 项、旋转/driver/server、宿主 SIGKILL/no-replay 复跑通过；iPhone 又显示 Offline，已请求重连，不把旧结果改标为新执行。两端 10 月 6 日实际 USB 中断原件 hash 与原生语义复验通过，但不挪作本候选整矩阵完成。4.4/4.5 保持未勾选，当前候选 USB/锁屏人工恢复继续需要配合。用户确认暂无真实业务两构建、后端真值/清理和批准 OCR/视觉 profile；相关试点/放行任务继续保留。详见 [10 月 7 日对账](../../../docs/physical-validation-2026-10-07.md)。

- [x] 1.1 对照 dev 实现、四个 active change 与总览登记共享模块责任人及能力边界，不重复实现已有工具。
- [x] 1.2 定义版本化 provenance、verification、evidence lineage 和 task status 类型及严格 schema。
- [x] 1.3 建立旧记录/未知版本/缺字段/派生件 golden fixtures 和只读兼容测试。
- [x] 1.4 统一 Viewer、CLI、MCP/DSH 的结果投影与 recovered/flaky 非零语义契约测试。
- [x] 1.5 固定证据引用与后台任务接口，记录 C0 验收提交；向 B1/B2/C1/C2 提供消费 fixtures。

## 2. A1 运行来源（依赖 1；可与 A2 并行）

- [x] 2.1 实现 App/OS/驱动/执行器有界只读 collector，区分 observed/declared/unknown。
- [x] 2.2 接入可信构建提交、后端别名和测试数据版本，增加公开白名单/秘密与路径过滤测试。
- [x] 2.3 在执行前冻结 provenance，实现 strict 模式缺失必需字段时零业务写入测试。
- [x] 2.4 在运行详情与比较中显示来源/未知/环境差异，并保留旧记录。
- [x] 2.5 双端样本验证采集值及 unknown，记录 A1 契约提交供趋势和视觉使用。

2026-10-05：基于 A1 契约候选 `REDACTED_REVISION`，双端运行前冻结 App ID、平台/OS、provider、driver/runtime 的 observed 字段；version/build/binary、项目声明和 viewport 保持 unknown，未用事后设备查询回填。见 `docs/physical-validation-2026-10-05.md`。

## 3. A2 CLI 生命周期（依赖 1；复用现有 owner）

- [x] 3.1 保持 test suite attach 兼容，定义 test job 的可信本机配置和预算校验。
- [x] 3.2 实现 managed-job 预检、loopback runtime、设备 claim、登记 suite 受理路径。
- [x] 3.3 实现 SIGINT/SIGTERM/总超时取消、在途收敛及有界自有资源清理。
- [x] 3.4 保存 job summary/JSON/JUnit，验证 0/1/2/130 与原 suite verdict 分离及错误优先级。
- [x] 3.5 覆盖 owner 冲突、attach 外部实例、报告写失败、清理失败和中断不重放的进程测试。
- [x] 3.6 提供自托管 runner CI 示例，明确无浏览器录像、设备/签名/账号前提。

## 4. A3 可靠性与性能（测试集准备可提前）

- [x] 4.1 建立设备断线/锁屏/旋转/驱动故障的预期结果与动作派发断言表。
- [x] 4.2 增加 PNG/XML 单侧失败、磁盘/manifest 故障及重启恢复的隔离目录测试。
- [x] 4.3 增加 prepare/执行/取证/清理各阶段取消和异常退出验证。
- [ ] 4.4 在一台支持 Android 设备执行完整故障矩阵，保留 owner/材料/未执行动作证据。
- [ ] 4.5 在一台支持 iPhone 执行同等矩阵，分别记录平台限制与恢复方法。

2026-10-05 增量：双端各 9 项受控故障符合预期，编排/取消及各 50 份材料重启复核通过。Android 新完成旋转/UiAutomator2/Appium 进程终止恢复、SIGKILL 宿主 owner/no-replay；真实 USB 拔插未操作导致 180 秒超时，4.4 保持未完成。iPhone USB 重接后新增本候选宿主 SIGKILL/no-replay、旋转/WDA/Appium 终止与锁屏/人工解锁恢复；真实 USB 拔插同样未操作而 timeout，4.5 保持未完成。锁屏探针的步骤类别汇总错误保留原件，实际 failed assert/无 dispatch journal 已只读复核，代码类别检查已修正。旧 USB/锁屏证据不替代本候选缺项。见 `docs/physical-validation-2026-10-05.md`。
- [x] 4.6 双端分别运行至少 30 次固定基准并冻结预算，保留失败样本和排除理由。

双端均完成固定 30 次（各 0 失败/排除、510 份材料校验）：Android P95 9762 ms/预算 11715 ms；iPhone P95 9017 ms/预算 10821 ms。每次新 session、YAML/caps SHA 不变、逐步 PNG/XML、独立 Viewer 控件交互、历史恢复和 owned stop 均验证。阶段分布保留私有报告，初态及软件 overlay 公开记录；仅 run duration，不含建/关 session，不是生产 SLO 或跨平台速度排名。预算冻结供后续回归使用，不以同一批校准样本证明新预算已回归。见 `fixtures/benchmarks/budgets-v1.json` 和 `docs/physical-validation-2026-10-05.md`。
- [x] 4.7 整理至少 100 个故意失败样本的错误通过统计，不以有限样本宣称普遍零风险。离线确定性 100/100 非通过，0 错误通过；不替代真机风险测量，见 `docs/workbench-adoption-validation.md`。

## 5. A4 安装与试点（准备独立；验收需 A1/A2/A3）

- [x] 5.1 建立版本能力/源码 SHA/包 SHA/支持矩阵清单，核对 tarball 内文档与示例入口。
- [x] 5.2 仓库外干净安装验证 standalone/Mock/MCP/DSH 0.1.5-rc.2 Native/PTC，同一包留证。DSH clean profile 使用受支持的 `patchReload: startup`；默认 live HMR 宿主退出问题单列未验，详见 `docs/workbench-adoption-validation.md`。
- [ ] 5.3 验证前一支持版本升级、回退和旧归档只读；不覆盖新格式或删除 journal。
- [x] 5.4 修复已识别的公开文档本机证据断链：保留历史说明但不将未入库私有文件作为公共可点击链接，不上传私有材料。
- [x] 5.5 修复归档导入 E2E 的 URL pathname 解码问题，使用正确文件 URL 转换并覆盖含空格/非 ASCII 的安装目录。
- [ ] 5.6 与项目方确认两自研 App、20 条双端流程、隔离账号/接口及试点授权，缺失则登记阻塞。
- [ ] 5.7 接入两试点的 prepare/业务 verifier/cleanup，保留业务正反例和数据归属证据。
- [ ] 5.8 收集并审阅 5 名非开发用户的首次体验记录，统计 4/5 与 15 分钟目标及完整安装时间。
- [ ] 5.9 汇总连续 7 天至少 100 次计划运行的既有试点日志，核对全部分母和非产品故障目标；不足周期不得勾选。

## 6. 集成与交付门禁

- [x] 6.1 将 owner/lifecycle 新决策写入相关 ADR，更新能力表、采用指南和安装说明，不改历史验收结论。
- [x] 6.2 验证新增慢操作的局部进度、无关控件交互、失败保留、成功刷新及领域时间，留存并人工检查 Viewer 截图。
- [x] 6.3 运行 pnpm check、pnpm test:e2e、pnpm build、pnpm pack:check 及本 change strict OpenSpec 校验，记录真实结果。
- [ ] 6.4 审核工程门禁与外部采用门禁分别完成；原 active change 未验项保持原归属和状态，不自动创建 tag/Release。
