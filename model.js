/* On-device AI: logistic regression over weather features.
   Trains in milliseconds on the user's logged entries, then scores
   forecast days as "likely enjoyable" (0..1). */

const Model = (() => {
  const MIN_ENTRIES = 5;

  function featureVector(features) {
    return Weather.FEATURES.map((k) => Number(features[k]) || 0);
  }

  // z-score normalization stats from training data
  function computeStats(X) {
    const n = X.length, d = X[0].length;
    const mean = new Array(d).fill(0);
    const std = new Array(d).fill(0);
    for (const row of X) row.forEach((v, j) => (mean[j] += v / n));
    for (const row of X) row.forEach((v, j) => (std[j] += (v - mean[j]) ** 2 / n));
    for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j]) || 1;
    return { mean, std };
  }

  function normalize(row, stats) {
    return row.map((v, j) => (v - stats.mean[j]) / stats.std[j]);
  }

  function sigmoid(z) {
    return 1 / (1 + Math.exp(-z));
  }

  // Gradient descent with L2 regularization (keeps weights sane on tiny data)
  function train(entries) {
    if (entries.length < MIN_ENTRIES) return null;
    const labels = entries.map((e) => (e.mood === "good" ? 1 : 0));
    if (!labels.includes(0) || !labels.includes(1)) return null; // need both classes

    const rawX = entries.map((e) => featureVector(e.weather));
    const stats = computeStats(rawX);
    const X = rawX.map((r) => normalize(r, stats));
    const y = labels;
    const n = X.length, d = X[0].length;

    let w = new Array(d).fill(0);
    let b = 0;
    const lr = 0.1, lambda = 0.05, epochs = 500;

    for (let ep = 0; ep < epochs; ep++) {
      const gw = new Array(d).fill(0);
      let gb = 0;
      for (let i = 0; i < n; i++) {
        let z = b;
        for (let j = 0; j < d; j++) z += w[j] * X[i][j];
        const err = sigmoid(z) - y[i];
        for (let j = 0; j < d; j++) gw[j] += err * X[i][j];
        gb += err;
      }
      for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + lambda * w[j]);
      b -= lr * (gb / n);
    }

    return { weights: w, bias: b, stats };
  }

  function predict(model, features) {
    const x = normalize(featureVector(features), model.stats);
    let z = model.bias;
    for (let j = 0; j < x.length; j++) z += model.weights[j] * x[j];
    return sigmoid(z);
  }

  // Top features influencing good/bad days
  function insights(model, topN = 4) {
    const ranked = Weather.FEATURES.map((name, j) => ({
      name,
      weight: model.weights[j]
    })).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
    return ranked.slice(0, topN).filter((f) => Math.abs(f.weight) > 0.01);
  }

  return { MIN_ENTRIES, train, predict, insights };
})();
