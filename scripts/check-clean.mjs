#!/usr/bin/env node
// Проверка чистоты рабочего дерева перед коммитом.
// Ищет ключи API (UUID) и запрещённые слова во всех файлах репозитория.
// Шаблоны собираются из кодов символов, чтобы этот файл сам их не содержал.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const self = path.resolve(fileURLToPath(import.meta.url));
const SKIP_DIRS = new Set(['.git', 'node_modules', '.superpowers']);
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.xlsx', '.xls', '.pdf', '.woff', '.woff2', '.ttf']);

const word = (...codes) => String.fromCharCode(...codes);
const PATTERNS = [
    { name: 'uuid', re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i },
    { name: 'brand', re: new RegExp(word(84, 75, 69)) },                       // латиница, 3 буквы
    { name: 'industry', re: new RegExp(word(1090, 1072, 1073, 1072, 1082), 'i') }, // кириллица, 5 букв
    { name: 'old-field', re: new RegExp(word(1074, 1099, 1074, 1077, 1089, 1082), 'i') }, // кириллица, 6 букв
    { name: 'retail', re: new RegExp(word(1084, 1072, 1075, 1072, 1079, 1080, 1085), 'i') }, // кириллица, 7 букв
];

function* walk(dir) {
    for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) {
            if (!SKIP_DIRS.has(name)) yield* walk(full);
        } else {
            yield full;
        }
    }
}

let hits = 0;
for (const file of walk(root)) {
    if (path.resolve(file) === self) continue;
    if (BINARY_EXT.has(path.extname(file).toLowerCase())) continue;
    const text = readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
        for (const p of PATTERNS) {
            if (p.re.test(line)) {
                hits++;
                console.log(`${path.relative(root, file)}:${i + 1}: ${p.name}`);
            }
        }
    });
}

if (hits > 0) {
    console.log(`check-clean: найдено совпадений: ${hits}. Коммит запрещён.`);
    process.exit(1);
}
console.log('check-clean: чисто.');
