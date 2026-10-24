# 本机双槽设备矩阵

状态：第六项工程实现；双 Mock／伪 Appium／进程故障注入不是双真机验收。真实 Android＋iPhone 业务、20 轮对照、外部使用者判读仍见 OpenSpec 第 8 节，不能据本指南归档或发布生产承诺。

## 范围与默认行为

- 一个协调器最多一个活动矩阵、两个槽位、100 个单元；同槽 FIFO 串行，跨槽最多并行 2。没有动态设备迁移或自动失败重试。
- 每槽独立子进程、MirrorService、WorkbenchApplication、可写 Store、Appium 会话和机器级 UDID claim。父进程只协调，不直接控制设备。
- 旧单设备 Viewer／Agent 工具仍指向旧单设备运行时，不会因选中矩阵槽而改变目标。
- 矩阵启动／取消／安全复跑仅开放本机 Viewer／CLI；MCP 和 DSH 新增只读 `mobile_matrix_status`。连续媒体不进入工具结果。

## 登记与项目

启动本机宿主前显式配置两个绝对路径：

```sh
export MOBILE_MIRROR_TEST_PROJECT=/absolute/project/project.json
export MOBILE_MIRROR_MATRIX_REGISTRY=/absolute/project/matrix.json
```

路径必须为本机正常文件，不接受符号链接穿越。宿主已有 `agentTestControl.projectPath` 时优先使用该项目；Agent 读取另须启用现有测试策略，并将矩阵使用的 flow／platform／appId 全部纳入允许列表。API 只接收登记 ID，不接受项目路径、脚本、可执行文件、工作目录或任意 capabilities。

下面是无真机演示登记。`smoke` 和 `reset` 必须存在于项目的 flows；Mock 当前只模拟 iOS，不能把它写成 Android 真机证据。

```json
{
  "contractVersion": 1,
  "slots": [
    {"id":"one","configId":"one","platform":"ios","udid":"mock-slot-one","provider":"mock","config":{"mockStartupDelayMs":0},"capabilities":{},"ports":{"driver":28101,"mjpeg":28102}},
    {"id":"two","configId":"two","platform":"ios","udid":"mock-slot-two","provider":"mock","config":{"mockStartupDelayMs":0},"capabilities":{},"ports":{"driver":28103,"mjpeg":28104}}
  ],
  "plans": {
    "smoke": {
      "cells": [
        {"id":"first","slotId":"one","flow":"smoke","params":{},"fixture":{"parallelSafe":true,"namespace":"first","resourceKeys":[],"reset":"reset"}},
        {"id":"second","slotId":"two","flow":"smoke","params":{},"fixture":{"parallelSafe":true,"namespace":"second","resourceKeys":[],"reset":"reset"}}
      ]
    }
  }
}
```

真机槽改为 `provider: appium`，登记明确 UDID、平台和本机 `config.appiumUrl`。默认 external，不隐式启动 Appium；需要 managed 时在本机登记中显式选择既有受管配置。Android 的 driver 对应 systemPort，iOS 对应 wdaLocalPort，iOS 还须提供独立绝对 `derivedDataPath`；mjpeg、必要的 webview 端口均不可重复。禁止 sessionOverride、冲突 capability 别名和远端 Appium。预检占用端口只报失败，不杀原 owner。

制品：登记 `appium:app` 时仅接受本机普通 APK／IPA 文件，每个最多 64 MiB、总量 128 MiB。开始时复制为私有只读制品，绑定 SHA-256，连接和复跑前重新校验；不下载 URL、不接受 app 目录／别名。超预算明确拒绝，不能绕过冻结改为读取原路径。预装 App 不复制二进制，其来源沿用 declared／observed／unknown，不补造 observed 哈希。

## Fixture 的并发契约

两个槽都有单元时，每个单元都须声明 `parallelSafe: true`，且不同槽 namespace 不同。存在 prepare hook 时，flow header 必须声明 `params.matrixNamespace`，并在 prepare 参数中绑定 `${params.matrixNamespace}`；运行值由协调器生成，包含 matrixId、slotId 和登记 namespace，调用方不能覆盖。

共享账号／后端资源用相同 `resourceKeys` 声明互斥。正常完成释放键；未知写入／槽隔离会封锁该键，使后续依赖单元 blocked，不因为另一槽空闲就继续污染数据。prepare／verify／cleanup 仍使用已有可信扩展契约；并发安全是负责人声明，不是自动证明业务后端隔离。

