import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts', 'check-clean.mjs');

function runCheck() {
    return spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
}

test('check-clean fails and names the file when a key-like UUID is planted', () => {
    const planted = path.join(root, 'tmp-planted.txt');
    // UUID собирается из частей, чтобы сам тестовый файл не содержал полный шаблон.
    const fakeKey = ['12345678', '1234', '1234', '1234', '123456789abc'].join('-');
    writeFileSync(planted, `apikey ${fakeKey}\n`);
    try {
        const r = runCheck();
        assert.equal(r.status, 1, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
        assert.match(r.stdout, /tmp-planted\.txt/);
    } finally {
        unlinkSync(planted);
    }
});

test('check-clean passes on a clean tree', () => {
    const r = runCheck();
    assert.equal(r.status, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
});
