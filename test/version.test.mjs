// Versionsnummer in index.html und version.js muss übereinstimmen (Cache-Schutz nach Veröffentlichungen)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { APP_VERSION } from '../public/js/version.js';

test('index.html trägt dieselbe Version wie version.js', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, new RegExp(`<html[^>]*data-v="${APP_VERSION}"`), 'data-v im <html>-Tag');
  const versions = [...html.matchAll(/\.(?:js|css)\?v=([\w.]+)/g)].map((m) => m[1]).filter((v) => !/^\d+\.\d+\.\d+$/.test(v));
  assert.ok(versions.length >= 3, 'zu wenige ?v=-Angaben');
  for (const v of versions) assert.equal(v, APP_VERSION, 'alle ?v= in index.html');
  for (const f of fs.readdirSync(new URL('../public/js', import.meta.url))) {
    if (f.endsWith('.js')) assert.ok(html.includes(`"./js/${f}": "./js/${f}?v=${APP_VERSION}"`), `${f} fehlt in der Import-Map`);
  }
});
