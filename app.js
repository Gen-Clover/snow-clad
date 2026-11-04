import { greeting, reply, isPhone, isOpen, nightsBetween } from './assistant.js';
import { mountCalendar } from './calendar.js';

document.documentElement.classList.add('js');
const $ = id => document.getElementById(id);
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = ms => new Promise(r => setTimeout(r, calm ? 0 : ms));

function make(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

/* Nav turns solid once the hero has scrolled away */
new IntersectionObserver(([e]) => $('nav').classList.toggle('over', e.isIntersecting), { rootMargin: '0px 0px -99% 0px' }).observe($('top'));
$('menu').addEventListener('click', e => { if (e.target.closest('a') && $('menu').matches(':popover-open')) $('menu').hidePopover(); });

/* Chosen dates are shared by the booking bar, the lead form and the chat */
let stay = { start: null, end: null };
const label = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const shortLabel = d => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

function setStay(next) {
  stay = next;
  document.querySelectorAll('[data-in]').forEach(el => { el.textContent = stay.start ? shortLabel(stay.start) : 'Add date'; });
  document.querySelectorAll('[data-out]').forEach(el => { el.textContent = stay.end ? shortLabel(stay.end) : 'Add date'; });
}

function stayMessage() {
  const guests = $('b-guests').value;
  return `${label(stay.start)} to ${label(stay.end)}, ${guests} guest${guests > 1 ? 's' : ''}`;
}

/* Calendar picker */
const picker = $('picker'), wide = matchMedia('(min-width: 861px)');
let draft = stay, afterPick = null;

function showDraft() {
  const { start, end } = draft;
  $('picker-done').disabled = !end;
  if (!start) $('picker-summary').textContent = 'Select your check-in date';
  else if (!end) $('picker-summary').textContent = `${shortLabel(start)}. Now select your check-out date`;
  else {
    const nights = nightsBetween(start, end);
    $('picker-summary').textContent = `${shortLabel(start)} to ${shortLabel(end)}, ${nights} night${nights > 1 ? 's' : ''}`;
  }
}

const pickerCal = mountCalendar($('picker-cal'), { months: wide.matches ? 2 : 1, onChange: range => { draft = range; showDraft(); } });

function openPicker(trigger, then = null) {
  afterPick = then && (() => then(trigger));
  draft = stay;
  pickerCal.set(draft, wide.matches ? 2 : 1);
  showDraft();
  picker.showModal();
}

$('picker-close').addEventListener('click', () => picker.close());
picker.addEventListener('click', e => { if (e.target === picker) picker.close(); });
$('picker-clear').addEventListener('click', () => { draft = { start: null, end: null }; pickerCal.set(draft); showDraft(); });
$('picker-done').addEventListener('click', () => {
  setStay(draft);
  picker.close();
  afterPick?.();
});
document.querySelectorAll('[data-dates]').forEach(b => b.addEventListener('click', () => openPicker(b)));

/* Assistant */
const chat = $('chat'), log = $('chat-log'), chips = $('chat-chips'), input = $('chat-input'), fab = $('chat-fab'), bar = $('mobile-bar');
let state = null, busy = false, opener = fab;

function bubble(text, who) {
  const el = make('div', `msg ${who}`, text);
  log.append(el);
  log.scrollTop = log.scrollHeight;
}

function showChips(list) {
  chips.replaceChildren(...list.map(text => {
    const b = make('button', 'chip', text);
    b.type = 'button';
    b.onclick = () => send(text);
    return b;
  }));
}

function showMiniCalendar() {
  const box = make('div', 'msg-cal');
  log.append(box);
  mountCalendar(box, { onChange: ({ start, end }) => { if (end) send(`${label(start)} to ${label(end)}`); } });
}

async function speak({ say, chips: next, state: nextState, calendar }) {
  state = nextState;
  if (state.checkIn && state.checkOut && isOpen(state.checkIn, state.checkOut)) setStay({ start: state.checkIn, end: state.checkOut });
  busy = true;
  showChips([]);
  for (const line of say) {
    const dots = make('div', 'typing');
    dots.setAttribute('aria-hidden', 'true');
    dots.innerHTML = '<span></span><span></span><span></span>';
    log.append(dots);
    log.scrollTop = log.scrollHeight;
    await wait(Math.min(350 + line.length * 6, 900));
    dots.remove();
    bubble(line, 'bot');
  }
  if (calendar) showMiniCalendar();
  showChips(next);
  log.scrollTop = log.scrollHeight;
  busy = false;
}

async function send(text) {
  if (busy || !text.trim()) return;
  log.querySelector('.msg-cal')?.remove();
  bubble(text.trim(), 'me');
  input.value = '';
  await speak(reply(text, state));
  input.focus();
}

async function openChat(trigger, firstMessage) {
  opener = trigger;
  chat.hidden = false;
  fab.hidden = true;
  bar.hidden = true;
  fab.setAttribute('aria-expanded', 'true');
  input.focus();
  if (!state) await speak({ ...greeting(), calendar: !firstMessage });
  if (firstMessage) await send(firstMessage);
}

function closeChat() {
  chat.hidden = true;
  fab.hidden = false;
  bar.hidden = false;
  fab.setAttribute('aria-expanded', 'false');
  opener?.focus();
}

document.querySelectorAll('[data-open-chat]').forEach(b => b.addEventListener('click', () => openChat(b)));
$('chat-close').addEventListener('click', closeChat);
chat.addEventListener('keydown', e => { if (e.key === 'Escape') closeChat(); });
$('chat-form').addEventListener('submit', e => { e.preventDefault(); send(input.value); });

/* Booking bar and mobile bar: ask for dates if needed, then hand over to the assistant */
function checkDates(trigger) {
  if (stay.end) openChat(trigger, stayMessage());
  else openPicker(trigger, t => openChat(t, stayMessage()));
}

$('booking').addEventListener('submit', e => { e.preventDefault(); checkDates(e.submitter); });
$('bar-dates').addEventListener('click', e => checkDates(e.currentTarget));

/* Door unlock animation */
const lock = $('lock'), screen = $('lock-screen'), lockIcon = $('lock-icon'), dots = [...$('lock-dots').children];
let lockRun = 0;

function unlock() {
  lock.classList.add('open');
  lockIcon.className = 'ph ph-lock-key-open';
  screen.textContent = 'Unlocked. Welcome in.';
}

async function playLock() {
  const run = ++lockRun;
  lock.classList.remove('open');
  lockIcon.className = 'ph ph-lock-key';
  dots.forEach(d => d.classList.remove('on'));
  screen.textContent = 'Enter your code';
  if (calm) { dots.forEach(d => d.classList.add('on')); unlock(); return; }
  await wait(600);
  for (const dot of dots) {
    if (run !== lockRun) return;
    dot.classList.add('on');
    await wait(280);
  }
  if (run === lockRun) unlock();
}

$('lock-replay').addEventListener('click', playLock);
new IntersectionObserver((entries, io) => {
  if (entries[0].isIntersecting) { io.disconnect(); playLock(); }
}, { threshold: .5 }).observe(lock);

/* Scroll reveal */
const revealer = new IntersectionObserver(entries => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); revealer.unobserve(e.target); }
}, { threshold: .12 });
document.querySelectorAll('.reveal').forEach(el => revealer.observe(el));

