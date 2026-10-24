# 失败分析与跨次比较验收记录

更新：2026-09-18。本文区分确定性自动化与 Android/iOS 真机验收；不把比较结果称为自动根因。

## 已验证范围

- 比较身份使用 HMAC 输入指纹、计划指纹、平台、App 和执行环境；旧记录缺少契约时明确不可用，不迁移或猜测。
- 隔离 worker 完成步骤对齐、PNG/XML/断言/业务/清理/恢复/耗时比较，支持显式截图遮罩、资源预算、单 worker 有界队列、取消、缓存、重启 interrupted 与派生产物哈希复核。
- Evidence Reduction 只把步骤增删、断言、业务、清理和恢复差异提升为 Diagnostic Context。截图像素、结构和单次耗时变化保留在完整报告，不自动写成业务失败或根因。
- Viewer、DSH adapter 与独立 MCP 读取同一个 ComparisonService。`mobile_mirror_run_diagnostic_context` 默认只返回事实摘要和稳定引用；指定一个 `evidenceRef` 时仅返回登记元数据及受控本机 URL，不接受自由路径或整包导出。
- 浏览器 E2E 已验证创建、轮询、报告下载、Context 展示、证据回钻、重启后 Context 完全一致和跨来源拒绝；保留并人工检查 [Viewer 截图](https://raw.githubusercontent.com/qmkCamel/flowassert/main/artifacts/screenshots/mobile-mirror-run-comparison.png)。

## Android 真机

设备为 PLA110，应用为仓库 Fixture，执行目录保留在本机 `artifacts/physical-validation/run-comparison-android-2026-09-18T09-13-19-742Z`，原始真机材料按仓库规则不提交。

| 场景 | 标识 | 结果 |
| --- | --- | --- |
| 正例基线 | `87ba1812-62a3-441a-a8c5-44317fa0b4b3` | pass，业务 verifier pass，cleanup pass |
| 正例目标 | `5038723d-d2af-47c5-94ce-d618bc218370` | pass，业务 verifier pass，cleanup pass |
| 故意业务失败 | `526c85af-e3d8-4245-b73d-e47841a8ef98` | fail，业务 verifier fail，cleanup pass |
| 正例严格比较 | `dcfd33cd-a690-43d3-a7a9-f79fe752c558` | rules v2，completed；Context 中两侧 verdict、业务和断言一致，无诊断首分歧；像素差异只留在完整报告 |
| 业务失败人工对照 | `78d89cfd-0eed-4103-8ece-e39bf2c2223e` | rules v2，completed、review-only；Context 保留不同 logical test/input 限制，业务维度 different、`business-assertion` 分类 |

真机流程还验证了 Viewer 比较入口、派生 diff PNG、故意失败分类、服务重启后报告完全相同及派生产物 SHA-256 复核。rules v2 修正了运行时动态 fixture ID 导致的步骤误拆分，并将 verifier 比较约束为可复核的状态关系，避免两次正常运行被动态 ID/时间戳误报为业务差异。

## iOS 真机

设备为 iPhone 16 Plus / iOS 26.2.1，应用为仓库 Fixture，执行目录保留在本机 `artifacts/physical-validation/run-comparison-ios-2026-09-18T09-47-42-411Z`，原始真机材料按仓库规则不提交。

| 场景 | 标识 | 结果 |
| --- | --- | --- |
| 正例基线 | `69d7513e-c8a8-4ce5-9065-db3a5a820037` | pass，业务 verifier pass，cleanup pass |
| 正例目标 | `8d2eec21-7baf-4e9c-9395-b5afd560e2c4` | pass，业务 verifier pass，cleanup pass |
| 故意业务失败 | `4815e367-8f10-40e5-99d4-c2a7800ba161` | fail，业务 verifier fail，cleanup pass |
| 正例严格比较 | `735e32e8-c027-4a50-9a55-48eb9ce1efff` | rules v2，completed、comparable；Context 中两侧 verdict、业务和断言一致，无分类事实 |
| 业务失败人工对照 | `aadbdef6-2f68-49e2-82cb-2e827890d7c8` | rules v2，completed、review-only；业务维度 different、`business-assertion` 分类 |

严格比较的 Diagnostic Context SHA-256 为 `8f0d012e7d13b8d4813f901abdccaeba9841b1ab10fd62e90cd5a0b8f5480d4b`，完整报告 SHA-256 为 `748ba1992d964957d1cee68a629be3c2f494ed5b478cde4e1c29b8849af213fa`；其中登记 24 个 evidence refs，并成功把一个引用解析到目标运行的 `step-4.xml`。业务失败对照的 Context/报告 SHA-256 分别为 `8765c52c4a49956c7ff8dc6188995ca328996209b6ea8817288d9397f8400a01` 与 `9530d813842cc9394a714591dc4ab5d44dd10c68317eaae784aa990e9d2991d3`。

探针还验证了 Viewer 比较入口与截图、派生 diff PNG、服务重启后的报告逐字节一致及派生产物 SHA-256 复核。执行结束后 4723、47831、8100、9100 均无监听，未残留 Appium、xcodebuild、iproxy 或 WebDriverAgent 宿主进程。首次尝试时手机仅使用 4G，Fixture 正确显示 `Network error` 且 cleanup pass；连接与 Mac 相同的 Wi-Fi 后完整矩阵通过，因此不把该次网络前置条件失败记为产品回归。

## 上层 Agent 受控消费

Codex 读取业务失败 Context 后得到的事实是“目标 verdict 为 fail、业务维度不同、存在 business-assertion”，同时看到“不同 logical test、不同输入”的 review-only 限制。它将“预期金额不一致”保留为外部解释，没有把解释写成 comparison verdict。

消费前后 Context SHA-256 均为 `50fa01edc972bf81d7b19f255a2ad14fd0b179e1110ac720a787d80e4603251c`，完整报告 SHA-256 均为 `3d6360ab995b85c427558646832fc1f8d3447aa2c2b296f2acbb49388a6bd8dc`。另从正例 Context 选择一个稳定 `evidenceRef`，成功解析到已登记的 `step-1.png` 元数据和本机 URL；Agent 没有获得自由文件路径，也没有改变原运行 verdict 或证据。

Android 与 iOS 已完成同等 Fixture 真机矩阵。该结论只覆盖当前两台设备、仓库 Fixture、当前 comparison rules 和本机执行环境；更多系统版本、外部业务 App、统计性能回归、视频差异和视觉门禁仍不在本次验收范围内。
