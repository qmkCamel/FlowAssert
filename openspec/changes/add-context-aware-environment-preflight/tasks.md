## 1. 上下文与报告契约

- [x] 1.1 定义入口、操作、provider、平台和功能策略的类型与参数规范化；覆盖 codex 别名、无参 runtime、显式 platform 兼容映射及非法组合在 I/O 前拒绝。
- [x] 1.2 实现纯检查计划与去重；逐项测试四种入口及 report/mock/connect/test 的命令、HTTP、元数据访问允许/禁止矩阵，覆盖显式 all 与最大组合预算。
- [x] 1.3 实现 Doctor v2 schema、依赖角色、能力分项、完成时间及 ready/blocked/incomplete 聚合；覆盖必要项未知、下游跳过、preferred 降级和稳定错误码。
- [ ] 1.4 从已登记 flow/suite 和项目策略推导 test 前提；拒绝任意测试路径、禁止 off 降低必需断言/录制要求，验证不运行 flow、hook 或模型。

## 2. 共享只读检查与执行边界

- [x] 2.1 从 doctor 与连接助手提取可注入的基础、Appium、Android、iOS 检查叶子，保留既有版本限制与显式 host command discovery 规则。
- [x] 2.2 增加最多 32 项、并发 3、60 秒总预算、20 秒单命令上限及输出限制；测试超限、依赖跳过、独立检查继续执行和取消后的零新派发。
- [x] 2.3 接通 AbortSignal、固定 argv 与 loopback HTTP；验证无 shell、无外部进程终止、runtime/report/mock 无设备命令及 Appium 请求。
- [x] 2.4 实现结构化脱敏和有限只读报告/store 检查；测试敏感 canary、异常/输出超限、路径不可达、无全盘扫描与无配置写入。

## 3. DSH 精确目标检查

- [x] 3.1 增加仅 dsh 入口可用的显式 executable/profile 输入、可信绝对路径校验和 canonical identity；非 DSH 入口拒绝相关参数且不读取宿主材料。
- [x] 3.2 经固定 `--version` 检查精确 0.2.0-rc.2；覆盖错误 rc、未来版本、非正常退出、额外输出、超时与多安装 PATH 干扰，不回退另一份安装。
- [x] 3.3 实现选定 profile 下有限的插件登记和有效 peer 元数据解析；覆盖标准 symlink、混装、缺项、循环、字节/深度预算与动态不可判定状态，不 import/eval 包。
- [x] 3.4 接入适配器可验证的宿主上下文并保留 peer 装载拒绝；缺可靠信息返回 incomplete，不引入 ctx 私有字段、agent loop 补丁、config dump 或自动 clean-profile。
- [x] 3.5 增加负向子进程/文件访问测试，证明非 DSH 入口完全不调用 DSH，预检不启动 Web/Agent、不安装、不读取或回显密钥。

## 4. 可选能力与操作门禁

- [x] 4.1 实现媒体 off/preferred/required 选择，覆盖 Android PNG/scrcpy 降级与必需媒体阻塞；iOS MJPEG 标明 session 后验证，不启动 WDA。
- [x] 4.2 复用 OCR 只读诊断和 AI 恢复策略/凭据可用性检查，覆盖未选能力零访问、无 prepare/编译/模型请求以及必需能力不可静默降级。
- [x] 4.3 增加浏览器录制 API/MIME 前提检查；无采集/录制副作用，服务器不伪造浏览器结果，无头与必需浏览器录制冲突明确拒绝。

## 5. CLI 与 Viewer 接入

- [x] 5.1 接通 CLI 的入口/操作/能力及 DSH 参数，更新帮助、v2 JSON/文本输出、退出码 0/2/1/130；迁移所有 doctor 消费者及旧默认 all 测试。
- [x] 5.2 核对附着已有 Viewer 与独立无头任务的实际执行上下文，避免把 CLI 本机预检当作另一运行实例的就绪凭证；报告不授予项目/设备执行权限。
- [x] 5.3 Viewer 连接助手与能力入口使用共享计划；报告/Mock 不增加环境门禁，DSH 宿主准备与手机连接分开，不增加 MCP/DSH 工具或连续视频结果。
- [x] 5.4 保留 deviceRef 的 TTL/single-use、同源校验、helper/签名确认与 MirrorService owner；新增 HTTP 输入若有须有有限 schema、可信服务端配置及 requestSignal，禁止传任意命令和 profile 路径。
- [x] 5.5 按 user-action-contract 实现局部 pending/进度/取消、失败保留上次报告与画面、真实完成时间；上下文切换取消旧请求并以 generation 拒绝晚到结果。
- [x] 5.6 增加至少 800 ms 等待期间的浏览器交互测试：检查仍可切主题/看历史、禁止重复提交、取消与超时可恢复、失败保留材料；保存并人工检查桌面/窄屏运行截图。

## 6. 无真机验证与文档迁移

- [x] 6.1 完成矩阵单测、真实受控子进程测试与 fake Appium HTTP 测试；覆盖完全没有 DSH/手机工具的 report、Mock、MCP 基础环境，禁止把 fixture 结果标为真机验收。
- [x] 6.2 用同一构建 tarball 运行四入口隔离探针，验证包内文件/依赖完整、CLI v2 输出、非 DSH 隔离及错误 DSH 目标的稳定失败；记录版本、命令和结果。
- [x] 6.3 更新 README、安装/doctor、MCP、DSH、Viewer、无头任务及有关示例，明确默认值和 JSON/退出码 breaking 迁移、无关项不展示、预检不等于连接/模型验收。
- [x] 6.4 运行严格 OpenSpec 验证及 `pnpm check`、`pnpm test:e2e`、`pnpm build`、`pnpm pack:check`；单列基线 Git 历史扫描失败，不改历史或放宽规则来获得绿灯。

## 7. 独立真实环境验收与收尾

- [x] 7.1 在明确选定、可授权的 DSH 0.2.0-rc.2 干净 profile 验证预检与真实插件装载，并核对目标身份一致；安装/启动是独立验收动作，不加入用户预检路径。缺宿主/授权时记录具体阻塞，不阻止其他可推进任务。
- [x] 7.2 在可用且无冲突的 Android/iPhone 上分别进行只读连接准备抽样，核对设备状态与报告；不连接会话、不申请签名、不操作业务 App，未授权材料保持待确认。缺设备/授权时分别保留未完成项，不用历史或 Mock 替代。
- [x] 7.3 对照每项任务登记实现路径、测试和证据，区分确定性测试、打包、浏览器、真实宿主与真机结果；推进所有可独立完成的任务，剩余项逐条列出具体前提，未全部验收不得宣称变更已完成。
