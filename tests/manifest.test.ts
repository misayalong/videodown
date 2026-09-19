import { expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

it('各平台 MAIN 仅注入对应站点且无 Cookie、右键或全站权限', () => {
  const manifest = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));
  expect(manifest.name).toBe('VideoDown');
  expect(manifest.permissions).toEqual(['downloads', 'storage', 'offscreen', 'declarativeNetRequestWithHostAccess']);
  expect(manifest.host_permissions).not.toContain('<all_urls>');
  const mains = manifest.content_scripts.filter((s: {world?: string}) => s.world === 'MAIN');
  expect(mains.map((s: {matches: string[]; js: string[]}) => [s.matches, s.js])).toEqual([
    [['https://www.youtube.com/*'], ['main.js']],
    [['https://www.bilibili.com/*'], ['bilibili-main.js']],
    [['https://www.douyin.com/*'], ['douyin-main.js']],
  ]);
  expect(manifest.content_scripts.find((s: {world?: string}) => !s.world).matches).toEqual(['https://www.youtube.com/*', 'https://x.com/*', 'https://twitter.com/*', 'https://www.bilibili.com/*', 'https://www.douyin.com/*']);
  expect(manifest.host_permissions).toEqual(['https://*.googlevideo.com/*', 'https://*.gvt1.com/*', 'https://api.fxtwitter.com/*', 'https://*.bilivideo.com/*', 'https://*.bilivideo.cn/*', 'https://*.douyinvod.com/*']);
  for(const file of ['background.js', 'main.js', 'bilibili-main.js', 'douyin-main.js', 'content.js', 'offscreen.js', 'offscreen.html', 'icons/icon16.png', 'icons/icon48.png', 'icons/icon128.png']) expect(existsSync(`dist/${file}`)).toBe(true);
});
