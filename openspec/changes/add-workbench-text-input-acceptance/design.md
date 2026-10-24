## Context
使用 AppClaw 2.7.0 原生结构化 type 定位/聚焦，由 MirrorService 的 WorkbenchDevice 执行实际输入。原生 type 的失败分支会尝试独立 ADB，因此设备调用失败时父进程直接终结 worker，不将错误回复给上游以触发回退。
## Goals / Non-Goals
支持公开文本 replace/append/clear；拒绝模糊目标、密码输入和焦点错位。首轮 Android 第三方 App，iOS 业务场景不以 Android 通过代替。不对模型回复全文做固定匹配，不替代后端数据库校验。
## Decisions
YAML 使用 type: {into: {id: ...}, text: ..., mode: replace|append}，默认 replace。mode 为本机扩展，进入原生 parser 前剥离并按步骤索引保留；禁止标量 type 和秘密插值。父进程核对当前原生 type 步骤后，将已审核 selector、文本和模式传给 facade。输入前在同一独占调用内重新读源，验证唯一可编辑目标、非敏感、聚焦、可见、启用和 bounds，交由 provider 做 active element 重叠检查。
## Risks / Trade-offs
Android 真机发现重新聚焦后 append 只留下后缀；本机 facade 用同一独占操作内读取的现值生成完整写入值，避免依赖选区。合并值再次检查长度。Agent provider 行为未改变，不能用此用例关闭 Agent Android 输入验收。
模型输出非确定性，使用完成状态和非空回复、消息展示为业务断言。若页面无法给出可靠完成标志，保留未验收，不以固定等待充数。持久化只在确认产品支持会话历史后验收。真机原始材料本地忽略，不公开账号数据。
## Migration Plan
新增可选命令，旧 YAML 不变。通过单测、原生 worker 集成、真机正反例及原生门禁后交付。
## Open Questions
真机已确认文字框、发送操作、回复正文、消息底部操作栏和历史列表标识。以这些 UI 条件作为当前验收边界，不等同于独立服务端完成或数据库持久化验证。

## iOS 同边界节点补充（2026-09-15）
真机源树中的 TextView 与外层 Other 容器可具有完全相同的几何。facade 按选中输入元素的非空 identifier、原生类型及几何建立对应关系，仍要求唯一。不能借用同边界其他输入的焦点，也不能用 index 消除规范化节点身份歧义。normalizer 将 iOS TextView/TextEditor 映射为 input，Android 普通 TextView 保持 text；WDA 稳定 active element 的类型校验同步支持多行输入，保留前后身份/几何复核、敏感与可见性检查。

iOS 真机还检出重新聚焦后光标可能位于正文中间。工作台对双端 append 都在独占操作内读取目标现值，生成完整值并按 replace 写入，不依赖光标选区；iOS 仅使用 value，空值不得使用 label/text 代替。Agent provider 原有 append 语义不变。
