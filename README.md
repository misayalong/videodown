# VideoDown

在 YouTube 和 X 视频上悬停，点击下载按钮并选择清晰度。Chrome Manifest V3 扩展，基于 YtDown 与 XDown 的现有能力合并。

## 本地安装

已生成的 `dist/` 可直接加载：

1. 在 Chrome 打开 `chrome://extensions`，开启「开发者模式」。
2. 点击「加载已解压的扩展程序」，选择本项目的 `dist` 目录。
3. 如已安装 YtDown/TubeMux 或 XDown，请停用旧插件，避免出现两个下载按钮。
4. 刷新已打开的 YouTube 或 X 页面，在视频上移动鼠标，点击红色下载按钮。

更新源码并构建后，在扩展管理页点击 VideoDown 的刷新按钮，再刷新视频页面。

## 功能

- YouTube：普通视频和 Shorts；根据源视频实际提供的格式显示清晰度与音频选项。高清双轨在浏览器内合并为 MP4/WebM，不转码。
- 合并过程显示进度；点击正在合并的条目取消。全插件同时最多一个合并任务，其他合并请求显示忙碌提示。
- X：时间线和推文详情中的视频，按清晰度选择；同一推文多个视频分别成组，文件名带视频序号。
- 两个平台共用基于 YtDown 的页面悬浮按钮和菜单；支持关闭、重试及全屏容器适配。
- 直链下载交给 Chrome 下载管理；无需等待合并任务结束。

首版仅支持 Chrome。本项目无右键入口、工具栏下载弹窗、任务队列或任务面板。

## 构建与测试

沿用原项目的 Node 工具链及 mediabunny 依赖，版本锁定在 `package-lock.json`。

```sh
npm ci
npm run build
npm test
```

`npm test` 先构建，再运行解析、文件名、平台转换和构建产物后台消息链路测试。测试数据为合成值，不需要登录账号或访问真实平台。图标由 `npm run icons` 生成。

构建使用唯一入口 `scripts/build.mjs`，分别输出 `background.js`、`content.js`、YouTube MAIN world 的 `main.js` 与 `offscreen.js`，并复制 manifest 和静态资源。

## 架构

```text
src/
  platforms/
    types.ts             页面定位与解析接口
    index.ts             页面平台注册
    background.ts        后台解析与下载域名注册
    youtube/             页面定位、MAIN 桥接、解析、下载选项转换
    x/                   推文定位、FxTwitter 解析、下载选项转换
  shared/
    media.ts             视频列表与直链/合并下载选项
    types.ts             下载和进度消息
    filename.ts          文件名清洗
  content/               公共悬浮菜单、缓存、进度与取消交互
  background/            公共下载入口、单合并任务和消息转发
  offscreen/             分段拉流、OPFS 临时文件、mediabunny 合并
```

平台模块只交付视频列表、展示信息和下载请求。公共菜单不判断 YouTube/X，也不解析平台响应。平台注册分别面向页面和后台，避免后台导入 DOM 代码。

详见 [新增平台指南](docs/adding-platform.md) 和 [验证记录](docs/validation.md)。

## 网络与权限

- `downloads`：将文件保存到 Chrome 的默认下载位置。
- `storage`：用 `storage.session` 保存当前合并任务，供 Service Worker 重启后继续交接。
- `offscreen`：在扩展的离屏页面中拉取和合并音视频。
- 页面脚本仅注入 `www.youtube.com`、`x.com` 和 `twitter.com`；YouTube MAIN 脚本仅注入 YouTube。
- 后台请求范围：Google Video/GVT1 媒体 CDN 和 `api.fxtwitter.com`。直链下载地址另按平台 CDN 白名单校验。
- X 解析会向 FxTwitter 发送目标推文 ID；服务故障或无法访问的推文会导致解析失败。请求不携带用户登录凭据。
- 解析缓存保存在页面内存中，30 分钟过期；「重试」绕过缓存。合并使用本地 OPFS 临时文件，并在结束或取消后清理。

不包含遥测、下载历史持久化或商店发布配置。网站结构和接口变化仍可能需要更新对应平台模块；合并不会消除原解析方案对平台接口的依赖。
