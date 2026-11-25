# PD Impression — Apple Silicon 测试版

开发分支：`feature/apple-silicon`。目标：M 系列芯片 Mac，最低系统声明沿用主线的 macOS 13.7.1。

本分支增加原生 ARM64 打包；继续使用 Electron 45.3.2、Sharp 0.35.5，功能代码、默认 **8000px**、图片任务并发和项目格式保持原样。原版 `main` 与旧系统专用 `compat/high-sierra` 不受影响。

## 当前状态

配置和本机检查已准备。本次未推送、未启动 GitHub 工作流、未创建 Release，没有生成或宣称验证了 ARM64 DMG。Windows 上的测试不能代替 M 芯片 Mac 运行验证。

2026-11-25 的本地验证记录：

- 类型检查、生产构建和 80 项单元／集成测试通过。
- 使用 npm 11.17.0，在空目录按 `darwin/arm64` 安装全部 373 个依赖成功。由于宿主为 Windows，该项检查禁用安装脚本；Mac 安装脚本和实际运行仍由云端检查。
- 下载的官方 Electron 45.3.2 ARM64 包中，8 个检查到的 Mach-O 二进制最低系统为 13.0；Sharp 0.35.5 和 libvips 8.18.7 的 ARM64 二进制最低系统为 11.0。均不高于配置的 13.7.1。
- electron-builder 配置读取和 schema 校验通过；actionlint 1.7.12 检查两个工作流通过。
- 打包后的 Windows x64 应用通过 TIFF 导入、保存重开、默认 8000px JPEG 导出、ICC／分辨率和原图不变测试。该结果不代表 ARM64 应用已运行。

## GitHub 上如何构建（以后授权推送后）

1. 提交并推送 `feature/apple-silicon`，不合并到 `main`。
2. 在仓库 Actions 中打开原有的 `mac-intel.yml` 工作流入口。它在侧栏可能仍叫 **Build macOS Intel test installer**，本分支中名称为 **Build macOS test installer**。
3. 点击 **Run workflow**，分支务必选择 **feature/apple-silicon**。若出现 `architecture`，选择 **apple-silicon**；未提供该输入时，本分支也默认选择 Apple Silicon。
4. 该入口调用同一提交中的 `mac-arm64.yml`，在 `macos-15` ARM64 构建机运行 **Build Apple Silicon test installer**。不会启动 `main` 或 High Sierra 分支的构建。
5. 成功后从该次运行的 Artifacts 下载 `PD-Impression-AppleSilicon-test-编号`，解压得到 DMG、校验文件和本说明。

新工作流仅存在于开发分支时，GitHub 可能不显示独立的 Run workflow 按钮，因此保留已有入口来调用它，无需为了显示按钮先改动 main。[GitHub 手动工作流说明](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)、[同一提交中的复用工作流](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)。

安装包：`PD Impression-0.1.0-macOS-AppleSilicon.dmg`（版本号跟随 package.json）。这是 ARM64 专用包；Intel 包仍由 `architecture: intel` 或 `npm run dist:mac:intel` 生成。

工作流只有手动／被手动入口调用的触发方式、仓库只读权限，打包命令固定 `--publish never`。上传 Actions 附件不等于创建正式 Release。

## 云端会检查什么

- 构建机和 Node.js 都必须为 `darwin/arm64`，避免误用 Intel 或 Rosetta 环境。
- 从锁文件执行 `npm ci --include=optional`，确认安装 ARM64 Sharp 和 libvips。
- 单元测试、类型检查、生产构建，以及 ARM64 DMG 打包。
- 检查应用标识、Electron 版本、ad-hoc 签名；扫描应用、Framework、`.node`、`.dylib` 等 Mach-O 文件，要求包含 ARM64，且最低系统版本不高于 13.7.1。
- 启动打包应用，断言实际 `process.arch === arm64`，验证 16 位 TIFF 导入、项目保存／重开、默认 8000px JPEG 导出、ICC 和物理分辨率、原图不变。
- 验证磁盘镜像并生成 `SHA256SUMS-AppleSilicon.txt`；前面任何一步失败，都不会上传安装包。

失败时可能有 `AppleSilicon-diagnostics-编号` 附件，其中保存原生库检查结果和测试截图；非常早的失败可能尚无诊断文件。

## 在自己的 M 芯片 Mac 安装

下载附件并解压，打开 DMG，将 **PD Impression** 拖到“应用程序”。这是同一个现代版应用的 ARM64 构建，名称和应用标识与现代 Intel 版一致；如果同一台 Mac 已装现代版，安装时会替换应用，不提供并排安装。安装前保留旧安装包，已有项目先复制备份后测试。

旧系统兼容版名为 **PD Impression High Sierra**，使用不同的应用标识和设置目录。

此测试版预期为 ad-hoc 签名，未配置 Developer ID 或公证。若系统拦截，确认是自己的构建后查看系统提供的“仍要打开”选项；如提示损坏或持续打不开，保留错误信息，不关闭系统安全功能。

使用真实扫描照片验证颜色、方向、中文文字、整卷和整条 TIFF、保存／重开及导出耗时。在“活动监视器”确认应用种类为“Apple”。云端 macOS 15 通过，不等于已在最低版本 13.7.1 或所有 M 芯片型号上实测。

## 在 M 芯片 Mac 本地构建（可选）

使用原生 ARM64 Node.js 24，不能复制 Windows 或 Intel Mac 的 node_modules：

```sh
npm ci --include=optional
npm test
npm run dist:mac:arm64
npm run verify:mac:arm64
PDIMPRESSION_EXPECTED_ARCH=arm64 npm run test:packaged
```

ARM64 应用目录为 `release/mac-arm64/PD Impression.app`。Intel 构建仍输出 `release/mac/PD Impression.app`，两个命令和安装包名称分开。

构建依据：[GitHub ARM64 runner](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)、[electron-builder 架构支持](https://www.electron.build/v26/docs/mac/)、[Sharp 原生依赖安装](https://sharp.pixelplumbing.com/install/)。
