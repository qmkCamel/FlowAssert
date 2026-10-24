2026-09-25 修订基线：`dev@REDACTED_REVISION`。原勾选保留首轮实现证据；第 8—13 节细化剩余工程验收，全部从未完成开始。原 2.3/2.5 对应 R5，3.4/3.6 对应 R3，4.1/4.3—4.8 对应 R0/R4；必须具备全部相应证据后才能勾选原总项，不重复声称交付。R1/R2 由[第二阶段任务](../add-workbench-authoring-and-visual-validation/tasks.md)负责。

## 1. 基础与依赖（依赖 C0；趋势上线依赖 A1）

- [ ] 1.1 确认 C0/A1 契约提交及原 request journal/tombstone、比较 refs、视觉 baseline 的保护接口。
- [ ] 1.2 建立计划/case/attempt、import/derived、未知环境、损坏和已删除材料的统计 fixtures。
- [ ] 1.3 建立 v1/v2、原件/派生件及旧读取器的兼容 fixtures。

## 2. C1 趋势（可与 C2a 并行）

- [x] 2.1 实现有界摘要索引、generation 原子切换、分页和可取消重建。
- [x] 2.2 实现按用例/输入/环境的分组、计划分母与尝试去重，导入单列。
- [ ] 2.3 实现双窗口样本门槛、版本化耗时预算及失败/取消/恢复路径分列。
- [x] 2.4 Viewer 增加趋势、覆盖范围、排除原因及 run/evidence 回钻。
- [ ] 2.5 覆盖索引损坏、超 10,000 摘要、unknown 环境、重复导入和 tombstone 查询测试。

## 3. C2a 安全分享

- [x] 3.1 定义 v2 包的 reportedVerdict、not-revalidated、withheld、shareId 与私有来源映射 schema。
- [x] 3.2 实现 XML/日志/参数白名单与已知秘密建议，禁止将凭据/路径/journal 默认导出。
- [x] 3.3 实现 PNG 实际像素遮蔽/元数据清理、人工预览与确认，不覆盖原件。
- [ ] 3.4 实现有界导出 job 与 64 文件/4 MiB/16 MiB/请求大小预算，默认排除录像。
- [x] 3.5 实现 v1/v2 双读，派生 reported pass 显示未重验且不进入自动通过基线。
- [ ] 3.6 验证已知敏感 fixtures 无原文、hash/引用篡改、withheld、失败/取消保留旧导出与原件。

## 4. C2b 生命周期保护（删除依赖 4.1—4.3 验收）

- [ ] 4.1 建立运行/比较/导出/基线/pin 的引用索引及读 lease 注册，保护现有消费者。
- [x] 4.2 实现容量统计与带 generation/hash/有效期的 dry-run 清理计划，不删除数据。
- [ ] 4.3 验证预览后新增引用/lease、跨进程 owner、symlink/路径逃逸和陈旧计划拒绝。
- [ ] 4.4 实现确认后 mutation gate 内重验、隔离 trash、journal/tombstone 原子状态。
- [ ] 4.5 实现 7 天恢复、冲突拒绝及独立 purge 授权，区分 trash 占用和物理释放量。
- [ ] 4.6 实现默认关闭的保留政策和磁盘不足阻止新任务，不驱逐受保护材料。
- [ ] 4.7 覆盖移动/提交/恢复/purge 中断、并发读取、引用变化与重启一致性。
- [ ] 4.8 验证媒体删除后 requestId 重试仍返回原受理而无设备动作，幂等 tombstone 不随清理删除。

## 5. C3 业务模板（依赖 A4 的实际项目资料）

- [x] 5.1 提炼任务命名空间、correlation id 与本机凭据配置的 HTTP prepare/verify/cleanup 示例。
- [x] 5.2 增加异步业务轮询、未知写入结果、仅自有资源清理的正反例。
- [ ] 5.3 在两试点真实接口验证模板和取消/清理失败，材料脱敏后再提交仓库。
- [x] 5.4 编写自托管 CI/JSON/JUnit 接入说明，明确可信 worker 非沙箱。

## 6. C4 长期采用与升级

