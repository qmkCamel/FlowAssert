# 第六项 OCR 基础阶段验证（2026-10-01）

本阶段只完成任务 1.1–1.4、2.1、2.5，共 6/39。生产断言、冻结评测/批准服务、Viewer 区域选择、检查点持久留证及双设备矩阵仍未交付。此记录不是第六项总体验收，也不归档 OpenSpec。

## 已实际运行

- macOS 26.3.1（25D2128）、arm64，随包 Swift 源显式编译；Vision revision 3，en-US / zh-Hans。
- 中英文合成 PNG 用实际 Vision 识别，完整精确匹配成功。原图、裁剪、结果及摘要在本目录；不是授权真实 App 冻结集。
- 坏 PNG、几何变化、额外动作字段、未知版本、低置信、多目标、边界截断和进程预算拒绝测试。
- 两个活动任务、四个排队任务；取消等待所属 worker/进程退出，最终 active=0、queued=0。
- 打包探针验证仓库外安装，doctor 缺 helper 时拒绝且不编译，用户显式 prepare 后 doctor 和两种文字的实际识别通过。安装脚本未编译 helper。

## 工程门禁与已发现问题

- `pnpm check`：83 文件 / 716 测试通过，包含新增确定性验收任务收尾回归。
- `pnpm build`、`pnpm test:e2e`（59/59）、`pnpm pack:check`、`pnpm public:check`、共享 application 探针与 OpenSpec strict 均通过。
- 修复后的同包 CLI/MCP/真实 Vision 工程探针通过，19 个宿主工具；doctor 无 helper 时返回 2，显式 prepare 后中英文识别通过且生产仍关闭。
- 同一最终 tarball 的 DSH 0.1.5-rc.2 clean-profile Native/PTC、注册用例及图像模型边界探针通过，19 个工具，关闭完成。
- 验证包 `mobile-mirror-final.tgz`，SHA-256：`f7ca889b639e069426fcdaa1415dc55e9a48fbf2314ae1611b1dfbbc51d6b2ba`。
- 一次复跑暴露既有验收任务终态文件先于 Promise 收尾可见，紧接提交偶发 acceptance-busy；已在 `REDACTED_REVISION` 修复终态查询等待收尾，并用 after-job-save 切点确定性验证。未用重跑当作修复。
- 最初 `tsx -e` 使用 CJS 路径导致上游 ESM-only 子路径导入失败，探针改用 Node `--import tsx --input-type=module`；正式包 CLI 为 ESM，不修改上游依赖。
- E2E 自动生成的旧公开截图保留在本机验收临时目录，登记 hash 基准恢复后再跑公开检查；其他无关截图不纳入提交。

## 下一阶段

按原方案先完成原图/ROI 检查点留证、独立冻结评测、限定 profile 人工批准、显式文字断言与 Viewer 交互门禁，之后才开始双设备矩阵。真实授权图像集和双真机业务验收必须另外完成；本阶段所有 OCR 输出始终 `productionEnabled: false`。
