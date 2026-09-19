#!/usr/bin/env node
/**
 * 各平台 MAIN 与公共脚本独立构建：content script 是"经典脚本"，不能使用 ES import，
 * 因此每个入口必须独立构建并内联全部共享代码（inlineDynamicImports），产物平铺到 dist/。
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'vite';

const root = import.meta.dirname;
const outDir = resolve(root, '../dist');
mkdirSync(outDir, { recursive: true });

const entries = [
  { name: 'background', file: 'src/background/index.ts' },
  { name: 'content', file: 'src/content/index.ts' },
  { name: 'main', file: 'src/platforms/youtube/main/index.ts' },
  { name: 'bilibili-main', file: 'src/platforms/bilibili/main.ts' },
  { name: 'douyin-main', file: 'src/platforms/douyin/main.ts' },
  { name: 'offscreen', file: 'src/offscreen/index.ts' },
];

for (const [i, entry] of entries.entries()) {
  await build({
    configFile: false,
    root: resolve(root, '..'),
    logLevel: 'warn',
    build: {
      outDir,
      emptyOutDir: i === 0,
      rollupOptions: {
        input: { [entry.name]: resolve(root, '..', entry.file) },
        // MAIN 与网站共享全局环境，新平台必须用闭包隔离内部函数。
        output: {
          entryFileNames: '[name].js',
          format: entry.name === 'bilibili-main' || entry.name === 'douyin-main' ? 'iife' : 'es',
          codeSplitting: false,
        },
      },
    },
  });
  console.log(`built dist/${entry.name}.js`);
}

copyFileSync(resolve(root, '../manifest.json'), resolve(outDir, 'manifest.json'));
console.log('manifest.json copied');
