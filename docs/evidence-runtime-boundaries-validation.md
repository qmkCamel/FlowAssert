# 证据生命周期与执行边界验收

日期：2026-09-29。基线 `origin/dev@REDACTED_REVISION`，实施分支 `refactor/evidence-runtime-boundaries`。Node 24.19.0、pnpm 11.7.0、macOS arm64。使用独立工作树，不覆盖原工作区。

## 交付与检查

- 上轮 `modularize-plugin-friendly-runtime` 的 5 条 requirement 已同步主规范并归档，修正了归档生成的 Purpose 占位和文档链接。
- 新 comparison/share 引用先于消费记录持久发布，内部 `retire()` 先 tombstone 后撤销；重启、重复退休、错误 owner、丢失/未知引用、旧记录及源 manifest 不变有回归。
- 发布/退休切点包含 throw 注入；发布首条引用后另有真实子进程 SIGKILL 验证。不能把这些测试等同于所有文件系统/断电/ENOSPC 故障矩阵完成。
- 原生执行 Worker v1 schema/序号/步骤转换、非法工具、超预算消息、取消后迟到消息有测试；实际固定 AppClaw Worker 的既有用例也通过。
- 历史读取增加并发上限 16，损坏记录不丢失、顺序不变；没有改动 evidence hash 校验语义。

| 门禁 | 本轮结果 |
| --- | --- |
| `pnpm check` | 74 个测试文件、649 个测试通过；类型检查通过 |
| `pnpm test:e2e --workers=1` | 56/56 通过；与 build/pack 串行执行 |
| `pnpm build` / `pnpm pack:check` | 通过 |
| OpenSpec strict 全量校验 | 34/34 通过 |
| 打包 application 探针 | mock 执行通过，源证据未变，shutdown 完成 |
| 打包 MCP 探针 | 17 个工具；PNG、结构查询、本地化、YAML hash、flow/suite/cancel/triage、信号清理通过 |
| DSH 干净 profile | **0.1.5-rc.2**，17 个工具，native/PTC 生命周期与注册测试通过；catalog image/text-only projection 边界通过 |
| 前版兼容探针 | 两条 mock run：发布保护、退休、旧版保守保留、新版重启恢复及源 manifest 未变均通过 |

受测候选 tarball SHA-256：`714a6ff541f87163a02d4f5840c4d51a3111a94ca112d03affc5ea1691413415`。这是验收候选包的标识；最终提交另补验收文档，不把此值冒充后续重新打包的 hash。前版候选为上一轮 `REDACTED_REVISION` 构建的 application 包。application/MCP 使用候选包入口并复用当前锁定依赖；DSH 则把 tarball 安装到独立临时 profile，不修改用户已有 profile 或全局 Harness。

可复跑入口：`scripts/plugin-runtime-probe.mjs <candidate/application.js>`、`scripts/evidence-compatibility-probe.mjs <candidate/application.js> <previous/application.js>`、`pnpm exec tsx scripts/mcp-runtime-probe.ts --launcher <candidate/scripts/mobile-mirror-mcp.mjs> --viewer-localization true --screenshot <output.png>`、`node scripts/dsh-clean-profile-probe.mjs --dsh <absolute-dsh-rc.2> --tarball <absolute-tarball>`。前两个脚本以 `node` 运行；候选包需解压并提供锁定运行依赖。探针使用临时 mock 数据，不操作真实业务 App。

## 可复跑的查询基准

入口：`pnpm bench:queries`，也可传 `100`、`1000`、`10000` 的子集。只创建并删除本轮临时目录，不接受用户归档根目录；stdout 为 JSON，包含数据量、内存和查询结果。

每个规模：N 条完成态 run、N 个终态分诊 job、N 条持久引用；每个 run 0 个步骤、1 个 33 字节文本证据，10,000 条 manifest 总计 5,898,894 字节。另验证损坏 manifest 与丢失证据的详情投影。每组抽样检查最后一条源 manifest，查询前后 hash 未变；查询完成后另对第 1、2 条制造损坏样本。

| 操作（最终有界版本，毫秒） | 100 | 1,000 | 10,000 |
| --- | ---: | ---: | ---: |
| 历史 manifest 列表 | 11 | 32 | 273 |
| 单条状态，无证据复验 | 1 | <1 | <1 |
| 单条详情，包含证据复验 | 1 | <1 | <1 |
| 分诊冷初始化 | 11 | 81 | 881 |
| 分诊幂等查找 | 9 | 80 | 825 |
| 清理完整快照 | 36 | 322 | 3,275 |

原无界 Promise.all 版本 10,000 条列表单次 341 ms / 采样进程 RSS 299 MiB；第一次有界测量 272 ms / 174 MiB，最终包含损坏样本的复跑为 273 ms / 177 MiB。全流程采样 RSS 峰值由一次观测的约 400 MiB 降至最终约 265 MiB。这些不是隔离实验下的稳定收益比例：每个规模仅一轮、未驱逐 OS 缓存，RSS 是进程级且受 GC 影响。

该数据是轻量元数据下界，不代表图片/录像大归档吞吐、p95 或生产 SLO。决策：先保留 16 并发上限，不换数据库；分诊请求索引、摘要分页与完整清理扫描仍是下一步可测量的优化点。任何缓存都不能把未复验材料标为 verified。

## 录屏偶发失败调查

原失败 trace 显示截图点击已完成，但直到用例超时都未收到 PNG；超时后清理会话触发录屏结束，等待下载的代码随后可能收到 WebM。源码中尺寸为零会直接 return：轮询对同一个 `<img>` 重设 src 时存在 decode gap。

新增用例在点击捕获阶段确定性模拟图片自然尺寸归零，并在录屏中要求收到 PNG、旧结果可见且主题仍可操作。临时将该页面的 capture.js 替换为已提交 `REDACTED_REVISION` 原实现：用例在 5 秒内稳定报 PNG 下载超时；恢复新实现：通过。临时基线替换代码不进入提交。此对照证明 decode-gap 缺陷已修复；原现场没有点击瞬间的尺寸遥测，因此不声称已排除所有其他偶发下载原因。

按 user-action-contract 复核慢保存局部状态、主题切换、截图与录屏独立、失败保留旧 PNG/视频；最终运行截图已检查并保留：[桌面录制中截图](../artifacts/screenshots/evidence-boundaries-capture-desktop.png)、[窄屏导出结果](../artifacts/screenshots/evidence-boundaries-capture-narrow.png)。

## 宿主与真机边界

本轮 ADB 设备列表为空；使用 Xcode 完整 developer directory 的 devicectl 检查，已配对 iPhone 为 unavailable。没有对外部 App 发起操作或模型请求，因此不宣称本次版本已完成双端真机回归。连接设备后仍需补运行/取消/断连/退出及证据重启复验。

本轮兼容检查仅针对明确的前版候选包和临时数据；不替代全部历史版本、全部 ENOSPC 切点、外部试点和真实模型图片消费门禁。
