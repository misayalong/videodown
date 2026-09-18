import { youtube } from './youtube';
import { x } from './x';

const platforms = [youtube, x];
export function platformFor(hostname: string) {
  return platforms.find((platform) => platform.matches(hostname));
}
