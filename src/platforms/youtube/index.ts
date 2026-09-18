import { requestSolve } from './bridge';
import { parsePlayerPayload } from './parse';
import { toMedia } from './media';
import type { Platform } from '../types';

export const youtube: Platform = {
  id: 'youtube',
  matches: (hostname) => hostname === 'www.youtube.com',
  minPlayerSize: { width: 240, height: 135 },
  locate() {
    const id = location.pathname === '/watch'
      ? new URLSearchParams(location.search).get('v')
      : /^\/shorts\/([A-Za-z0-9_-]{6,})/.exec(location.pathname)?.[1];
    if (!id) return null;
    const movie = document.querySelector<HTMLElement>('#movie_player');
    if (movie && movie.getBoundingClientRect().width > 0) {
      return { id, element: movie, rect: movie.getBoundingClientRect() };
    }
    const reel = document.querySelector<HTMLElement>('ytd-reel-video-renderer[is-active]')
      ?? document.querySelector<HTMLElement>('ytd-reel-video-renderer');
    if (!reel) return null;
    const rect = reel.getBoundingClientRect();
    const videoRect = reel.querySelector('video')?.getBoundingClientRect();
    return {
      id, element: reel,
      rect: videoRect && videoRect.width > 0
        ? new DOMRect(videoRect.left, rect.top, videoRect.width, rect.height) : rect,
    };
  },
  async resolve(id) {
    const response = await requestSolve(id);
    if (!response.ok) throw new Error(response.error);
    return toMedia(parsePlayerPayload(response.payload));
  },
};
