import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './load-core.mjs';

test('loadCore returns the AddrCore object from index.html', () => {
    const core = loadCore();
    assert.equal(typeof core, 'object');
    assert.ok(core !== null);
});
