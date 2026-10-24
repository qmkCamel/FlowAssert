# 本机区域 OCR

当前工程实现包括本机 helper、候选预览、冻结评测、显式批准、项目登记的 `assertTextInRegion` 和 Viewer 框选。**尚未取得真实授权冻结集的质量放行，也未批准任何真实项目**。预览 `productionEnabled` 始终为 false；显式断言仅在项目、页面前置条件、构建、profile、评测和本机版本均匹配批准时可用。旧单设备和视觉 no-go 规则不变。

## 显式准备

```sh
flowassert ocr prepare --cache /absolute/private/ocr-cache
flowassert ocr doctor --cache /absolute/private/ocr-cache
```

仅 prepare 会调用 `/usr/bin/xcrun swiftc` 编译随包分发的 Swift 源码，最多 120 秒；需要已安装 Xcode 命令行工具。doctor/识别绝不自动编译、安装或下载。CLI 提供正在处理、失败及取消反馈；失败不覆盖已有 helper。输出包括源/二进制 SHA-256、OS 完整版本、架构、支持的识别 revision 和语言，不输出本机缓存路径。

产物按源码/架构/OS 内核版本寻址，权限私有，摘要复核后再运行。系统版本或能力变化会拒绝旧身份；用户需要准备新产物、重新评测/批准，而不是默认继承旧配置。缓存不足或未知容量拒绝准备；不读取或终止外部设备服务。

## 候选 API

包的 `application` 导出 `WorkbenchOcr`、`prepareOcr` 和 `doctorOcr`。`new WorkbenchOcr(cache).preview(pngBytes, profile, signal)` 只接收 PNG 字节和严格 profile，没有设备、文件选择、shell 或网络能力。结果含候选 decision、文字框、来源身份、profile 摘要、原图/裁剪摘要、ROI、耗时和完成时间；裁剪字节留在调用方本机，结果不能作为生产验收。

区域必须为 1 个整数像素矩形，绑定 App、页面、构建、平台、几何和方向。单行完整精确匹配，仅可选 NFC/首尾空白处理，不自动拼行、模糊匹配、负向成功或文字驱动动作。唯一清晰不同文字为候选 fail；空结果、低置信、多目标、边界截断、版本漂移为 inconclusive。明确 blocker 可记录失败，未找到 blocker 不证明没有未知遮挡。

限制：原 PNG 16 MiB/4096×4096；裁剪 PNG 4 MiB；256 框/256 KiB 输出；2 个活动任务/4 个排队任务，含排队/预检/解码的总预算 10 秒。解码使用有界 worker，识别为本机子进程，取消待子进程/worker 退出才释放槽位。它是可信代码隔离，不是 OS 沙箱。

## 实际识别与能力边界

实际 helper 使用 [Apple Vision 的文字识别请求](https://developer.apple.com/documentation/vision/vnrecognizetextrequest)，固定 accurate、显式请求修订和语言，关闭自动语言探测和纠错；不传用户自定义词典。实际识别结果和能力集合以本机探针为准，不以文档代替验收。

`scripts/ocr-runtime-probe.ts` 创建中英文合成 PNG，调用真实 helper，并检查坏图片/几何变化拒绝和结束后零活动槽位。探针支持 `--module` 指向仓库外安装包。合成图片只证明安装、协议和执行链路，不证明真实 App 字体/模糊/遮挡条件的准确率；本阶段不能人工批准生产。

## 冻结评测与显式批准

`application` 导出 `freezeOcrDataset`、`evaluateOcrDataset`、`summarizeOcrEvaluation`、`approveOcrRegistration`、`requireOcrApproval` 和 `ocrProjectDigest`。标签、图片 SHA-256、近重复页面组、开发／冻结拆分、放行／拒绝分组和 profile 在调用识别前冻结。报告保留原始输出，查询时重新计算门禁；不接受用户提供的 `candidate-go` 标志。

CLI 支持（以下均为示例路径，不会隐式读取其他图片）：

```sh
flowassert ocr freeze --manifest /private/data/manifest.json --output /private/data/frozen.json
flowassert ocr evaluate --manifest /private/data/frozen.json --digest <freeze返回的datasetDigest> --cache /private/data/helper --output /private/data/evaluation.json
flowassert ocr approve --registration /private/data/registration.json --project /private/project/project.json --approver reviewer --confirm APPROVE --output /private/data/approval.json
```

manifest 包含 `dataset` 和 `images`（case ID 到明确绝对路径）。dataset 结构以 `ocrDatasetSchema` 为准。文件读取拒绝符号链接、特殊文件和读取中变化；总图片预算 128 MiB。输出为带摘要的 `{digest,value}` 信封，使用独占创建，不覆盖原文件。取消不发布结果；no-go 仍保留报告并返回 2。帮助程序不可用会产生 no-go，不自动 prepare。

registration 包含 `profile`、完整 `evaluation` 报告和结构化 `page` 选择器。批准结果的 `value` 可显式登记到项目 `ocrProfiles.<名称>`。批准绑定排除批准信封后的项目输入摘要、页面前置条件、完整 profile、评测和版本；更改流程／fixture／构建等项目输入需要重新审查。删除登记的 approval 即撤销；在途执行使用启动时冻结的项目，新运行重新校验。

```yaml
- assertVisible: { text: "订单" }
- assertTextInRegion: { profile: orderTitle }
```

文字断言不能取代结构化 UI 断言或业务 hook。启动前检查所有分支的批准、helper 和构建；执行时重新检查本机版本，并用同一步 PNG/XML 检查点确认页面唯一匹配。保存完整原图、ROI 裁剪、配置、识别输出、身份摘要和时间。空识别、歧义、版本／页面／几何不符、取消及异常均不得通过。

## Viewer 与验证边界

工作台“本机区域文字识别”支持选择本机 PNG、拖动框选 ROI、读取已登记配置和批准状态、候选预览、取消及保存草稿。保存草稿不改项目批准。运行时可操作其他历史、切换语言；输入变化隔离迟到结果，失败／取消保留带来源摘要和完成时间的上一份完整结果。

测试中的 `ocr-fixture.ts` 是明确标记的人工合约输入，不能用作真实质量放行材料。真实图片与真机任务继续保留未完成。
