## Purpose

为失败分诊建立可重复的错误归因防护和非作者诊断收益评测，明确软件门禁、真实设备验证与独立用户采用各自需要的证据，防止仅以生成摘要、测试数量或演示成功替代产品价值验收。

## ADDED Requirements

### Requirement: Versioned adversarial corpus
验收 SHALL 使用至少 120 个脱敏场景，开发集与冻结验收集各至少 60 个，按 App/页面/失败模板族隔离；冻结集包含四类单方向、unknown/不适用、多方向混合六组且每组至少 10 个。每例登记期望方向集合、事实与假设边界、必需证据、禁止结论及安全检查建议，生产分类不得读取答案。

#### Scenario: Similar symptom different cause
- **WHEN** 相同 element-not-found 症状分别来自 ID 改变、页面未打开、遮挡、证据损坏和真实控件删除
- **THEN** 测试以各自证据确定不同的可接受输出，不允许统一判为定位器变化

### Requirement: Deterministic safety and usefulness gates
同输入和规则版本的语义结果 SHALL 一致，所有安全反例必须通过；未知/坏证据被确证为产品缺陷、自动改变 verdict、未授权读取或自动写操作均为零容忍。冻结集非 unknown 方向的微平均 precision SHALL 至少 95%，金标准可判定方向的微平均 recall SHALL 至少 80%；同时公开分组结果、abstain/partial 比例及失败样本，不能靠全部 unknown 达标。

#### Scenario: Conservative but useless classifier
- **WHEN** 系统没有错误归因但对全部可判定样本输出 unknown
- **THEN** precision 标记无可计算预测，recall 为零，工程有用性门槛不通过，不宣称安全即优秀

### Requirement: Non-author controlled five-minute evaluation
产品分诊验收 SHALL 至少招募 5 名不是样本作者、规则实现者或答案标注者的参与者；使用相同归档的现有 Viewer 与新分诊流程做平衡顺序对照，不对同一参与者重复展示相同或同族样本。新流程在冻结集 60 个任务中至少 48 个须在 5 分钟内选对完整处理方向、定位关键证据并指出限制；超时/放弃计失败，不从分母剔除。

#### Scenario: Fast but unsupported answer
- **WHEN** 参与者在五分钟内猜中方向但未定位金标准所需证据或把假设称为已确认根因
- **THEN** 该任务不计成功，记录为缺依据或过度归因

### Requirement: Measured benefit and separate adoption claims
评测 SHALL 记录从打开运行详情到完成回答的端到端时长、点击/求助、方向与证据准确性，失败/超时按五分钟上限计入对照耗时；新流程中位有上限完成耗时须比现有 Viewer 降低至少 30%，且五分钟成功率不降低。不足样本/用户/周期保持 pending，不替代既有三团队四周长期采用门槛，不将时间改善当作统计显著性或通用优越性。

#### Scenario: No independent participants
- **WHEN** 只有实现者使用 Mock 完成演示与 E2E
- **THEN** 可以登记软件验收，非作者收益和长期采用仍未验，不以作者熟练度填入盲测结果

### Requirement: Device host and interruption acceptance
发布候选 SHALL 在同一 tarball 上验证旧比较入口兼容、新 Viewer/CLI/MCP/DSH `0.1.5-rc.2` Native/PTC 的投影与权限、归档只读及新报告重启；Android/iPhone 各覆盖四方向、无基线、混合/缺证的登记样本。真实故障不能安全注入时必须标明录制或合成来源，不外推为真机通过；既有 DSH 生命周期阻塞须独立解决和复验。

#### Scenario: Software and device evidence differ
- **WHEN** 两平台合成语料通过但某平台真实签名或断线样本未获得
- **THEN** 软件矩阵显示通过，真实设备对应项保持未验并列出所缺材料，不改变其他已通过项

### Requirement: Auditable acceptance record
验收报告 SHALL 保存源码/包 SHA、规则与语料版本、测试命令、分母/失败样本、匿名参与者角色、分配顺序与原始时间记录；公开材料必须脱敏且获得授权。任何 gate 未通过必须列为未完成，规划文件或历史命令记录不得当作当前实现验证。

#### Scenario: Holdout used for tuning
- **WHEN** 根据冻结集的失败结果修改分类规则
- **THEN** 原冻结集只保留为回归材料，另建独立冻结集后重新验收，不继续用同一批答案宣称未见样本效果
