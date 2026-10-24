import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const XLSX = require('../vendor/xlsx.full.min.js');

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

function xlsxWith(text) {
    const ws = XLSX.utils.aoa_to_sheet([['Адрес'], [text]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Лист1');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

test('check-clean finds a UUID inside an xlsx cell', () => {
    const planted = path.join(root, 'tmp-planted.xlsx');
    const fakeKey = ['12345678', '1234', '1234', '1234', '123456789abc'].join('-');
    writeFileSync(planted, xlsxWith('ключ ' + fakeKey));
    try {
        const r = runCheck();
        assert.equal(r.status, 1, r.stdout);
        assert.match(r.stdout, /tmp-planted\.xlsx.*uuid/);
    } finally { unlinkSync(planted); }
});

test('check-clean rejects a corrupted xlsx instead of crashing', () => {
    const planted = path.join(root, 'tmp-broken.xlsx');
    writeFileSync(planted, Buffer.from('this is not a zip archive'));
    try {
        const r = runCheck();
        assert.equal(r.status, 1, r.stdout);
        assert.match(r.stdout, /tmp-broken\.xlsx.*zip-unreadable/);
    } finally { unlinkSync(planted); }
});
