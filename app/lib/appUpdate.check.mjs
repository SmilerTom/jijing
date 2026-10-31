import assert from 'node:assert/strict';
import { downloadAppUpdate, extractUpdateAssets, getAppReloadUrl, isAppUpdateAvailable } from './appUpdate.mjs';

assert.equal(isAppUpdateAvailable('old-build', 'new-build'), true);
assert.equal(isAppUpdateAvailable('same-build', 'same-build'), false);
assert.equal(isAppUpdateAvailable('development', 'new-build'), false);
assert.equal(
  getAppReloadUrl('https://example.com/jijing/?tab=mine', 'new-build'),
  'https://example.com/jijing/?tab=mine&_update=new-build'
);

const html = `<link rel="stylesheet" href="/jijing/_next/static/css/a.css"/>
<script src="/jijing/_next/static/chunks/b.js"></script><script src="/jijing/_next/static/chunks/b.js"></script>
<script src="https://cdn.example.com/x.js"></script><link rel="icon" href="/jijing/icon.svg"/>`;
assert.deepEqual(extractUpdateAssets(html, 'https://example.com/jijing/?_update=1'), [
  'https://example.com/jijing/_next/static/css/a.css',
  'https://example.com/jijing/_next/static/chunks/b.js'
]);

const files = { 'https://example.com/jijing/?_update=1': html };
globalThis.fetch = async (url) => ({
  ok: url !== 'https://example.com/jijing/_next/static/css/a.css' || !globalThis.failCss,
  status: 500,
  text: async () => files[url],
  arrayBuffer: async () => new ArrayBuffer(1)
});
const progress = [];
await downloadAppUpdate('https://example.com/jijing/?_update=1', (value) => progress.push(value));
assert.deepEqual(progress.at(-1), { loaded: 3, total: 3 });
globalThis.failCss = true;
await assert.rejects(downloadAppUpdate('https://example.com/jijing/?_update=1'), /资源下载失败/);

console.log('appUpdate checks passed');
