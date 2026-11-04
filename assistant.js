// Scripted demo assistant: no LLM, no network, nothing stored.
// Every value in STAY is a placeholder until the owner confirms it.
export const STAY = { nightly: 3200, weekend: 3900, maxGuests: 4, checkIn: '2 PM', checkOut: '11 AM' };

const DAY = 864e5;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MON = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const ORD = '(?:st|nd|rd|th)?';
const TO = '(?:-|to|till|until)';

const midnight = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const nightsBetween = (a, b) => Math.round((b - a) / DAY);
const monthIndex = m => MONTHS.indexOf(m.slice(0, 3));
const money = n => '₹' + n.toLocaleString('en-IN');

export const formatDate = d => d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
const chipDate = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export const isPhone = v => /^(\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}$/.test(v.trim());

// shortcut: repeating pattern fakes a calendar, replace with the Airbnb iCal feed when this goes live.
export const isBooked = d => [3, 4, 5].includes(Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY) % 17);

export function isOpen(checkIn, checkOut) {
  for (let d = checkIn; d < checkOut; d = addDays(d, 1)) if (isBooked(d)) return false;
  return true;
}

export function quote(checkIn, checkOut) {
  let total = 0;
  for (let d = checkIn; d < checkOut; d = addDays(d, 1)) total += [5, 6].includes(d.getDay()) ? STAY.weekend : STAY.nightly;
  return total;
}

function nextOpening(checkIn, nights) {
  for (let i = 1; i <= 60; i++) {
    const start = addDays(checkIn, i);
    if (isOpen(start, addDays(start, nights))) return start;
  }
  return null;
}

// A date with no year means its next occurrence on or after `from`. Rolled-over dates (31 Feb) return null.
function resolve(day, month, year, from) {
  const build = y => new Date(y, month, day);
  let d = build(year ?? from.getFullYear());
  if (year == null && d < from) d = build(from.getFullYear() + 1);
  return d.getMonth() === month && d.getDate() === day ? d : null;
}

function resolveDayOnly(day, from) {
  for (let i = 0; i < 3; i++) {
    const d = new Date(from.getFullYear(), from.getMonth() + i, day);
    if (d.getDate() === day && d >= from) return d;
  }
  return null;
}

const fullYear = y => (y == null ? null : +y < 100 ? 2000 + +y : +y);

const DATE_TOKEN = new RegExp(
  `(?<iso>\\d{4})-(?<isoM>\\d{1,2})-(?<isoD>\\d{1,2})` +
  `|\\b(?<numD>\\d{1,2})[/.](?<numM>\\d{1,2})(?:[/.](?<numY>\\d{2,4}))?\\b` +
  `|\\b(?<dmD>\\d{1,2})${ORD}\\s*(?:of\\s+)?(?<dmM>${MON})\\b,?(?:\\s*(?<dmY>\\d{4}))?` +
  `|\\b(?<mdM>${MON})\\b\\.?\\s*(?<mdD>\\d{1,2})${ORD}\\b(?:,?\\s*(?<mdY>\\d{4}))?`, 'g');

function tokenDate(g, from) {
  if (g.iso) return resolve(+g.isoD, +g.isoM - 1, +g.iso, from);
  if (g.numD) return resolve(+g.numD, +g.numM - 1, fullYear(g.numY), from);
  if (g.dmD) return resolve(+g.dmD, monthIndex(g.dmM), fullYear(g.dmY), from);
  return resolve(+g.mdD, monthIndex(g.mdM), fullYear(g.mdY), from);
}

function relativeStart(t, today) {
  if (/\bday after tomorrow\b/.test(t)) return { checkIn: addDays(today, 2) };
  if (/\btomorrow\b/.test(t)) return { checkIn: addDays(today, 1) };
  if (/\b(today|tonight)\b/.test(t)) return { checkIn: today };
  const weekend = t.match(/\b(next\s+)?weekend\b/);
  if (weekend) {
    const dow = today.getDay();
    if (dow === 6 && !weekend[1]) return { checkIn: today, checkOut: addDays(today, 1) };
    const start = addDays(today, ((5 - dow + 7) % 7) + (weekend[1] ? 7 : 0));
    return { checkIn: start, checkOut: addDays(start, 2) };
  }
  const wd = t.match(new RegExp(`\\b(${WEEKDAYS.join('|')})\\b`));
  if (wd) {
    const diff = (WEEKDAYS.indexOf(wd[1]) - today.getDay() + 7) % 7 || 7;
    return { checkIn: addDays(today, diff) };
  }
  return null;
}

