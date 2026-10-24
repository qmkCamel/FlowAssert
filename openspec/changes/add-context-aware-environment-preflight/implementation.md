# 按入口与操作的环境预检：实施与验证

日期：2026-10-07。基线 `origin/dev@REDACTED_REVISION`，实现分支 `feat/scoped-environment-preflight`。环境 macOS arm64、Node 24.19.0、pnpm 11.7.0。结果仅适用于本次代码与所述范围。

## 已实现

| 任务 | 实现与证据 |
| --- | --- |
| 1.1–1.3 | `src/environment-preflight.ts`：纯规范化/计划、codex 别名、默认 runtime、v2 报告及依赖角色；`tests/environment-preflight.test.ts` 覆盖无设备矩阵、冲突、超时和可选降级 |
| 1.4 | `src/preflight-project.ts`：仅已登记 flow/suite，合并必要 OCR/AI，编译但不执行；`tests/preflight-project.test.ts` 覆盖注册、权限、取消、凭据零请求及 OCR 不可用。项目级“必需录像”字段目前不存在，扩展范围待确认，不把显式功能检查冒充项目登记推导 |
| 2.1–2.4 | `src/preflight-host-checks.ts`、doctor/连接助手共享固定查询及 scrcpy 叶子；顶层与嵌套命令并发最多 3，60 秒预算、单命令不超过 20 秒、1 MiB 输出上限；取消向项目读取和原生编译 worker 传递；报告只保留稳定代码/版本/数量 |
| 3.1–3.5 | `src/preflight-dsh.ts`：明确绝对路径、canonical executable、精确 rc.2、有限 manifest、安装优先的内置 peer；负向测试含混装、额外输出、symlink、循环、超限。保留既有宿主 peer 装载拒绝，不改 agent loop |
| 4.1–4.3 | media/OCR/AI/recording 分别 off/preferred/required；off 零探测；PNG 不要求 scrcpy；iOS MJPEG 仍需 session 验证；浏览器只检查 API/MIME，无头 required 录像拒绝，不开始采集 |
| 5.1–5.4 | CLI 参数及退出码迁移；同源有限 HTTP schema；Viewer 可信本机项目、无任意宿主路径；保留设备引用 TTL/single-use/owner/授权，检查报告不授予执行权 |
| 5.5–5.6 | Viewer 局部进度、取消、旧结果保留、完成时间、generation 隔离。1100 ms 等待期间切换主题仍可用；取消/失败/切范围后旧响应不覆盖；全量浏览器 85 通过、1 条既有性能测试按条件跳过 |
| 6.1–6.3 | 矩阵单测、实际受控子进程、fake Appium HTTP、同包四入口隔离安装；中英文 README、安装、MCP、DSH、Viewer、无头、架构与文档索引已迁移 |
| 7.1 | 同一明确宿主、同一临时 profile 的静态前提和 Native/PTC 实调均验证，详情见下；未读取用户完整配置 |
| 7.2 | 双端只读准备抽样已执行，真实缺项如实保留，未建立会话/操作业务 App/申请签名 |

## 用户确认的 DSH 边界

用户明确要求“保持边界，启用状态单独实调验证”。版本与 peer 元数据通过不等于插件已启用，因此 `dsh-profile-unverified` 保留 manual，整体 incomplete / exit 2。读取补丁、热更新/启动参数推断实际启用不在预检职责内。

实际 rc.2 从选定安装目录优先解析内置 peer；只读实现只有限核对该安装以及选定 profile，不回退 PATH 的别的安装。非标准布局无法证明时未确认。既有 `dsh-clean-profile-probe.mjs` 保持原样，新增 `scripts/preflight-dsh-probe.mjs` 专门执行独立授权验收。

## 打包与真实宿主

执行 `pnpm build`、`pnpm pack:check`、`pnpm pack`，随后以**同一 tarball**执行：

```sh
node scripts/preflight-package-probe.mjs /ABSOLUTE/CANDIDATE.tgz
node scripts/preflight-dsh-probe.mjs /ABSOLUTE/SELECTED_DSH /ABSOLUTE/CANDIDATE.tgz
```

首轮共同 SHA-256：`f2cfd05200044ff733e5188f71745e1d79ad3d1d00ba99333b6b716d502d55c5`。收尾构建共同 SHA-256：`ac1184bd009a775cd9d34012c7dbf1ebc366be428691399bb0310fda14bb3ca7`；四入口与真实 DSH Native/PTC 均再次通过。该 tarball 与最终运行代码一致，后续仅补 OpenSpec 收尾记录，不重新生成候选包。

