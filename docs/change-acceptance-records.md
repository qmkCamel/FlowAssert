# 变更验收与 PR 摘要

本机功能，入口在 Viewer 工作台的「变更验收 / PR 摘要」。它聚合已经完成的运行，不运行、构建或安装 App，不提交 GitHub 评论。需要显式声明范围及提交／制品来源。工程验证与真实业务验收分开记录，不能把 Mock 通过当成产品发布就绪。

## 使用流程

1. 填仓库公开标签、完整提交摘要（40 或 64 位十六进制）和可选 PR 编号。
2. 从已完成运行加入覆盖单元，补齐 JSON 中的来源、平台、参数摘要、环境和必需维度。`binarySha256` 是制品摘要，不是截图摘要；未知信息不能编造。
3. 显式审查公开标签及声明关联，再预览。缺失／冲突显示 `incomplete`；源运行和证据不会被修改。
4. 确认发布不可变修订。后续用同一对象生成新修订，不能删除失败单元或降低必需维度来刷新范围。查看历史修订时显示当时结论和当前材料核查。
5. 下载 JSON 或可粘贴到 PR 的 Markdown。只有公开元数据，无原始参数、错误、日志、设备序列号或图片。上传前仍应审查自行填写的公开标签。
6. 不再需要保护证据时显式废弃对象；摘要保留，仅撤销本对象引用，不删除运行及其他消费者的保护。

`pass` 只说明声明范围内所需维度通过。所有摘要均注明「声明关联，未验证制品供应链」。一次恢复不能直接算干净通过；关联干净复验可称「复验通过」，原始失败仍保留。旧运行缺少完整来源时，不通过补写历史来获得绿色结论。

## 输入示例

```json
{
  "contractVersion": 1,
  "repository": "example-mobile",
  "commit": "0123456789012345678901234567890123456789",
  "declarationsReviewed": true,
  "cells": [{
    "id": "checkout-ios", "title": "订单创建", "platform": "ios", "appId": "com.example.app",
    "binarySha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "build": "replace-with-real-build", "logicalTestKey": "replace-with-run-key",
    "inputDigest": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "environment": { "os": "replace", "provider": "appium", "driver": "replace", "viewport": "replace", "backendEnvironment": "test" },
    "required": ["ui", "business", "cleanup", "evidence"],
    "runId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "historyRunIds": []
  }]
}
```

示例占位值不能用于实际验收；制品摘要必须恰好 64 位，以实际来源替换。

## CLI 与宿主

CLI 必须显式连接正在运行的 loopback Viewer；不会猜测设备、启动新 runtime 或向远端传输：

```sh
flowassert test acceptance preview --url http://127.0.0.1:3210 --file acceptance.json
flowassert test acceptance publish --url http://127.0.0.1:3210 --file acceptance.json --reviewed
flowassert test acceptance show --url http://127.0.0.1:3210 --id RECORD_UUID
flowassert test acceptance export --url http://127.0.0.1:3210 --id RECORD_UUID --revision 1 --format markdown
```

发布可用 `--id`、`--revision`（期望旧修订号）及 `--request-key`（UUID）控制幂等；同键不同内容拒绝。查询的 `--revision` 是要读的修订号。导出写 stdout，可显式重定向到本机文件。退出码：通过 0、失败 1、不完整／请求错误 2、纯取消 130。SIGINT 请求取消；已提交的修订不伪报取消成功。

DSH 与 MCP 共用只读 `mobile_acceptance_get({ id, revision? })`，属于当前 20 项默认工具集合（修复另有 5 项 opt-in Preview 工具），旧工具参数语义不变。需要启用现有 Agent test control；所有来源运行都必须属于当前项目的已登记执行，并仍满足 flow/suite/platform/app 权限。对象 ID 不是跨项目授权凭据；共享策略隐藏不允许的维度细节。工具不提供创建、发布、任意路径读取和媒体数据。DSH 验证基线固定 `0.2.0-rc.2`，不修改 agent loop。

## 存储与故障语义

数据放在运行 store 的 `acceptance/`，不能手工编辑后继续当作已验证事实。每对象至多 100 修订、100 个覆盖单元；最多 1,000 对象／任务，两个发布任务及两个核查读操作并发。预览最多 16 个、有效期 10 分钟。来源读取上限为总 64 MiB、单文件 16 MiB、manifest 4 MiB；超限降为不完整。

发布保留 256 MiB 磁盘余量，先登记意图和证据引用，再不可覆盖发布修订及原子索引。SIGKILL 后不重放设备动作；修订已落盘则恢复完成状态，否则标记 interrupted。引用前置可能留下保守保护的中断意图，不能以清理为由直接删除未知引用。

查询／下载重新校验来源字节；当前材料损坏时保留生成时结论，并把当前结论降为不完整。读租约阻止清理竞争；废弃先写 tombstone，再撤销引用，可安全重复。未知版本、损坏索引／意图／tombstone 失败关闭。

## 验证边界

确定性测试覆盖来源匹配、失败优先、复验链、恶意标签、容量、并发确认、幂等、过期、取消、SIGKILL、清理竞争及权限隔离。浏览器测试使用真实 Viewer 和 Mock 材料，检查下载、局部进度、语言切换、失败保留与迟到响应。

真实业务变更对应的 Android/iPhone 制品、服务端真值及至少两位非作者评审仍需单独完成。详见 OpenSpec `add-change-acceptance-records/tasks.md`；未验收前保持 active，不归档。
