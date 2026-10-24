# 模拟器连接向导

## Why

Appium 支持模拟器，但 Viewer 向导只发现 USB 真机，iOS 强制签名检查阻断无签名模拟器接入。

## What Changes

- Viewer 显式选择真机或模拟器，默认保留真机；切换后原检查失效。
- Android 仅发现 ADB 已在线的本机 emulator；iOS 仅发现已启动且可用的 iOS Simulator。
- iOS 模拟器独立检查 Xcode 和 simctl，不要求 Team ID，不继承真机签名或注册配置。
- 连接前重查同一设备，通过共享 MirrorService 使用现有截图、控制及工作台。

## Impact

涉及连接向导、Appium 配置合并、Viewer 与文档。只读检查不启动、安装、擦除或关闭模拟器；连接阶段仍可能部署自动化辅助程序。模拟器证据不替代真机验收。
