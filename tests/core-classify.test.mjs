import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './load-core.mjs';
import { fixture, vector, house } from './helpers.mjs';

const core = loadCore();
const S = () => core.STATUS;

test('STATUS has the five exact labels', () => {
    assert.deepEqual(S(), {
        CONFIRMED: 'Подтверждён', NO_CITY: 'Город не указан', CITY_UNCONFIRMED: 'Город не подтверждён',
        NO_HOUSE: 'Дом не найден', ERROR: 'Ошибка'
    });
});

test('parseGeocoderResponse extracts components from a raw Yandex response', () => {
    const cands = core.parseGeocoderResponse(fixture('raw-response.json'));
    assert.equal(cands.length, 1);
    const c = cands[0];
    assert.equal(c.kind, 'house');
    assert.equal(c.precision, 'exact');
    assert.equal(c.locality, 'Екатеринбург');
    assert.ok(c.province.includes('Свердловская область'));
    assert.equal(c.street, 'проспект Ленина');
    assert.equal(c.house, '24А');
    assert.equal(c.lat, 56.837238);
    assert.equal(c.lon, 60.597888);
});

test('empty response gives no candidates and status NO_HOUSE', () => {
    const cands = core.parseGeocoderResponse(fixture('empty-response.json'));
    assert.deepEqual(cands, []);
    const r = core.classify('qwertyuiop12345', cands);
    assert.equal(r.status, S().NO_HOUSE);
    assert.equal(r.candidateCount, 0);
    assert.equal(r.top, null);
});

test('matchAnchor reports the level at which the input confirms the candidate', () => {
    const full = vector('confirmed.json').cases;
    const top = s => { const r = full.find(r => r.input.includes(s)); return [r.input, r.candidates[0]]; };
    assert.equal(core.matchAnchor(...top('Г. Екатеринбург, пр-кт Ленина')), 'locality');
    assert.equal(core.matchAnchor(...top('Иваново г, Революции пл')), 'area');       // у дома нет locality, есть округ
    assert.equal(core.matchAnchor(...top('Усть-Ордынский п')), 'locality');
    assert.equal(core.matchAnchor(...top('г. Орёл')), 'locality');                    // ё → е
    const mosk = vector('no-city.json').cases.find(r => r.input === 'ул. Мира, 15');
    assert.equal(core.matchAnchor(mosk.input, mosk.candidates[0]), null);
});

test('street name never confirms a same-named city, district or region', () => {
    const others = [house('Красноярск', ['Сибирский федеральный округ', 'Красноярский край'], 'улица Пушкина'),
                    house('Якутск', ['Дальневосточный федеральный округ', 'Республика Саха (Якутия)'], 'улица Пушкина')];
    const pushkin = house('Пушкин', ['Северо-Западный федеральный округ', 'Санкт-Петербург'], 'улица Пушкина');
    assert.equal(core.matchAnchor('ул. Пушкина, 10', pushkin), null);
    assert.equal(core.classify('ул. Пушкина, 10', [pushkin, ...others]).status, S().NO_CITY);
    const chekhov = house('Чехов', ['Центральный федеральный округ', 'Московская область'], 'улица Чехова');
    assert.equal(core.matchAnchor('ул. Чехова, 5', chekhov), null);
    const lenInsky = house('', ['Центральный федеральный округ', 'Московская область'], 'Ленинский проспект', '10', { area: 'Ленинский городской округ' });
    assert.equal(core.matchAnchor('Ленинский пр-кт, 10', lenInsky), null);
    const mosk = house('Воскресенск', ['Центральный федеральный округ', 'Московская область'], 'Московская улица', '21А');
    assert.equal(core.matchAnchor('ул. Московская, 21А', mosk), null);
    // а настоящий город со «своей» улицей подтверждается
    assert.equal(core.matchAnchor('г. Киров, ул. Кирова, 5', house('Киров', ['Приволжский федеральный округ', 'Кировская область'], 'улица Кирова', '5')), 'locality');
});

test('only a region or district in the input does not confirm an address found in several towns', () => {
    const mo = ['Центральный федеральный округ', 'Московская область'];
    const cands = [house('Подольск', mo, 'улица Ленина', '12'), house('Химки', mo, 'улица Ленина', '12'), house('Клин', mo, 'улица Ленина', '12')];
    assert.equal(core.classify('Московская обл., ул. Ленина, 12', cands).status, S().NO_CITY);
    const yar = ['Центральный федеральный округ', 'Ярославская область'];
    const area = [house('посёлок Щедрино', yar, 'улица Ленина', '5', { area: 'Ярославский район' }),
                  house('посёлок Ивняки', yar, 'улица Ленина', '5', { area: 'Ярославский район' })];
    assert.equal(core.classify('Ярославская обл, Ярославский р-н, Ленина ул, 5', area).status, S().NO_CITY);
    // один дом в районе — подтверждаем по району
    assert.equal(core.classify('Ярославская обл, Ярославский р-н, Ленина ул, 5', area.slice(0, 1)).status, S().CONFIRMED);
});

test('a town name shared by several regions needs the region in the input', () => {
    const kirov1 = house('Киров', ['Приволжский федеральный округ', 'Кировская область'], 'улица Ленина', '12');
    const kirov2 = house('Киров', ['Центральный федеральный округ', 'Калужская область'], 'улица Ленина', '12');
    assert.equal(core.classify('г. Киров, ул. Ленина, 12', [kirov1, kirov2]).status, S().CITY_UNCONFIRMED);
    assert.equal(core.classify('Кировская обл, г. Киров, ул. Ленина, 12', [kirov1, kirov2]).status, S().CONFIRMED);
    assert.equal(core.classify('г. Киров, ул. Ленина, 12', [kirov1]).status, S().CONFIRMED);
});

test('kind=other without a house number is not a house', () => {
    const snt = { kind: 'other', precision: 'other', text: '', province: ['Центральный федеральный округ', 'Московская область'], area: '', locality: 'СНТ Лира', street: '', house: '', lat: 55, lon: 37 };
    assert.equal(core.classify('СНТ Лира', [snt]).status, S().NO_HOUSE);
    const withHouse = { ...snt, house: '5', locality: 'Мытищи' };
    assert.equal(core.classify('г. Мытищи, мкр Дружба, 5', [withHouse]).status, S().CONFIRMED);
});

test('countDistinctLocalities counts house-level candidates by region+locality', () => {
    const lenina = vector('no-city.json').cases.find(r => r.input === 'улица Ленина, 12');
    assert.equal(core.countDistinctLocalities(lenina.candidates), 10);
    const ekb = vector('confirmed.json').cases.find(r => r.input.includes('Г. Екатеринбург'));
    assert.equal(core.countDistinctLocalities(ekb.candidates), 1);
});

test('classify confirms an abbreviated city against the full candidate name', () => {
    const spb = house('Санкт-Петербург', ['Северо-Западный федеральный округ', 'Санкт-Петербург'], 'Невский проспект', '28');
    const r = core.classify('СПб, Невский пр., 28', [spb]);
    assert.equal(r.status, S().CONFIRMED);
    assert.equal(r.anchor, 'locality');
    const rnd = house('Ростов-на-Дону', ['Южный федеральный округ', 'Ростовская область'], 'Будённовский проспект', '1');
    assert.equal(core.classify('Ростов н/Д, Будённовский пр., 1', [rnd]).status, S().CONFIRMED);
});
