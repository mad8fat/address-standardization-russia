import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './load-core.mjs';
import { vector } from './helpers.mjs';

const core = loadCore();

test('parseInputRows skips header rows and blank addresses', () => {
    const rows = [['Адрес', 'Метка'], ['г. Москва, ул. Тверская, 10', 'Офис 1'], ['   ', ''], ['улица Ленина, 12']];
    assert.deepEqual(core.parseInputRows(rows), [
        { original: 'г. Москва, ул. Тверская, 10', label: 'Офис 1' },
        { original: 'улица Ленина, 12', label: '' }
    ]);
    assert.deepEqual(core.parseInputRows([['адрес:', 'x'], [' Г. Екатеринбург, пр-кт Ленина, 24а ', 42]]),
        [{ original: 'Г. Екатеринбург, пр-кт Ленина, 24а', label: '42' }]);
    assert.deepEqual(core.parseInputRows([['Адрес доставки'], ['г. Орёл, ул. Ленина, 1']]), [{ original: 'г. Орёл, ул. Ленина, 1', label: '' }]);
    assert.deepEqual(core.parseInputRows([[''], ['Адреса', 'Метка'], ['г. Орёл, ул. Ленина, 1']]), [{ original: 'г. Орёл, ул. Ленина, 1', label: '' }]);
});

test('parseInputRows truncates absurdly long cells', () => {
    const long = 'ул. Ленина, 12, '.repeat(200);
    const items = core.parseInputRows([[long]]);
    assert.equal(items[0].original.length, core.MAX_ADDRESS_LENGTH);
});

test('parseTextInput splits lines and tabs, dropping empty lines', () => {
    assert.deepEqual(core.parseTextInput('a\tb\n\nc\r\n'), [['a', 'b'], ['c']]);
});

test('federalDistrict maps the first province to its short code and ignores prototype keys', () => {
    assert.equal(core.federalDistrict(['Уральский федеральный округ', 'Свердловская область']), 'УФО');
    assert.equal(core.federalDistrict(['Иль-де-Франс']), '');
    assert.equal(core.federalDistrict([]), '');
    assert.equal(core.federalDistrict(['constructor']), '');
});

test('precisionLabel translates Yandex precision values and ignores prototype keys', () => {
    assert.equal(core.precisionLabel('exact'), 'точный дом');
    assert.equal(core.precisionLabel('number'), 'тот же номер, другой корпус');
    assert.equal(core.precisionLabel('near'), 'ближайший дом');
    assert.equal(core.precisionLabel('range'), 'приблизительно');
    assert.equal(core.precisionLabel('street'), '');
    assert.equal(core.precisionLabel(''), '');
    assert.equal(core.precisionLabel('constructor'), '');
    assert.equal(core.precisionLabel('toString'), '');
});

test('buildGeocodeUrl uses the fixed parameters and encodes the address', () => {
    const url = core.buildGeocodeUrl('K', 'ул. Мира, 15');
    assert.ok(url.startsWith('https://geocode-maps.yandex.ru/1.x/?'));
    assert.match(url, /apikey=K(&|$)/);
    assert.match(url, /results=10/);
    assert.match(url, /rspn=1/);
    assert.match(url, /lang=ru_RU/);
    assert.match(url, /format=json/);
    assert.ok(url.includes('bbox=19.6,41.1~180,82'));
    assert.ok(url.includes('geocode=%D1%83%D0%BB.%20%D0%9C%D0%B8%D1%80%D0%B0%2C%2015'));
});

test('mapLinks builds Yandex Maps and 2GIS links', () => {
    const l = core.mapLinks(56.837238, 60.597888, 'Екатеринбург, проспект Ленина, 24А');
    assert.equal(l.yandex, 'https://yandex.ru/maps/?ll=60.597888%2C56.837238&z=17&pt=60.597888%2C56.837238,pm2rdm');
    assert.ok(l.dgis.startsWith('https://2gis.ru/search/'));
    assert.ok(l.dgis.includes('?m=60.597888%2C56.837238%2F18'));
});