- 隐藏手机工具 PATH 后 Viewer/MCP/CLI 基础前提 ready / exit 0；DSH 缺少明确目标 incomplete / exit 2；报告、Mock ready。
- 错误 DSH executable 版本拒绝，不回退其他安装。
- 真正 DSH 0.2.0-rc.2 临时 profile 安装后，版本与有效 peer 通过，静态启用状态仍未确认；随后同目标 Native/PTC 注册与调用成功。
- 独立脚本只启动并停止自己创建的宿主，确认退出和端口释放；临时 profile 已清理，不改用户现有 profile。
- 以上是实际宿主 + Mock 工具调用，不是真实模型、真机操作或业务验收。

## 双端只读抽样（本轮新证据）

实际构建 CLI 执行 `doctor --platform android --format json` 及 `doctor --platform ios --format json`。未开启签名诊断、未指定任意用户 profile、未启动 Appium/WDA。设备数量来自当前命令输出，不记录 UDID、名称、账户或原始材料。

| 范围 | 观察 | 正确结论 |
| --- | --- | --- |
| Android | ADB 1.0.41；online 1，offline/unauthorized 0 | 设备枚举通过；默认 external Appium 不可达，CLI 路径未登记，整体 blocked / exit 2 |
| iOS 默认环境 | 系统 active developer directory 指向 Command Line Tools | Xcode 不可用，不能据此断言手机未连接；整体 blocked |
| iOS 进程级选定 Xcode | 仅本次进程设置 `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`；Xcode 26.5、物理设备 1 | 改用 `xcdevice list` 结构化枚举后再次抽样：仅计入 available=true、非 simulator 的 iphoneos；排除 Mac、模拟器与不可用设备。Appium 缺项 + 签名未授权仍如实保留，整体 blocked / exit 2 |

未改变全局 xcode-select；未接管其他会话或申请信任/配对/签名。准备抽样不要求环境全部就绪；也不等于连接、WDA 启动或媒体链路已验收。

## 浏览器运行证据

已人工查看仓库内截图：`artifacts/screenshots/preflight-progress-desktop.png`（1100 ms 等待期间：局部进度、取消、旧结果可见、主题可操作）与 `artifacts/screenshots/preflight-completed-narrow.png`（390 px 窄屏完成结果）。修正了通用 label 样式覆盖 hidden 的问题；未选测试引用保持隐藏，窄屏结果可换行。测试不涉及真实手机控制。

## 收尾与未完成项

- 全量 E2E：`pnpm test:e2e --workers=1`，85 passed / 1 skipped；构建与 E2E 已串行，未再出现重建 lib 导致浏览器资源丢失。
- TypeScript 单独通过；`openspec validate --all --strict`：51/51。
- `pnpm check --maxWorkers=2`：TypeScript、契约检查通过；129 个文件中 128 通过，1154 项中 1153 通过。唯一失败用例为公开仓库扫描：原有历史路径问题 + 当时尚未纳入 Git 的新文档链接。将本次文件纳入 Git 后运行 `node scripts/check-public-readiness.mjs`，仅剩提交 `REDACTED_REVISION` 的 `openspec/changes/upgrade-dsh-020-rc2/merge-validation.md` 历史 `absolute-home-path`；没有新文件或链接问题。
- 收尾定向回归：`pnpm exec vitest run tests/public-readiness.test.mjs tests/doctor.test.ts tests/environment-preflight.test.ts tests/preflight-project.test.ts tests/onboarding-cli.test.ts tests/connection-assistant.test.ts --maxWorkers=2`，67 通过 / 1 失败；失败仍仅为上述历史项。此前四个预检/CLI 文件 46/46 通过。没有通过放宽扫描、改快照或重写历史获取绿灯。
- 最终 `pnpm build`、`pnpm pack:check`、`pnpm pack`、同包双探针通过；DSH 验收临时目录已清理、自有进程退出、端口释放。`git diff --cached --check` 通过。
- Git 交付只包含本次源码/测试/文档/OpenSpec 和两张预检截图；其他已有截图/报告不纳入。原主要工作树落后且有未提交内容，保留不动，通过独立功能分支向远端 dev 快进交付，不强推。
- 项目级必需录像登记尚无 schema，已向用户确认是否纳入本次；在答复前不将任务 1.4 全部勾选，也不宣称 OpenSpec 已全部完成。
