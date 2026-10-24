import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './load-core.mjs';

const core = loadCore();

test('cleanAddressForQuery stays fast on a 32767-character cell', () => {
    const big = ('ул. Ленина, 12, пом, ').repeat(1500).slice(0, 32767);
    const t0 = Date.now();
    core.cleanAddressForQuery(big);
    assert.ok(Date.now() - t0 < 200, `took ${Date.now() - t0} ms`);
});

test('expandCityAbbreviations expands known city abbreviations at word boundaries only', () => {
    const e = s => core.expandCityAbbreviations(s);
    assert.equal(e('СПб, Невский пр., 28'), 'Санкт-Петербург, Невский пр., 28');
    assert.equal(e('С.-Петербург, Невский пр., 28'), 'Санкт-Петербург, Невский пр., 28');
    assert.equal(e('г. Санкт Петербург, Невский пр., 28'), 'г. Санкт-Петербург, Невский пр., 28');
    assert.equal(e('Н. Новгород, Кремль, 1'), 'Нижний Новгород, Кремль, 1');
    assert.equal(e('Н.Новгород, Кремль, 1'), 'Нижний Новгород, Кремль, 1');
    assert.equal(e('Ростов н/Д, Будённовский пр., 1'), 'Ростов-на-Дону, Будённовский пр., 1');
    assert.equal(e('Ростов на Дону, Будённовский пр., 1'), 'Ростов-на-Дону, Будённовский пр., 1');
    assert.equal(e('Ростов-на-Дону, Будённовский пр., 1'), 'Ростов-на-Дону, Будённовский пр., 1');
    assert.equal(e('Екб, пр. Ленина, 24А'), 'Екатеринбург, пр. Ленина, 24А');
    assert.equal(e('мск, ул. Тверская, 13'), 'Москва, ул. Тверская, 13');
    assert.equal(e('Нск, Красный пр., 34'), 'Новосибирск, Красный пр., 34');
    // не трогать: часть другого слова, Ростовская область, неоднозначное «Влг»
    assert.equal(e('Омск, ул. Ленина, 1'), 'Омск, ул. Ленина, 1');
    assert.equal(e('Томск, пр. Ленина, 36'), 'Томск, пр. Ленина, 36');
    assert.equal(e('Ростовская обл, Ростов-на-Дону, Будённовский пр., 1'), 'Ростовская обл, Ростов-на-Дону, Будённовский пр., 1');
    assert.equal(e('Влг, пр. Ленина, 1'), 'Влг, пр. Ленина, 1');
});

test('cleanAddressForQuery expands abbreviations before anything else', () => {
    assert.equal(core.cleanAddressForQuery('СПб, Невский пр., 28, оф. 5'), 'Санкт-Петербург, Невский пр., 28');
});

test('expandCityAbbreviations turns typographic dashes into a hyphen', () => {
    assert.equal(core.expandCityAbbreviations('Ростов\u2013на\u2013Дону'), 'Ростов-на-Дону');   // короткое тире
    assert.equal(core.expandCityAbbreviations('Комсомольск\u2011на\u2011Амуре'), 'Комсомольск-на-Амуре');
    assert.equal(core.expandCityAbbreviations('a\u2010b\u2012c\u2014d\u2015e\u2212f'), 'a-b-c-d-e-f');
});
