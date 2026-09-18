import { expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

it('可加载构建包含四个入口，MAIN 仅注入 YouTube且无右键/全站权限', () => {
  const manifest = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));
  expect(manifest.name).toBe('VideoDown');
  expect(manifest.permissions).toEqual(['downloads', 'storage', 'offscreen']);
  expect(manifest.host_permissions).not.toContain('<all_urls>');
  expect(manifest.content_scripts.find((s: {world?: string}) => s.world === 'MAIN').matches).toEqual(['https://www.youtube.com/*']);
  expect(manifest.content_scripts.find((s: {world?: string}) => !s.world).matches).toEqual(['https://www.youtube.com/*', 'https://x.com/*', 'https://twitter.com/*']);
  for(const file of ['background.js', 'main.js', 'content.js', 'offscreen.js', 'offscreen.html', 'icons/icon16.png', 'icons/icon48.png', 'icons/icon128.png']) expect(existsSync(`dist/${file}`)).toBe(true);
});
