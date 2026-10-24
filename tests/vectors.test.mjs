import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { loadCore } from './load-core.mjs';

const core = loadCore();
const dir = new URL('./vectors/', import.meta.url);
const load = name => JSON.parse(readFileSync(new URL(name, dir), 'utf8'));

for (const name of readdirSync(dir).filter(f => f.endsWith('.json') && !['tokenize.json', 'clean.json'].includes(f))) {
    const vec = load(name);
    test(`vectors/${name}: ${vec.description}`, () => {
        assert.ok(vec.cases.length > 0);
        for (const c of vec.cases) {
            const got = core.classify(c.input, c.candidates);
            assert.equal(got.status, c.expected.status, `${c.input} → ${got.status} (anchor=${got.anchor}, n=${got.candidateCount})`);
            if ('anchor' in c.expected) assert.equal(got.anchor, c.expected.anchor, c.input);
            if ('topLocality' in c.expected) assert.equal(got.top.locality, c.expected.topLocality, c.input);
            if ('reordered' in c.expected) assert.equal(!!got.reordered, c.expected.reordered, c.input);
        }
    });
}

test('vectors/tokenize.json', () => {
    for (const c of load('tokenize.json').cases) assert.deepEqual(core.tokenize(c.input), c.expected, c.input);
});

test('vectors/clean.json', () => {
    for (const c of load('clean.json').cases) assert.equal(core.cleanAddressForQuery(c.input), c.expected, c.input);
});
