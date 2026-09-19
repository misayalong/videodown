import type { Platform } from '../types';
import { requestPageMedia } from '../page-bridge';
import { bilibiliTarget } from './target';

export const bilibili: Platform = {
  id: 'bilibili',
  matches: (hostname) => hostname === 'www.bilibili.com',
  minPlayerSize: { width: 240, height: 135 },
  locate() {
    const id = bilibiliTarget(new URL(location.href));
    if (!id) return null;
    const video = document.querySelector<HTMLElement>('#bilibili-player video, .bpx-player-container video');
    if (!video) return null;
    return { id, element: video, rect: video.getBoundingClientRect() };
  },
  resolve: (id) => requestPageMedia('bilibili', id),
};
