import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync, readFileSync } from 'node:fs';
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

test('check-clean catches a UTF-16 file and a UUID glued to a prefix', () => {
    const planted = path.join(root, 'tmp-planted-utf16.txt');
    const fakeKey = ['12345678', '1234', '1234', '1234', '123456789abc'].join('-');
    writeFileSync(planted, Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(`KEY_${fakeKey}\n`, 'utf16le')]));
    try {
        const r = runCheck();
        assert.equal(r.status, 1);
        assert.match(r.stdout, /tmp-planted-utf16\.txt/);
    } finally {
        unlinkSync(planted);
    }
});

test('check-clean verifies the pinned hash of vendored files', () => {
    const vendorFile = path.join(root, 'vendor', 'xlsx.full.min.js');
    const original = readFileSync(vendorFile);
    writeFileSync(vendorFile, Buffer.concat([original, Buffer.from('\n// tampered\n')]));
    try {
        const r = runCheck();
        assert.equal(r.status, 1);
        assert.match(r.stdout, /vendor-hash-mismatch/);
    } finally {
        writeFileSync(vendorFile, original);
    }
});
