# Requirement → 模块 → 验证映射

代码与测试对应表；实际门禁和候选包结果见 implementation-validation.md。测试存在不等于任意真实设备已通过。

| Requirement | 模块归属 | 验证 |
| --- | --- | --- |
| Explicit first-test journey | journey-authoring → WorkbenchAuthoring → WorkbenchService | journey E2E 无 YAML 编写断言正反例；authoring 无设备/无断言单测 |
| Lossless reviewed Inspector handoff | inspector、journey-authoring、authoring-document | 显式交接/取消/过期 E2E；原 Inspector 敏感/歧义测试；原文区间 round-trip |
| Validation bound to exact inputs | authoring、acceptance | 改文、10 分钟、重启、目标/项目变化、重复/冲突；迟到响应 E2E |
| Shared durable acceptance with isolated authorization | WorkbenchApplication、acceptance、Agent adapter | 受理/Agent 回归、SIGKILL fixture、同包 compatibility probe |
| Bounded revisioned local case library | cases、Store gate/容量、authoringOrigin | CAS、1000×100 合成 catalog、50 分页、symlink、六个故障切点；HTTP 同源/身份；双窗口 E2E |
| Restricted reusable export | authoring-document、journey-authoring | 固定四文件、外部依赖拒绝、公开数据/大小检查；650 ms 失败保留预览 E2E |
| Nonblocking and accessible authoring actions | journey-authoring、journey 状态条 | 650 ms 保存/校验/导出期间独立导航、迟到/失败保留；录像/Inspector；旧取消门禁 |
| Dedicated navigable run analysis | journey-router、journey-analysis | 路由白名单单测；深链、前进后退、坏 UUID/step、未保存替换、不取消运行 E2E |
| Understandable evidence-grounded result summary | 原结果投影 + journey-analysis | 原契约冻结；首失败、业务未验、缺证、派生当前与原报告分开呈现 E2E |
| Historical step evidence linkage | 原 artifact/lease + journey-analysis | 原证据完整性/保留 lease；迟到图片、坏 hash 响应、缺图、源码行、真实 Mock 录像 E2E |
| Reviewed comparable investigation and replay | comparison/repair + investigation | 八项 investigation：typed facts、父子/App/平台、原件不变、lease/取消；旧与新入口 repair lineage E2E |
| Responsive accessible analysis and conservative sharing | 三栏/窄屏 tabs + 原安全分享 | zh/en、键盘、390×844、CSS 200% zoom；慢比较/调查、旧报告保留；v1/v2 导入后新分析 E2E |

相邻旧 authoring 2.1–2.5 对应 handoff/editor，3.1–3.4 对应 investigation，旧 triage 4.x 对应分析与长动作。旧任务不批量改写，真机与独立用户任务不因本轮测试数量自动完成。

契约保护：workbench-authoring-contract-baseline.json 固定功能开发基线 SHA、原有 17 工具及旧 YAML/HTTP/结果/归档/宿主探针文件 hash；合入 `dev` 时用 workbench-authoring-dev-integration-baseline.json 显式记录上游新加的 3 个只读工具和 8 个上游变动文件 hash，对应 contracts 单测同时验证原有前缀与新增后缀。此用例创作能力本身只增加 Viewer 接口，不增加宿主工具数。

边界：旧/导入/派生数据使用仓库 fixture；异常网络与慢动作使用明确路由故障注入。用例库切点注入异常，只有共享受理执行真实子进程强杀。真实设备、实际 App 构建变更和独立非作者用户仍待验收。
