/* eslint-env node */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(path.join(__dirname, '../ios/NoLateShareExtension/TicketWebPage.js'), 'utf8');
function extract(url, text, body = true, page = {}) {
  let result;
  const context = vm.createContext(Object.assign({
    window: { location: new URL(url) },
    document: { body: body ? { innerText: text } : null },
  }, page));
  vm.runInContext(source, context);
  context.ExtensionPreprocessingJS.run({ completionFunction: value => { result = value; } });
  return JSON.parse(JSON.stringify(result));
}

test('returns displayed ticket text without the transferable URL or its secret', () => {
  const text = '승차권\n2026-11-20\n서울 → 동대구\nKTX 255\n06:43\n08:32';
  assert.deepEqual(extract('https://www.korail.com/ticket?code=synthetic-secret#private', text), {
    version: 1, origin: 'https://www.korail.com', text,
  });
});

test('does not read unrelated, deceptive, insecure or nonstandard-port pages', () => {
  for (const url of ['https://example.com', 'https://korail.com.example.com', 'https://fakekorail.com', 'http://korail.com', 'https://korail.com:8443']) {
    assert.deepEqual(extract(url, '승차권'), {});
  }
});

test('supports official railway domains and subdomains', () => {
  for (const host of ['korail.com', 'www.korail.go.kr', 'www.letskorail.com', 'etk.srail.or.kr']) {
    assert.equal(extract('https://' + host, '승차권').origin, 'https://' + host);
  }
});

test('recognizes the bus booking origins used by NoLate without reading unrelated Tmoney pages', () => {
  const text = '모바일 승차권\n동서울 → 속초\n우등';
  for (const host of ['intercitybus.tmoney.co.kr', 'intercitybuse.tmoney.co.kr', 'intercitybusc.tmoney.co.kr', 'intercitybusj.tmoney.co.kr',
    'txbus.t-money.co.kr', 'www.kobus.co.kr', 'www.bustago.or.kr']) {
    assert.deepEqual(extract('https://' + host + '/ticket?code=synthetic#private', text), { version: 1, origin: 'https://' + host, text });
  }
  for (const url of ['https://shop.tmoney.co.kr', 'http://intercitybus.tmoney.co.kr', 'https://www.bustago.or.kr:444',
    'https://u:p@www.kobus.co.kr', 'https://bustago.or.kr.example.test', 'https://txbus.t-money.co.kr.example.test']) {
    assert.deepEqual(extract(url, text), {});
  }
});

test('does not truncate an oversized page into a plausible ticket', () => {
  assert.deepEqual(extract('https://korail.com', 'x'.repeat(32001)), {
    version: 1, origin: 'https://korail.com', tooLarge: true,
  });
  assert.equal(extract('https://korail.com', '', false).text, '');
});

test('only shares single rendered text rectangles already present in the ticket body', () => {
  const visible = '스마트티켓 1매\n서울\n06:43';
  const nodes = [
    ['서울', true, false, 1], ['숨은예약번호', true, false, 1], ['서울', false, false, 1],
    ['06:43', true, true, 1], ['서울', true, false, 2],
  ].map(([nodeValue, shown, form, rectCount]) => ({
    nodeValue, parentElement: { closest: () => form, checkVisibility: () => shown }, rectCount,
  }));
  let current;
  const page = {
    NodeFilter: { SHOW_TEXT: 4 },
    getComputedStyle: () => ({ visibility: 'visible', opacity: '1' }),
    document: {
      body: { innerText: visible },
      createTreeWalker: () => ({ nextNode: () => nodes.shift() }),
      createRange: () => ({
        selectNodeContents: node => { current = node; },
        getClientRects: () => Array(current.rectCount).fill({ left: 10, top: 20, width: 30, height: 15 }),
      }),
    },
  };
  assert.deepEqual(extract('https://www.korail.com/ticket', visible, true, page).regions, [['서울', 10, 20, 30, 15]]);
});
