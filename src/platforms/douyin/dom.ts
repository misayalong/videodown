import type { VideoTarget } from '../types';

/** 推荐流使用活动卡片；详情和作品弹层使用播放器容器。直播卡片不匹配。 */
export function findDouyinTarget(): VideoTarget | null {
  const expected = new URLSearchParams(location.search).get('modal_id') ||
    /^\/video\/(\d+)/.exec(location.pathname)?.[1];
  const containers = document.querySelectorAll<HTMLElement>(
    '[data-e2e="feed-active-video"], [data-e2e="player-container"]',
  );
  let best: VideoTarget | null = null;
  let bestArea = 0;
  for (const container of containers) {
    const id = container.getAttribute('data-e2e-vid') ||
      Array.from(container.classList).map((name) => /^video_(\d+)$/.exec(name)?.[1]).find(Boolean);
    if (!id || !/^\d+$/.test(id) || (expected && id !== expected)) continue;
    const video = container.querySelector('video');
    if (!video) continue;
    const rect = video.getBoundingClientRect();
    const area = Math.max(0, Math.min(innerWidth, rect.right) - Math.max(0, rect.left)) *
      Math.max(0, Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top));
    if (area > bestArea) {
      best = { id, element: container, rect };
      bestArea = area;
    }
  }
  return best;
}
