# UX Viewport

UX Viewport 是一个面向 UX 验收的 macOS 浏览器扩展。它会调整 Arc 或 Chrome 的真实窗口，使网页可视区达到指定尺寸，无需打开 DevTools。

## 功能

- 默认预置：`1728 × 1117`、`1440 × 900`、`1280 × 720`、`768 × 900`
- 一键应用默认尺寸，初始默认为 `1440 × 900`
- 所有预置均可编辑、删除、设为默认
- 自定义尺寸可仅应用，也可保存后应用
- 悬浮胶囊实时显示当前网页 viewport，Hover 展开，支持关闭和拖拽，松手后自动吸附左右边缘
- 在所有普通网页中自动显示，并跨标签页、跨域导航保持相同位置
- 自动退出最大化/全屏并最多校准三次

## 团队安装与自动更新

正式分发使用 Chrome Web Store 的 `Unlisted` 链接。同事打开链接安装一次后，Chrome 和 Arc 会自动接收商店审核通过的新版本；也可在 `chrome://extensions/` 开启开发者模式后点击「更新」立即检查。

首次发布完成后，将安装链接放在这里：`https://chromewebstore.google.com/detail/<EXTENSION_ID>`。

GitHub 用于查看源码和 Release，直接下载 ZIP 适合测试，但手动安装的 ZIP 不具备面向普通用户的可靠自动更新能力。完整发布配置见 [Chrome Web Store 发布配置](docs/chrome-web-store-publishing.md)。

## Chrome 开发安装

1. 打开 `chrome://extensions/`。
2. 打开右上角的「开发者模式」。
3. 点击「加载已解压的扩展程序」。
4. 选择本项目根目录。
5. 将 UX Viewport 固定到工具栏。

## Arc 开发安装

1. 打开 `arc://extensions/`。
2. 打开「Developer mode」。
3. 点击「Load unpacked」并选择本项目根目录。
4. 在 Arc 的 Site Controls 中找到 UX Viewport，需要时固定到工具栏。

## GitHub Release

推送与 `manifest.json` 版本一致的 tag 后，GitHub Actions 会自动运行测试，在 Releases 中生成 `ux-viewport.zip`；完成商店变量配置后，还会自动提交 Chrome Web Store 更新。

```bash
git tag v1.2.0
git push origin v1.2.0
```

每次发布新版本前，同步更新 `manifest.json` 和 `package.json` 中的版本号，再推送对应 tag。

## 使用

1. 打开要验收的普通网页。
2. Hover 悬浮胶囊展开控制面板；也可以点击浏览器工具栏中的 UX Viewport 图标。
3. 点击主按钮应用默认尺寸，或展开下拉菜单选择其他尺寸。
4. 移出组件或点击页面其他区域后，组件会收起为实时尺寸胶囊。

## 权限说明

- `http://*/*`、`https://*/*`：在普通网页中自动显示悬浮组件，并在跨域导航后继续工作。
- `activeTab`：在自动注入不可用时响应用户主动点击。
- `scripting`：向当前页面注入悬浮控件。
- `storage`：在本地保存预置尺寸、默认项和全局控件位置。

扩展不上传或同步任何数据。

## 已知限制

- `chrome://`、`arc://`、Chrome Web Store 等浏览器受限页面无法显示悬浮组件。
- 目标 viewport 加上浏览器工具栏后超过 macOS 可用屏幕区域时，系统会限制窗口尺寸，扩展会显示目标值和实际值。
- 文件页面需在扩展详情中额外开启「允许访问文件网址」。

## 开发验证

```bash
npm test
node --check background.js
node --check widget.js
```
