# ADR 0014: Worker 退出与内置引用生产者收口

状态：Accepted。日期：2026-10-01。基线：REDACTED_REVISION。延续 ADR 0011–0013，不引入容器、调度框架或数据库。

## 决策

`workbench-worker-lifecycle` 只管理实际退出与单结果计算。comparison、analyzer、visual、share-image、native parser 使用单结果封装；native streaming 保留自己的协议、设备调用队列和步骤检查点，使用同一退出所有权。terminate 成功或失败都等待 exit；失败在 exit 后报告，exit 永不到达则保持等待，不伪造安全释放。native 同时等待已接受的设备调用结束。取消胜出后不接受迟到成功，清理监听器与计时器。

suite、run-backed baseline、Agent flow、pin、child 使用按目标 run ID 分组的 publication marker，每项保存现有 v3 ledger 身份。所有写入经 Store mutation gate：先发布保护，再持久化消费记录；先提交退休 marker，再撤销该 owner 的引用。正常重试复用活跃身份，重新激活已退休 pin 使用新身份。失败可留下保守的孤儿引用，不自动猜测并删除。旧记录继续使用旧扫描，无批量重写。

| 消费者 | 发布点 | 退休条件 |
| --- | --- | --- |
| suite | 持久化 attempt 列表前 | 显式 freeze 且已验证的 frozen facts 持久化后；失败可重试 |
| baseline | 已审核 run 图像的 approval 记录前 | 不自动退休；源 manifest/image hash 仍严格复验 |
| Agent flow | run 创建后、打开执行门前 | 既有 verified terminal projection；尚无 run 的 accepted 请求由持久 UUID 预留保护 |
| pin | pins.json 和 pin-references.json 提交前 | unpin 的退休记录持久化后；双文件中断不放宽删除 |
| child | 首次 child manifest 提交前 | 仅 purge；移入 trash、恢复和中断均保持父运行保护 |

suite/Agent 的目标可能仍在执行，sourceHash 表示发布时观察到的 manifest，而非承诺其永不变化；marker 身份与 ledger 副本必须一致。baseline 仍要求当前 hash 等于批准时 hash。子运行 marker 随 cleanup journal 保留，purge 及恢复流程完成退休重试。

Agent 记录发布失败不得因 finally 打开执行门而意外运行：先取消，再放行以排空任务。终态写盘失败由状态报告 `persistence: failed`、操作结果 inconclusive，并在 close 聚合报错；原始 run verdict 不重写，不能将其独立投影误当成请求持久化成功。

## 兼容与安全

suite 与 Agent 在新 run 创建后均先关闭执行门，完成引用与消费记录发布才允许运行，避免 manifest 在 sourceHash 复核之间变化。suite 发布失败先取消再打开门排空，不允许未登记的 attempt 继续操作设备。

新 marker 缺失、身份不符、活跃目标不符或损坏时清理失败关闭；没有 marker 的旧格式保守扫描继续生效。旧 reader 可读取 v3 ledger 并保护未知 consumer；旧 pin writer 不理解新 marker，可能造成两份元数据不一致，此时新版阻止清理，显式重试 pin/unpin 恢复一致性。严格旧 baseline reader 可能拒读新增字段，这是保守拒绝，不应删除字段绕过。

引用持久化失败留下的无主保护项可能需要人工诊断；本轮不提供未经证明的自动 GC。Worker 不是代码安全沙箱。无新监听、权限、宿主注册方式或 agent-loop 修改。

## 验收边界

见[本轮验收](../worker-reference-governance-validation.md)。覆盖软件故障注入、重启、mock 宿主与浏览器，不代表全部磁盘断电组合或任意历史版本认证。按用户要求暂缓真机验收。查询索引、第二引擎和动态插件体系仍是独立需求，不属于本次可靠性/引用收口。
