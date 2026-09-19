import { afterEach, expect, it, vi } from 'vitest';
import { findDouyinTarget } from '../../src/platforms/douyin/dom';

afterEach(() => vi.unstubAllGlobals());

function container(id: string, top = 0, classOnly = false) {
  const rect = { left: 0, right: 640, top, bottom: top + 360, width: 640, height: 360 };
  return {
    classList: ['player', 'video_' + id],
    getAttribute: () => classOnly ? null : id,
    querySelector: () => ({ getBoundingClientRect: () => rect }),
  };
}
function page(containers: ReturnType<typeof container>[], search = '', pathname = '/') {
  vi.stubGlobal('document', { querySelectorAll: () => containers });
  vi.stubGlobal('location', { search, pathname });
  vi.stubGlobal('innerWidth', 1024);
  vi.stubGlobal('innerHeight', 768);
}

it('推荐流只选可见作品，滚动后目标 ID 更新', () => {
  const first = container('10001');
  const next = container('10002', 900);
  page([first, next]);
  expect(findDouyinTarget()?.id).toBe('10001');
  page([container('10001', -500), container('10002')]);
  expect(findDouyinTarget()?.id).toBe('10002');
});
it('作品弹层优先匹配 modal_id，不误用后面的推荐流', () => {
  page([container('10001'), container('10002', 10, true)], '?modal_id=10002');
  expect(findDouyinTarget()?.id).toBe('10002');
  page([container('10001')], '?modal_id=10002');
  expect(findDouyinTarget()).toBeNull();
});
it('独立详情页匹配播放器的作品 ID；页面切换未加载完成时不下载旧作品', () => {
  page([container('10001', 0, true)], '', '/video/10001');
  expect(findDouyinTarget()?.id).toBe('10001');
  page([container('10001', 0, true)], '', '/video/10002');
  expect(findDouyinTarget()).toBeNull();
  page([]);
  expect(findDouyinTarget()).toBeNull();
});
