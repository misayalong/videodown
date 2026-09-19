# VideoDown

在 YouTube、X、抖音和 B 站视频上悬停，点击下载按钮并选择清晰度。Chrome Manifest V3 扩展，基于 YtDown 与 XDown 的现有能力合并。

## 本地安装

已生成的 `dist/` 可直接加载：

1. 在 Chrome 打开 `chrome://extensions`，开启「开发者模式」。
2. 点击「加载已解压的扩展程序」，选择本项目的 `dist` 目录。
3. 如已安装 YtDown/TubeMux 或 XDown，请停用旧插件，避免出现两个下载按钮。
4. 刷新已打开的视频页面，在视频上移动鼠标，点击红色下载按钮。

更新源码并构建后，在扩展管理页点击 VideoDown 的刷新按钮，再刷新视频页面。

v0.2.0 新增抖音、B 站的页面与媒体域名，以及限定媒体请求的来源规则权限。v0.2.1 修复新增平台页面脚本与网站同名函数冲突，v0.2.2 修正抖音播放器地址字段和 B 站竖屏分辨率显示，v0.2.3 将两站完整 MP4 改为离屏获取，修复抖音原生直链下载返回 403 的问题。v0.2.4 补齐推荐流 prime CDN 地址缺少的播放器来源参数，但未覆盖 MSE 播放；v0.2.5 改用当前作品播放器的地址处理函数，同时支持 HTTPS 与 `blob:` 播放模式。更新后菜单右上角应显示 v0.2.5。如果扩展因新权限停用，请在 Chrome 中检查并重新启用。

## 功能

- YouTube：普通视频和 Shorts；根据源视频实际提供的格式显示清晰度与音频选项。高清双轨在浏览器内合并为 MP4/WebM，不转码。
- 合并及抖音/B 站完整文件下载显示进度；点击活动条目取消。这些下载共用一个任务槽位，同时最多运行一个，其他请求显示忙碌提示。
- X：时间线和推文详情中的视频，按清晰度选择；同一推文多个视频分别成组，文件名带视频序号。
- 抖音：推荐流、普通视频详情和作品弹层，逐条下载当前作品。优先选择播放源；只有平台下载源时标注「可能带平台水印」（当前页面数据未提供可靠水印标志）。不裁剪画面、不去除作者添加的文字或 Logo。
- B 站：普通投稿播放页，下载当前分 P；切换分 P 后更新目标。仅展示当前账号实际取得媒体地址的画质，区分普通、高帧率等档位。
- 抖音/B 站输出含声音的 MP4，同画质优先 H.264＋AAC；较高画质仅有 HEVC/AV1 时保留源编码并标注。双轨复用浏览器内合并，不转码；部分文件需要支持相应编码的播放器。
- 四个平台共用基于 YtDown 的页面悬浮按钮和菜单；支持关闭、重试及全屏容器适配。
- YouTube/X 的原生直链下载交给 Chrome 下载管理，无需等待合并任务结束。抖音/B 站完整 MP4 在扩展离屏页面获取后原样保存，以便来源规则生效，不重新封装或转码。

仅支持 Chrome。抖音/B 站沿用网页登录态，使用前请确认当前账号能够正常播放视频。本项目无右键入口、粘贴链接入口、工具栏下载弹窗、任务队列或任务面板；不支持批量下载、直播、图文和番剧。

## 构建与测试

沿用原项目的 Node 工具链及 mediabunny 依赖，版本锁定在 `package-lock.json`。

```sh
npm ci
npm run build
npm test
```

`npm test` 先构建，再运行解析、文件名、平台转换和构建产物后台消息链路测试。测试数据为合成值，不需要登录账号或访问真实平台。图标由 `npm run icons` 生成。

构建使用唯一入口 `scripts/build.mjs`，输出公共 `background.js`、`content.js`、`offscreen.js`，以及各站独立的 MAIN 脚本 `main.js`（YouTube）、`bilibili-main.js`、`douyin-main.js`，并复制 manifest 和静态资源。

## 架构

```text
src/
  platforms/
    types.ts             页面定位与解析接口
    index.ts             页面平台注册
    background.ts        后台解析与下载域名注册
    youtube/             页面定位、MAIN 桥接、解析、下载选项转换
    x/                   推文定位、FxTwitter 解析、下载选项转换
    bilibili/            当前分 P 定位、网页登录态 API 解析、双轨选择
    douyin/              当前作品定位、页面媒体数据读取、MP4/双轨选择
    page-bridge.ts       抖音/B 站的 MAIN 与 content 媒体结果通信
  shared/
    media.ts             视频列表与原生直链/离屏文件/合并下载选项
    types.ts             下载和进度消息
    filename.ts          文件名清洗
  content/               公共悬浮菜单、缓存、进度与取消交互
  background/            公共下载入口、单离屏任务和消息转发
  offscreen/             分段拉流、OPFS 原文件保存、mediabunny 合并
```

平台模块只交付视频列表、展示信息和下载请求。公共菜单不判断平台，也不解析平台响应。平台注册分别面向页面和后台，避免后台导入 DOM 代码。

详见 [新增平台指南](docs/adding-platform.md) 和 [验证记录](docs/validation.md)。

## 网络与权限

- `downloads`：将文件保存到 Chrome 的默认下载位置。
- `storage`：用 `storage.session` 保存当前离屏下载任务，供 Service Worker 重启后继续交接。
- `offscreen`：在扩展的离屏页面中拉取和合并音视频。
- 页面脚本仅注入 `www.youtube.com`、`x.com`、`twitter.com`、`www.bilibili.com`、`www.douyin.com`；各平台 MAIN 脚本只在自己的域名运行。
- 后台请求范围：Google Video/GVT1、B 站 bilivideo.com/bilivideo.cn、抖音 douyinvod.com 媒体 CDN 和 `api.fxtwitter.com`。下载地址按平台 CDN 白名单校验，不授予全站权限。
- `declarativeNetRequestWithHostAccess`：两站部分 CDN 校验 Referer；会话规则只为扩展自身发起、命中两站媒体 CDN 的请求设置对应站点来源，不修改用户网页的其他请求。
- B 站解析请求在 B 站页面内访问其官方 API，抖音从当前作品的页面媒体数据读取；不读取或导出 Cookie，不向第三方解析服务发送两站登录凭据。
- X 解析会向 FxTwitter 发送目标推文 ID；服务故障或无法访问的推文会导致解析失败。请求不携带用户登录凭据。
- 解析缓存保存在页面内存中，30 分钟过期；「重试」绕过缓存。离屏下载和合并使用本地 OPFS 临时文件，并在结束或取消后清理。

不包含遥测、下载历史持久化或商店发布配置。抖音的播放器容器及 React 媒体属性、B 站的网页播放接口可能随站点更新而变化，需要维护对应平台模块。无法解析时可重试或刷新页面。