安全复跑必须登记 `fixture.reset`，只执行冻结的重置 flow；重置未通过、取消或清理未确认时，不进入业务 flow。复跑重新连接自己的会话并生成新 attempt，绝不改写旧结果。

## CLI 与 Viewer

```sh
flowassert matrix validate smoke --url http://127.0.0.1:3210
flowassert matrix start smoke --url http://127.0.0.1:3210 --confirm 'START smoke'
flowassert matrix status MATRIX_UUID --url http://127.0.0.1:3210
flowassert matrix cancel MATRIX_UUID --slot one --url http://127.0.0.1:3210 --confirm 'CANCEL MATRIX_UUID one'
flowassert matrix cancel MATRIX_UUID --url http://127.0.0.1:3210 --confirm 'CANCEL MATRIX_UUID'
flowassert matrix retry MATRIX_UUID --cell first --url http://127.0.0.1:3210 --confirm 'RETRY MATRIX_UUID first'
```

将 `MATRIX_UUID` 替换为实际 ID。start／retry 等待终态；SIGINT／SIGTERM 请求取消，不直接杀设备进程。显式 loopback URL、同源写请求和确认文本都必须匹配。validate 是只读资源预检，claim 在 start 的 prepare 阶段获取，不能把 validate 成功当成随后不会竞争。

Viewer「本机设备矩阵」可以读取登记计划、检查资源、勾选本机留证许可并启动。独立进度、单槽／全局取消、槽位画面、复跑、历史与逐 attempt 表保留。画面是用户请求的一次快照，不新增持续视频订阅。切槽后迟到画面丢弃；失败保留已有结果，其他控件仍可交互。历史列表最多最近 20 项，按 ID 可查询旧项。

## 结果、验收与保护

工作根目录的 `matrices/<id>/` 保存冻结 input、state、不可覆盖的 `result-N.json`、制品以及各独立 `stores/<storeId>/`。矩阵预留 192 MiB，仍保留既有 256 MiB 余量；容量未知／不足在派发前拒绝。子 Store 另走原有证据准入。

每条子结果发布 `matrix:attempt` 持久引用。登记 storeId 与 attempt/hash/回执绑定；在线由子 owner 读取，离线互斥只读，不接收任意目录。历史结果保存当时投影；当前查询重新校验原始证据与引用，损坏只会降级，不改历史清单。UI／业务／视觉／清理／证据分项独立，不用总绿灯替代业务证明。

退出码优先级：确定失败 1 > 缺证据／blocked／中断／清理未确认 2 > 纯取消 130 > 全部完整通过 0。所有历史 attempt 都参与，后续成功不能覆盖原失败；复验关系留给验收对象解释。

第四项验收 cell 可引用：

```json
{"runId":"ATTEMPT_UUID","matrixCell":{"matrixId":"MATRIX_UUID","cellId":"first","attemptId":"ATTEMPT_UUID"},"historyRunIds":[]}
```

这只是普通验收 cell 的来源字段，其余 commit／binary／build／环境／logicalTestKey／inputDigest／required 仍必须完整。绿色矩阵没有权力补造缺失来源或需求覆盖。引用失效和跨 store 不匹配会阻止提交或降为 incomplete。

## 故障恢复

1. 断线／未知派发隔离原槽，后续单元 blocked；另一槽可继续，但共享未知资源键保持封锁。
2. 父进程退出导致私有 IPC 断开，子进程走自身取消与关闭链。子进程 SIGKILL 后不能证明设备会话结束，保留 active claim，拒绝抢占。
3. 重启只把未终态矩阵标 interrupted，不重放 queued／running 单元，也不按旧 PID 自动杀进程。
4. 正常关闭且有 reset 的单元可显式 retry。清理未确认时先人工核对精确 UDID、会话、进程启动身份及 claim；不要删除整个 claim 目录。当前不提供自动强制恢复按钮，确认并处理原会话后可新建矩阵，旧中断记录仍保留。
5. 终态发布失败不会显示成功；当前进程报告 `matrix-terminal-persistence-failed`，拒绝复跑。先恢复容量／目录问题再重启核查，不能手工把 state 改绿。

## 验证层次

工程记录见 [离线工程验证](https://github.com/qmkCamel/flowassert/blob/main/artifacts/local-device-matrix/validation.md)，所有 Mock、伪 Appium、合成 OCR 证据明确标注。授权真实 OCR 冻结集、具体 profile 的人工生产批准、双真机业务与非作者评审尚未完成。
