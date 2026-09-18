import { describe, expect, it } from 'vitest';
import { buildFilename, sanitizeFilename } from '../../src/shared/filename';

describe('buildFilename', () => {
  it('清洗非法字符并折叠空白', () => {
    expect(buildFilename('My Video: "The Sequel"? / Part 2', '720p', 'mp4')).toBe(
      'My_Video_The_Sequel_Part_2_720p.mp4',
    );
  });

  it('音频使用 audio 标签与 m4a 扩展名', () => {
    expect(buildFilename('视频标题', 'audio', 'm4a')).toBe('视频标题_audio.m4a');
  });

  it('总长不超过 180 且保留后缀', () => {
    const name = buildFilename('啊'.repeat(300), '360p', 'mp4');
    expect(name.length).toBeLessThanOrEqual(180);
    expect(name.endsWith('_360p.mp4')).toBe(true);
  });

  it('空标题回退为 video', () => {
    expect(buildFilename('', '360p', 'mp4')).toBe('video_360p.mp4');
    expect(buildFilename('???', '360p', 'mp4')).toBe('video_360p.mp4');
  });

  it('去掉结尾的点（Windows 兼容）', () => {
    expect(buildFilename('title...', '360p', 'mp4')).toBe('title_360p.mp4');
  });
});

describe('sanitizeFilename', () => {
  it('移除文件系统非法字符', () => {
    expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij');
    expect(sanitizeFilename('x\u0007y')).toBe('xy');
  });
});
