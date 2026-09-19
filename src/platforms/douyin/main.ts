import { servePageMedia } from '../page-bridge';
import { findDouyinTarget } from './dom';
import { parseDouyin } from './parse';
import { allowsDouyinStream } from './policy';
import type { DouyinAweme } from './types';

interface PlayerConfig {
  awemeInfo?: DouyinAweme;
  preProcessUrl?: (url: string, options: Record<string, never>) => { url?: unknown };
}

interface Fiber {
  memoizedProps?: { xgplayerConfig?: PlayerConfig };
  return?: Fiber;
}

function prepareUrl(config: PlayerConfig, raw: string): string {
  try {
    const result = config.preProcessUrl!(raw, {});
    if (typeof result?.url === 'string') {
      const source = new URL(raw);
      const processed = new URL(result.url);
      if (allowsDouyinStream(processed) && processed.origin === source.origin && processed.pathname === source.pathname) {
        return processed.href;
      }
    }
  } catch { /* 网站异常可能包含签名地址，不向下载菜单透传。 */ }
  throw new Error('播放器未能生成有效的下载地址，请开始播放后重新解析');
}

servePageMedia('douyin', async (targetId) => {
  const target = findDouyinTarget();
  if (!target || target.id !== targetId) throw new Error('视频已切换，请重新打开下载菜单');
  // 从当前 video 的最近 React 节点进入，外层作品卡片不一定持有播放器配置。
  let element: Element | null = target.element.querySelector('video');
  let fiber: Fiber | undefined;
  while (element && target.element.contains(element)) {
    const node = element as unknown as Record<string, unknown>;
    const key = Object.keys(node).find((name) => name.startsWith('__reactFiber$'));
    if (key) { fiber = node[key] as Fiber; break; }
    element = element.parentElement;
  }
  for (let depth = 0; fiber && depth < 40; depth++, fiber = fiber.return) {
    const config = fiber.memoizedProps?.xgplayerConfig;
    if (config?.awemeInfo?.awemeId !== targetId || typeof config.preProcessUrl !== 'function') continue;
    const media = parseDouyin(config.awemeInfo, targetId);
    // HTTPS 与 MSE/blob 播放均由当前播放器处理签名参数，不依赖 currentSrc。
    for (const video of media.videos) for (const { download } of video.variants) {
      if (download.mode === 'fetch') download.url = prepareUrl(config, download.url);
      else if (download.mode === 'mux') {
        download.videoUrl = prepareUrl(config, download.videoUrl);
        download.audioUrl = prepareUrl(config, download.audioUrl);
      }
    }
    return media;
  }
  throw new Error('视频数据尚未就绪，请开始播放后重试；仍失败时请刷新页面');
});
