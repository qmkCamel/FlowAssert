# ADR：有界 Web 自举运行

状态：采纳；2026-10-12。本轮目标仓库证据见[回迁验证](../../openspec/changes/port-report-playback-and-web-selftest/implementation-validation.md)，不沿用来源分支的验收数字。

## 契约

- 新运行以 `executionKind: web` 显式区分；原生 `TestRun` 保持原语义。`WorkbenchRun = TestRun | WebTestRun`，Web 不包含手机 sessionId、deviceName、appId、YAML 或 XML。
- Web 用例复用现有 caseId、不可变 revisionId、乐观并发和幂等请求，内容为 `platform: web`、`target: synthetic-viewer`、`scenarioVersion: 1`、登记场景 ID。原生执行入口显式拒绝 Web 修订。
- 沿用 `/api/runs`、取消、证据地址、历史目录和报告路由；原生比较、分享、导入、修复及设备健康不支持 Web，显式拒绝，不合成手机记录。
- WorkbenchService 统一占用运行槽位，适配器没有独立排队器。默认禁用；`MOBILE_MIRROR_WEB_TESTS=1` 或显式构造参数启用。每次启动仍需本地证据确认。
- 每个 Web attempt 创建独立 B 子进程、临时根目录和只读 loopback 端口。B 只生成合成历史，明确禁用递归；不接受外部 URL。A/B 真实路径不得相同或嵌套。仅清理登记的自有进程/浏览器，目录和证据保留。
- 启动前保存资源租约，随后登记 PID、origin、构建摘要及浏览器会话。取消先置 cancelling/中止命令，再排空并保存 finished。重启将未完成运行标为 inconclusive/cleanup-pending，不重放或按旧 PID 杀进程。
- 每场景 30 命令、3 分钟，整次 20 分钟。截图/页面快照/固定采集器事实/请求日志作为原始证据写入现有不可变证据存储。
- 采集成功不等于视觉通过。默认 `visualReview: needs-review` → inconclusive；断言失败 → fail；取消 → cancelled。显式复核必须绑定所有图片摘要、观察和复核人，另有独立检查器通过才能 pass；不得将故障注入标签作为视觉答案。
- 像素基线是独立的人工批准动作，精确环境不匹配为 incomparable，无基线为 not-compared；不因测试失败更新基线。

## 取舍

仅支持登记的八个合成场景，不建设通用网站 DSL。存储暴露显式类型化 record 读取；手机专用读取拒绝 Web，防止既有手机流程误读。Web 报告嵌入现有路由，不另建报告平台。保留 Vitest/Playwright 独立门禁。CI 首期只允许手动取证，不伪造无人视觉复核。