// Returns { checkIn?, checkOut?, nights? } or null when the text has no date in it.
export function parseDates(text, today = new Date()) {
  today = midnight(today);
  let t = text.toLowerCase().replace(/\b\d+\s*(guests?|people|persons?|adults?|kids?|child(ren)?|pax|of us)\b/g, ' ');
  const nightsMatch = t.match(/\b(\d{1,2})\s*nights?\b/);
  const nights = nightsMatch ? +nightsMatch[1] : null;
  if (nightsMatch) t = t.replace(nightsMatch[0], ' ');

  let found = null;
  const dayRange = t.match(new RegExp(`\\b(\\d{1,2})${ORD}\\s*${TO}\\s*(\\d{1,2})${ORD}\\s*(?:of\\s+)?(${MON})\\b`));
  const monthRange = t.match(new RegExp(`\\b(${MON})\\b\\.?\\s*(\\d{1,2})${ORD}\\s*${TO}\\s*(\\d{1,2})${ORD}\\b`));
  const bareRange = t.match(new RegExp(`^\\D*\\b(\\d{1,2})${ORD}\\s*${TO}\\s*(\\d{1,2})${ORD}\\b\\D*$`));

  if (dayRange || monthRange) {
    const [a, b, m] = dayRange ? [dayRange[1], dayRange[2], dayRange[3]] : [monthRange[2], monthRange[3], monthRange[1]];
    const checkIn = resolve(+a, monthIndex(m), null, today);
    found = checkIn && { checkIn, checkOut: resolve(+b, monthIndex(m), null, addDays(checkIn, 1)) };
  } else {
    const tokens = [...t.matchAll(DATE_TOKEN)];
    if (tokens.length) {
      const checkIn = tokenDate(tokens[0].groups, today);
      found = { checkIn };
      if (tokens[1] && checkIn) found.checkOut = tokenDate(tokens[1].groups, addDays(checkIn, 1));
    } else if (bareRange) {
      const checkIn = resolveDayOnly(+bareRange[1], today);
      found = checkIn && { checkIn, checkOut: resolveDayOnly(+bareRange[2], addDays(checkIn, 1)) };
    } else {
      found = relativeStart(t, today);
    }
  }
  if (found?.checkIn && nights) found.checkOut = addDays(found.checkIn, nights);
  if (!found && nights) return { nights };
  return found;
}

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

