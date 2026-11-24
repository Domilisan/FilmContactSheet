# PD Impression — Intel Mac 测试版

目标电脑：Intel 芯片，macOS Ventura 13.7.1 或更新系统。

## 下载和安装

1. 在 GitHub 仓库的 Actions 页面选择 **Build macOS Intel test installer**。
2. 点击 **Run workflow**，选择包含本配置的分支，启动构建。
3. 等待成功后，在该次运行页面的 Artifacts 下载 **PD-Impression-macOS-Intel-test-编号**。
4. 解压下载的 ZIP，打开其中的 DMG，将 **PD Impression** 拖到 **Applications（应用程序）**。
5. 从“应用程序”打开软件，不需要安装 Node.js 或 VS Code。

此测试版只有 ad-hoc 本地签名，没有 Apple Developer ID 签名和公证。macOS 可能拦截从网络下载的应用。只在确认来源是自己的构建时，通过“系统设置 → 隐私与安全性”查看系统提供的“仍要打开”选项；如果提示应用损坏或持续打不开，请保留完整提示以便排查，不关闭系统安全功能。

## 验证范围

- 云端在 Intel macOS 构建机上测试打包后的应用：TIFF 导入、项目保存和重开、自定义名称导出 JPEG、原图保持不变。
- 构建还会检查应用及原生库的 Intel 架构、最低 macOS 版本和 ad-hoc 签名。
- 云端运行系统不是 Ventura。通过上述检查不等于已经在 13.7.1 上实测；请在自己的 Mac 上试一次实际扫描照片、中文文字排版、多项目导入和导出。
- 不支持未经验证的更旧系统，也不作为 Apple Silicon 专用安装包。

## 本地重新构建（可选）

在 Intel Mac 上安装 Node.js 24，进入项目目录运行：

```sh
npm ci --include=optional
npm run dist:mac:intel
npm run verify:mac:intel
npm run test:packaged
```

输出文件：`release/PD Impression-0.1.0-macOS-Intel.dmg`（版本号跟随 package.json）。

工作流只允许手动触发、只有仓库读取权限，打包命令明确禁用发布。安装包仅作为 Actions 附件保留 30 天，不创建标签、不创建或修改 GitHub Releases。
