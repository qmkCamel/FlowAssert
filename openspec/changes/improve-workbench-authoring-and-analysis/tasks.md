## 1. M0 基线和复用审计

- [x] 1.1 核对最新 dev、REDACTED_REVISION 与活动 changes，逐模块记录复用/适配/延期清单，保持 readiness 新语法和真机未验项独立。见 `implementation-audit.md`；用户已确认 D5a 共享受理调整。
- [x] 1.2 冻结旧 YAML、HTTP、CLI/MCP/DSH、v1/v2 run 与 ResultProjection golden fixtures，记录原始 hash 与工具清单。见 `tests/fixtures/workbench-authoring-contract-baseline.json` 和对应 hash 回归。
- [x] 1.3 审查首测/分析/窄屏页面视觉方案，确认导航、首屏内容与错误/空态，不先实现未经审查的整体换肤。
- [x] 1.4 为两份 delta specs 建立 requirement→模块→测试映射；对照旧 authoring/triage tasks 标注覆盖关系，不批量勾选。见 `requirement-map.md`，逐条关联现有后端、浏览器和同包验证；实际结果见 implementation-validation.md。

## 2. M1 导航与第一条用例

- [x] 2.0a 抽取应用拥有的共享持久受理组件：channel 隔离、identity/digest、原子同步、容量、恢复不重放、关闭协调；不新增设备 owner。见 `workbench-acceptance.ts` 及专项测试。
- [x] 2.0b 适配 Agent，保持原 policy/catalog/注册目标、v1 journal、requestKey、工具 schema、引用及 tombstone 兼容；旧 golden 与权限矩阵不变。旧单测、同包 MCP 17 工具及 DSH rc.2 Native/PTC 均通过。
- [x] 2.0c 定义 Viewer authoring journal v1 与独立 namespace/预算/引用，完成独立进程中断、ENOSPC、响应丢失、重启、关闭竞态及旧版本安全兼容探针。旧读器保护性 orphan fixture、journal/manifest 不变、恢复不重放均通过；默认 npm 安装的上游 peer 冲突单列于阶段报告。

- [x] 2.1 提取轻量 hash 路由、选择状态和全局活动运行条，覆盖前进/后退、坏路由、未保存离开与旧入口回退。
- [x] 2.2 适配 acceptance 表单：目标、步骤/预期、参数、校验、留证确认；无设备可留稿、无断言不声称已验证。
- [x] 2.3 适配 Inspector 显式追加/新建/替换确认，覆盖 TTL、跨 session、歧义、敏感节点和保留原稿。
- [x] 2.4 实现支持子集的步骤卡与原始 YAML 映射；保留注释/未知节点，不能无损编辑时转源码模式；以 golden 文档证明 round-trip 不丢语义。
- [x] 2.5 定义 ValidationReceipt schema 与只读校验服务，绑定 input/project/compiler/target，覆盖 10 分钟过期和重启失效。见 `workbench-authoring.ts` 和对应专项测试。
- [x] 2.6 经 D5a 共享持久受理组件实现 authoring/run；先返回同 channel 已受理 identity，再校验新 receipt，测试重复、digest 冲突、响应丢失和重启零重复设备写入；不自动注册草稿或修改 Agent 权限。包含真实子进程强杀测试，UI 接线和固定修订校验已在 2.7 完成。
- [x] 2.7 实现准确 revision 的执行确认、局部进度、取消和旧校验失效；不改变旧 POST /api/runs 和宿主工具的调用契约。
- [x] 2.8 适配固定相对路径项目导出，预览文件/外部依赖，不带凭据/主机命令，失败保留草稿。
- [x] 2.9 运行 mock 首测正反例与编辑中迟到响应 E2E；≥500ms 校验/导出过程中切历史，验证反馈、失败保留、焦点和完成刷新。

## 3. M2 独立运行分析

