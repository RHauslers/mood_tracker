/* On-device AI: ensemble of class-balanced logistic regression + kNN.
   Trains in milliseconds, predicts 0..1 probability a day feels good. */

const Model = (() => {
  const MIN_ENTRIES = 5;

  function featureVector(features) {
    return Weather.FEATURES.map((k) => Number(features[k]) || 0);
  }

  // z-score normalization
  function computeStats(X) {
    const n = X.length, d = X[0].length;
    const mean = new Array(d).fill(0);
    const std  = new Array(d).fill(0);
    for (const row of X) row.forEach((v, j) => (mean[j] += v / n));
    for (const row of X) row.forEach((v, j) => (std[j] += (v - mean[j]) ** 2 / n));
    for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j]) || 1;
    return { mean, std };
  }

  function normalize(row, stats) {
    return row.map((v, j) => (v - stats.mean[j]) / stats.std[j]);
  }

  function sigmoid(z) {
    return 1 / (1 + Math.exp(-Math.max(-50, Math.min(50, z))));
  }

  // --- Logistic Regression with class-weight balancing ---
  function trainLR(X, y) {
    const n = X.length, d = X[0].length;
    const nPos = y.filter((v) => v === 1).length;
    const nNeg = n - nPos;
    // Class weights: inverse frequency, balanced so sum = n
    const wPos = nNeg > 0 ? (n / (2 * nPos)) : 1;
    const wNeg = nPos > 0 ? (n / (2 * nNeg)) : 1;
    const sampleW = y.map((v) => (v === 1 ? wPos : wNeg));

    let w = new Array(d).fill(0);
    let b = Math.log(nPos / Math.max(nNeg, 1)); // initialize bias to log-odds
    const lr = 0.05, lambda = 0.01, epochs = 800;

    for (let ep = 0; ep < epochs; ep++) {
      const gw = new Array(d).fill(0);
      let gb = 0;
      for (let i = 0; i < n; i++) {
        let z = b;
        for (let j = 0; j < d; j++) z += w[j] * X[i][j];
        const err = (sigmoid(z) - y[i]) * sampleW[i];
        for (let j = 0; j < d; j++) gw[j] += err * X[i][j];
        gb += err;
      }
      for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + lambda * w[j]);
      b -= lr * (gb / n);
    }
    return { w, b };
  }

  function predictLR(model, x) {
    let z = model.lrModel.b;
    for (let j = 0; j < x.length; j++) z += model.lrModel.w[j] * x[j];
    return sigmoid(z);
  }

  // --- k-Nearest Neighbors ---
  function euclidean(a, b) {
    let s = 0;
    for (let j = 0; j < a.length; j++) s += (a[j] - b[j]) ** 2;
    return Math.sqrt(s);
  }

  function predictKNN(model, x, k = 5) {
    const distances = model.trainX.map((row, i) => ({
      d: euclidean(row, x),
      label: model.trainY[i]
    }));
    distances.sort((a, b) => a.d - b.d);
    const neighbors = distances.slice(0, Math.min(k, distances.length));
    const votes = neighbors.reduce((sum, nb) => sum + nb.label, 0);
    return votes / neighbors.length;
  }

  // --- Saturation check: LR is useless if all training predictions are extreme ---
  function isLRSaturated(lrModel, X) {
    const preds = X.map((x) => {
      let z = lrModel.b;
      for (let j = 0; j < x.length; j++) z += lrModel.w[j] * x[j];
      return sigmoid(z);
    });
    return preds.every((p) => p < 0.05 || p > 0.95);
  }

  // --- Derived pressure features (based on clinical research) ---
  // pressure_delta: change vs previous day in hPa (negative = falling = bad)
  // pressure_low:   1 if absolute pressure < 1007 hPa (migraine danger zone)
  function addPressureFeatures(weatherArr) {
    return weatherArr.map((w, i) => {
      const prev = i > 0 ? weatherArr[i - 1].pressure : w.pressure;
      const delta = (w.pressure || 0) - (prev || 0);
      const low   = (w.pressure || 0) < 1007 ? 1 : 0;
      return { ...w, pressure_delta: delta, pressure_low: low };
    });
  }

  // For forecast: inject pressure delta vs last logged entry's pressure
  function addPressureFeaturesForForecast(forecastDays, lastKnownPressure) {
    let prev = lastKnownPressure;
    return forecastDays.map((day) => {
      const p = day.features.pressure || 0;
      const delta = p - prev;
      const low   = p < 1007 ? 1 : 0;
      prev = p;
      return { ...day, features: { ...day.features, pressure_delta: delta, pressure_low: low } };
    });
  }

  // --- Public train ---
  function train(entries) {
    if (entries.length < MIN_ENTRIES) return null;
    const labels = entries.map((e) => (e.mood === "good" ? 1 : 0));
    if (!labels.includes(0) || !labels.includes(1)) return null;

    // Sort by date so pressure deltas are chronologically meaningful
    const sorted = entries.slice().sort((a, b) => a.date.localeCompare(b.date));
    const sortedLabels = sorted.map((e) => (e.mood === "good" ? 1 : 0));
    const enrichedWeather = addPressureFeatures(sorted.map((e) => e.weather));

    const rawX = enrichedWeather.map((w) => featureVector(w));
    const stats = computeStats(rawX);
    const X = rawX.map((r) => normalize(r, stats));
    const y = sortedLabels;

    const lrModel = trainLR(X, y);
    const saturated = isLRSaturated(lrModel, X);

    // Store last known pressure so forecast deltas can be computed
    const lastPressure = sorted[sorted.length - 1].weather.pressure || 1013;

    return { lrModel, trainX: X, trainY: y, stats, saturated, lastPressure };
  }

  // --- Public predict: ensemble LR + kNN, clamp to 5-95% ---
  function predict(model, features) {
    const x = normalize(featureVector(features), model.stats);
    const knnScore = predictKNN(model, x);
    let score;
    if (model.saturated) {
      score = knnScore;
    } else {
      const lrScore = predictLR(model, x);
      score = 0.5 * lrScore + 0.5 * knnScore;
    }
    return Math.max(0.05, Math.min(0.95, score));
  }

  // --- Insights from LR weights (still interpretable) ---
  function insights(model, topN = 4) {
    if (model.saturated) return []; // LR weights not meaningful when saturated
    const ranked = Weather.FEATURES.map((name, j) => ({
      name,
      weight: model.lrModel.w[j]
    })).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
    return ranked.slice(0, topN).filter((f) => Math.abs(f.weight) > 0.01);
  }

  function modelLabel(model) {
    return model.saturated ? "kNN" : "Ensemble (LR + kNN)";
  }

  return { MIN_ENTRIES, train, predict, insights, modelLabel, addPressureFeaturesForForecast };
})();
