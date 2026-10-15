# macOS arm64 打包验证

验证日期：2026-10-15。未修改 `src/`，未提交 Git，未新增 npm 依赖。

## 图标与构建

- `icon.svg`：1024 画布、824 像素连续圆角底板、透明边距和轻微阴影；蓝色主节点通过柔和曲线连接玫红、青绿、橙色节点。
- `pnpm icon`：调用现有 Electron 离屏渲染，再由系统 `sips`、`iconutil` 生成 PNG 和 ICNS；临时 iconset 自动清理。
- 已查看 1024 和 16 像素 PNG，检查全部外缘及四角透明度，无裁切。ICNS 反向解包后包含 16/32/128/256/512 及全部 @2x，共 10 个尺寸。
- `mac.icon` 指向 `build/icon.icns`；开发态 Dock 从 `app.getAppPath()/build/icon.png` 加载；打包态使用应用包内图标。
- 已查看 NSWorkspace 为 Finder 提供的图标，以及 NSRunningApplication 的运行中应用图标，均包含新图案。macOS 26 会自动叠加系统图标底板；未清理系统缓存。
- 直接屏幕截图命令返回无法从显示器生成图片，改用上述系统图标 API 和包内 ICNS 检查完成验证。

## 瘦身前后

MiB = 1,048,576 字节；逻辑体积不重复统计框架符号链接。

| 项目 | 原始逻辑体积 MiB | 新逻辑体积 MiB |
| --- | ---: | ---: |
| .app | 289.19 | 242.90 |
| DMG | 122.53 | 102.96 |
| ZIP | 122.62 | 111.08 |
| Frameworks（含语言资源） | 287.21 | 240.85 |
| 语言资源 | 48.03 | 1.67 |
| app.asar | 1.57 | 1.23 |

`.app` 的 `du -sk` 磁盘占用从 **319.13 MiB** 降至 **261.57 MiB**。原始文件字节数：DMG 128,485,016 → 107,965,082；ZIP 128,572,406 → 116,474,225。

原始 ASAR 已仅包含 `dist/`、`dist-electron/`、`package.json`，无 `node_modules`，因此保留依赖分类和现有依赖排除规则。主进程仍将服务端代码打入单文件。此次启用主进程压缩、禁用 source map、排除 `.map`、设置安装包最大压缩，并将 220 个语言目录缩至 `en.lproj`、`zh_CN.lproj`、`zh_TW.lproj` 三个。

新 ASAR 内容再次检查通过，所有文件 SHA256 均与归档内完整性记录一致。Electron Framework 二进制 SHA256 与原始 Electron 分发一致，未裁剪二进制。

## 验证结果与范围

- `pnpm icon`：成功。
- `pnpm test`：3 个测试文件、43/43 测试通过。
- `pnpm typecheck`：成功。
- `pnpm dev`：Vite 和服务端均成功启动，前端与 `/api/agent` 返回 200，随后正常停止。
- `pnpm start`：成功启动，`/` 和 `/api/agent` 返回 200，随后正常停止。开发和生产服务冒烟均使用临时 DATA_DIR。
- `pnpm dist`：成功生成 arm64 .app、DMG、ZIP 及 blockmap。
- 启动前 `lsof` 确认原占用者为项目旧版 .app，使用 AppleScript 正常退出；新包启动前再次确认端口空闲。
- `open release/mac-arm64/人脉图谱.app` 后，`/` 和 `/api/agent` 均为 200；监听进程路径确认为新产物。验证后使用 AppleScript 正常退出，`lsof` 确认 3789 已释放。
- 包内 `CFBundleIconFile=icon.icns`，与源 ICNS 逐字节一致；`sips -g all` 确认 1024×1024、带透明通道。

环境：macOS 26.7 arm64，pnpm 10.30.2，electron-builder 26.15.3；Electron 44.7.2、Chromium 152.0.7977.149、内置 Node 24.21.0、V8 15.2.124.37-electron.0。

变更限于图标资源、生成脚本、构建配置和主进程开发态 Dock 图标入口。main 承担本地服务和系统窗口；preload 仅暴露平台信息；renderer 使用本地页面。现有默认 session、窗口隔离（contextIsolation/sandbox 开启，nodeIntegration 关闭）、IPC/文件/外链权限边界均不涉及此次改动。无新增原生模块、系统权限、协议或自动更新入口。

产物沿用项目 `identity: null` 设置，未签名、公证；未执行自动更新或 Windows/Linux 验证，本次目标仅为 macOS arm64 本机打包与启动验证。
