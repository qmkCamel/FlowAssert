## Purpose

为团队采用本机移动测试工作台提供范围受控的业务模板、版本兼容与升级证据、可追溯的能力文档，以及独立长期使用的验收口径，使工程完成和实际采用收益分别可核对。

## ADDED Requirements

### Requirement: Scoped trusted business templates
团队模板 SHALL 复用可信注册 worker，端点/凭据在本机登记、Agent 只选允许的用例；prepare/verify/cleanup 使用任务级命名空间和私有 cleanup token，有超时/响应大小限制。模板 MUST 明确非沙箱，未知写入结果不自动重放，不清理外部资源。

#### Scenario: Business write times out
- **WHEN** HTTP prepare 已发送但返回超时
- **THEN** 报告结果未知并依登记策略核对/清理，不盲目重试业务写入

### Requirement: Versioned support and upgrade evidence
候选版本 SHALL 关联源码/包 SHA、能力、支持矩阵和兼容记录，验证前一支持版本升级及只读回退；问题分享需用户检查脱敏材料并显式提交。无法识别的新格式 MUST 明确拒绝而非覆盖或降级重写。

#### Scenario: Roll back with newer archives
- **WHEN** 用户回退到不识别 v2 的旧版本
- **THEN** 新包文件保持不变，旧程序明确不支持，旧格式历史仍可读取

### Requirement: Sustained independent team adoption
采用验收 SHALL 记录至少 3 个外部团队连续 4 周的实际回归、求助次数和诊断/维护工时；至少 80% 盲测失败样本在 5 分钟内正确分类并定位证据，不要求自动根因。缺团队/周期 MUST 保持未验，不用 star、Fixture 或演示次数替代。

#### Scenario: Engineering finished without longitudinal use
- **WHEN** 功能和自动化门禁完成但只有一周试用
- **THEN** 工程完成可单列，持续采用门槛保持 pending

### Requirement: Traceable capability and architecture documentation
当前能力说明、架构图、路线图与 TODO SHALL 区分规划、工程实现、Mock/自动化验证、真机验证、采用验证和已发布资产，标注适用日期/版本并指向实际记录。内部模块抽取 MUST 保持已有公开 HTTP/CLI/Agent 契约；新增异步导出协议须显式选择。主机和设备支持不能从软件模拟结果外推，历史报告不得因文档更新而被改写为新版本已通过。

#### Scenario: Reliability implementation precedes external pilots
- **WHEN** R0—R6 的工程任务通过，而两版自研 App 或外部团队周期尚未取得
- **THEN** 文档 SHALL 明确工程能力和未验采用门槛，父 change 继续保留未完成任务，不把完整方案或新架构图当作验收证据

#### Scenario: Internal handler and panel extraction
- **WHEN** HTTP handler、运行阶段或 Viewer 面板被抽取到独立模块
- **THEN** 原 URL/方法/授权、错误码、结果含义和已保存记录 SHALL 保持兼容，并通过实际慢任务交互和公共契约回归核对
