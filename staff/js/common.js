const PHT = 'Asia/Manila';
const CATEGORIES = ['Regular', 'Student', 'Senior Citizen', 'Child', 'PWD'];
const CLASSES = ['Local', 'Tourist'];
const PORT_NAMES = { ANILAO: 'Anilao Port', TINGLOY: 'Tingloy Port' };

// All dates and times in the staff portal use Philippine time, whatever the computer's timezone is.
const Time = {
  parts(d = new Date()) {
    return Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: PHT, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(d).map(x => [x.type, x.value]));
  },
  today() { const p = Time.parts(); return `${p.year}-${p.month}-${p.day}`; },
  label(hhmm) { const [h, m] = String(hhmm).slice(0, 5).split(':').map(Number); return `${String(h % 12 || 12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; },
  longDate(key) { const [y, m, d] = key.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }); },
  shortDate(key) { const [y, m, d] = key.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }); },
  stamp(iso) { return new Date(iso).toLocaleString('en-US', { timeZone: PHT, month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).replace(',', ''); }
};
