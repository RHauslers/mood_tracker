/* On-device AI: ensemble of class-balanced logistic regression + kNN.
   Trains in milliseconds, predicts 0..1 probability a day feels good. */

const Model = (() => {
  const MIN_ENTRIES = 3;         // allow experimental predictions with fewer entries
  const IDEAL_ENTRIES = 10;      // threshold for full confidence
  const MIN_CONFIDENCE = 0.05;   // minimum clamped confidence for low-data predictions
  const MAX_CONFIDENCE = 0.95;   // never be fully certain

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

  // --- Common-sense priors: medically/logically expected feature directions ---
  // positive = more of this feature → better mood, negative = more → worse mood
  // Strength fades as data grows (prior weight = priorStrength * priorScale(n))
  // Pollutants/pollen priors are strong because they're never genuinely good for mood;
  // any observed correlation (e.g. pollen ↑ on clear days → good mood) is confounding.
  const PRIORS = {
    pm2_5: -0.8, pm10: -0.8, ozone: -0.5,
    alder_pollen: -0.8, birch_pollen: -0.8, grass_pollen: -0.8,
    mugwort_pollen: -0.8, olive_pollen: -0.8, ragweed_pollen: -0.8,
    pressure_delta: 0.4,   // rising pressure → better
    pressure_low: -0.5,     // low pressure zone → worse
    humidity: -0.15,        // high humidity → slightly worse
    cloudcover: -0.15,      // more clouds → slightly worse
    precipitation: -0.2,    // rain → worse
    windspeed: -0.05        // wind → slightly worse
  };

  // --- Logistic Regression with class-weight balancing + priors ---
  function trainLR(X, y) {
    const n = X.length, d = X[0].length;
    const nPos = y.filter((v) => v === 1).length;
    const nNeg = n - nPos;
    // Class weights: inverse frequency, balanced so sum = n
    const wPos = nNeg > 0 ? (n / (2 * nPos)) : 1;
    const wNeg = nPos > 0 ? (n / (2 * nNeg)) : 1;
    const sampleW = y.map((v) => (v === 1 ? wPos : wNeg));

    // Prior influence: strong with few entries, fades with more data
    // With 5 entries priorScale=0.45, with 50 entries priorScale=0.14
    const priorScale = 2 / Math.sqrt(n);
    let w = Weather.FEATURES.map((name, j) => (PRIORS[name] || 0) * priorScale);
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
      for (let j = 0; j < d; j++) {
        const prior = (PRIORS[Weather.FEATURES[j]] || 0) * priorScale;
        // L2 regularization pulls toward prior, not toward zero
        w[j] -= lr * (gw[j] / n + lambda * (w[j] - prior));
      }
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

  // --- Confidence / uncertainty ---
  function confidence(model, nEntries) {
    // Data-driven uncertainty: how much do the top neighbors disagree?
    // Base it also on the number of entries and class balance.
    const nPos = model.trainY.filter((v) => v === 1).length;
    const nNeg = model.trainY.length - nPos;
    const balance = Math.min(nPos, nNeg) / Math.max(nPos, nNeg, 1); // 1 = balanced, 0 = only one class
    const size = Math.min(1, (nEntries - MIN_ENTRIES) / (IDEAL_ENTRIES - MIN_ENTRIES));
    return Math.max(MIN_CONFIDENCE, Math.min(MAX_CONFIDENCE, 0.3 + 0.5 * size + 0.2 * balance));
  }

  function confidenceLabel(nEntries, conf) {
    if (nEntries < MIN_ENTRIES) return "no prediction";
    if (nEntries < IDEAL_ENTRIES) return "experimental — " + Math.round(conf * 100) + "% confident";
    if (conf < 0.55) return "uncertain";
    if (conf < 0.75) return "fairly confident";
    return "confident";
  }

  // --- Plain-language explanation for a single prediction ---
  function plainExplain(model, features, nEntries) {
    const parts = [];
    const reasons = explain(model, features, 3);
    const knnInfo = explainKNN(model, features, 5);

    if (reasons.length) {
      const top = reasons[0];
      const label = Weather.FEATURES[top.name] ? top.name : top.name;
      const direction = top.contribution > 0 ? "good" : "bad";
      // Pick a human-friendly phrase for the top feature
      const phrase = featurePhrase(label, top.raw, top.contribution > 0);
      if (phrase) parts.push(phrase);
    }

    if (knnInfo.total > 0) {
      const ratio = knnInfo.goodCount / knnInfo.total;
      if (ratio >= 0.8) parts.push("Matches your best days");
      else if (ratio <= 0.2) parts.push("Matches your worst days");
      else parts.push(knnInfo.goodCount + "/" + knnInfo.total + " similar days were good");
    }

    if (nEntries < IDEAL_ENTRIES) {
      parts.push("Low data — confidence is experimental");
    }

    return parts.join(" · ");
  }

  function featurePhrase(name, raw, isGood) {
    const val = Number(raw) || 0;
    const dir = isGood ? "good" : "bad";
    if (name === "temperature") {
      if (isGood) return val > 20 ? "Warm and pleasant" : "Mild temperature";
      return val < 8 ? "Very cold" : "Cool temperature";
    }
    if (name === "windspeed") {
      if (isGood) return val < 10 ? "Calm" : "Breezy";
      return val > 20 ? "Very windy" : "Windy";
    }
    if (name === "pressure_delta") {
      return val > 0 ? "Pressure rising" : "Pressure falling";
    }
    if (name === "pressure_low") {
      return isGood ? "Normal pressure" : "Low pressure zone";
    }
    if (name.includes("pollen")) {
      return isGood ? "Low pollen" : "High pollen";
    }
    if (name === "pm2_5" || name === "pm10" || name === "ozone") {
      return isGood ? "Clean air" : "Higher air pollution";
    }
    if (name === "cloudcover") {
      return isGood ? (val > 50 ? "Overcast" : "Sunny") : (val > 50 ? "Gloomy" : "Too bright?");
    }
    if (name === "humidity") {
      return isGood ? "Comfortable humidity" : "High humidity";
    }
    if (name === "precipitation") {
      return isGood ? "Dry" : "Wet / rainy";
    }
    return (isGood ? "Higher " : "Lower ") + (FEATURE_LABELS[name] || name);
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

    const model = { lrModel, trainX: X, trainY: y, stats, saturated, lastPressure };
    model.confidence = confidence(model, entries.length);
    model.nEntries = entries.length;
    model.label = confidenceLabel(entries.length, model.confidence);
    return model;
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

  // --- Explain a single prediction: which features contributed most ---
  function explain(model, features, topN = 3) {
    const vec = featureVector(features);
    const x = normalize(vec, model.stats);
    const contributions = Weather.FEATURES.map((name, j) => ({
      name,
      raw: vec[j],
      contribution: model.lrModel.w[j] * x[j] // signed: positive = toward good
    })).sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
    // Only return features with meaningful contribution
    return contributions.slice(0, topN).filter((f) => Math.abs(f.contribution) > 0.02);
  }

  // --- kNN explanation: what were the nearest neighbors like? ---
  function explainKNN(model, features, k = 5) {
    const vec = featureVector(features);
    const x = normalize(vec, model.stats);
    const distances = model.trainX.map((row, i) => ({
      d: euclidean(row, x),
      label: model.trainY[i]
    }));
    distances.sort((a, b) => a.d - b.d);
    const neighbors = distances.slice(0, Math.min(k, distances.length));
    const goodCount = neighbors.filter((nb) => nb.label === 1).length;
    const badCount = neighbors.length - goodCount;
    return { goodCount, badCount, total: neighbors.length };
  }

  function modelLabel(model) {
    return model.saturated ? "kNN" : "Ensemble (LR + kNN)";
  }

  return { MIN_ENTRIES, IDEAL_ENTRIES, train, predict, confidence, confidenceLabel, insights, explain, explainKNN, plainExplain, modelLabel, addPressureFeaturesForForecast };
})();
