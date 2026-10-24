#!/usr/bin/env node
// Проверка чистоты репозитория перед коммитом.
// Ищет ключи API (UUID) и запрещённые слова. Режимы:
//   node scripts/check-clean.mjs           — рабочее дерево (все файлы, кроме .git и node_modules)
//   node scripts/check-clean.mjs --staged  — содержимое индекса (то, что реально уйдёт в коммит)
// Файлы xlsx/xlsm/docx (zip) сканируются изнутри: текст xml-вхождений проверяется построчно,
// нечитаемый архив считается нарушением (zip-unreadable).
// Сторонние файлы из vendor/ не сканируются построчно, но их SHA-256 должен совпасть с закреплённым.
// Шаблоны слов собираются из кодов символов, чтобы этот файл сам их не содержал.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipTextEntries } from './zip-text.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const selfRel = 'scripts/check-clean.mjs';
const staged = process.argv.includes('--staged');
const SKIP_DIRS = new Set(['.git', 'node_modules']);
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.xls', '.pdf', '.woff', '.woff2', '.ttf']);
const ZIP_EXT = new Set(['.xlsx', '.xlsm', '.docx']);

// Закреплённые хеши сторонних файлов: подмена содержимого ловится, построчный скан не нужен.
const VENDOR_SHA256 = {
    'vendor/xlsx.full.min.js': 'cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41'
};

const word = (...codes) => String.fromCharCode(...codes);
const PATTERNS = [
    { name: 'uuid', re: /(?<![0-9a-f])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-f])/i },
    { name: 'brand', re: new RegExp('(^|[^a-z])' + word(84, 75, 69) + '([^a-z]|$)', 'i') },
    { name: 'industry', re: new RegExp(word(1090, 1072, 1073, 1072, 1082), 'i') },
    { name: 'old-field', re: new RegExp(word(1074, 1099, 1074, 1077, 1089, 1082), 'i') },
    { name: 'retail', re: new RegExp(word(1084, 1072, 1075, 1072, 1079, 1080, 1085), 'i') },
];

function decode(buf) {
    if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return buf.toString('utf16le', 2);
    if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) return Buffer.from(buf.subarray(2)).swap16().toString('utf16le');
    if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return buf.toString('utf8', 3);
    // UTF-16LE без BOM: каждый второй байт нулевой
    let zeros = 0; const n = Math.min(buf.length, 200);
    for (let i = 1; i < n; i += 2) if (buf[i] === 0) zeros++;
    if (n >= 8 && zeros > n / 4) return buf.toString('utf16le');
    const utf8 = buf.toString('utf8');
    // cp1251 (кириллица) — если UTF-8 не разобрался, пробуем latin1→cp1251 грубо: достаточно для поиска слов
    return utf8.includes('�') ? cp1251(buf) : utf8;
}

function cp1251(buf) {
    let out = '';
    for (const b of buf) out += b < 0x80 ? String.fromCharCode(b) : (b >= 0xC0 ? String.fromCharCode(0x410 + b - 0xC0) : (b === 0xA8 ? 'Ё' : b === 0xB8 ? 'ё' : String.fromCharCode(b)));
    return out;
}

// Рабочее дерево глазами git: отслеживаемые и новые файлы, без игнорируемых (.gitignore).
// Игнорируемый файл может попасть в коммит только через `git add -f`, и тогда его поймает режим --staged.
function* walkTree() {
    let list;
    try {
        list = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root }).toString('utf8');
    } catch (e) {
        list = null;
    }
    if (list === null) { yield* walkDir(root); return; }
    for (const rel of list.split('\0').filter(Boolean)) {
        const full = path.join(root, rel);
        try { if (!statSync(full).isFile()) continue; } catch (e) { continue; }
        yield { rel, read: () => readFileSync(full) };
    }
}

// Без git (например, скачанный архив): обычный обход каталога.
function* walkDir(dir) {
    for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) { if (!SKIP_DIRS.has(name)) yield* walkDir(full); }
        else yield { rel: path.relative(root, full).split(path.sep).join('/'), read: () => readFileSync(full) };
    }
}

function* walkIndex() {
    const out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { cwd: root });
    for (const rel of out.toString('utf8').split('\0').filter(Boolean)) {
        yield { rel, read: () => execFileSync('git', ['show', ':' + rel], { cwd: root, maxBuffer: 64 * 1024 * 1024 }) };
    }
}

let hits = 0;
const report = (rel, line, name) => { hits++; console.log(`${rel}:${line}: ${name}`); };

for (const file of staged ? walkIndex() : walkTree()) {
    if (file.rel === selfRel) continue;
    if (Object.hasOwn(VENDOR_SHA256, file.rel)) {
        const sha = createHash('sha256').update(file.read()).digest('hex');
        if (sha !== VENDOR_SHA256[file.rel]) report(file.rel, 0, 'vendor-hash-mismatch');
        continue;
    }
    if (ZIP_EXT.has(path.extname(file.rel).toLowerCase())) {
        let entries;
        try { entries = zipTextEntries(file.read()); } catch (e) { report(file.rel, 0, 'zip-unreadable'); continue; }
        for (const entry of entries) {
            entry.text.split(/\r?\n/).forEach((line, i) => {
                for (const p of PATTERNS) if (p.re.test(line)) report(file.rel + '!' + entry.name, i + 1, p.name);
            });
        }
        continue;
    }
    if (BINARY_EXT.has(path.extname(file.rel).toLowerCase())) continue;
    const text = decode(file.read());
    text.split(/\r?\n/).forEach((line, i) => {
        for (const p of PATTERNS) if (p.re.test(line)) report(file.rel, i + 1, p.name);
    });
}

if (staged) {
    // сообщение коммита тоже не должно содержать секретов
    const msgFile = path.join(root, '.git', 'COMMIT_EDITMSG');
    try {
        const msg = decode(readFileSync(msgFile));
        for (const p of PATTERNS) if (p.re.test(msg)) report('COMMIT_EDITMSG', 0, p.name);
    } catch (e) { /* нет файла — не pre-commit */ }
}

if (hits > 0) {
    console.log(`check-clean: найдено совпадений: ${hits}. Коммит запрещён.`);
    process.exit(1);
}
console.log(`check-clean: чисто (${staged ? 'индекс' : 'рабочее дерево'}).`);
