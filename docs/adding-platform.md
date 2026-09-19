# 新增平台指南

扩展方式为增加源码模块并重新构建发布，不支持运行时安装扩展包。

## 1. 建立平台模块

在 `src/platforms/<platform>/` 下实现 `Platform`（见 `src/platforms/types.ts`）：

- `id`：稳定的平台标识。
- `matches(hostname)`：精确匹配支持的页面域名。
- `minPlayerSize`：适用页面中可操作视频的最小尺寸。
- `locate(pointer, current, menuOpen)`：定位页面视频，返回稳定目标 ID、元素和可见矩形；无目标时返回 null。平台负责 SPA 导航、引用视频归属等专属规则。
- `resolve(targetId)`：返回 `MediaCollection`；失败抛出带可展示文案的 Error。

参考 YouTube 的页面解析或 X 的后台解析，仅采用新平台实际需要的路径。

## 2. 转为统一下载结果

`MediaCollection` 包含标题和一个或多个视频。每个视频包含稳定 ID、标题、时长和下载选项。

每个选项拥有稳定且不与其他视频重复的 ID、标签、扩展名和完整 `download` 请求：

- `mode: 'direct'`：可下载 URL 和经过清洗的文件名。
- `mode: 'fetch'`：完整 MP4 的 URL、文件字节数（未知为 null）和文件名。用于抖音/B 站需要来源头的完整文件，在现有 offscreen 中原样保存，共用合并任务的进度、取消和单任务限制。
- `mode: 'mux'`：音视频 URL、编解码器、封装格式、字节数和文件名。

平台模块负责格式筛选和命名规则。公共层负责菜单渲染、下载、进度及取消，无需认识原始响应字段。X 的 `media.ts` 演示多视频，YouTube 的 `media.ts` 演示双轨。

## 3. 注册和权限

1. 在 `src/platforms/index.ts` 注册页面模块。
2. 在平台 `policy.ts` 定义允许下载的准确 CDN 域名，在 `src/platforms/background.ts` 注册。不可使用字符串包含判断域名。
3. 若需要后台解析，在平台目录实现解析函数，并注册到后台 `resolvers`；使用现有 `ResolveRequest` 消息。
4. 在 `manifest.json` 中加入必要页面匹配和后台请求权限，保持最小域名范围。
5. 只有需要独立 MAIN 脚本等实际执行上下文时，才增加构建入口和对应 manifest 配置。

抖音与 B 站已使用 `page-bridge.ts` 在页面上下文解析，只向 content 返回 `MediaCollection`，不传递整份页面状态或登录信息。B 站目标包含分 P，抖音目标来自当前可见播放器的作品 ID。

两站 CDN 的 Referer 规则位于 `src/background/media-rules.ts`：仅匹配扩展自身作为 initiator 的指定媒体域名，首次下载前等待规则注册成功。两站完整 MP4 必须使用 `fetch` 模式；Service Worker 直接调用 `chrome.downloads.download` 的网络下载不能依赖该规则。不可扩大成任意请求头代理，也不可影响 YouTube、X 或普通网页流量。

## 4. 验证

使用匿名合成响应测试成功、真实错误形态、格式筛选、多视频和下载结果。测试新域名允许规则能拒绝伪造子域名。

执行 `npm test`，再加载新构建，验证真实页面定位、解析、下载、导航和失败重试。涉及新下载方式时，需要另行确定公共能力的最小改动；现有接口并不承诺覆盖所有未来平台。
