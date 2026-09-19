import { youtube } from './youtube';
import { x } from './x';
import { bilibili } from './bilibili';
import { douyin } from './douyin';

const platforms = [youtube, x, bilibili, douyin];
export function platformFor(hostname: string) {
  return platforms.find((platform) => platform.matches(hostname));
}
