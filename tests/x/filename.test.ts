import { describe, expect, it } from 'vitest';
import { buildFilename } from '../../src/platforms/x/filename';

describe('buildFilename', () => {
  it('标准命名', () => {
    expect(buildFilename({ handle: 'SpaceX', tweetId: '2072695632104468543', label: '720p' })).toBe(
      'SpaceX_2072695632104468543_720p.mp4',
    );
  });

  it('去掉 @ 前缀；空 handle 回退为 x', () => {
    expect(buildFilename({ handle: '@SpaceX', tweetId: '1', label: '720p' })).toBe('SpaceX_1_720p.mp4');
    expect(buildFilename({ handle: null, tweetId: '1', label: '720p' })).toBe('x_1_720p.mp4');
    expect(buildFilename({ handle: '   ', tweetId: '1', label: '720p' })).toBe('x_1_720p.mp4');
  });

  it('多视频追加序号', () => {
    expect(buildFilename({ handle: 'a', tweetId: '1', label: '720p', videoNumber: 2 })).toBe('a_1_720p_v2.mp4');
  });

  it('清洗文件系统非法字符', () => {
    expect(buildFilename({ handle: 'a/b:c*d?"<>|', tweetId: '1', label: '720p' })).toBe('abcd_1_720p.mp4');
    expect(buildFilename({ handle: 'a b', tweetId: '1', label: '720p' })).toBe('a_b_1_720p.mp4');
  });

  it('超长文件名截断到 180 字符且保留 .mp4 后缀', () => {
    const name = buildFilename({ handle: 'h'.repeat(300), tweetId: '1', label: '720p' });
    expect(name.length).toBeLessThanOrEqual(180);
    expect(name.endsWith('.mp4')).toBe(true);
  });

  it('label 统一小写', () => {
    expect(buildFilename({ handle: 'a', tweetId: '1', label: 'MP4' })).toBe('a_1_mp4.mp4');
  });
});
