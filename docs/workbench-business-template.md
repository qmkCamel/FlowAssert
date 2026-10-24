# 已登记 HTTP 业务验证模板（工程样例）

[`examples/business-http/`](../examples/business-http/) 提供可复制的 `prepare.mjs`、`verify.mjs`、`cleanup.mjs`、`project.json.example` 和 `order.yaml.example`。它只演示受信任的本机测试环境，不含账号、真实 App 配置或外部试点数据；真实项目必须先审查接口所有权、数据隔离和撤销权限。

将样例复制到仓库外的私有测试项目目录，把两个 `.example` 分别命名为 `project.json`、`order.yaml`；修改 App ID、UI 断言及已批准的测试服务 origin。凭据由运行该任务的可信主机设置 `MOBILE_MIRROR_HTTP_TOKEN`，只通过项目中登记的 `credentials` 映射传入 worker；不要写进 YAML、命令行、报告或 Git。示例 origin 为 loopback；若真机 App 需要访问服务端，另行配置受控 Android reverse 或可信局域网地址，不把无认证测试接口暴露公网。

执行契约：

- `prepare` 生成 `namespace + UUID` 作为 correlation ID，在唯一一次 PUT 之前登记同 ID 的 cleanup token。写入超时/断线属于**结果未知**，不自动重放；先查询或按登记 token 清理。
- `verify` 只读轮询该 ID 的业务状态，最多 8 次、10 秒，单次请求不超过 2 秒、响应不超过 16 KiB。仅终态和预期金额一致才 `pass`；错误金额为 `fail`，接口/超时/未知状态为 `inconclusive`。UI 成功提示不能替代此结果。
- `cleanup` 只 DELETE 本轮登记的 ID，并核查它已是 404。500、超时或资源残留必须显式失败；不能清空全表、按前缀批删或清理其他团队资源。私有 cleanup journal 随任务保留供人工排查。

`tests/workbench-business-template.test.mjs` 在本机假服务上验证项目可编译、异步正反例、未知写入只发生一次、仅自有资源清理、失败清理保留资源及响应体上限。这不是两个真实试点接口的验收。

自托管 CI 使用 [managed job](managed-job.md) 的 `test job` 入口：为 runner 单独提供绝对路径的私有 runtime config、设备连接 JSON 和报告目录，登记 `smoke` 套件及允许的 App/平台，再由受保护环境注入凭据。任务完成后读取 `*.job.json` 中的 `jobExitCode`、`suiteExitCode` 和 `*.junit.xml`；失败码 1 表示确定性失败，2 表示不确定/基础设施/清理/报告故障，130 表示取消。JSON/JUnit 和原始 PNG/XML 默认只保存在受控本机目录；是否上传 CI artifact 必须另行审查脱敏及授权。扩展 worker 是**受信任代码**，进程隔离与模块导入限制不构成不可信代码沙箱。
