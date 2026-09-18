const STATUS_ID_RE = /\/status\/(\d+)/;
const MEDIA_PATH_RE = /\/(video|photo)\/\d+\/?$/;

const MIN_VIDEO_W = 80;
const MIN_VIDEO_H = 60;

function visibleRect(video: HTMLVideoElement): DOMRect | null {
  const rect = video.getBoundingClientRect();
  if (rect.width < MIN_VIDEO_W || rect.height < MIN_VIDEO_H) return null;
  return rect;
}

function rectContains(rect: DOMRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/**
 * 定位指针所指的视频。X 的播放器覆盖层（如 Pause 按钮）不在 <video> 内，
 * 且当前 DOM 已移除 videoPlayer 之类的 data-testid，因此：
 * 1. 快路径：直接命中 <video> 或播放器容器（兼容旧结构）；
 * 2. 回退：在所有可见视频里找矩形包含指针坐标的最小者（覆盖层必然悬浮在视频矩形内）。
 */
export function findEligibleVideo(target: Element, x: number, y: number): HTMLVideoElement | null {
  const path = location.pathname;
  if (path.startsWith('/messages') || path.startsWith('/i/broadcast')) return null;

  const scope = target.closest('video, [data-testid="videoPlayer"], [data-testid="videoComponent"]');
  if (scope) {
    const video = scope instanceof HTMLVideoElement ? scope : scope.querySelector('video');
    if (video && visibleRect(video)) return video;
  }

  let best: HTMLVideoElement | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const video of document.querySelectorAll('video')) {
    const rect = visibleRect(video);
    if (!rect || !rectContains(rect, x, y)) continue;
    const area = rect.width * rect.height;
    if (area < bestArea) {
      bestArea = area;
      best = video;
    }
  }
  return best;
}

function idFromHref(href: string): string | null {
  try {
    const m = new URL(href).pathname.match(STATUS_ID_RE);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

export function idFromLocation(): string | null {
  return location.pathname.match(STATUS_ID_RE)?.[1] ?? null;
}

/**
 * 从视频元素定位它所属的推文 ID：
 * 1. 视频本身被 /status/ 链接包裹（时间线媒体块、引用卡片内的视频）——链接即归属推文；
 * 2. 否则在最近的 article 里给所有 /status/ 链接打分：带 <time> 的永久链接权重最高，
 *    指向 /video/、/photo/ 的媒体链接次之，靠得分排除引用卡片里指向他人的链接；
 * 3. 都没有时退回当前页面地址（详情页一定带 /status/）。
 */
export function resolveTweetId(video: HTMLVideoElement): string | null {
  const wrapped = video.closest('a[href*="/status/"]');
  if (wrapped instanceof HTMLAnchorElement) {
    const id = idFromHref(wrapped.href);
    if (id) return id;
  }

  const article = video.closest('article');
  if (article) {
    const scores = new Map<string, number>();
    for (const a of article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')) {
      if (a.closest('article') !== article) continue;
      const id = idFromHref(a.href);
      if (!id) continue;
      let score = 1;
      if (a.querySelector('time')) score += 3;
      if (MEDIA_PATH_RE.test(new URL(a.href).pathname)) score += 2;
      scores.set(id, (scores.get(id) ?? 0) + score);
    }
    let best: { id: string; score: number } | null = null;
    for (const [id, score] of scores) {
      if (!best || score > best.score) best = { id, score };
    }
    if (best) return best.id;
  }

  return idFromLocation();
}

