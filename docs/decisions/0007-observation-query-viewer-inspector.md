# ADR 0007：Observation 查询与本机 Viewer Inspector

- 状态：Accepted（源码边界、本地测试与 Android/iPhone 真机已复核，打包宿主层已于 2026-09-16 独立补验）
- 日期：2026-09-15
- 前驱：ADR 0002、0005、0006

## 决策

Agent 通过第十项工具 `mobile_mirror_query_screen` 对仍保留的 observation 执行 find/get/subtree。共享纯模块采用 AND 字面匹配、原顺序分页和 64 KiB 完整输出预算，不访问 provider、不续期、不改变 revision/epoch。summary inspect 仍捕获和保存完整规范化结构，仅缩减宿主投影。历史结果可读不等于可执行；actionBinding 提示原严格动作校验的限制，不构成授权。

Viewer 显式捕获独立 inspection，以自己的随机身份和 generationToken 关联 PNG/结构。它共用 provider 捕获互斥与工作台运行租约，不进入 Agent store、不生成 attachment；本机查看不会修改 Agent 分享策略。HTTP 只接受精确 Origin 的 JSON 空对象，限制 PNG、结构、像素和整体响应，并关联 response close 与总时限取消。服务端没有第二个截图缓存或下载目录。

冻结表面固定 contain，节点几何只使用同次 inspection 的 viewport 与 PNG。实时渲染器独立继续运行，节点选择、查询、翻页、主题与缩放不会产生设备动作。坐标比例不一致关闭 overlay；无障碍结构和截图按顺序采集，不能保证原生原子性或真实 hit-test。

浏览器保留最多一份有效结果和一个候选；刷新失败保留原结果，generation 变化立即清理，epoch 变化标历史，TTL 最多 60 秒。所有动态文字使用 textContent；敏感节点字段脱敏不代表图片像素脱敏。

## 取舍

复用 ViewInspectKit 的按需查询与几何检查思路，不引入 SDK、白盒属性或第二套设备控制。一次本机 Base64 响应便于整体替换，但有内存放大，因此只允许一个捕获/发送任务且不持久化。默认 full inspect 向后兼容；summary/query 对大结构有价值，但不能减少第一次 source 采集成本。

## 验证边界

详见 [Inspector 验证记录](../inspector-validation.md)。Mock、HTTP/fake、打包宿主与真机分别记录；未执行的层次不声明通过。发布和主规格归档属于独立交付动作。

## 2026-09-16 宿主 schema 验收补充

真实 DSH rc.1 编译器拒绝联合根同时声明 type/oneOf。适配层递归省略联合根的冗余 type，保留分支约束，MCP 契约不变。新增真实 defineTool 十工具注册回归，同 tarball 全新 profile Native/PTC 与 query 零图片增量通过；不再以伪造注册函数的单测代替宿主编译验收。
