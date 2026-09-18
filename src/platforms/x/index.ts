import { findEligibleVideo, resolveTweetId } from './dom';
import type { Platform } from '../types';
import type { ResolveRequest, ResolveResponse } from '../../shared/media';

export const x: Platform = {
  id: 'x',
  matches: (hostname) => hostname === 'x.com' || hostname === 'twitter.com',
  minPlayerSize: { width: 80, height: 60 },
  locate(pointer, current, menuOpen) {
    if (location.pathname.startsWith('/messages') || location.pathname.startsWith('/i/broadcast')) return null;
    const hit = document.elementFromPoint(pointer.x, pointer.y);
    const video = menuOpen && current?.element.isConnected
      ? current.element as HTMLVideoElement
      : (hit ? findEligibleVideo(hit, pointer.x, pointer.y) : null)
        ?? (current?.element.isConnected ? current.element as HTMLVideoElement : null);
    if (!video) return null;
    const id = resolveTweetId(video);
    return id ? { id, element: video, rect: video.getBoundingClientRect() } : null;
  },
  async resolve(targetId) {
    const request: ResolveRequest = { type: 'resolve', platform: 'x', targetId };
    const response = await chrome.runtime.sendMessage(request) as ResolveResponse;
    if (!response?.ok) throw new Error(response?.error ?? '与后台服务通信失败，请重试');
    return response.media;
  },
};
