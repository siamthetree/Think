import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'path';

test('production CSP has no wildcard https: in img-src or connect-src', () => {
  const viteConfigContent = fs.readFileSync(path.join(process.cwd(), 'vite.config.ts'), 'utf8');
  assert.ok(!viteConfigContent.includes("img-src 'self' data: blob: https:"), 'img-src should not have https: wildcard');
  assert.ok(!viteConfigContent.includes("connect-src 'self' https:"), 'connect-src should not have https: wildcard');
  assert.match(viteConfigContent, /img-src 'self' data: blob:/);
  assert.match(viteConfigContent, /connect-src 'self'/);
});
