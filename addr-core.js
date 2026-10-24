// addr-core.js — ядро нормализации российских адресов через Яндекс Геокодер: чистые функции без DOM, без зависимостей, подключается тегом script или require. Лицензия MIT. Репозиторий: https://github.com/mad8fat/address-standardization-russia
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.AddrCore = factory();
}(typeof self !== 'undefined' ? self : this, function () {
// Ядро: чистые функции без DOM. Тестируются в Node (tests/*.test.mjs).
const AddrCore = {};
AddrCore.VERSION = '1.1.0';

// Слова-типы адресных объектов, не участвующие в сравнении названий.
AddrCore.STOP_WORDS = new Set([
    'г', 'город', 'обл', 'область', 'район', 'с', 'село', 'п', 'пос', 'поселок', 'рп',
    'д', 'деревня', 'ул', 'улица', 'проспект', 'пер', 'переулок', 'ш', 'шоссе', 'мкр',
    'микрорайон', 'дом', 'кв', 'к', 'корп', 'корпус', 'стр', 'строение', 'зд', 'здание',
    'пом', 'помещ', 'помещение', 'офис', 'литера', 'этаж', 'федеральный', 'округ', 'го',
    'муниципальный', 'городской', 'городского', 'республика', 'край', 'автономный',
    'рабочий', 'типа', 'наб', 'набережная', 'бульвар', 'пл', 'площадь', 'проезд', 'тупик',
    'аллея', 'вн', 'тер', 'территория', 'снт', 'днт', 'влд', 'владение', 'им', 'имени',
    'поселение', 'станица', 'хутор', 'аул', 'квартал', 'линия', 'муниципальное', 'образование',
    'городское', 'станция', 'федеральная'
]);

// Длиннее этого адрес не бывает; защищает регулярки от гигантских ячеек.
AddrCore.MAX_ADDRESS_LENGTH = 500;

// Нормализованные значимые слова строки: нижний регистр, ё→е, длина ≥ 3, без слов-типов.
AddrCore.tokenize = function (s) {
    return String(s || '')
        .toLowerCase()
        .replace(/ё/g, 'е')
        .split(/[^а-яa-z0-9]+/)
        .filter(t => t.length >= 3 && !AddrCore.STOP_WORDS.has(t));
};

// Сокращения городов, которые геокодер возвращает полным названием.
// Раскрываем только по границам слов, чтобы не задеть «Омск», «Томск» и «Ростовская обл».
// «Влг» намеренно нет: Волгоград и Вологда неразличимы.
function cityAbbreviation(body, full) {
    return { re: new RegExp('(?<![а-яёa-z])(?:' + body.source + ')(?![а-яёa-z])', 'gi'), full };
}
AddrCore.CITY_ABBREVIATIONS = [
    cityAbbreviation(/спб|с\.?\s*-?\s*петербург|санкт\s+петербург/, 'Санкт-Петербург'),
    cityAbbreviation(/н\.?\s*новгород/, 'Нижний Новгород'),
    cityAbbreviation(/ростов[\s-]*(?:на|н)[\s./-]*д(?:ону)?/, 'Ростов-на-Дону'),
    cityAbbreviation(/екб|е-бург/, 'Екатеринбург'),
    cityAbbreviation(/мск/, 'Москва'),
    cityAbbreviation(/нск|н-ск/, 'Новосибирск')
];

AddrCore.expandCityAbbreviations = function (s) {
    let out = String(s || '');
    for (const { re, full } of AddrCore.CITY_ABBREVIATIONS) out = out.replace(re, full);
    return out;
};

// Маркеры помещения: всё, что идёт от них и дальше, геокодеру не нужно.
AddrCore.PREMISES_MARKER = /(^|[\s,;(])(пом|помещ|помещение|кв|офис|оф|этаж|литера|лит|вход|подъезд|а\/я|павильон)(?=\.|\s|$|№|\d)/i;

// Сегмент состоит только из цифр, диапазонов и литер («33», «28-31», «12а») — продолжение списка помещений.
AddrCore.NUMERIC_SEGMENT = /^[\d\s№\-–—/.,а-яa-z]{0,8}$/i;

function trimTrailingSeparators(s) {
    let end = s.length;
    while (end > 0 && /[\s,;(\-–—]/.test(s[end - 1])) end--;
    return s.slice(0, end);
}

// Строка для запроса: без пустых CSV-полей и без сегментов про помещения.
// Сегмент с маркером обрезается, идущие за ним чисто номерные сегменты выбрасываются,
// а сегменты со словами (например, город в конце строки) остаются.
AddrCore.cleanAddressForQuery = function (raw) {
    raw = AddrCore.expandCityAbbreviations(String(raw || '').slice(0, AddrCore.MAX_ADDRESS_LENGTH));
    const segments = raw.split(',').map(x => x.trim()).filter(Boolean);
    const kept = [];
    let dropNumeric = false;
    for (const seg of segments) {
        const m = seg.match(AddrCore.PREMISES_MARKER);
        if (m) {
            const head = trimTrailingSeparators(seg.slice(0, m.index + m[1].length));
            if (head) kept.push(head);
            dropNumeric = true;
            continue;
        }
        if (dropNumeric && (AddrCore.NUMERIC_SEGMENT.test(seg) && /\d/.test(seg))) continue;
        dropNumeric = false;
        kept.push(seg);
    }
    return kept.join(', ').replace(/\s+/g, ' ').trim();
};

// Статусы результата. Строки показываются пользователю и попадают в выгрузку.
AddrCore.STATUS = Object.freeze({
    CONFIRMED: 'Подтверждён',
    NO_CITY: 'Город не указан',
    CITY_UNCONFIRMED: 'Город не подтверждён',
    NO_HOUSE: 'Дом не найден',
    ERROR: 'Ошибка'
});

// Кандидат считается домом: kind=house, либо kind=other с номером дома (так Яндекс отдаёт дома с корпусом).
AddrCore.isHouse = function (c) {
    return !!c && (c.kind === 'house' || (c.kind === 'other' && !!c.house));
};

// Candidate: {kind, precision, text, province: string[], area, locality, street, house, lat, lon}
AddrCore.parseGeocoderResponse = function (json) {
    const members = (((json || {}).response || {}).GeoObjectCollection || {}).featureMember || [];
    return members.map(m => {
        const g = m.GeoObject || {};
        const md = ((g.metaDataProperty || {}).GeocoderMetaData) || {};
        const comps = ((md.Address || {}).Components) || [];
        const c = { kind: md.kind || '', precision: md.precision || '', text: md.text || '',
                    province: [], area: '', locality: '', street: '', house: '', lat: NaN, lon: NaN };
        for (const comp of comps) {
            switch (comp.kind) {
                case 'province': c.province.push(comp.name); break;
                case 'area': c.area = c.area || comp.name; break;
                case 'locality': c.locality = comp.name; break;   // последний = самый конкретный
                case 'street': c.street = comp.name; break;
                case 'house': c.house = comp.name; break;
            }
        }
        const pos = String(((g.Point || {}).pos) || '').split(' ');
        c.lon = parseFloat(pos[0]);
        c.lat = parseFloat(pos[1]);
        return c;
    });
};

// Все значимые слова названия должны встретиться в наборе слов строки точно (без вхождений:
// «пушкина» не подтверждает «Пушкин», «кирова» не подтверждает «Киров»).
function tokensMatch(nameTokens, pool) {
    return nameTokens.every(t => pool.has(t));
}

// Слова исходной строки без слов названия улицы кандидата: улица не может подтверждать
// город, район или регион («ул. Московская» ≠ Московская область, «ул. Чехова» ≠ Чехов).
function anchorPool(input, c) {
    const streetTokens = new Set(AddrCore.tokenize(c.street));
    return new Set(AddrCore.tokenize(input).filter(t => !streetTokens.has(t)));
}

// Слова входа по вхождениям: compounds — составные названия через дефис («Ростов-на-Дону»,
// «Москва-Сити»): значимые слова дефисного слова, если их не меньше двух и в каждом есть буква;
// standalone — слова, стоящие вне составных названий. Номера вида «10-12», «10-А», «28-31»
// составными не считаются, их слова идут в standalone.
function inputWords(input) {
    const standalone = new Set();
    const compounds = [];
    for (const word of AddrCore.expandCityAbbreviations(input).split(/[^а-яёa-z0-9-]+/i)) {
        const toks = AddrCore.tokenize(word);
        if (word.includes('-') && toks.length >= 2 && toks.every(t => /[а-яa-z]/.test(t))) compounds.push(toks);
        else for (const t of toks) standalone.add(t);
    }
    return { standalone, compounds };
}

AddrCore.compoundNames = function (input) {
    return inputWords(input).compounds;
};

// Составное название из входа неделимо: слово названия кандидата засчитывается, если во входе оно
// стоит отдельно или входит в составное название, которое название кандидата покрывает целиком.
// «Ростов» не подтверждается «Ростов-на-Дону», а «г. Москва, Москва-Сити» подтверждает «Москву».
function wordsAdmitName(toks, words) {
    return toks.every(t => words.standalone.has(t) ||
        words.compounds.some(cmp => cmp.includes(t) && cmp.every(x => toks.includes(x))));
}

// Для привязки по району или региону: каждое составное название входа, кроме состоящих только из
// слов улицы кандидата, покрыто каким-то названием кандидата (населённый пункт, район, регион).
// Иначе непокрытое составное название — скорее всего город, которого кандидат не нашёл
// («Камчатский край, Петропавловск-Камчатский» при кандидате «Елизово»).
function compoundsCoveredByCandidate(c, words) {
    const streetTokens = new Set(AddrCore.tokenize(c.street));
    const names = [c.locality, c.area, ...(c.province || [])].map(AddrCore.tokenize).filter(n => n.length > 0);
    return words.compounds.every(cmp => cmp.every(t => streetTokens.has(t)) ||
        names.some(n => cmp.every(t => n.includes(t))));
}

function levelMatches(level, c, pool, words) {
    if (level !== 'locality' && !compoundsCoveredByCandidate(c, words)) return false;
    const names = level === 'province' ? (c.province || []) : [c[level]];
    return names.some(name => {
        const toks = AddrCore.tokenize(name);
        return toks.length > 0 && tokensMatch(toks, pool) && wordsAdmitName(toks, words);
    });
}

// Уровень привязки: locality → area → province, иначе null. skipLocality — когда среди кандидатов
// есть более длинное совпадающее название, и город верхнего кандидата подтверждать нельзя.
function anchorLevel(input, c, { words, skipLocality }) {
    const pool = anchorPool(input, c);
    for (const level of ['locality', 'area', 'province']) {
        if (level === 'locality' && skipLocality) continue;
        if (levelMatches(level, c, pool, words)) return level;
    }
    return null;
}

// На каком уровне исходная строка подтверждает кандидата: locality → area → province, иначе null.
AddrCore.matchAnchor = function (input, c) {
    input = AddrCore.expandCityAbbreviations(input);
    return anchorLevel(input, c, { words: inputWords(input), skipLocality: false });
};

// Первый кандидат (любого вида), чей населённый пункт целиком назван во входе с учётом составных
// названий и состоит из большего числа слов, чем у верхнего («Ростов-на-Дону» длиннее «Ростова»).
// pool — слова входа без улицы верхнего кандидата: название улицы из строки не должно
// «находить» СНТ или посёлок с таким же словом в названии.
function longerLocalityMatch(cands, top, pool, words) {
    const topLength = AddrCore.tokenize(top.locality).length;
    for (const c of cands) {
        const toks = AddrCore.tokenize(c.locality);
        if (toks.length > topLength && tokensMatch(toks, pool) && wordsAdmitName(toks, words)) return c;
    }
    return null;
}

function localityKey(c) { return (c.province || []).join('/') + '|' + (c.locality || ''); }

// Сколько разных населённых пунктов среди кандидатов-домов.
AddrCore.countDistinctLocalities = function (cands) {
    const keys = new Set();
    for (const c of cands || []) if (AddrCore.isHouse(c)) keys.add(localityKey(c));
    return keys.size;
};

// Одноимённые населённые пункты в разных регионах среди кандидатов-домов (Киров Кировской и Калужской областей).
function sameNameInOtherRegions(top, cands) {
    const name = AddrCore.tokenize(top.locality).join(' ');
    if (!name) return false;
    const regions = new Set();
    for (const c of cands) {
        if (AddrCore.isHouse(c) && AddrCore.tokenize(c.locality).join(' ') === name) regions.add((c.province || []).join('/'));
    }
    return regions.size >= 2;
}

// Итог проверки одного адреса.
AddrCore.classify = function (input, cands) {
    input = AddrCore.expandCityAbbreviations(input);
    cands = cands || [];
    let top = cands.length ? cands[0] : null;
    let reordered = false;
    const candidateCount = AddrCore.countDistinctLocalities(cands);
    if (!AddrCore.isHouse(top)) {
        return { status: AddrCore.STATUS.NO_HOUSE, anchor: null, candidateCount, top, reordered };
    }
    const words = inputWords(input);
    // более длинное совпадающее название ниже по списку: дом — становится верхним,
    // не дом — запрещает подтверждать город верхнего кандидата
    let skipLocality = false;
    const better = longerLocalityMatch(cands, top, anchorPool(input, top), words);
    if (better && AddrCore.isHouse(better)) {
        cands = [better, ...cands.filter(c => c !== better)];
        top = better;
        reordered = true;
    } else if (better) {
        skipLocality = true;
    }
    const anchor = anchorLevel(input, top, { words, skipLocality });
    const S = AddrCore.STATUS;
    const result = status => ({ status, anchor, candidateCount, top, reordered });
    if (anchor === 'locality') {
        // город назван, но таких городов несколько и регион в строке не указан
        if (sameNameInOtherRegions(top, cands) && !levelMatches('province', top, anchorPool(input, top), words)) {
            return result(S.CITY_UNCONFIRMED);
        }
        return result(S.CONFIRMED);
    }
    if (anchor) {
        // в строке только район или регион: подтверждаем, если дом нашёлся в одном населённом пункте
        return result(candidateCount >= 2 ? S.NO_CITY : S.CONFIRMED);
    }
    if (candidateCount >= 2) return result(S.NO_CITY);
    return result(S.CITY_UNCONFIRMED);
};

// ---- Входные данные -------------------------------------------------------

// Текст: по адресу на строку, метка через табуляцию. Пустые строки отбрасываются.
AddrCore.parseTextInput = function (text) {
    return String(text || '').split(/\r?\n/)
        .filter(line => line.trim())
        .map(line => line.split('\t').map(x => x.trim()));
};

// Заголовок колонки A: «Адрес», «Адреса», «адрес:», «Адрес доставки», «Исходный адрес».
AddrCore.HEADER_CELL = /^(исходный\s+)?адрес(а)?(\s+[а-яё]+)?\s*:?$/i;

// Строки (из SheetJS или parseTextInput) → записи. Пропускает заголовок и пустые адреса.
AddrCore.parseInputRows = function (rows) {
    const items = [];
    let first = true;
    for (const row of rows || []) {
        let original = String((row && row[0]) ?? '').trim();
        if (!original) continue;
        if (first && AddrCore.HEADER_CELL.test(original)) { first = false; continue; }
        first = false;
        if (original.length > AddrCore.MAX_ADDRESS_LENGTH) original = original.slice(0, AddrCore.MAX_ADDRESS_LENGTH);
        const label = String((row && row[1]) ?? '').trim().slice(0, AddrCore.MAX_ADDRESS_LENGTH);
        items.push({ original, label });
    }
    return items;
};

// ---- Справочники и ссылки --------------------------------------------------

AddrCore.FEDERAL_DISTRICTS = Object.freeze({
    'Центральный федеральный округ': 'ЦФО',
    'Северо-Западный федеральный округ': 'СЗФО',
    'Южный федеральный округ': 'ЮФО',
    'Северо-Кавказский федеральный округ': 'СКФО',
    'Приволжский федеральный округ': 'ПФО',
    'Уральский федеральный округ': 'УФО',
    'Сибирский федеральный округ': 'СФО',
    'Дальневосточный федеральный округ': 'ДФО'
});

AddrCore.federalDistrict = function (province) {
    for (const name of province || []) {
        if (Object.hasOwn(AddrCore.FEDERAL_DISTRICTS, name)) return AddrCore.FEDERAL_DISTRICTS[name];
    }
    return '';
};

AddrCore.PRECISION_LABELS = Object.freeze({
    exact: 'точный дом',
    number: 'тот же номер, другой корпус',
    near: 'ближайший дом',
    range: 'приблизительно'
});

AddrCore.precisionLabel = function (p) {
    return Object.hasOwn(AddrCore.PRECISION_LABELS, p) ? AddrCore.PRECISION_LABELS[p] : '';
};

// «55.7558, 37.6173», «55,7558; 37,6173», «55.7558 37.6173» → [lat, lon]; иначе null.
AddrCore.parseCoords = function (s) {
    const str = String(s || '').trim();
    if (!str) return null;
    let parts = str.split(/[\s,;]+/).filter(Boolean);
    // «55,7558, 37,6173»: четыре целых группы без точек — десятичные запятые
    if (parts.length === 4 && !str.includes('.') && parts.every(p => /^-?\d+$/.test(p))) {
        parts = [parts[0] + '.' + parts[1], parts[2] + '.' + parts[3]];
    }
    if (parts.length !== 2) return null;
    const [lat, lon] = parts.map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return [lat, lon];
};

AddrCore.exportFileName = function (date) {
    const d = date || new Date();
    const p = n => String(n).padStart(2, '0');
    return `addresses_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.xlsx`;
};

// Сообщение об ошибке из ответа Яндекса: {statusCode, error, message} или {error: {message}}.
AddrCore.apiErrorMessage = function (json) {
    if (!json || typeof json !== 'object') return '';
    if (typeof json.message === 'string' && (json.statusCode || json.error)) return json.message;
    if (json.error && typeof json.error === 'object' && typeof json.error.message === 'string') return json.error.message;
    if (typeof json.error === 'string') return json.error;
    return '';
};

AddrCore.GEOCODER_URL = 'https://geocode-maps.yandex.ru/1.x/';
AddrCore.RUSSIA_BBOX = '19.6,41.1~180,82';

AddrCore.buildGeocodeUrl = function (apiKey, address) {
    return AddrCore.GEOCODER_URL + '?apikey=' + encodeURIComponent(apiKey) +
        '&geocode=' + encodeURIComponent(address) +
        '&format=json&results=10&lang=ru_RU&bbox=' + AddrCore.RUSSIA_BBOX + '&rspn=1';
};

AddrCore.mapLinks = function (lat, lon, finalAddress) {
    return {
        yandex: `https://yandex.ru/maps/?ll=${lon}%2C${lat}&z=17&pt=${lon}%2C${lat},pm2rdm`,
        dgis: `https://2gis.ru/search/${encodeURIComponent(finalAddress)}?m=${lon}%2C${lat}%2F18`
    };
};

// ---- Запись результата -----------------------------------------------------

// Record: original, label, status, precision, check, district, province, locality, street, house,
//         streetAndHouse, finalAddress, lat, lon, coordinates, yandexLink, dgisLink, candidates, candidatesText
AddrCore.emptyRecord = function (original, label) {
    return {
        original: original || '', label: label || '', status: '', precision: '', check: 'авто', error: '',
        district: '', province: '', locality: '', street: '', house: '', streetAndHouse: '',
        finalAddress: '', lat: NaN, lon: NaN, coordinates: '', yandexLink: '', dgisLink: '',
        candidates: [], candidatesText: ''
    };
};

// Заполняет адресные поля записи из компонентов (используется и при ручном сохранении).
AddrCore.fillAddressFields = function (rec, f) {
    rec.district = f.district || '';
    rec.province = f.province || '';
    rec.locality = f.locality || '';
    rec.street = f.street || '';
    rec.house = f.house || '';
    rec.streetAndHouse = [rec.street, rec.house].filter(Boolean).join(', ');
    rec.finalAddress = [rec.locality, rec.street, rec.house].filter(Boolean).join(', ');
    rec.lat = Number.isFinite(f.lat) ? f.lat : NaN;
    rec.lon = Number.isFinite(f.lon) ? f.lon : NaN;
    if (Number.isFinite(rec.lat) && Number.isFinite(rec.lon)) {
        rec.coordinates = `${rec.lat}, ${rec.lon}`;
        const links = AddrCore.mapLinks(rec.lat, rec.lon, rec.finalAddress);
        rec.yandexLink = links.yandex;
        rec.dgisLink = links.dgis;
    } else {
        rec.coordinates = ''; rec.yandexLink = ''; rec.dgisLink = '';
    }
    return rec;
};

AddrCore.candidatesText = function (cands) {
    const seen = new Set();
    for (const c of cands || []) {
        if (!AddrCore.isHouse(c)) continue;
        const name = c.locality || (c.province || []).slice(-1)[0] || '';
        if (name) seen.add(name);
    }
    return Array.from(seen).join('; ');
};

AddrCore.buildRecord = function ({ original, label, cands, cls, error }) {
    const rec = AddrCore.emptyRecord(original, label);
    if (error) {
        rec.status = AddrCore.STATUS.ERROR;
        rec.error = String(error);
        return rec;
    }
    rec.status = cls.status;
    rec.candidates = (cands || []).slice();
    const top = cls.top;
    const S = AddrCore.STATUS;
    if (top && cls.status === S.NO_CITY) {
        // город угадан геокодером: в запись идут только улица и дом из строки, город выбирает человек
        AddrCore.fillAddressFields(rec, { street: top.street, house: top.house, lat: NaN, lon: NaN });
        rec.finalAddress = '';
    } else if (top) {
        rec.precision = AddrCore.precisionLabel(top.precision);
        AddrCore.fillAddressFields(rec, {
            district: AddrCore.federalDistrict(top.province),
            province: (top.province || []).slice(-1)[0] || '',
            locality: top.locality, street: top.street, house: top.house,
            lat: top.lat, lon: top.lon
        });
    }
    if (cls.status === S.NO_CITY || cls.status === S.CITY_UNCONFIRMED) {
        rec.candidatesText = AddrCore.candidatesText(cands);
    }
    return rec;
};

AddrCore.EXPORT_HEADERS = Object.freeze(['№', 'Исходный адрес', 'Метка', 'Федеральный округ', 'Регион',
    'Населённый пункт', 'Улица и дом', 'Итоговый адрес', 'Координаты', 'Яндекс Карты', '2ГИС',
    'Статус', 'Точность', 'Проверка', 'Кандидаты']);

// Что делать с HTTP-статусом ответа геокодера.
AddrCore.decideOnHttpStatus = function (status) {
    if (status === 200) return 'ok';
    if (status === 403 || status === 429) return 'stop';
    if (status >= 400 && status < 500) return 'fail';   // плохой запрос: повторять бессмысленно
    return 'retry';
};

AddrCore.recordToExportRow = function (rec, index) {
    return [index + 1, rec.original, rec.label, rec.district, rec.province, rec.locality,
        rec.streetAndHouse, rec.finalAddress, rec.coordinates, rec.yandexLink, rec.dgisLink,
        rec.status, rec.precision, rec.check, rec.candidatesText].map(v => v == null ? '' : v);
};
return AddrCore;
}));
