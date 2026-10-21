import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './load-core.mjs';

const core = loadCore();

test('decideOnHttpStatus: 200 ok, 403/429 stop, other 4xx fail, 5xx and network retry', () => {
    assert.equal(core.decideOnHttpStatus(200), 'ok');
    assert.equal(core.decideOnHttpStatus(403), 'stop');
    assert.equal(core.decideOnHttpStatus(429), 'stop');
    assert.equal(core.decideOnHttpStatus(400), 'fail');
    assert.equal(core.decideOnHttpStatus(404), 'fail');
    assert.equal(core.decideOnHttpStatus(500), 'retry');
    assert.equal(core.decideOnHttpStatus(502), 'retry');
    assert.equal(core.decideOnHttpStatus(0), 'retry');
});

test('apiErrorMessage understands both Yandex error shapes', () => {
    assert.equal(core.apiErrorMessage({ statusCode: 403, error: 'Forbidden', message: 'Invalid key' }), 'Invalid key');
    assert.equal(core.apiErrorMessage({ error: { message: 'limit' } }), 'limit');
    assert.equal(core.apiErrorMessage({ response: {} }), '');
    assert.equal(core.apiErrorMessage(null), '');
});