/* Amenity tiles */
$('tiles-more').addEventListener('click', e => {
  const open = e.currentTarget.getAttribute('aria-expanded') !== 'true';
  document.querySelectorAll('#tiles li').forEach((li, i) => { if (i >= 6) li.hidden = !open; });
  e.currentTarget.setAttribute('aria-expanded', open);
  e.currentTarget.textContent = open ? 'Show fewer' : 'Show all 16 amenities';
});

/* Reviews: everything shown comes from the data file, so a live feed can replace it later */
fetch('assets/reviews.json').then(r => r.json()).then(({ count, url, airbnb, reviews }) => {
  document.querySelectorAll('[data-review-link]').forEach(a => { a.href = url; });
  if (count) document.querySelector('[data-review-count]').textContent = `${count} Google review${count > 1 ? 's' : ''}. Read them`;
  document.querySelector('[data-review-total]').textContent = `from ${airbnb.count} reviews on Airbnb`;
  $('review-scores').replaceChildren(...airbnb.scores.map(({ label: name, score }) => {
    const item = make('div', 'score');
    item.append(make('dt', '', name), make('dd', '', score.toFixed(1)));
    return item;
  }));
  $('review-list').replaceChildren(...reviews.map(({ author, source, text }) => {
    const card = make('figure', 'review');
    const stars = make('span', 'stars');
    stars.setAttribute('role', 'img');
    stars.setAttribute('aria-label', '5 out of 5 stars');
    stars.innerHTML = '<i class="ph-fill ph-star" aria-hidden="true"></i>'.repeat(5);
    card.append(stars, make('blockquote', '', text), make('figcaption', '', `${author}, on ${source}`));
    return card;
  }));
});

/* Photos: a filterable grid and a full-screen viewer, both from the manifest */
let photos = null;
const manifest = async () => photos ??= await (await fetch('assets/photos/photos.json')).json();
const fileOf = img => img.src.split('/').pop();

const gallery = $('gallery'), galleryBody = $('gallery-body'), filters = $('gallery-filters');
const viewer = $('viewer'), track = $('viewer-track');
let viewing = [];

