import type { Platform } from '../types';
import { requestPageMedia } from '../page-bridge';
import { findDouyinTarget } from './dom';

export const douyin: Platform = {
  id: 'douyin',
  matches: (hostname) => hostname === 'www.douyin.com',
  minPlayerSize: { width: 160, height: 100 },
  locate: findDouyinTarget,
  resolve: (id) => requestPageMedia('douyin', id),
};
