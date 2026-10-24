# ADR 0012: 证据消费者生命周期与执行消息边界

状态：Accepted。日期：2026-09-29。实施基线：dev@REDACTED_REVISION。后续于 ADR 0011，不引入新框架。

## 决策

### 持久引用发布与退休

新 comparison/share 使用 v3 `workbench:comparison` / `workbench:share` 引用，消费记录携带 `referencePublication` v1。在 Store mutation gate 内先持久发布引用，再发布消费记录。comparison 的两个引用保护整条源运行（空 evidenceRefs 不表示不保护）；share 引用包含已选择且验证过的源文件。

发布失败可以留下保护性孤儿，但不得先删除引用再重试。引用文件、消费文件及其相关父目录执行 fsync。`retire()` 是内部显式 API，不因退出或关闭自动调用，也没有新增 Agent/HTTP 权限入口：终态 comparison 或已生成的分享映射先写 `retiredAt`，再按消费者身份撤销引用；重复调用可继续完成中断的退休。分享退休不撤回已导出的文件，比较退休不删除报告及派生图片，但禁止再解析源证据或作为缓存结果复用。

统一快照对带 marker 的记录验证身份、目标、源 hash 与完整引用副本。活跃 marker 缺失或不匹配的引用阻止清理；退休后残留的引用仍继续保护。旧 comparison/share 无 marker 时沿用保守扫描，不做隐式迁移，也不开放旧记录的 retire。suite/baseline/Agent 等生产者仍在后续范围。

### 确定性执行 Worker v1

执行事件统一包含 `protocolVersion: 1` 和单调 `sequence`，主线程在任何设备调用前解析 schema 并验证工具 ID、合法步骤开始/结束、编译块 kind 与成功终态。重复、跳号、未知版本、无开始的终止、非法工具或超预算消息令执行失败；取消/结束后的迟到消息不再派发。RPC 回复带版本，Worker 拒绝无对应请求的回复。

schema 校验是内部协议健壮性，不是第三方代码安全沙箱。设备参数的细节授权仍由 WorkbenchDevice/MirrorService 验证；所有写入保留同一设备租约。解析模式仍是内部固定 AppClaw parser，本轮没有将 parser ABI 或全部引擎语义抽象为多引擎接口。

### 查询与画面边界

历史读取并发上限 16，仍返回全部条目及损坏记录的保守投影，不截断或跳过 hash 复验。规模基准显示分诊幂等查询与清理扫描仍有线性成本，暂不增加数据库、缓存可信度或生产 SLO 承诺。

Viewer 捕获保留上一张已解码图片副本，避免轮询 `<img>.src` 切换导致宽高暂时为零而吞掉截图点击；不改变设备动作与归档格式。录屏与截图仍独立操作，旧结果在失败时保留。

## 回滚与限制

前版 REDACTED_REVISION 能读取 v3 引用但不知道新退休标识，因此会保守保留这些源运行；不可为方便回退而删除 marker、引用或 journal。当前版本重启后恢复正常退休语义。新协议主线程和执行 Worker 必须同包发布，混用旧 Worker 将明确失败，不静默降级。

本轮不完成全部磁盘故障矩阵、所有旧消费者迁移、动态插件市场、第二执行引擎或真机验收。详细测量和软件/设备边界见[验收记录](../evidence-runtime-boundaries-validation.md)。
