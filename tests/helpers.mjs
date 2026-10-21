import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const fixture = name => JSON.parse(readFileSync(path.join(here, 'fixtures', name), 'utf8'));

// Плоские фикстуры (results[] с province «A / B») → Candidate
export function toCandidate(p) {
    const [lon, lat] = String(p.pos).split(' ').map(Number);
    const localities = p.locality ? p.locality.split(' / ') : [];
    return {
        kind: p.kind, precision: p.precision, text: p.text,
        province: p.province ? p.province.split(' / ') : [],
        area: p.area ? p.area.split(' / ')[0] : '',
        locality: localities[localities.length - 1] || '',
        street: p.street || '', house: p.house || '', lat, lon
    };
}

// Синтетический кандидат-дом для негативных тестов
export function house(locality, province, street, h = '10', extra = {}) {
    return { kind: 'house', precision: 'exact', text: '', province, area: '', locality, street, house: h, lat: 55, lon: 37, ...extra };
}
