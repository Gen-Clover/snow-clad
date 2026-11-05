import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { parseDates, parseGuests, isPhone, isOpen, isBooked, newState, reply, greeting } from './assistant.js';
import { dayState, pick } from './calendar.js';

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

test('an answered question does not ask for dates again but keeps the way forward', () => {
  const r = reply('do you have parking', greeting().state, today);
  assert.deepEqual(r.say.length, 1);
  assert.match(r.say[0], /parking/i);
  assert.equal(r.chips[0], 'Pick dates');
  assert.equal(r.calendar, undefined);
  assert.equal(reply('Pick dates', r.state, today).calendar, true);

  const s = { ...newState(), step: 'offer', checkIn: new Date(2026, 10, 6), checkOut: new Date(2026, 10, 8), guests: 2 };
  const offer = reply('is there wifi', s, today);
  assert.equal(offer.say.length, 1);
  assert.equal(offer.state.step, 'offer');
  assert.ok(offer.chips.includes('Yes, hold these dates'));

  const done = reply('is there wifi', { ...s, step: 'done' }, today);
  assert.equal(done.state.step, 'done');
  assert.deepEqual(done.chips, ['Start over']);

  // Still guides the guest when nothing was understood, and dates in a question still move on.
  assert.equal(reply('blah blah', newState(), today).calendar, true);
  assert.equal(reply('parking for 6 to 8 Nov', newState(), today).state.checkIn.getDate(), 6);
});

test('every reply says something', () => {
  for (const step of ['dates', 'guests', 'offer', 'name', 'phone', 'done']) {
    for (const msg of ['asdf', 'what is the price?', '']) {
      const s = { ...newState(), step, name: 'Aman', checkIn: new Date(2026, 10, 15), checkOut: new Date(2026, 10, 18), guests: step === 'guests' ? null : 2 };
      assert.ok(reply(msg, s, today).say.join('').length > 0, `${step}:${msg}`);
    }
  }
});

const daysBefore = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - n);
// First day of a booked run, so the night before it is open.
const firstBooked = Array.from({ length: 40 }, (_, i) => new Date(2026, 10, 5 + i)).find(d => isBooked(d) && !isBooked(daysBefore(d, 1)));
const empty = { start: null, end: null };

test('calendar blocks past and booked days', () => {
  assert.equal(dayState(new Date(2026, 10, 3), empty, today).disabled, true);
  assert.equal(dayState(firstBooked, empty, today).disabled, true);
  assert.equal(dayState(daysBefore(firstBooked, 1), empty, today).disabled, false);
});

test('a booked day can be the check-out day but a stay cannot cross it', () => {
  const start = daysBefore(firstBooked, 1);
  const state = dayState(firstBooked, { start, end: null }, today);
  assert.equal(state.checkoutOnly, true);
  assert.equal(state.disabled, false);
  assert.deepEqual(pick({ start, end: null }, firstBooked), { start, end: firstBooked });
  const past = new Date(firstBooked.getFullYear(), firstBooked.getMonth(), firstBooked.getDate() + 3);
  assert.equal(isBooked(past), false);
  assert.deepEqual(pick({ start, end: null }, past), { start: past, end: null });
});

test('picking again after a full range starts a new range', () => {
  const start = new Date(2026, 10, 5), end = new Date(2026, 10, 6), next = new Date(2026, 10, 7);
  assert.deepEqual(pick({ start, end }, next), { start: next, end: null });
  assert.deepEqual(pick({ start, end: null }, start), { start, end: null });
});

test('calendar dates sent to the assistant parse, including September', () => {
  assert.deepEqual(range('15 Nov 2026 to 18 Nov 2026, 2 guests'), ['2026-11-15', '2026-11-18']);
  assert.deepEqual(range('5 Sept 2027 to 8 Sept 2027'), ['2027-9-5', '2027-9-8']);
});

test('date prompts carry a calendar and no reply quotes a price', () => {
  assert.equal(greeting().calendar, true);
  const free = Array.from({ length: 40 }, (_, i) => new Date(2026, 10, 5 + i))
    .find(d => isOpen(d, new Date(d.getFullYear(), d.getMonth(), d.getDate() + 3)));
  const out = new Date(free.getFullYear(), free.getMonth(), free.getDate() + 3);
  const fmt = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const conversation = [`${fmt(free)} to ${fmt(out)}, 2 guests`, 'what is the price?', 'Yes, hold these dates', 'Harpreet Kaur', '98765 43210'];
  let state = newState();
  for (const message of conversation) {
    const r = reply(message, state, today);
    assert.doesNotMatch(r.say.join(' '), /₹|\bRs\b/);
    state = r.state;
  }
  assert.equal(state.step, 'done');
  assert.doesNotMatch(readFileSync('index.html', 'utf8'), /₹/);
});

test('review data has the shape the page reads', () => {
  const data = JSON.parse(readFileSync('assets/reviews.json', 'utf8'));
  assert.equal(data.rating, 5);
  assert.ok(data.count === null || Number.isInteger(data.count));
  assert.match(data.url, /^https:\/\/www\.google\.com\/maps\//);
  assert.equal(data.airbnb.count, data.reviews.length);
  for (const s of data.airbnb.scores) assert.ok(s.label && s.score <= 5, s.label);
  for (const r of data.reviews) assert.ok(r.author && r.text && r.source, 'a review needs an author, text and source');
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
