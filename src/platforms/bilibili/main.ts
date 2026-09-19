import { servePageMedia } from '../page-bridge';
import { parseBilibili } from './parse';
import { bilibiliTarget, parseBilibiliTarget } from './target';
import type { BilibiliPlay, BilibiliVideo } from './types';

async function api<T>(path: string, query: Record<string, string>): Promise<T> {
  const url = new URL(path, 'https://api.bilibili.com');
  url.search = new URLSearchParams(query).toString();
  const response = await fetch(url, { credentials: 'include', signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error('B 站解析请求失败（HTTP ' + response.status + '），请重试');
  const body = await response.json() as { code: number; data?: T };
  if (body.code !== 0 || !body.data) {
    throw new Error(body.code === -101 ? '请先登录 B 站并确认视频可以播放' : 'B 站未提供视频数据（' + body.code + '），请重试');
  }
  return body.data;
}

servePageMedia('bilibili', async (targetId) => {
  if (targetId !== bilibiliTarget(new URL(location.href))) throw new Error('视频已切换，请重新打开下载菜单');
  const target = parseBilibiliTarget(targetId);
  const query: Record<string, string> = target.video.startsWith('av') ? { aid: target.video.slice(2) } : { bvid: target.video };
  const video = await api<BilibiliVideo>('/x/web-interface/view', query);
  const page = video.pages?.find((item) => item.page === target.page);
  if (!page) throw new Error('当前分 P 不存在');
  const play = await api<BilibiliPlay>('/x/player/playurl', {
    bvid: video.bvid, cid: String(page.cid), qn: '127', fnval: '4048', fourk: '1',
  });
  return parseBilibili(video, play, target.page);
});