- [x] 6.1 更新版本能力/归档/API 兼容表与脱敏问题报告指南，不默认上传。见 `docs/workbench-compatibility.md`；未验收的回退边界明确保留。
- [ ] 6.2 用固定候选包验证前一支持版本升级/只读回退及 v2 在旧程序中的明确拒绝。
- [ ] 6.3 汇总至少 3 个外部团队连续 4 周日志、维护/诊断工时和求助次数；未满足周期保持 pending。
- [ ] 6.4 组织失败样本盲测并记录至少 80% 在 5 分钟分类及证据定位的目标结果。

## 7. 集成与交付门禁

- [ ] 7.1 同步相关 ADR/能力总表/保留与恢复文档，明确 purge 不可恢复和模型/录像默认边界。
- [ ] 7.2 对扫描/导出/导入/清理/统计逐项验证慢任务中无关交互、局部进度、失败保留和成功刷新时间，保留人工检查截图。
- [x] 7.3 运行 pnpm check、pnpm test:e2e、pnpm build、pnpm pack:check 与本 change strict 校验。
- [ ] 7.4 在隔离数据集完成端到端运行→比较→分享→导入→清理→恢复，原件/派生/幂等结果一致。
- [ ] 7.5 分别审核工程完成与持续采用门槛；多设备调度不顺带实现，Release 另行确认。

## 8. R0 共享引用与任务契约

- [ ] 8.1 冻结 EvidenceReference/ReadLease/OperationRecord/CleanupJournal v1 和 owner generation；与 R1/R2 对齐 baseline 与结果摘要字段。
- [ ] 8.2 为下载流、比较、分享、视觉候选、历史复跑、趋势注册读 lease；初始化/申请/释放与 mutation gate 的竞态测试通过。
- [ ] 8.3 统一 baseline/suite/comparison/child/share/pin/Agent 引用读取；索引损坏和未知消费者 fail closed，批准发布与保护引用不可分离。
- [x] 8.4 加强 store 跨进程身份/nonce 校验，覆盖 PID 复用、活 owner、未知 owner、失效持有者重启；不新增设备连接或共享 daemon。
- [ ] 8.5 完成独立子进程故障注入接缝、可控时间/容量检查与登记清单校验 fixtures，明确哪些测试验证真实进程边界。

## 9. R3 预览与导出任务

- [x] 9.1 增加 opt-in 202/jobId 的提交/查询/取消/结果接口及持久状态，旧同步接口消费同一服务且响应格式兼容。
- [ ] 9.2 实现 requestId/digest 幂等、1 并发/2 排队/30 秒转换预算、worker 资源上限及文件/像素/序列化预算；边界值与超限测试通过。
- [x] 9.3 将 review token 绑定来源/选择/mask/规则/输出 hash 与 10 分钟有效期，变更和过期要求重新预览；导出提交前再次核验。
- [x] 9.4 实现私有临时产物→原子提交 manifest→可下载结果，验证来源映射共同发布；commit 期间取消语义明确。
- [x] 9.5 kill 转换/提交进程并重启，验证 interrupted 不自动重做、完整产物可恢复、旧导出可访问；测试取消/失败不泄露已知敏感 fixtures。
- [x] 9.6 Viewer 接入任务进度/取消/重复提交保护；慢任务期间浏览历史，确认失败保留和完成时间/下载刷新，保留桌面/窄屏截图。

## 10. R4 清理中断与幂等

- [x] 10.1 实现 move/restore/purge intent、逐对象提交和启动恢复状态表；旧 journal 无法判定时保护，恢复冲突不自动换 ID。
- [x] 10.2 在每个 intent/fsync/rename/提交前后 SIGKILL 并重启；覆盖 live/trash 四组合与 hash 不符、批次部分成功和跨盘拒绝。
- [x] 10.3 补 purge 部分删除中断：保留剩余清单与原授权，重启不自动继续不可逆删除，新确认只作用于重验剩余对象。
- [x] 10.4 覆盖预览后新增 baseline/share/pin/读 lease，owner 变化、失效计划及 symlink/路径替换；保护材料不得进入 trash 或 purge。
- [x] 10.5 实现独立持久 requestId tombstone、完成 Agent 媒体清理资格与 evidence unavailable 投影；清理/重启后相同请求零设备动作。单流程 Agent journal 与媒体分离；套件经显式确认后将已核验 attempt 摘要及来源 hash 原子写入独立 suite manifest，才解除媒体引用。隔离/purge 后趋势保留历史分母并显示 unavailable；无合法清理 journal 降为 inconclusive。见 `tests/test-run-control.test.ts`、`tests/workbench-suite-tombstone.test.ts`。
- [ ] 10.6 实现至少 7 天恢复/到期政策默认关闭、分类容量与扫描预算；不完整扫描不可执行删除，恢复不覆盖身份。
- [ ] 10.7 实现写入前容量预留/安全余量、未知容量拒绝与终态释放；测试各阶段 ENOSPC 后已有证据可读、失败不得 pass。
- [x] 10.8 隔离数据集实测慢扫描/多对象清理/恢复，操作其他面板，确认逐对象结果、容量/时间刷新及 purge 不可回滚提示。Mock Viewer E2E 验证两个独立 run、扫描中切语言、移动中切主题、单件恢复与单件 purge；见 `tests/e2e/workbench-retention.spec.ts`。

