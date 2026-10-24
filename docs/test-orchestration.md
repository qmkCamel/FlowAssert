# 参数、代码验证与回归套件

2026-09-16：当前实现直接扩展 YAML，不需要 `version: 2`。叶子操作继续使用固定 AppClaw 2.7.0；设备控制和证据由 MirrorService/WorkbenchService 持有。自然语言恢复、多设备并行、任意代码安全沙箱不包含在内。

## 运行一个套件

示例项目保留在源码仓库，不随运行包分发。宿主启动前设置本机可信项目注册文件的绝对路径：

```sh
MOBILE_MIRROR_TEST_PROJECT="$PWD/examples/test-project/project.json" pnpm dev
```

连接演示设备后进入“测试工作台”，选择套件并点击“运行套件”。示例两行数据分别走真假分支，结果按 case 和 attempt 展示；每一步可以展开 PNG/XML。公开参数栏为 JSON，传入参数必须由流程声明。普通粘贴 YAML 无需项目文件；子流程、代码扩展及套件通过宿主项目登记，浏览器不能提交任意本机路径。

命令行连接已经运行的 Viewer，端口使用实际地址：

```sh
flowassert test suite smoke --url http://127.0.0.1:53988 --tags smoke --report-dir ./reports
```

不启动另一套 Appium。JSON/JUnit 报告保留 case/attempt ID，证据在原运行目录。退出码：0 为全部干净通过，1 为失败/flaky，2 为配置/基础设施不确定，130 为取消；零匹配不算通过。Ctrl-C 请求取消队列及当前 attempt，等待有界清理结束。

## 流程编排

```yaml
name: 参数示例
platform: ios
appId: com.example.mobilemirror.mock
params:
  label: {type: string, default: 'Hello, harness.'}
---
- runFlow: {ref: common}
- if:
    condition: {platform: ios}
    then:
      - assertVisible: {text: '{{ params.label }}'}
- repeat:
    until: {visible: {text: '{{ params.label }}'}}
    maxIterations: 3
    steps:
      - swipe: {direction: up}
```

- `params` 支持 string/number/boolean。优先级：默认值 < 套件 params < case params < 数据行 params < 显式运行 params。未知参数报错。
- `{{ params.name }}`、`{{ outputs.seed.label }}` 只能绑定完整字段；不支持 JS、环境变量、拼接或二次解析。公开文字输入仍经过原限制，密码及敏感输入仍禁止。
- `runFlow: {ref, with}` 引用登记流程，不接受任意路径；必须同平台和 appId，不允许引用环或子流程 hooks。
- `if.condition` 支持 `platform`、`equals: [a,b]`、`visible`、`notVisible`。读取错误不能当成 false。
- `repeat` 使用 `times` 或 `until + maxIterations`；先检查 until，耗尽未满足即失败。每节点最多 20 次、深度最多 5、静态最多 500 个叶子步骤；单 attempt 10 分钟。
- 数据集是最多 100 行 `{id, params}` 的 JSON 数组；套件展开后最多 100 个 case。没有实际执行任何 UI 断言的路径不能通过。
- `done` 只能放在列表末尾，子流程结束不会结束根流程；原生执行器自动补的块尾 done 不作为重复证据步骤。

按“原快照重跑”使用固化的流程、参数和项目文件；“载入此用例重跑”可编辑后使用当前注册项目。旧运行材料不删除。

## 可信代码扩展

扩展是本机登记的自包含 ESM JS bundle（TS 先编译/打包）。运行时模块解析只允许当前 bundle 与 `node:` 内置模块；第三方依赖应打包进 bundle。独立子进程用于超时、取消和回收，**不是安全沙箱**，不要登记不可信代码。扩展不提供设备写入 API，不要绕过工作台建立第二个设备会话。

项目配置示例（合并到 project.json）：

```json
{
  "extensions": {
    "verifyCount": {
      "module": "verify-count.mjs",
      "role": "verify",
      "timeoutMs": 10000,
      "credentials": {"API_TOKEN": "MY_TEST_API_TOKEN"},
      "input": {"type":"object","properties":{"url":{"type":"string"},"expected":{"type":"number"}},"required":["url","expected"]},
      "output": {"type":"object","properties":{"verdict":{"type":"string"},"expected":{"type":"number"},"actual":{"type":"number"},"source":{"type":"string"},"artifactRefs":{"type":"array","items":{"type":"string"}}},"required":["verdict","expected","actual","source","artifactRefs"]}
    }
  }
}
```

`input/output` 是受限 JSON schema：type、properties、required、items、enum，object 拒绝未声明字段。不支持任意 JSON Schema 特性。API 凭据从注册的宿主环境变量单独注入；不把密码写在 YAML。stdout/stderr 不转发到报告，发布结果校验并拒绝包含已知凭据值的输出；不能承诺恶意可信代码无法泄漏主机数据。

```js
// verify-count.mjs：URL 必须是自己的授权测试接口。
export default async ({ url, expected }) => {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${process.env.API_TOKEN}` },
  })
  if (!response.ok) throw new Error('Test API unavailable')
  const { count: actual } = await response.json()
  return { verdict: actual === expected ? 'pass' : 'fail', expected, actual,
    source: url, artifactRefs: [] }
}
```

流程 header 声明 `verify: [{ref: verifyCount, args: {url: ..., expected: 1}}]`。未配置为 not-performed，明确不符为 fail，接口超时/异常/非法输出为 inconclusive。返回的 expected/actual/source 作为扩展 JSON 证据保存并参与哈希校验，`artifactRefs` 不能代替业务来源事实。

准备数据用 `role: prepare`，header 用 `prepare: [{ref: seed, args: {...}, as: seed}]`；其 schema 允许的公开输出可供 UI 绑定。若创建外部资源，注册项声明 `cleanup: clean`，在模块内创建后立刻 `await ctx.registerCleanup(token)`，等待私有 journal 落盘后再继续。`clean` 必须登记为 cleanup，token 必须符合其 input schema；其返回值也需符合 output。多资源逆序清理，准备部分失败、断言失败或取消仍尝试 cleanup。

扩展默认 30 秒，最长 60 秒，输出及日志上限各 256 KiB，资源登记最多 100 条。取消回收进程树后执行独立 30 秒清理预算；清理失败阻止干净通过，并停止套件。强杀后只显示不确定、清理待处理，不自动重放写操作；私有 token 在 `runs/<runId>/private/resources.json`，不通过普通证据 HTTP 公开。

## 隔离、重试和范围

首期单设备串行；每个 case 独立 prepare/verify/cleanup。`reset` 可引用同 App 的登记流程，在每次 attempt 前执行；它不能声明 hooks。默认依赖当前安装 App 的状态，不承诺全新安装级隔离。

默认 retries=0。启用最多一次时必须同时声明 retrySafe=true 和 reset；上次资源清理成功、设备状态明确才继续。第一次失败第二次通过显示 flaky，默认 CI 非零。截图缺失、设备状态不确定或会话切换均不能被重试掩盖。取消停止队列，中断不自动续跑。

实现与验证状态见 [验收记录](https://github.com/qmkCamel/flowassert/blob/main/docs/test-orchestration-validation.md)。Mock、受控接口、打包与真机是不同证据层；不会因为提供了 verifier 入口就宣称某个业务已经验收通过。