function viewerIndex() { return Math.round(track.scrollLeft / track.clientWidth) || 0; }

function showCaption() {
  const i = viewerIndex(), p = viewing[i];
  if (!p) return;
  $('viewer-cap').textContent = `${p.label} (${i + 1} of ${viewing.length})`;
  $('viewer-prev').disabled = i === 0;
  $('viewer-next').disabled = i === viewing.length - 1;
}

function openViewer(list, file) {
  viewing = list;
  track.replaceChildren(...list.map(p => {
    const slide = make('figure', 'viewer-slide');
    slide.append(Object.assign(document.createElement('img'), { src: 'assets/photos/' + p.file, alt: p.alt, loading: 'lazy', decoding: 'async' }));
    return slide;
  }));
  viewer.showModal();
  track.scrollTo({ left: Math.max(0, list.findIndex(p => p.file === file)) * track.clientWidth, behavior: 'instant' });
  showCaption();
  track.focus();
}

const stepViewer = n => track.scrollBy({ left: n * track.clientWidth, behavior: calm ? 'auto' : 'smooth' });
track.addEventListener('scroll', showCaption, { passive: true });
$('viewer-prev').addEventListener('click', () => stepViewer(-1));
$('viewer-next').addEventListener('click', () => stepViewer(1));
$('viewer-close').addEventListener('click', () => viewer.close());
viewer.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft') { e.preventDefault(); stepViewer(-1); }
  if (e.key === 'ArrowRight') { e.preventDefault(); stepViewer(1); }
});

function showCategory(category, all) {
  const list = category === 'All' ? all : all.filter(p => p.category === category);
  filters.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', c.dataset.category === category));
  const grid = make('div', 'gallery-grid');
  grid.append(...list.map(p => {
    const b = make('button', 'photo-btn');
    b.type = 'button';
    b.setAttribute('aria-label', `View photo: ${p.label}`);
    b.append(Object.assign(document.createElement('img'), { src: 'assets/photos/' + p.file, alt: p.alt, loading: 'lazy', width: p.width, height: p.height }));
    b.onclick = () => openViewer(list, p.file);
    const fig = make('figure');
    fig.append(b, make('figcaption', '', p.label));
    return fig;
  }));
  galleryBody.replaceChildren(grid);
  galleryBody.scrollTop = 0;
}

document.querySelectorAll('[data-gallery]').forEach(b => b.addEventListener('click', async () => {
  gallery.showModal();
  const all = await manifest();
  if (filters.childElementCount) return;
  for (const category of ['All', ...new Set(all.map(p => p.category))]) {
    const chip = make('button', 'chip', `${category} ${category === 'All' ? all.length : all.filter(p => p.category === category).length}`);
    chip.type = 'button';
    chip.dataset.category = category;
    chip.onclick = () => showCategory(category, all);
    filters.append(chip);
  }
  showCategory('All', all);
}));
$('gallery-close').addEventListener('click', () => gallery.close());
gallery.addEventListener('click', e => { if (e.target === gallery) gallery.close(); });

/* Every photo on the page opens the viewer */
document.querySelectorAll('.bento img, .detail-media img, .band img').forEach(img => {
  const b = make('button', 'photo-btn');
  b.type = 'button';
  b.setAttribute('aria-label', `View photo: ${img.alt}`);
  img.replaceWith(b);
  b.append(img);
  b.onclick = async () => openViewer(await manifest(), fileOf(img));
});

/* Social links still waiting on real URLs should not jump the page */
document.querySelectorAll('[data-pending]').forEach(a => a.addEventListener('click', e => e.preventDefault()));

/* Lead form: validates like the real thing, sends nothing */
const lead = $('lead'), sent = $('lead-sent');

function setError(id, message) {
  const field = $(id);
  $(`${id}-err`).textContent = message;
  if (message) field.setAttribute('aria-invalid', 'true');
  else field.removeAttribute('aria-invalid');
  return !message;
}

lead.addEventListener('submit', e => {
  e.preventDefault();
  const checks = [
    setError('l-name', $('l-name').value.trim().length >= 2 ? '' : 'Please enter your name.'),
    setError('l-phone', isPhone($('l-phone').value) ? '' : 'Please enter a 10-digit Indian mobile number.'),
  ];
  if (checks.every(Boolean)) {
    lead.hidden = true;
    sent.hidden = false;
    sent.focus();
  } else {
    lead.querySelector('[aria-invalid="true"]').focus();
  }
});

$('lead-reset').addEventListener('click', () => {
  lead.reset();
  sent.hidden = true;
  lead.hidden = false;
  $('l-name').focus();
});
