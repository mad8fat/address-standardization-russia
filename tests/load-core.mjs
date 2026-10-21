import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadCore() {
    const html = readFileSync(path.join(root, 'index.html'), 'utf8');
    const m = html.match(/<script id="core">([\s\S]*?)<\/script>/);
    if (!m) throw new Error('index.html: блок <script id="core"> не найден');
    const context = vm.createContext({});
    vm.runInContext(m[1] + '\n;AddrCore;', context, { filename: 'index.html#core' });
    return vm.runInContext('AddrCore', context);
}