export function parseGuests(text, bareAllowed = false) {
  const t = text.toLowerCase().replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/g, w => NUMBER_WORDS[w]);
  if (/\b(just me|solo|alone|only me)\b/.test(t)) return 1;
  if (/\bcouple\b/.test(t)) return 2;
  const parts = [...t.matchAll(/\b(\d{1,2})\s*(adults?|kids?|child(?:ren)?|infants?)\b/g)];
  if (parts.length) return parts.reduce((sum, m) => sum + +m[1], 0);
  const m = t.match(/\b(\d{1,2})\s*(?:guests?|people|persons?|pax|of us)\b/) || t.match(/\b(?:we are|we're|family of|group of)\s*(\d{1,2})\b/);
  if (m) return +m[1];
  return bareAllowed && /^\s*\d{1,2}\s*$/.test(t) ? +t : null;
}

const FAQ = [
  [/\b(price|prices|pricing|rate|rates|cost|costs|tariff|how much|charges?)\b/, () => `Sample rates for this demo: ${money(STAY.nightly)} a night, ${money(STAY.weekend)} on Fridays and Saturdays. Give me your dates and I can total it up.`],
  [/self.?check|door code|smart lock|\bkeys?\b|front desk|(what|when|how).*check.?(in|out)|check.?(in|out) (time|timing)/, () => `Check-in is any time after ${STAY.checkIn} and check-out is by ${STAY.checkOut}. You get a door code once your stay is confirmed, so there is no key handover and no waiting at a desk.`],
  [/\b(wi-?fi|internet)\b/, () => 'Yes, Wi-Fi is included, and there is a proper desk with an ergonomic chair if you need to work.'],
  [/\bparking\b/, () => 'Yes, parking is available at the property.'],
  [/\b(pets?|dogs?|cats?)\b/, () => 'Please ask the host about pets before you book. I can pass the question along with your enquiry.'],
  [/\b(address|location|where|directions?|airport|map)\b/, () => 'You will find it at SBP City of Dreams, opposite Trishla City, on High Ground Road in Zirakpur, close to Chandigarh and Mohali.'],
  [/\b(kitchen|cook|cooking)\b/, () => 'There is a kitchenette with a sink and cabinets, plus a kettle, tea tray and mini fridge. The host can tell you what cooking equipment is provided.'],
  [/\b(balcony|view|garden|courtyard)\b/, () => 'The suite has a private balcony over the courtyard, with gardens, a gazebo, a sports court and a giant chess board below.'],
  [/\b(bathrobe|towels?|toiletries|hair ?dryer|shower|geyser|hot water)\b/, () => 'The bathroom has a rain shower and water heater, with towels, a bathrobe, toiletries and a hair dryer provided.'],
  [/\b(cancel|cancellation|refund)\b/, () => 'The host confirms the cancellation terms with your booking. In this demo the terms are still to be added.'],
  [/\b(iron|ironing)\b/, () => 'Yes. There is a pull-out ironing board with an iron built into the wardrobe, so your work clothes are easy to sort.'],
  [/\b(human|person|agent|owner|host|call me|phone number|talk to)\b/, () => 'Happy to get a person involved. Call the host on xxxxx xxxxx, or leave your details here and they will reach out.'],
];

const faqAnswer = t => FAQ.find(([re]) => re.test(t))?.[1]() ?? null;

export const newState = () => ({ step: 'dates', checkIn: null, checkOut: null, guests: null, name: null, phone: null });

export const greeting = () => ({
  state: newState(),
  say: ["Hi, I'm Snow, the Snow Clad stay assistant. Which dates are you looking at?"],
  chips: ['This weekend', 'Next weekend', 'Tomorrow for 2 nights', 'What are the rates?'],
});

const stayLine = s => `${formatDate(s.checkIn)} to ${formatDate(s.checkOut)} (${nightsBetween(s.checkIn, s.checkOut)} night${nightsBetween(s.checkIn, s.checkOut) > 1 ? 's' : ''})`;

function advance(s, say) {
  if (!s.checkIn) {
    s.step = 'dates';
    say.push('Which dates are you looking at? Something like "15 to 18 Nov" or "this weekend" works.');
    return { say, state: s, chips: ['This weekend', 'Next weekend', 'Tomorrow for 2 nights'] };
  }
  if (!s.checkOut) {
    s.step = 'dates';
    say.push(`Checking in ${formatDate(s.checkIn)}. How many nights will you stay?`);
    return { say, state: s, chips: ['1 night', '2 nights', '3 nights'] };
  }
  if (!s.guests) {
    s.step = 'guests';
    say.push(`${stayLine(s)}. How many guests?`);
    return { say, state: s, chips: Array.from({ length: STAY.maxGuests }, (_, i) => `${i + 1} guest${i ? 's' : ''}`) };
  }
  if (isOpen(s.checkIn, s.checkOut)) {
    s.step = 'offer';
    say.push(`Good news: ${stayLine(s)} is open for ${s.guests} guest${s.guests > 1 ? 's' : ''}. Estimated total ${money(quote(s.checkIn, s.checkOut))} at sample rates.`, 'Shall I send this to the host to hold for you?');
    return { say, state: s, chips: ['Yes, hold these dates', 'Try other dates'] };
  }
  const nights = nightsBetween(s.checkIn, s.checkOut);
  const alt = nextOpening(s.checkIn, nights);
  s.step = 'dates';
  say.push(`Some nights in ${stayLine(s)} are already booked.` + (alt ? ` The closest opening for ${nights} night${nights > 1 ? 's' : ''} starts ${formatDate(alt)}.` : ''));
  return { say, state: s, chips: [...(alt ? [`${chipDate(alt)} to ${chipDate(addDays(alt, nights))}`] : []), 'Try other dates'] };
}

const PROMPT = {
  name: ['May I have your name?', []],
  phone: ['And the best mobile number for the host to reach you on?', []],
  offer: ['Shall I send these dates to the host?', ['Yes, hold these dates', 'Try other dates']],
  done: ['Anything else I can help with?', ['Start over']],
};

export function reply(text, state, today = new Date()) {
  today = midnight(today);
  const s = { ...state };
  const say = [];
  const raw = text.trim();
  const t = raw.toLowerCase();

  if (/\b(start over|restart|reset)\b/.test(t)) return advance(newState(), ["Sure, let's start again."]);

  const answer = faqAnswer(t);
  const isQuestion = raw.endsWith('?') || !!answer;

  if (s.step === 'name' && !isQuestion) {
    if (!/^[\p{L}][\p{L} .'-]{1,59}$/u.test(raw)) return { say: ['Could you share your name using letters only?'], state: s, chips: [] };
    s.name = raw;
    s.step = 'phone';
    return { say: [`Thanks, ${raw.split(' ')[0]}. ${PROMPT.phone[0]}`], state: s, chips: [] };
  }
  if (s.step === 'phone' && !isQuestion) {
    if (!isPhone(raw)) return { say: ['That does not look like an Indian mobile number. Please share the 10 digits, for example 98765 43210.'], state: s, chips: [] };
    s.phone = raw;
    s.step = 'done';
    return {
      say: [
        `All set, ${s.name.split(' ')[0]}. Here is the enquiry the host would receive: ${stayLine(s)}, ${s.guests} guest${s.guests > 1 ? 's' : ''}, estimated ${money(quote(s.checkIn, s.checkOut))}, call back on ${raw}.`,
        'This is a demo, so nothing was actually sent. In the live version the host gets this right away.',
      ],
      state: s,
      chips: ['Start over'],
    };
  }

  if (answer) say.push(answer);
  if (s.step === 'name' || s.step === 'phone') {
    if (!answer) say.push("I'm not sure about that one, the host can tell you.");
    say.push(PROMPT[s.step][0]);
    return { say, state: s, chips: [] };
  }

  if (s.step === 'offer') {
    if (/^(yes|yep|yeah|sure|ok|okay|please|hold|book|confirm)\b/.test(t)) {
      s.step = 'name';
      return { say: [PROMPT.name[0]], state: s, chips: [] };
    }
    if (/^(no|nope)\b|other dates|different dates/.test(t)) return advance({ ...newState(), guests: s.guests }, ['No problem.']);
  }
  if (/other dates|different dates/.test(t)) return advance({ ...newState(), guests: s.guests }, []);

  const dates = parseDates(t, today);
  const guests = parseGuests(t, s.step === 'guests');

  if (guests != null) {
    if (guests < 1 || guests > STAY.maxGuests) {
      say.push(`This stay sleeps up to ${STAY.maxGuests} guests, so ${guests} would not fit.`);
      s.guests = null;
    } else s.guests = guests;
  }

  if (dates?.checkIn) {
    if (dates.checkIn < today) say.push('That date has already passed, so please pick one from today onwards.');
    else if (dates.checkOut && dates.checkOut <= dates.checkIn) say.push('Your check-out needs to be after your check-in.');
    else { s.checkIn = dates.checkIn; s.checkOut = dates.checkOut ?? null; }
  } else if (dates?.nights && s.checkIn) {
    s.checkOut = addDays(s.checkIn, dates.nights);
  } else if (s.checkIn && !s.checkOut && /^\d{1,2}$/.test(t) && +t > 0) {
    s.checkOut = addDays(s.checkIn, +t);
  }

  const changed = s.checkIn !== state.checkIn || s.checkOut !== state.checkOut || s.guests !== state.guests;
  if (!changed && !say.length) say.push(answer ? '' : "I didn't quite catch that.");
  if (!changed && PROMPT[s.step]) {
    say.push(PROMPT[s.step][0]);
    return { say: say.filter(Boolean), state: s, chips: PROMPT[s.step][1] };
  }
  return advance(s, say.filter(Boolean));
}