## 11. R5 趋势统计口径

- [ ] 11.1 实现版本化计划身份、attempt 去重与 outcome 优先级；测试 unplanned/import/derived/损坏/active 和两个通过率分母。
- [x] 11.2 区分有意清理的历史摘要与无 tombstone 材料缺失；验证清理不悄悄改变过去分母，回钻显示 unavailable。见 `tests/workbench-suite-tombstone.test.ts`。
- [x] 11.3 接入双窗口 UTC 半开区间、同组比较及显式 A/B 构建维度；unknown、不兼容、重叠/空区间有稳定结果。
- [x] 11.4 接入登记的版本化预算、中位数/绝对差与相对差规则；覆盖 29/30、阈值相等、零基线、无预算、非有限值及失败/取消/恢复时长分列。
- [ ] 11.5 查询/generation/分页固定同代，覆盖重建取消/失败、坏索引、10,000/10,001、128 MiB 和时窗外导入计数；不静默截断覆盖范围。
- [ ] 11.6 Viewer 展示双窗口样本、排除原因、预算/规则版本与 run 引用；慢重建时保留旧图表，取消与历史可操作。

## 12. R6 模块和文档收敛

- [x] 12.1 以契约 golden 固定现有 HTTP/CLI/工具行为，再拆 runs/baseline/sharing/retention/trends handler；公共授权层保持一致。
- [x] 12.2 抽取运行阶段/取证/终态聚合及 store 引用/journal 接口，加入必要依赖方向检查；MirrorService owner/租约/取消边界回归通过。原生 worker 阶段、业务 hook/私有资源 journal、逐步取证、终态聚合和容量准入各为独立模块；`scripts/check-contracts.ts` 阻止领域模块反向引入 Viewer/入口，Mock 取消与 E2E 回归保持。
- [x] 12.3 分离 Viewer 历史/结果/分享/清理/趋势面板与 action 状态；验证草稿、选择和旧结果在模块重载/失败/迟到响应下保持。
- [ ] 12.4 对齐 docs/design/mobile-test-workbench-current.md、docs/architecture.md、PRODUCT_TODO.md、roadmap、能力表与 ADR；每项能力链接实际实现/验证，明确版本及未验范围，清理主规范遗留 Purpose 占位文本并按拟升级 OpenSpec 版本校验。

## 13. 本轮集成验收

- [ ] 13.1 同一 tarball 在临时数据集完成运行→视觉→比较→分享→导入→隔离→重启→恢复/purge→幂等重试，检查原件/派生/报告/统计一致。
- [ ] 13.2 验证前一支持包的 v1 读取、旧同步 API、新版本格式只读回退拒绝及原文件 hash 不变；不升级依赖来绕过兼容缺陷。
- [x] 13.3 重新运行 pnpm check、pnpm test:e2e、pnpm build、pnpm pack:check、两个 change strict 与链接检查，目检桌面/窄屏证据。2026-09-26 本地：562 单测、54 E2E、三个 active change strict、公开链接检查；见 `docs/workbench-adoption-validation.md`。仅软件门禁，不代表 R0—R6 整体完成。
- [x] 13.4 分别记录 R0—R6 工程完成度、未完成 B3b/真机/C3/C4 资料和后续依赖顺序；父 change 未满足全部任务前不归档。见 `docs/workbench-offline-engineering-status.md`。
