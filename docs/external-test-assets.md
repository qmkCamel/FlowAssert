# 外部测试资产：导入、授权与验收边界

## 产品边界

这是一条报告导入链路，不是 Maestro/Appium 第二执行器。报告解析器只接收字节和公开生产者信息，不持有 MirrorService、设备、Runner 或证据存储权限。默认仅 Viewer/CLI 本机可见。

| 格式 | 当前支持 | 尚未验证 |
| --- | --- | --- |
| JUnit XML | testsuite/testsuites、嵌套、重名和参数化、失败/错误/跳过、Unicode；计数矛盾和未知结果保守告警 | 真实 Maestro 报告及具体 Appium 客户端 runner 的版本兼容性 |
| external-results-v1 JSON | 严格 contractVersion=1；tests 中 name/classname/status/durationMs，未知字段拒绝 | 任意第三方 JSON 不自动兼容 |
| 附件 | 用户显式选择 PNG/JPEG/UTF-8 text/JSON/XML；实际解码验证，按测试 ID 显式关联 | 视频、HTML、SVG、脚本、报告内 URL/路径自动抓取均不支持 |

测试中的 `synthetic-probe`、`external-fixture` 是人工生成的安全/契约样本，不能用作真实框架兼容证明。真实兼容验收要求生产者版本、生成命令、授权来源、原始 SHA-256，以及失败/跳过/缺附件样本。当前没有这些样本和独立使用方验收记录。

## 操作

Viewer 打开「外部测试报告」，选择报告、附件和执行器名称/版本。先解析预览，检查告警、来源及测试 ID；需要映射时修改 JSON 后重新预览，勾选审查再确认导入。输入变化使旧预览失效。导入过程中原生历史和语言控件仍可操作，失败/取消保留上次结果。

CLI 示例（Viewer URL 必须显式指定为本机；文件和父目录不能是符号链接）：

```sh
flowassert test external-results preview --url http://127.0.0.1:3210 --report /absolute/real/path/results.xml --adapter junit --engine team-runner --engine-version 1
flowassert test external-results import --url http://127.0.0.1:3210 --report /absolute/real/path/results.xml --adapter junit --engine team-runner --engine-version 1 --attachment /absolute/real/path/screenshot.png --mapping /absolute/real/path/mapping.json --reviewed
flowassert test external-results show --url http://127.0.0.1:3210 --id ASSET_UUID
```

`preview` 输出预览后取消 staging；`import` 必须带 `--reviewed`。`--request-key UUID` 支持内容绑定的幂等请求；成功退出只表示导入成功，不表示测试通过。macOS `/tmp` 和 `/var` 常为符号链接，请使用解析后的真实文件路径。示例映射结构：

```json
{
  "declaration": {},
  "bindings": [],
  "attachments": []
}
```

declaration 可声明 commit、appId、platform、binarySha256、build；bindings 条目为 `{testId, logicalTestKey, inputDigest}`；attachments 按选择顺序填写 `{testId, contentType}`。测试 ID 在预览中取得，未映射附件保持报告级，不猜测截图对应关系。

## 项目授权

本机用户对**每份资产**明确授权当前注册项目后，Agent 才能调用共用只读 `mobile_external_result_get({id})`。授权绑定资产摘要、项目身份和内容修订。原文件/测试名称/日志/凭据不进入摘要；不传输图片或连续视频。撤销、项目修订变化、资产撤回均拒绝读取。验收记录查询同样复核这些授权，不能经引用绕过。

```sh
flowassert test external-results grant --url http://127.0.0.1:3210 --id ASSET_UUID --reviewed
flowassert test external-results revoke --url http://127.0.0.1:3210 --id ASSET_UUID --reviewed
```

## 验收和数据安全

`reported-pass/reported-fail/incomplete` 是生产者报告结论；字节 `verified/unavailable` 是当前完整性；`external-not-revalidated` 是验证来源。这三个维度互不替代。外部 pass 不能单独变成本机严格 pass。验收覆盖单元的 `externalResults: [{assetId,testId}]` 只关联材料；本机复验、业务、清理仍按原规则检查。来源声明或 logicalTestKey/inputDigest 不匹配则 incomplete。

报告最大 5 MiB，最多 1000 用例，XML 深度 16；附件最多 32 个、单个 16 MiB、合计 64 MiB、图像最大 4096×4096。解析/附件验证各有 10 秒 worker 限时，两个活动导入预算。worker 资源约束不是 OS 沙箱，第三方 adapter 仅允许受信启动代码注入，不能从报告或 HTTP 注册。

容量未知/不足拒绝受理。私有 staging + 摘要确认 + fsync + 不可变目录提交，预览 10 分钟到期。中断后不重放解析或设备动作。下载重新验证摘要，文本强制 attachment/nosniff；显示不可信名称用 textContent。验收修订引用与读取租约阻止回收；未知引用保守阻止。显式回收保留本机 trash 字节，不等于物理删除；无自动清空回收区。

## 工程验收记录

见 `artifacts/external-assets/validation.md`。浏览器截图位于同目录 desktop.png、narrow.png。真实框架样本、实际使用方迁移验收仍是 OpenSpec 未完成项；不因此阻止独立的软件工程迭代，也不据此归档整个变更。
