# 需求、兼容样本与证据映射

归档仍是事实源。ReportSummary/ReportDetail 使用 workbench-contracts 的现有结果投影；目录不做附件完整性复验，打开详情/导出才校验。软件验证不证明真实业务或用户成效。

## 冻结兼容矩阵

| 样本类别与测试位置 | 预期 |
| --- | --- |
| `tests/workbench-report.test.ts` 旧 schema/Mock、未知构建 | 原结果保留；runtime 未声明，不推断通过；来源和 provider 分开 |
| 同文件：取消/恢复、不可读、中断、损坏 steps | 分类与 coverage 显式；坏记录不能伪造通过 |
| 同文件：同名不同 caseId、运行级健康必需未验/不支持 | 历史不按名字合并；不造失败步骤；不支持进入 HTML |
| `tests/workbench.test.ts` 原始旧/新归档、缺图/坏 hash；`tests/workbench-runtime-integrity.test.ts` v2 | 按既有权威契约保守投影；原报告结论与当前材料状态分开 |
| `tests/workbench-share.test.ts` v2 派生；`tests/workbench-runtime-gates.test.ts` 与包探针 v4 | 导入派生为 inconclusive/not-revalidated；源 reportedVerdict 保留；未知必需功能拒绝 |
| `scripts/report-package-probe.mjs` 当前包/上一 dev | HTML 冻结字节/重启可读，旧版本不读新版提交；原始运行和 JSON 仍可读 |
| `tests/report-http.test.ts` 缺 PNG 登记、超 8 MiB manifest | 目录不读 artifact；不可读 coverage 保留，原 manifest 不改写 |

具体 fixtures 在各文件中显式构造，新增报告样本仅合成数据，不复制私人归档进公共测试。

## Requirement → implementation → test

| 规范要求 | 实现 | 验证 |
| --- | --- | --- |
| Structured bounded report discovery | query schema + store.listReportSummaries + reports HTTP | report unit/HTTP：日期时区/半开边界、50/10000/10001、稳定排序、未知/重复参数、旧 API |
| Consistent counts and stable navigation | query generation/cursor + report-catalog | 跨页计数、源/筛选变化拒 cursor；report-reading E2E 返回页/焦点、650ms 失败保留 |
| Scannable and truthful summaries | shared report presentation + table/cards | 旧字段/未验状态、桌面/390px 中英文截图；当前证据独立于 recordedVerdict |
| Identity-based history and qualified trends | case history + existing trends service | 同名不同身份 unit；workbench-trends 分母/attempt/派生/缺材料；趋势范围跳转 E2E |
| Responsive directory actions | epoch/AbortController/local progress | 延迟刷新中独立趋势导航；迟到响应不覆盖、失败保留旧结果 |
| Existing run-analysis delta | reportDetail + journey-analysis | journey/evidence/history E2E：旧深链、按失败导航/搜索、运行级 gate、原尺寸/fit、慢比较独立导航、旧图归属；1500ms 读取期间后台轮询不反复打断 |
| Pixel redaction controls | report-mask-geometry/redaction + existing worker | geometry 的原像素/缩放/滚动/横竖/向外取整/64框；share 像素与原 hash；E2E 画框、键盘移动/撤销 |
| ReviewedReportSnapshot v1 passive HTML | whitelist adapter + HTML renderer | unit：转义/外链/私文/字节上限/步数/PNG/hash/不支持；渲染器只收 snapshot |
| Frozen preview/export and original JSON | existing share owner + format branch | 预览/export 同字节/ID、来源改动/过期/restart/未知 v4 功能；原 API min1 JSON 不改 |
| Cancellation/storage/ownership | existing job queue + lease/reservation + HTML commit | queue/cancel/commit boundary、HTML 超时/ENOSPC/SIGKILL 两个新增切点+manifest；读 lease 释放；既有 retention 竞争测试 |
| Offline reading | passive sandbox preview + file URL | Chromium/真实 Chrome/管理 Firefox：断网无 HTTP、锚点/打印/窄屏；实际 Safari 缺口见验证记录 |
| Performance/accessibility | bounded metadata reader + UI labels/focus | 1000条 30冷/30热；报告文字 contrast 实测、200%、键盘；原生读屏/完整非文字对比度未独立验收 |
| Physical material and independent users | immutable archived source probe + study protocol | 双平台历史 fixture 图、runtime performance 记录、2组原/子运行及受控缺图已验；真实录像/健康来源/5名参与者仍待真实条件 |

本表不得把相邻 change 的 fixture 或旧门禁宣传为当前真机独立验收。精确执行结果与未通过项以 implementation-validation.md 为准。
