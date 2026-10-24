# workbench-flow-composition Specification

## Purpose
为本机移动回归提供统一格式的流程组合能力，让用户通过类型参数、有限控制流和公共子流程维护多组测试数据，并可从每份证据追溯实际执行路径。

## Requirements

### Requirement: Typed composition
系统 SHALL 在当前 YAML 中直接支持类型参数、完整字段绑定、注册子流程和 JSON 数据行；未知变量、错误类型和依赖循环 MUST 在设备动作前拒绝。

#### Scenario: Invalid referenced input
- **WHEN** 引用子流程存在循环或参数类型错误
- **THEN** 运行被拒绝且设备没有动作

### Requirement: Bounded observable control flow
系统 SHALL 支持结构化条件和有界重复，记录条件 observation、分支、迭代和源步骤路径；查询失败 MUST NOT 当成条件 false，循环耗尽 MUST 不通过。

#### Scenario: Observation query fails
- **WHEN** 判断元素是否可见时设备读取失败
- **THEN** 结果为 inconclusive，两个分支均不执行

### Requirement: Nonempty verification and immutable inputs
系统 MUST 固化全部依赖和公开数据的快照与哈希，运行路径至少执行一个 UI 断言才允许 pass；数据 MUST NOT 二次解释为指令。

#### Scenario: Skipped assertion
- **WHEN** 条件分支使所有断言被跳过
- **THEN** 该运行不可标记 pass，报告说明未实际执行断言

### Requirement: Cancellation preserves evidence barriers
组合流程 SHALL 继承动作互斥、步骤证据屏障与取消规则，取消后 MUST 不派发下一叶子动作。

#### Scenario: Cancel nested loop
- **WHEN** 循环步骤执行中用户取消
- **THEN** 保留当前材料及逻辑路径，停止后续迭代并显示取消进度