test('parseCoords accepts dots, decimal commas and spaces, rejects garbage and out-of-range', () => {
    assert.deepEqual(core.parseCoords('55.7558, 37.6173'), [55.7558, 37.6173]);
    assert.deepEqual(core.parseCoords('55,7558, 37,6173'), [55.7558, 37.6173]);
    assert.deepEqual(core.parseCoords('55,7558; 37,6173'), [55.7558, 37.6173]);
    assert.deepEqual(core.parseCoords('55.7558 37.6173'), [55.7558, 37.6173]);
    assert.equal(core.parseCoords('37.6173x, 55'), null);
    assert.equal(core.parseCoords('95, 37'), null);
    assert.equal(core.parseCoords(''), null);
});

test('buildRecord fills a confirmed record from the top candidate', () => {
    const r = vector('confirmed.json').cases.find(r => r.input.includes('Г. Екатеринбург'));
    const cands = r.candidates;
    const cls = core.classify(r.input, cands);
    const rec = core.buildRecord({ original: r.input, label: 'Офис 1', cands, cls });
    assert.equal(rec.status, core.STATUS.CONFIRMED);
    assert.equal(rec.precision, 'точный дом');
    assert.equal(rec.check, 'авто');
    assert.equal(rec.district, 'УФО');
    assert.equal(rec.province, 'Свердловская область');
    assert.equal(rec.locality, 'Екатеринбург');
    assert.equal(rec.street, 'проспект Ленина');
    assert.equal(rec.house, '24А');
    assert.equal(rec.streetAndHouse, 'проспект Ленина, 24А');
    assert.equal(rec.finalAddress, 'Екатеринбург, проспект Ленина, 24А');
    assert.equal(rec.coordinates, `${cands[0].lat}, ${cands[0].lon}`);
    assert.equal(rec.label, 'Офис 1');
    assert.equal(rec.original, r.input);
    assert.equal(rec.candidatesText, '');
    assert.ok(rec.yandexLink.startsWith('https://yandex.ru/maps/'));
    assert.ok(rec.dgisLink.startsWith('https://2gis.ru/'));
});

test('buildRecord for an ambiguous address lists candidates and leaves the guessed city empty', () => {
    const r = vector('no-city.json').cases.find(r => r.input === 'улица Ленина, 12');
    const cands = r.candidates;
    const rec = core.buildRecord({ original: r.input, label: '', cands, cls: core.classify(r.input, cands) });
    assert.equal(rec.status, core.STATUS.NO_CITY);
    assert.ok(rec.candidatesText.startsWith('Киров; Ижевск; Благовещенск'));
    assert.equal(rec.candidates.length, cands.length);
    assert.equal(rec.locality, '');
    assert.equal(rec.province, '');
    assert.equal(rec.district, '');
    assert.equal(rec.coordinates, '');
    assert.equal(rec.yandexLink, '');
    assert.equal(rec.finalAddress, '');
    assert.equal(rec.street, 'улица Ленина');
    assert.equal(rec.house, '12');
});

test('buildRecord with an error yields an error record with the reason kept', () => {
    const rec = core.buildRecord({ original: 'x', label: 'Склад', error: 'HTTP 500' });
    assert.equal(rec.status, core.STATUS.ERROR);
    assert.equal(rec.error, 'HTTP 500');
    assert.equal(rec.finalAddress, '');
    assert.equal(rec.coordinates, '');
    assert.equal(rec.label, 'Склад');
    assert.deepEqual(rec.candidates, []);
});

test('recordToExportRow follows EXPORT_HEADERS order', () => {
    assert.deepEqual(core.EXPORT_HEADERS, ['№', 'Исходный адрес', 'Метка', 'Федеральный округ', 'Регион',
        'Населённый пункт', 'Улица и дом', 'Итоговый адрес', 'Координаты', 'Яндекс Карты', '2ГИС',
        'Статус', 'Точность', 'Проверка', 'Кандидаты']);
    const r = vector('confirmed.json').cases.find(r => r.input.includes('Г. Екатеринбург'));
    const cands = r.candidates;
    const rec = core.buildRecord({ original: r.input, label: '', cands, cls: core.classify(r.input, cands) });
    const row = core.recordToExportRow(rec, 0);
    assert.equal(row.length, 15);
    assert.equal(row[0], 1);
    assert.equal(row[1], r.input);
    assert.equal(row[2], '');
    assert.equal(row[11], 'Подтверждён');
    assert.equal(row[13], 'авто');
    assert.equal(row[14], '');
});

test('exportFileName uses the local date', () => {
    assert.match(core.exportFileName(new Date(2026, 9, 21, 1, 0)), /^addresses_2026-10-21\.xlsx$/);
});
