/* Dependency-free SVG charts (line, bar, heatmap). Each function returns an HTML string; nothing touches the data layer.
   Every mark carries a <title> so values show on hover and are readable by assistive technology. */
const Charts = {
  C: { line: '#1F6FDE', forecast: '#C2570C', grid: '#D9E2EC', axis: '#5B6B7B', empty: '#F2F4F7' },
  esc: s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  peso: v => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(v),
  pesoShort: v => '₱' + new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v),
  int: v => new Intl.NumberFormat('en-US').format(v),

  /* "Nice" axis maximum and 4 equal steps. */
  scale(max, integer) {
    if (!(max > 0)) return { max: 4, step: 1 };
    const raw = max / 4, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    let step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
    if (integer && step < 1) step = 1;
    return { max: Math.ceil(max / step) * step, step };
  },
  ramp(t) { // 0..1 -> light blue .. deep blue
    const a = [234, 242, 255], b = [20, 54, 95], c = a.map((x, i) => Math.round(x + (b[i] - x) * Math.min(1, Math.max(0, t))));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  },

  /* series: [{ name, values: number|null[], color, dashed }]. forecastFrom: index where the forecast region starts. */
  line({ labels, series, fmt = Charts.int, yTitle = '', forecastFrom = null, integer = true }) {
    const W = 760, H = 320, L = 62, R = 18, T = 18, B = 46, pw = W - L - R, ph = H - T - B;
    const all = series.flatMap(s => s.values).filter(v => v != null), sc = Charts.scale(Math.max(0, ...all), integer);
    const x = i => L + (labels.length === 1 ? pw / 2 : (i * pw) / (labels.length - 1)), y = v => T + ph - (v / sc.max) * ph;
    let g = '';
    for (let v = 0; v <= sc.max + 1e-9; v += sc.step) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${Charts.C.grid}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="${Charts.C.axis}">${Charts.esc(fmt(v))}</text>`;
    const every = Math.ceil(labels.length / 12);
    labels.forEach((l, i) => { if (i % every === 0 || i === labels.length - 1) g += `<text x="${x(i)}" y="${H - B + 18}" text-anchor="middle" font-size="11" fill="${Charts.C.axis}">${Charts.esc(l)}</text>`; });
    if (forecastFrom != null && forecastFrom < labels.length) {
      const x0 = x(forecastFrom) - (labels.length > 1 ? pw / (labels.length - 1) / 2 : 0);
      g += `<rect x="${x0}" y="${T}" width="${W - R - x0}" height="${ph}" fill="#FFF4D6" opacity=".55"/><text x="${W - R - 6}" y="${T + 14}" text-anchor="end" font-size="11" font-weight="600" fill="${Charts.C.forecast}">Forecast</text>`;
    }
    series.forEach(s => {
      const pts = s.values.map((v, i) => v == null ? null : [x(i), y(v), v, i]).filter(Boolean);
      if (pts.length > 1) g += `<polyline fill="none" stroke="${s.color}" stroke-width="2.5" ${s.dashed ? 'stroke-dasharray="7 5"' : ''} stroke-linejoin="round" points="${pts.map(p => p[0] + ',' + p[1]).join(' ')}"/>`;
      pts.forEach(p => { g += `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="#fff" stroke="${s.color}" stroke-width="2"><title>${Charts.esc(s.name)}, ${Charts.esc(labels[p[3]])}: ${Charts.esc(fmt(p[2]))}</title></circle>`; });
    });
    if (yTitle) g += `<text transform="translate(14 ${T + ph / 2}) rotate(-90)" text-anchor="middle" font-size="11" fill="${Charts.C.axis}">${Charts.esc(yTitle)}</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Line chart">${g}</svg>`;
  },

  /* bars: [{ label, value, color }]. */
  bar({ bars, fmt = Charts.int, yTitle = '', integer = true }) {
    const W = 760, H = 320, L = 62, R = 18, T = 26, B = 56, pw = W - L - R, ph = H - T - B;
    const sc = Charts.scale(Math.max(0, ...bars.map(b => b.value)), integer), slot = pw / bars.length, bw = Math.min(72, slot * .62);
    const y = v => T + ph - (v / sc.max) * ph; let g = '';
    for (let v = 0; v <= sc.max + 1e-9; v += sc.step) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${Charts.C.grid}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="${Charts.C.axis}">${Charts.esc(fmt(v))}</text>`;
    bars.forEach((b, i) => {
      const cx = L + slot * i + slot / 2, top = y(b.value);
      g += `<rect x="${cx - bw / 2}" y="${top}" width="${bw}" height="${Math.max(1, T + ph - top)}" rx="4" fill="${b.color || Charts.C.line}"><title>${Charts.esc(b.label)}: ${Charts.esc(fmt(b.value))}${b.note ? ' (' + Charts.esc(b.note) + ')' : ''}</title></rect>`;
      g += `<text x="${cx}" y="${top - 6}" text-anchor="middle" font-size="11" font-weight="600" fill="#1B2733">${Charts.esc(fmt(b.value))}</text>`;
      g += `<text x="${cx}" y="${H - B + 18}" text-anchor="middle" font-size="11" fill="${Charts.C.axis}">${Charts.esc(b.label)}</text>`;
    });
    if (yTitle) g += `<text transform="translate(14 ${T + ph / 2}) rotate(-90)" text-anchor="middle" font-size="11" fill="${Charts.C.axis}">${Charts.esc(yTitle)}</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Bar chart">${g}</svg>`;
  },

  /* rows = months ('YYYY-MM'), columns = day of month. matrix[row][day-1] = count. */
  heatmap({ months, matrix, max }) {
    const L = 74, T = 22, cw = 21, ch = 22, W = L + 31 * cw + 10, H = T + months.length * ch + 8; let g = '';
    for (let d = 1; d <= 31; d++) if (d === 1 || d % 5 === 0) g += `<text x="${L + (d - 1) * cw + cw / 2}" y="${T - 7}" text-anchor="middle" font-size="10" fill="${Charts.C.axis}">${d}</text>`;
    months.forEach((m, r) => {
      g += `<text x="${L - 8}" y="${T + r * ch + 15}" text-anchor="end" font-size="11" fill="${Charts.C.axis}">${Charts.esc(Analytics.monthLabel(m))}</text>`;
      const dim = Analytics.daysInMonth(m);
      for (let d = 1; d <= dim; d++) {
        const v = matrix[r][d - 1], fill = v ? Charts.ramp(.15 + .85 * (v / max)) : Charts.C.empty;
        g += `<rect x="${L + (d - 1) * cw + 1}" y="${T + r * ch + 1}" width="${cw - 2}" height="${ch - 2}" rx="3" fill="${fill}"><title>${Charts.esc(Analytics.monthLabel(m).replace(' ', ' ' + d + ', 20'))}: ${v} booking${v === 1 ? '' : 's'}</title></rect>`;
      }
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="chart heat" role="img" aria-label="Heatmap of bookings per day, one row per month">${g}</svg>`;
  },
  heatLegend(max) {
    const stops = [0, .25, .5, .75, 1].map(t => Charts.ramp(.15 + .85 * t)).join(',');
    return `<div class="legend"><span>0 bookings</span><i class="grad" style="background:linear-gradient(90deg,${stops})"></i><span>${Charts.int(max)} bookings (busiest day)</span></div>`;
  }
};
