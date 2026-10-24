// Минимальный читатель zip без зависимостей: отдаёт текст xml/rels-вхождений (для xlsx/docx).
import { inflateRawSync } from 'node:zlib';

export function zipTextEntries(buf, opts = {}) {
    const maxEntryBytes = opts.maxEntryBytes ?? 50 * 1024 * 1024;
    // EOCD ищем с конца: 22 байта записи + до 65535 байт комментария
    let eocd = -1;
    const lowest = Math.max(0, buf.length - 65557);
    for (let i = buf.length - 22; i >= lowest; i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a zip');
    const total = buf.readUInt16LE(eocd + 10);
    let pos = buf.readUInt32LE(eocd + 16);
    const out = [];
    for (let n = 0; n < total; n++) {
        if (buf.readUInt32LE(pos) !== 0x02014b50) throw new Error('bad central directory');
        const method = buf.readUInt16LE(pos + 10);
        const csize = buf.readUInt32LE(pos + 20);
        const usize = buf.readUInt32LE(pos + 24);
        const nameLen = buf.readUInt16LE(pos + 28);
        const extraLen = buf.readUInt16LE(pos + 30);
        const commentLen = buf.readUInt16LE(pos + 32);
        const local = buf.readUInt32LE(pos + 42);
        const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);
        pos += 46 + nameLen + extraLen + commentLen;
        if (!/\.(xml|rels)$/i.test(name)) continue;
        if (usize > maxEntryBytes || (method !== 0 && method !== 8)) continue;
        if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error('bad local header');
        // размеры берём из центрального каталога: в локальном заголовке они могут быть нулевыми
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        if (start + csize > buf.length) throw new Error('truncated entry');
        const data = buf.subarray(start, start + csize);
        const raw = method === 0 ? data : inflateRawSync(data, { maxOutputLength: maxEntryBytes });
        out.push({ name, text: raw.toString('utf8') });
    }
    return out;
}
