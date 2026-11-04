import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { parseDates, parseGuests, isPhone, isOpen, isBooked, quote, newState, reply, STAY } from './assistant.js';

// Wed 4 Nov 2026
const today = new Date(2026, 10, 4);
const ymd = d => [d.getFullYear(), d.getMonth() + 1, d.getDate()].join('-');
const range = text => { const r = parseDates(text, today); return [r.checkIn && ymd(r.checkIn), r.checkOut && ymd(r.checkOut)]; };

function run(messages, state = newState()) {
  let last;
  for (const m of messages) { last = reply(m, state, today); state = last.state; }
  return last;
}

test('parses date formats', () => {
  assert.deepEqual(range('15 to 18 Nov'), ['2026-11-15', '2026-11-18']);
  assert.deepEqual(range('nov 15-18'), ['2026-11-15', '2026-11-18']);
  assert.deepEqual(range('15th November to 18th November'), ['2026-11-15', '2026-11-18']);
  assert.deepEqual(range('15/11 to 18/11'), ['2026-11-15', '2026-11-18']);
  assert.deepEqual(range('2026-12-01 to 2026-12-03'), ['2026-12-1', '2026-12-3']);
  assert.deepEqual(range('tomorrow for 2 nights'), ['2026-11-5', '2026-11-7']);
  assert.deepEqual(range('this weekend'), ['2026-11-6', '2026-11-8']);
  assert.deepEqual(range('next weekend'), ['2026-11-13', '2026-11-15']);
  assert.deepEqual(range('15 to 18'), ['2026-11-15', '2026-11-18']);
});

test('rolls to the next occurrence across months and years', () => {
  assert.deepEqual(range('1 to 3 Jan'), ['2027-1-1', '2027-1-3']);
  assert.deepEqual(range('28 Dec to 2 Jan'), ['2026-12-28', '2027-1-2']);
  assert.deepEqual(range('2 to 5'), ['2026-12-2', '2026-12-5']);
});

test('date parsing ignores guest counts and text without dates', () => {
  assert.equal(parseDates('2 to 4 people', today), null);
  assert.equal(parseDates('do you have parking', today), null);
  assert.deepEqual(parseDates('3 nights', today), { nights: 3 });
  assert.equal(parseDates('31 Feb', today).checkIn, null);
});

test('parses guests', () => {
  assert.equal(parseGuests('2 adults and 1 kid'), 3);
  assert.equal(parseGuests('we are three'), 3);
  assert.equal(parseGuests('just me'), 1);
  assert.equal(parseGuests('4', true), 4);
  assert.equal(parseGuests('4'), null);
});

test('validates Indian mobile numbers', () => {
  for (const ok of ['9876543210', '+91 98765 43210', '98765-43210']) assert.ok(isPhone(ok), ok);
  for (const bad of ['12345', '1234567890', 'abc', '98765432101']) assert.ok(!isPhone(bad), bad);
});

test('weekend nights use the weekend rate', () => {
  // Thu 5 Nov to Sun 8 Nov: Thu, Fri, Sat
  assert.equal(quote(new Date(2026, 10, 5), new Date(2026, 10, 8)), STAY.nightly + 2 * STAY.weekend);
});

test('a stay is closed when any night is booked, but check-out day can be booked', () => {
  const booked = Array.from({ length: 40 }, (_, i) => new Date(2026, 10, 5 + i)).find(isBooked);
  const dayBefore = new Date(booked.getFullYear(), booked.getMonth(), booked.getDate() - 1);
  const free = new Date(dayBefore.getFullYear(), dayBefore.getMonth(), dayBefore.getDate() - 1);
  assert.equal(isOpen(free, booked), !isBooked(free) && !isBooked(dayBefore));
  assert.equal(isOpen(booked, new Date(booked.getFullYear(), booked.getMonth(), booked.getDate() + 1)), false);
});

test('full enquiry conversation captures a lead', () => {
  const free = Array.from({ length: 40 }, (_, i) => new Date(2026, 10, 5 + i))
    .find(d => isOpen(d, new Date(d.getFullYear(), d.getMonth(), d.getDate() + 2)));
  const dates = `${free.getDate()} ${free.toLocaleDateString('en-GB', { month: 'short' })} for 2 nights`;
  const r = run([dates, '2', 'Yes, hold these dates', 'Harpreet Kaur', '98765 43210']);
  assert.equal(r.state.step, 'done');
  assert.equal(r.state.guests, 2);
  assert.match(r.say[0], /98765 43210/);
});

test('booked dates suggest an alternative that is really open', () => {
  const booked = Array.from({ length: 40 }, (_, i) => new Date(2026, 10, 5 + i)).find(isBooked);
  const text = `${booked.getDate()} ${booked.toLocaleDateString('en-GB', { month: 'short' })} for 1 night, 2 guests`;
  const r = reply(text, newState(), today);
  assert.equal(r.state.step, 'dates');
  assert.match(r.say[0], /already booked/);
  const alt = reply(r.chips[0], { ...r.state, checkIn: null, checkOut: null }, today);
  assert.equal(alt.state.step, 'offer');
});

test('rejects past dates, too many guests and a bad phone number', () => {
  assert.match(reply('1 Nov 2026 for 2 nights', newState(), today).say[0], /already passed/);
  assert.match(reply('9 guests', newState(), today).say[0], /sleeps up to/);
  const r = reply('12345', { ...newState(), step: 'phone', name: 'Aman' }, today);
  assert.equal(r.state.step, 'phone');
  assert.match(r.say[0], /mobile number/);
});

test('questions mid-flow are answered without losing progress', () => {
  const s = { ...newState(), step: 'name', checkIn: new Date(2026, 10, 15), checkOut: new Date(2026, 10, 18), guests: 2 };
  const r = reply('Do you have parking?', s, today);
  assert.equal(r.state.step, 'name');
  assert.match(r.say[0], /parking/i);
  assert.match(r.say[1], /your name/);
});

test('every reply says something', () => {
  for (const step of ['dates', 'guests', 'offer', 'name', 'phone', 'done']) {
    for (const msg of ['asdf', 'what is the price?', '']) {
      const s = { ...newState(), step, name: 'Aman', checkIn: new Date(2026, 10, 15), checkOut: new Date(2026, 10, 18), guests: step === 'guests' ? null : 2 };
      assert.ok(reply(msg, s, today).say.join('').length > 0, `${step}:${msg}`);
    }
  }
});

test('photo manifest and page only reference photos that exist', () => {
  const photos = JSON.parse(readFileSync('assets/photos/photos.json', 'utf8'));
  assert.equal(photos.length, 37);
  assert.equal(readdirSync('assets/photos').length, photos.length + 1);
  for (const p of photos) {
    assert.ok(existsSync('assets/photos/' + p.file), p.file);
    assert.ok(p.label && p.alt && p.category, p.file);
  }
  const html = readFileSync('index.html', 'utf8');
  for (const [, src] of html.matchAll(/(assets\/[^"]+)"/g)) assert.ok(existsSync(src), src);
  assert.doesNotMatch(html, /sample photo|airbnb\.[a-z.]+\/trips/i);
});
