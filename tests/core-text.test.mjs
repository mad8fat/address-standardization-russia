import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './load-core.mjs';

const core = loadCore();

test('tokenize drops type words, short words and normalizes ё', () => {
    assert.deepEqual(core.tokenize('г. Ярославль, Советская ул, дом № 57'), ['ярославль', 'советская']);
    assert.deepEqual(core.tokenize('Усть-Ордынский п, Ленина ул'), ['усть', 'ордынский', 'ленина']);
    assert.deepEqual(core.tokenize('Кремлёвская улица, Орёл'), ['кремлевская', 'орел']);
    assert.deepEqual(core.tokenize('муниципальное образование Екатеринбург'), ['екатеринбург']);
});

test('cleanAddressForQuery cuts the premises segment and the numeric tail after it', () => {
    assert.equal(
        core.cleanAddressForQuery('150000, Ярославская обл, Ярославль г, Кирова ул, дом № 10/25, пом. №№1-5,7,12-14'),
        '150000, Ярославская обл, Ярославль г, Кирова ул, дом № 10/25'
    );
    assert.equal(core.cleanAddressForQuery('ул. Строителей, 25, литера А, этаж 2'), 'ул. Строителей, 25');
    assert.equal(core.cleanAddressForQuery('125009, г Москва, ул Большая Дмитровка, д. 1, кв. 5'), '125009, г Москва, ул Большая Дмитровка, д. 1');
    assert.equal(core.cleanAddressForQuery('Пермь, ул. Ленина, 23, офис 101'), 'Пермь, ул. Ленина, 23');
    assert.equal(core.cleanAddressForQuery('124365, г. Москва, г. Зеленоград, корп.360, кв.100'), '124365, г. Москва, г. Зеленоград, корп.360');
});

test('cleanAddressForQuery keeps a city that comes after the premises marker', () => {
    assert.equal(core.cleanAddressForQuery('ул. Ленина, д. 5, кв. 3, г. Ижевск'), 'ул. Ленина, д. 5, г. Ижевск');
    assert.equal(core.cleanAddressForQuery('ул. Ленина 12 кв 5'), 'ул. Ленина 12');
});

test('cleanAddressForQuery collapses empty CSV-style fields and keeps house markers', () => {
    assert.equal(core.cleanAddressForQuery(',664003,Иркутская обл,,Иркутск г,,Ленина ул,1,,,'), '664003, Иркутская обл, Иркутск г, Ленина ул, 1');
    assert.equal(core.cleanAddressForQuery('Ярославская обл, Карабиха д, Школьная ул, дом № стр. 2'), 'Ярославская обл, Карабиха д, Школьная ул, дом № стр. 2');
});

test('cleanAddressForQuery drops a leading premises segment and ignores look-alike street names', () => {
    assert.equal(core.cleanAddressForQuery('Павильон, ул Садовая, д 2'), 'ул Садовая, д 2');
    assert.equal(core.cleanAddressForQuery('ул. Офицерская, 3'), 'ул. Офицерская, 3');
    assert.equal(core.cleanAddressForQuery('Подъездная ул., 7'), 'Подъездная ул., 7');
    assert.equal(core.cleanAddressForQuery('Литейный пр., 4'), 'Литейный пр., 4');
});

test('cleanAddressForQuery stays fast on a 32767-character cell', () => {
    const big = ('ул. Ленина, 12, пом, ').repeat(1500).slice(0, 32767);
    const t0 = Date.now();
    core.cleanAddressForQuery(big);
    assert.ok(Date.now() - t0 < 200, `took ${Date.now() - t0} ms`);
});
