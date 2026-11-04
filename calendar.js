// Date-range calendar shared by the booking picker and the chat.
import { isBooked, isOpen, midnight } from './assistant.js';

const same = (a, b) => !!a && !!b && +a === +b;
const iso = d => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');

// A booked day can still be a check-out day when every night before it is open.
export function dayState(d, { start, end }, today) {
  const past = d < today, booked = isBooked(d);
  const checkoutOnly = booked && !!start && !end && d > start && isOpen(start, d);
  return {
    past, booked, checkoutOnly,
    disabled: past || (booked && !checkoutOnly),
    start: same(d, start),
    end: same(d, end),
    inside: !!start && !!end && d > start && d < end,
  };
}

export function pick({ start, end }, d) {
  if (start && !end && d > start && isOpen(start, d)) return { start, end: d };
  return { start: d, end: null };
}

function dayButton(d, state) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.day = iso(d);
  b.disabled = state.disabled;
  b.className = ['day', state.booked && 'booked', state.start && 'start', state.end && 'end', state.inside && 'inside'].filter(Boolean).join(' ');
  const when = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'long' });
  const status = state.past ? 'past' : state.checkoutOnly ? 'check-out only' : state.booked ? 'booked' : 'available';
  b.setAttribute('aria-label', `${when}, ${status}`);
  if (state.start || state.end) b.setAttribute('aria-pressed', 'true');
  const num = document.createElement('span');
  num.textContent = d.getDate();
  b.append(num);
  return b;
}

export function mountCalendar(el, { months = 1, range = { start: null, end: null }, today = midnight(new Date()), onChange = () => {} } = {}) {
  const firstMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  let view = firstMonth;

  function render(focusDay) {
    const grid = document.createElement('div');
    grid.className = 'cal-months';
    grid.style.setProperty('--months', months);
    for (let m = 0; m < months; m++) {
      const first = new Date(view.getFullYear(), view.getMonth() + m, 1);
      const title = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
      const month = document.createElement('div');
      month.className = 'cal-month';
      month.setAttribute('role', 'group');
      month.setAttribute('aria-label', title);
      const head = document.createElement('p');
      head.className = 'cal-title';
      head.textContent = title;
      const days = document.createElement('div');
      days.className = 'cal-days';
      for (const w of ['S', 'M', 'T', 'W', 'T', 'F', 'S']) {
        const label = document.createElement('span');
        label.className = 'cal-dow';
        label.setAttribute('aria-hidden', 'true');
        label.textContent = w;
        days.append(label);
      }
      for (let i = 0; i < first.getDay(); i++) days.append(document.createElement('span'));
      for (let d = first; d.getMonth() === first.getMonth(); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
        days.append(dayButton(d, dayState(d, range, today)));
      }
      month.append(head, days);
      grid.append(month);
    }
    const arrow = (cls, label, icon, step, off) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `icon-btn cal-arrow ${cls}`;
      b.setAttribute('aria-label', label);
      b.disabled = off;
      b.innerHTML = `<i class="ph ${icon}" aria-hidden="true"></i>`;
      b.onclick = () => { view = new Date(view.getFullYear(), view.getMonth() + step, 1); render(); };
      return b;
    };
    el.replaceChildren(arrow('prev', 'Previous month', 'ph-caret-left', -1, +view <= +firstMonth), arrow('next', 'Next month', 'ph-caret-right', 1, false), grid);
    if (focusDay) el.querySelector(`[data-day="${focusDay}"]`)?.focus();
  }

  el.classList.add('cal');
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-day]');
    if (!b) return;
    const [y, m, d] = b.dataset.day.split('-').map(Number);
    range = pick(range, new Date(y, m - 1, d));
    render(b.dataset.day);
    onChange(range);
  });
  render();

  return {
    set(next, nextMonths = months) {
      range = next;
      months = nextMonths;
      if (next.start) view = new Date(next.start.getFullYear(), next.start.getMonth(), 1);
      render();
    },
  };
}
