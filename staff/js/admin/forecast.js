/* Forecasting module: k-Nearest Neighbors regression on monthly booking counts.
   Independent of the UI. Pipeline: retrieve history (Analytics.historicalMonthly) -> preprocess (build lag samples,
   standardize) -> chronological train/test split -> predict -> evaluate (MAE, RMSE) -> recursive multi-month forecast.
   Nothing here returns made-up numbers: with too little history it returns { status: 'insufficient' }. */
const Forecast = {
  WINDOW: 3,       // previous months used as lag features
  MAX_K: 5,
  MIN_MONTHS: 12,  // below this there is not enough history to train and test honestly
  TEST_RATIO: 0.2,

  /* One sample per month t >= WINDOW: features = last WINDOW values + month-of-year (sin, cos); target = value at t. */
  seasonal(month) { const m = +month.slice(5, 7) - 1, a = (2 * Math.PI * m) / 12; return [Math.sin(a), Math.cos(a)]; },
  features(lags, month) { return [...lags, ...Forecast.seasonal(month)]; },
  buildSamples(series) {
    const w = Forecast.WINDOW, out = [];
    for (let t = w; t < series.length; t++) out.push({ month: series[t].month, lags: series.slice(t - w, t).map(p => p.value), y: series[t].value });
    return out;
  },
  /* z-score the lag features using training statistics only (no leakage from the test period). */
  fitScaler(train) {
    const vals = train.flatMap(s => s.lags), mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) || 1;
    return { mean, sd };
  },
  vec(lags, month, sc) { return Forecast.features(lags.map(v => (v - sc.mean) / sc.sd), month); },

  knn(trainVecs, trainY, x, k) {
    const d = trainVecs.map((v, i) => ({ i, d: Math.hypot(...v.map((a, j) => a - x[j])) })).sort((a, b) => a.d - b.d).slice(0, k);
    return d.reduce((s, n) => s + trainY[n.i], 0) / d.length;
  },
  model(samples) {
    const sc = Forecast.fitScaler(samples), vecs = samples.map(s => Forecast.vec(s.lags, s.month, sc)), ys = samples.map(s => s.y);
    const k = Math.max(1, Math.min(Forecast.MAX_K, samples.length));
    return { k, predict: (lags, month) => Math.max(0, Forecast.knn(vecs, ys, Forecast.vec(lags, month, sc), k)) };
  },

  /* Chronological split: the most recent months are held out for testing. */
  split(samples) {
    const nTest = Math.max(2, Math.round(samples.length * Forecast.TEST_RATIO));
    return { train: samples.slice(0, samples.length - nTest), test: samples.slice(samples.length - nTest) };
  },
  evaluate(samples) {
    const { train, test } = Forecast.split(samples), m = Forecast.model(train);
    const errs = test.map(s => m.predict(s.lags, s.month) - s.y);
    return { mae: errs.reduce((a, e) => a + Math.abs(e), 0) / errs.length, rmse: Math.sqrt(errs.reduce((a, e) => a + e * e, 0) / errs.length), trainMonths: train.length, testMonths: test.length, k: m.k };
  },
  /* Refit on all history, then predict month by month, feeding each prediction back in as the newest lag. */
  predictFuture(series, horizon) {
    const m = Forecast.model(Forecast.buildSamples(series)), vals = series.map(p => p.value);
    let month = series[series.length - 1].month; const out = [];
    for (let i = 0; i < horizon; i++) {
      month = Analytics.addMonths(month, 1);
      const v = Math.round(m.predict(vals.slice(-Forecast.WINDOW), month)); vals.push(v); out.push({ month, value: v });
    }
    return out;
  },

  /* series: [{ month: 'YYYY-MM', value }] continuous and chronological. */
  run(series, horizon) {
    if (series.length < Forecast.MIN_MONTHS) return { status: 'insufficient', have: series.length, need: Forecast.MIN_MONTHS };
    const samples = Forecast.buildSamples(series), metrics = Forecast.evaluate(samples);
    return { status: 'ok', history: series, forecast: Forecast.predictFuture(series, horizon), metrics, window: Forecast.WINDOW };
  }
};
