# 六项产品迭代合入 dev 验证

日期：2026-10-03。此次仅合并已有六项迭代，不实现新的自动源码修复方案，不执行真机操作，也不创建发布。

## 合并范围

- 目标基线：`dev@REDACTED_REVISION`。
- 来源：`feat/change-acceptance-roadmap@REDACTED_REVISION`。
- 使用独立工作区生成双亲 merge commit；原 dev 工作区的截图与未跟踪 OpenSpec 保持不变。
- 保留 dev 的比较关闭、Worker 退出、内置引用发布及退休治理，同时加入首次验收、语义就绪、诊断复验、变更验收、外部资产、OCR 与双槽矩阵。

## 合并适配

1. `WorkbenchApplication.close()` 同时关闭矩阵、OCR、分诊、分享和比较，并保持验收记录先于外部资产关闭，最终再关闭套件和工作台。
2. 运行服务同时保留内置引用同步与 OCR 项目摘要检查。
3. 应用探针与 Agent 测试保留双方断言，不删除 dev 的 ENOSPC、关闭及引用回归。
4. 架构守卫新增外部解析 Worker 的精确动态导入登记；路径由可信启动代码提供，HTTP 不接收模块地址。仍检查完整依赖图、环路和传递分层边界。
5. 双槽矩阵 ADR 改为 0015，避免与 dev 的比较生命周期 ADR 0013 重号；同步架构链接与打包清单。
6. README（中英文）、产品 TODO 和里程碑区分“已合入 dev”与“真实验收／发布完成”。

## 本轮验证

运行环境：Node 24.19.0、pnpm 11.7.0；依赖采用冻结 lockfile 安装。

| 命令 | 结果 |
| --- | --- |
| `pnpm build` | 通过；生成 Viewer 浏览器模块和运行时产物 |
| `pnpm check` | 通过；类型、契约检查，97 个文件／810 项测试 |
| `pnpm test:e2e` | 最终全量 64/64 通过 |
| `pnpm pack:check` | 通过 |
| `pnpm public:check` | 通过；公开内容与历史扫描 |
| `pnpm test:application:probe` | 通过；共享实例、语义就绪、只读核查、模板下载、child/pin 引用、比较关闭与 Store 重启 |
| `pnpm test:mcp:probe` | 通过；20 工具、Agent flow/suite/cancel/evidence/triage、双 Mock 矩阵 CLI/MCP |
| `openspec validate --all --strict` | 通过；40 个条目；使用本机已安装 OpenSpec 1.9.0 CLI |
| `git diff --cached --check` | 通过 |

首次 `pnpm check` 为 809/810：发现外部解析 Worker 未登记到新架构守卫，补齐精确登记后全量复验通过。首次 E2E 在新工作区完成构建前启动，Viewer 所需 `lib/viewer` 模块尚不可用，57/64 通过；构建后截图／Inspector 定向 15/15，再全量 64/64 通过。没有通过放宽断言、增加重试或跳过测试消除失败。

按 user-action-contract 验证：OCR 识别期间刷新历史、切换语言仍可用；取消、失败与输入改变后保留上次候选。双槽运行期间刷新历史、切换槽位和取消单槽不阻断另一槽；刷新失败保留结果。已检查本轮[矩阵运行截图](../artifacts/local-device-matrix/matrix-running-desktop.png)与[OCR 结果保留截图](../artifacts/local-ocr/ocr-desktop.png)。这些是 Mock／Fixture 交互证据，不是真机效果。

## 不变的验收边界

四个迭代 change 仍为 89/103，14 项真实材料、真机、独立参与者或归档前置验收未因此完成。此前同包 DSH Native/PTC 和 Vision 合成识别记录保留为历史证据，本轮未重新执行真实模型、真实 OCR 质量或双设备业务验收。详见[六项路线图](../openspec/changes/add-change-acceptance-records/roadmap.md)。
