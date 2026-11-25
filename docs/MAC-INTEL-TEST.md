# PD Impression — High Sierra Intel 兼容测试版

目标：iMac (21.5-inch, Mid 2011)、Intel 四核 i5、8GB 内存、macOS High Sierra 10.13.6。
分支：`compat/high-sierra`。原 `main` 和原版安装包独立保留。

## 当前交付状态

本次在 Windows 上适配并测试 Electron 26。Mac 的 Sharp 与 libvips 官方预编译库已下载、检查，二者均为 x86_64，最低系统标记均为 10.13.0。尚未在 macOS 上构建签名 DMG，也未在目标 iMac 实测。`High-Sierra-source.zip` 是源码构建包，不能直接安装。

## 为什么选择这组依赖

| 组件 | 固定版本 | 依据 |
| --- | --- | --- |
| Electron | 26.6.10 | [官方版本信息](https://releases.electronjs.org/release/v26.6.10)：内置 Node.js 18.16.1、Chromium 116；[Electron 27 起取消 10.13 支持](https://www.electronjs.org/blog/electron-27-0) |
| Sharp | 0.32.6 | [该版本安装文档](https://github.com/lovell/sharp/blob/v0.32.6/docs/install.md)明确支持 macOS x64 >=10.13、Node.js >=14.15 |
| libvips | 8.14.5 | [Sharp 0.32.6 配置](https://github.com/lovell/sharp/blob/v0.32.6/package.json)指定的预编译库及完整性校验值 |

新旧应用使用不同名称、应用标识和设置／缓存目录。兼容版默认导出宽度 8000px，图片任务串行，Sharp 并发为 1、缓存 48MB。6000／10000px 仍可选，实际速度和内存需目标机测量。

## 在另一台 Intel Mac 上构建

构建机须能运行 Node.js 24，推荐与工作流一致的较新 Intel macOS。不要在 10.13.6 目标机上安装 Node.js 24。也不要复制 Windows 的 node_modules 到 Mac。

1. 将源码包解压到一个新的文件夹，保留原版文件夹。
2. 在构建 Mac 安装 Node.js 24；首次下载依赖需要联网。
3. 在终端进入解压目录，执行：

```sh
bash build-high-sierra.command
```

脚本会依次执行 `npm ci --include=optional`、单元测试、构建 DMG、架构／最低系统／ad-hoc 签名检查和打包应用测试，再验证 DMG、生成 SHA256。任何一步失败都会停止，不能把未验证产物当作通过。

期望输出：

```text
release/PD-Impression-0.1.0-hs.1-High-Sierra-Intel.dmg
release/SHA256SUMS.txt
release/MAC-INTEL-TEST.md
```

应用名为 **PD Impression High Sierra**，应用标识为 `studio.pdimpression.highsierra`。脚本只构建本地产物，使用 `--publish never`，不会推送 Git 或创建 Release。

仓库另保留仅手动触发的 **Build High Sierra Intel test installer** 工作流，目标为 `macos-15-intel`。本次没有上传分支或触发工作流。如以后选择它，必须先另行授权推送。

## 在旧 iMac 上安装和验收

1. 将经过构建验证的 DMG 拷贝到旧 iMac，打开并把 **PD Impression High Sierra** 拖到“应用程序”。保留原版，不覆盖它。
2. 此测试包预期为 ad-hoc 签名，无 Developer ID 和公证。若系统拦截，确认是自己的构建后，可在 Finder 中按住 Control 点击应用并选择“打开”，或检查“系统偏好设置 → 安全性与隐私 → 通用”。若仍提示损坏，保留完整错误，不关闭系统安全功能。
3. 先导入一张暗房真实 TIFF，确认方向、颜色、中文名称及预览。
4. 先按默认 8000px 导出 JPEG；若内存或耗时不理想，可手动选择 6000px。检查 ICC、尺寸、文件大小和文字，确认原 TIFF 没有改变。
5. 逐步测试整卷、整条 TIFF、16 位 TIFF、带 ICC／不带 ICC、手动旋转、11 种扫描模板。
6. 验证任务排队和取消、多项目切换、项目保存／重开。旧项目先复制一份再打开，以新文件名保存测试结果；跨版本项目互用尚未以历史真实样本验证。
7. 在“活动监视器”记录导入／导出耗时、峰值内存和是否有黑屏。若黑屏，可先尝试只为本应用禁用 GPU，不修改系统：

```sh
open -a "PD Impression High Sierra" --args --disable-gpu
```

默认没有禁用硬件加速。若需要上述参数才能正常运行，应记录现象后再决定是否调整默认配置。

目标电脑只需要安装应用，不需要 Node.js、npm 或 VS Code。

## 验证边界与维护限制

- Windows 测试证明旧版 Electron、Sharp 和应用代码能够配合，不能证明 macOS 的文件选择器、字体、驱动和签名均正常。
- 原生库的最低系统标记符合目标，不等于完整应用已在 10.13.6 启动；Mac 构建还会扫描所有 Mach-O 文件并核实依赖版本、签名。
- Electron 26 已结束支持。2026-11-25 的 `npm audit --omit=dev` 报告 Sharp 有 high 风险项，关联 libvips、libheif、librsvg；仅靠升级配置无法同时满足旧系统与最新上游安全版本。
- 当前应用保持离线处理、sandbox 和 contextIsolation，仍不意味着旧依赖漏洞已经消除。该包仅作为可信本地扫描文件的兼容测试用途。
- 不自动执行 `npm audit fix --force`，不承诺旧机性能，不对原版 main 做任何降级。
