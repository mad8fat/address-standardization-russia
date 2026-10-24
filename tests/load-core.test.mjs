import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { loadCore } from './load-core.mjs';

const require = createRequire(import.meta.url);

test('addr-core.js is loadable via require and exposes VERSION', () => {
    const core = require('../addr-core.js');
    assert.equal(typeof core.classify, 'function');
    assert.equal(core.VERSION, '1.1.0');
});

test('loadCore returns the same object as require', () => {
    assert.equal(loadCore(), require('../addr-core.js'));
});

test('index.html loads addr-core.js and has no inline core block', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(html, /<script src="addr-core\.js"><\/script>/);
    assert.doesNotMatch(html, /<script id="core">/);
});

test('package.json is publishable: no private flag, main points to the core', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(pkg.private, undefined);
    assert.equal(pkg.type, undefined);
    assert.equal(pkg.main, 'addr-core.js');
    assert.equal(pkg.version, '1.1.0');
    assert.deepEqual(pkg.files, ['addr-core.js', 'README.md', 'LICENSE', 'docs/algorithm.md']);
});
