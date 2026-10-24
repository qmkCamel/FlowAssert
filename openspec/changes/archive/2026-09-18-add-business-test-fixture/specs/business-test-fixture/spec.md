## ADDED Requirements
### Requirement: Independent persistent business fixture
夹具 SHALL 用独立 UUID 隔离每轮数据，只有 App 业务提交接口创建订单，查询 MUST 读取持久化真值。
#### Scenario: Restart after submission
- **WHEN** 手机提交成功后重启服务
- **THEN** 独立查询仍能读取相同订单编号、商品和金额

### Requirement: Repeatable cleanup and negative verification
验收 SHALL 覆盖真机正例及错误期望反例，所有结束路径执行登记清理，保留 PNG/XML 与业务材料。
#### Scenario: Wrong expected amount
- **WHEN** UI 成功但 verifier 期望金额错误
- **THEN** 业务和运行失败，清理完成且材料仍可追溯

### Requirement: Native responsive clients and explicit networking
双端 App SHALL 使用原生可访问控件，网络时显示进度并保留最后结果；服务 MUST 默认 loopback，LAN 必须显式配置。
#### Scenario: Slow submission
- **WHEN** 提交超过 300 ms
- **THEN** 显示提交进度，帮助按钮仍可操作，失败不删除上一成功结果