- [x] 3.1 建立独立 run/step/tab 深链分析壳和窄屏页签，默认首失败；坏 run/step 有恢复路径，切页不取消运行。
- [x] 3.2 实现确定性自然语言摘要与技术详情折叠，覆盖原 verdict/当前证据/验证范围、无基线和业务未验；不把假设写成根因。
- [x] 3.3 联动登记截图、结构、源码与现有录像近似时间，使用原 artifact 校验/lease、按需加载与 epoch；缺失/损坏不得替换实时画面。
- [x] 3.4 把比较/分诊/人工复核接入分析页，保留原服务和权限；同名不同输入、跨 App/平台、未知环境不自动选基线。
- [x] 3.5 适配 investigation 与既有 repair 交接，展示语义 diff、新 draft/child run 和复验对照；拒绝弱化断言和不相干 follow-up。
- [x] 3.6 接入旧安全派生导出与明确本机深链说明，不扩展上传/云分享权限。
- [x] 3.7 覆盖旧/导入/派生 run、缺图/坏 hash、迟到响应、取消比较/分诊、重启及清理中读取；原文件 hash 不变。
- [x] 3.8 运行分析完整浏览器流程与≥500ms 故障场景，检查独立历史导航、局部反馈、旧报告保留；留并检查桌面/窄屏截图。

## 4. M3 用例资产与修订

- [x] 4.1 定义 CaseRecord/CaseRevision/可选 run origin 及 digest/CAS/预算，明确 YAML 原文本为执行事实，新增目录不混入 run 清理。
- [x] 4.2 实现自有目录保存、容量准入、不可变 revision 和原子 head 更新；注入每个提交切点与 ENOSPC，证明旧 head 可读且坏数据不被空库覆盖。
- [x] 4.3 实现有界分页/标签搜索、固定修订读取、复制、软归档与恢复；generation 变化明确刷新，预算到限不截断/驱逐。
- [x] 4.4 实现同源受限 HTTP、请求幂等与 schema/大小/path/symlink 检查；双窗口 CAS 冲突保留两边工作。
- [x] 4.5 向导接入显式保存与旧 localStorage 恢复选择；参数公开性确认、未保存离开和另存副本；不改写注册项目文件。
- [x] 4.6 新 run 固定 case/revision/input 摘要，历史按身份分组并显示参数/构建差异；旧 run 无关联不靠名称猜测。
- [x] 4.7 验证修订/归档不改变历史 verdict 或证据保护；前一版本读取新字段/新目录必须安全兼容或拒绝，回滚不删除 revision/journal。

## 5. M4 软件交付与证据

- [x] 5.1 完成中英文状态文案、键盘/可见焦点、aria-live、200% zoom 和 390×844/1440×900 检查；证据长动作遵守 user-action-contract。
- [x] 5.2 串行运行 pnpm check、pnpm test:e2e --workers=1、pnpm build、pnpm pack:check；新的 Viewer 运行截图保存并人工检查。
- [x] 5.3 同一候选 tarball 在隔离目录验证 Viewer/CLI/MCP/DSH 0.1.5-rc.2 的旧/新输入、关闭与结果投影，记录 hash 和实际宿主版本。范围和锁定依赖限制见实施记录。
- [x] 5.4 更新输入/持久化边界 ADR、能力表、首测和分析指南、迁移/回滚说明；OpenSpec strict 校验；主规范已同步，因独立验收暂缓不归档。
- [x] 5.5 记录实现与测试证据及保留的未验项；本任务不默认授权 commit/push/merge/tag/Release。

## 6. 独立验收（暂缓，不影响软件阶段退出）

- [x] 6.1 待用户恢复真机验收后，在 Android/iPhone 分别完成创建→执行→分析→修订→复验，单独记录签名/连接/定位限制。

2026-10-05 增量：双端专用 Fixture 链路已实测，故意失败与新修订通过均保留归档证据。iPhone 按已有签名配置显式传参后通过；Android 探针补传产品 OEM 兼容默认值并由用户解锁后通过，首轮配置/锁屏失败样本独立保留。6.1 完成，独立用户研究仍待参与者。见 `docs/physical-validation-2026-10-05.md`。
- [ ] 6.2 待有参与者后执行 5 人独立用户研究，核对 4/5、10 分钟、30 秒与两次操作目标；记录失败/帮助/安装时间，不以作者或 mock 替代。

完整操作录制、自然语言/PRD 生成、云分享和多人协作仅见 design D9；另行批准 change 后才成为实现任务。规划文件完成不等于实现或验收完成；D5a 已获用户确认，原审计暂停原因已解决，新增受理任务需用本候选证据逐项完成。

软件任务勾选依据为 requirement-map 与 implementation-validation，不代替本节独立验收。未保存的非破坏性导航保持原编辑器；破坏性替换才要求保存/放弃/取消。结构展示为登记原文/诊断加源码行高亮，修复沿用高级编辑器授权链；这些实施取舍见 design 的补充说明。
