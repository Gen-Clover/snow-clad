import { greeting, reply, isPhone } from './assistant.js';

document.documentElement.classList.add('js');
const $ = id => document.getElementById(id);
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = ms => new Promise(r => setTimeout(r, calm ? 0 : ms));

const localISO = d => new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const todayISO = localISO(new Date());
for (const id of ['b-in', 'b-out', 'l-in', 'l-out']) $(id).min = todayISO;

/* Assistant */
const chat = $('chat'), log = $('chat-log'), chips = $('chat-chips'), input = $('chat-input'), fab = $('chat-fab');
let state = null, busy = false, opener = fab;

function bubble(text, who) {
  const el = document.createElement('div');
  el.className = `msg ${who}`;
  el.textContent = text;
  log.append(el);
  log.scrollTop = log.scrollHeight;
}

function showChips(list) {
  chips.replaceChildren(...list.map(label => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = label;
    b.onclick = () => send(label);
    return b;
  }));
}

async function speak({ say, chips: next, state: nextState }) {
  state = nextState;
  busy = true;
  showChips([]);
  for (const line of say) {
    const dots = document.createElement('div');
    dots.className = 'typing';
    dots.setAttribute('aria-hidden', 'true');
    dots.innerHTML = '<span></span><span></span><span></span>';
    log.append(dots);
    log.scrollTop = log.scrollHeight;
    await wait(Math.min(350 + line.length * 6, 900));
    dots.remove();
    bubble(line, 'bot');
  }
  showChips(next);
  log.scrollTop = log.scrollHeight;
  busy = false;
}

async function send(text) {
  if (busy || !text.trim()) return;
  bubble(text.trim(), 'me');
  input.value = '';
  await speak(reply(text, state));
  input.focus();
}

async function openChat(trigger, firstMessage) {
  opener = trigger;
  chat.hidden = false;
  fab.hidden = true;
  fab.setAttribute('aria-expanded', 'true');
  input.focus();
  if (!state) await speak(greeting());
  if (firstMessage) await send(firstMessage);
}

function closeChat() {
  chat.hidden = true;
  fab.hidden = false;
  fab.setAttribute('aria-expanded', 'false');
  opener?.focus();
}

document.querySelectorAll('[data-open-chat]').forEach(b => b.addEventListener('click', () => openChat(b)));
$('chat-close').addEventListener('click', closeChat);
chat.addEventListener('keydown', e => { if (e.key === 'Escape') closeChat(); });
$('chat-form').addEventListener('submit', e => { e.preventDefault(); send(input.value); });

/* Hero booking bar hands its values to the assistant */
$('b-in').addEventListener('change', e => { $('b-out').min = e.target.value || todayISO; });
$('booking').addEventListener('submit', e => {
  e.preventDefault();
  const from = $('b-in').value, to = $('b-out').value, guests = $('b-guests').value;
  const who = `${guests} guest${guests > 1 ? 's' : ''}`;
  const message = from && to ? `${from} to ${to}, ${who}` : from ? `${from}, ${who}` : null;
  openChat(e.submitter, message);
});

/* Door keypad */
const screen = $('lock-screen'), keys = [...document.querySelectorAll('.lock-keys span:not(.off)')];
let lockRun = 0;

async function playLock() {
  const run = ++lockRun;
  screen.classList.remove('open');
  screen.textContent = 'Enter your code';
  if (calm) { screen.textContent = 'Unlocked. Welcome in.'; screen.classList.add('open'); return; }
  await wait(500);
  let typed = '';
  for (const digit of '4729') {
    if (run !== lockRun) return;
    const key = keys.find(k => k.textContent === digit);
    key.classList.add('on');
    typed += '*';
    screen.textContent = typed;
    await wait(220);
    key.classList.remove('on');
    await wait(180);
  }
  if (run !== lockRun) return;
  screen.textContent = 'Unlocked. Welcome in.';
  screen.classList.add('open');
}

$('lock-replay').addEventListener('click', playLock);
new IntersectionObserver((entries, io) => {
  if (entries[0].isIntersecting) { io.disconnect(); playLock(); }
}, { threshold: .5 }).observe($('lock'));

/* Scroll reveal */
const revealer = new IntersectionObserver(entries => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); revealer.unobserve(e.target); }
}, { threshold: .12 });
document.querySelectorAll('.reveal').forEach(el => revealer.observe(el));

/* All-photos gallery, built on first open from the photo manifest */
const gallery = $('gallery'), galleryBody = $('gallery-body');

$('gallery-open').addEventListener('click', async () => {
  gallery.showModal();
  if (galleryBody.childElementCount) return;
  const photos = await (await fetch('assets/photos/photos.json')).json();
  for (const category of new Set(photos.map(p => p.category))) {
    const heading = document.createElement('h3');
    heading.textContent = category;
    const grid = document.createElement('div');
    grid.className = 'gallery-grid';
    for (const p of photos.filter(p => p.category === category)) {
      const fig = document.createElement('figure');
      const img = Object.assign(document.createElement('img'), { src: 'assets/photos/' + p.file, alt: p.alt, loading: 'lazy', width: p.width, height: p.height });
      const cap = document.createElement('figcaption');
      cap.textContent = p.label;
      fig.append(img, cap);
      grid.append(fig);
    }
    galleryBody.append(heading, grid);
  }
});
$('gallery-close').addEventListener('click', () => gallery.close());
gallery.addEventListener('click', e => { if (e.target === gallery) gallery.close(); });

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
  const from = $('l-in').value, to = $('l-out').value;
  const checks = [
    setError('l-name', $('l-name').value.trim().length >= 2 ? '' : 'Please enter your name.'),
    setError('l-phone', isPhone($('l-phone').value) ? '' : 'Please enter a 10-digit Indian mobile number.'),
    setError('l-in', from && from < todayISO ? 'Please pick today or a later date.' : ''),
    setError('l-out', from && to && to <= from ? 'Check-out needs to be after check-in.' : ''),
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
