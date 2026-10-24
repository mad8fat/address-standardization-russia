import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './load-core.mjs';

const core = loadCore();

test('cleanAddressForQuery stays fast on a 32767-character cell', () => {
    const big = ('ул. Ленина, 12, пом, ').repeat(1500).slice(0, 32767);
    const t0 = Date.now();
    core.cleanAddressForQuery(big);
    assert.ok(Date.now() - t0 < 200, `took ${Date.now() - t0} ms`);
});
