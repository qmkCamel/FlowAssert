# Android 命令链路排查（2026-09-17）

当前结论：超时可以在没有 Appium、没有模型调用时复现，已定位到 ADB 命令通道层；尚未确定是线材、接口还是手机端 adbd。设备列表在线不代表 shell 可用。

## 已记录基线

设备 OnePlus 8T / Android 14，显式序列号 `2d50703c`，ADB 37.0.1。只读探针顺序执行 10 轮，每条命令独立限制 5 秒；不重启 ADB、不重连、不改变手机设置。

证据目录：`artifacts/physical-validation/android-link-2026-09-17T12-18-01.807Z/report.json`（本地产物）。

| 命令 | 成功 | 超时 | 观察 |
| --- | --- | --- | --- |
| get-state | 10/10 | 0 | 始终返回 device，15–33 ms |
| shell echo | 7/10 | 3 | 前三轮超时，第四轮 1518 ms，之后 45–55 ms |
| shell getprop API level | 7/10 | 3 | 前三轮超时，之后 48–65 ms |

相同连接未经人为干预自行恢复。该结果排除了“必须先发生模型或 Appium 调用才超时”的解释，不能单凭它证明 USB 线损坏，也不能排除手机端进程、USB 传输或主机 ADB 问题。

## 对照方法

```sh
MOBILE_MIRROR_ANDROID_SERIAL=2d50703c MIRROR_LINK_LABEL=current-usb pnpm exec tsx scripts/android-link-probe.ts
```

每次生成独立报告，不覆盖旧失败。标签只描述操作者已实际确认的接线条件。先结束当前设备会话，再做只读基线；探针不自动关闭他人的 Appium。

1. 保持同一手机、接口、解锁状态，换一根确认可传数据的线，运行相同 10 轮。
2. 保持新线，改为直连电脑或换电脑接口，再运行相同基线。不要同时更换多个因素后宣称定位到线材。
3. 若仍超时，再比较同线同接口的另一台 Android；必要时对照手机重启前后。此类设备操作需明确安排，不能靠扩大超时掩盖故障。
4. 只有命令通道稳定后才跑 Appium/恢复矩阵，区分建会话、取图/树、模型和动作阶段耗时。

目前换线/接口对照尚未完成。连续成功一次仅是恢复迹象；不能据此把历史间歇故障标为已修复。

## 更换手机对照：2026-09-17 20:27

用户更换为 PLA110 / Android API 36（序列号 `3B6F6CE61QJ0UM2Q`）。相同探针 10 轮共 30 条命令全部成功，14–50 ms，无超时。报告：`artifacts/physical-validation/android-link-2026-09-17T12-27-26.064Z/report.json`。

此结果说明当前新手机连接可稳定完成本轮短基线，支持继续 Appium 验收。用户只确认更换手机，未确认线材/接口是否保持不变，因此不把它写成严格单变量实验，也不据此断言旧手机硬件损坏。

新手机首次 Appium 启动另外遇到 `io.appium.settings.ForegroundService` 的 location 权限 SecurityException，建会话失败（12:28:40Z，cases=0）。为辅助包授予 coarse/fine location 并在系统弹窗确认后解决；12:29:23Z 被待确认弹窗遮挡的启动同样 cases=0，保留失败记录。这是辅助 App 权限配置问题，与旧手机 shell 超时分开统计。

之后完整恢复矩阵 36/36 符合预期、402 份证据重启复验通过。Appium 退出后再次运行同一只读基线，30/30 成功，16–75 ms；报告：`artifacts/physical-validation/android-link-2026-09-17T12-33-35.235Z/report.json`。新设备在本轮测试前、测试中与测试后均未出现旧故障；旧设备根因仍未确认。
