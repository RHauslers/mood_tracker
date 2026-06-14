/* App logic: logging, history, predictions, persistence */

const STORAGE_KEY = "mood_weather_entries_v1";

const FEATURE_LABELS = {
  temperature: "Temp (°C)",
  humidity: "Humidity (%)",
  pressure: "Pressure (hPa)",
  cloudcover: "Clouds (%)",
  windspeed: "Wind (km/h)",
  precipitation: "Precip (mm)",
  uv_index: "UV index",
  pm2_5: "PM2.5",
  pm10: "PM10",
  ozone: "Ozone",
  alder_pollen: "Alder pollen",
  birch_pollen: "Birch pollen",
  grass_pollen: "Grass pollen",
  mugwort_pollen: "Mugwort pollen",
  olive_pollen: "Olive pollen",
  ragweed_pollen: "Ragweed pollen",
  pressure_delta: "Pressure change (hPa/day)",
  pressure_low: "Low pressure zone"
};

const $ = (id) => document.getElementById(id);

function loadEntries() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}

function saveEntries(entries) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function setStatus(msg) {
  $("status").textContent = msg;
}

function setButtonsDisabled(disabled) {
  $("btn-good").disabled = disabled;
  $("btn-bad").disabled = disabled;
}

/* ---------- Logging ---------- */

async function logMood(mood, date, weather, lat, lon) {
  setButtonsDisabled(true);
  setStatus("Saving entry…");
  try {
    const entries = loadEntries();
    const targetDate = date || new Date().toISOString().slice(0, 10);
    const existing = entries.findIndex((e) => e.date === targetDate);
    const entry = { date: targetDate, mood, lat: lat ?? null, lon: lon ?? null, weather, ts: Date.now() };
    if (existing >= 0) entries[existing] = entry;
    else entries.push(entry);
    saveEntries(entries);

    if (!date) {
      setStatus(existing >= 0 ? "Today's entry updated." : "Entry saved!");
      renderTodayCard(entry);
    } else {
      setStatus("Past entry saved!");
      $("past-picker").classList.add("hidden");
    }
    renderHistory();
    renderPredictions();
  } catch (err) {
    setStatus("⚠️ " + err.message);
  } finally {
    setButtonsDisabled(false);
  }
}

async function logMoodToday(mood) {
  setButtonsDisabled(true);
  setStatus("Getting your location…");
  try {
    const { lat, lon } = await Weather.getPosition();
    setStatus("Fetching weather data…");
    const weather = await Weather.getCurrent(lat, lon);
    await logMood(mood, null, weather, lat, lon);
  } catch (err) {
    setStatus("⚠️ " + err.message);
    setButtonsDisabled(false);
  }
}

function renderTodayCard(entry) {
  const card = $("today-card");
  const w = entry.weather;
  const rows = Object.keys(FEATURE_LABELS)
    .filter((k) => w[k] !== undefined && w[k] !== null)
    .map((k) => `<div class="kv"><span>${FEATURE_LABELS[k]}</span><span>${round1(w[k])}</span></div>`)
    .join("");
  card.innerHTML = `
    <h3>${entry.mood === "good" ? "😊 Good day" : "😞 Bad day"} — ${entry.date}</h3>
    <div class="weather-grid">${rows}</div>`;
  card.classList.remove("hidden");
}

function round1(v) {
  return Math.round(Number(v) * 10) / 10;
}

/* ---------- History ---------- */

function renderHistory() {
  const entries = loadEntries().slice().sort((a, b) => b.date.localeCompare(a.date));
  $("entry-count").textContent = entries.length;
  const list = $("history-list");
  if (!entries.length) {
    list.innerHTML = `<p class="muted">No entries yet. Log your first day!</p>`;
    return;
  }
  list.innerHTML = entries.map((e) => `
    <div class="entry">
      <div class="dot ${e.mood}"></div>
      <div class="info">
        <div class="date">${e.date}</div>
        <div class="detail">${round1(e.weather.temperature)}°C · ${round1(e.weather.humidity)}% hum · ${round1(e.weather.pressure)} hPa · ${round1(e.weather.cloudcover)}% clouds</div>
      </div>
      <button class="del" data-date="${e.date}" aria-label="Delete entry">✕</button>
    </div>`).join("");

  list.querySelectorAll(".del").forEach((btn) =>
    btn.addEventListener("click", () => {
      const filtered = loadEntries().filter((e) => e.date !== btn.dataset.date);
      saveEntries(filtered);
      renderHistory();
      renderPredictions();
    })
  );
}

/* ---------- Predictions ---------- */

async function renderPredictions() {
  const entries = loadEntries();
  const info = $("predict-info");
  const list = $("predict-list");
  const insightsEl = $("insights");
  const modelPill = $("model-label");
  insightsEl.classList.add("hidden");
  modelPill.classList.add("hidden");
  list.innerHTML = "";

  if (entries.length < Model.MIN_ENTRIES) {
    info.textContent = `Need at least ${Model.MIN_ENTRIES} entries to train the AI. You have ${entries.length}.`;
    return;
  }

  const model = Model.train(entries);
  if (!model) {
    info.textContent = "Need at least one good AND one bad day logged to find patterns.";
    return;
  }

  info.textContent = "Training on " + entries.length + " entries… fetching forecast…";
  try {
    // Use the entry with a known location; fall back to the most recent
    const withLocation = entries.slice().reverse().find((e) => e.lat && e.lon);
    const ref = withLocation || entries[entries.length - 1];
    const rawForecast = await Weather.getForecast(ref.lat, ref.lon);
    const forecast = Model.addPressureFeaturesForForecast(rawForecast, model.lastPressure);
    info.textContent = `Based on your ${entries.length} entries, likelihood each day will feel good:`;

    modelPill.textContent = Model.modelLabel(model);
    modelPill.classList.remove("hidden");

    list.innerHTML = forecast.map((day) => {
      const p = Model.predict(model, day.features);
      const pct = Math.round(p * 100);
      const color = p >= 0.6 ? "var(--good)" : p <= 0.4 ? "var(--bad)" : "#f39c12";
      const label = new Date(day.date + "T12:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
      return `
        <div class="pred">
          <div class="day">${label}</div>
          <div class="bar-wrap"><div class="bar" style="width:${pct}%;background:${color}"></div></div>
          <div class="score" style="color:${color}">${pct}%</div>
        </div>`;
    }).join("");

    const top = Model.insights(model);
    if (top.length) {
      insightsEl.innerHTML = `<h3>What seems to affect you</h3>` + top.map((f) => {
        const dir = f.weight > 0 ? "higher → better days" : "higher → worse days";
        return `<div class="kv" style="display:flex;justify-content:space-between"><span>${FEATURE_LABELS[f.name]}</span><span class="muted">${dir}</span></div>`;
      }).join("");
      insightsEl.classList.remove("hidden");
    }
  } catch (err) {
    info.textContent = "⚠️ Could not fetch forecast: " + err.message;
  }
}

/* ---------- Tabs & init ---------- */

document.querySelectorAll(".tab").forEach((tab) =>
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    tab.classList.add("active");
    $(tab.dataset.view).classList.add("active");
  })
);

$("btn-good").addEventListener("click", () => logMoodToday("good"));
$("btn-bad").addEventListener("click", () => logMoodToday("bad"));

// Past day logging
$("btn-past").addEventListener("click", () => {
  $("past-picker").classList.toggle("hidden");
  if (!$("past-picker").classList.contains("hidden")) {
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() - 1);
    $("date-input").max = maxDate.toISOString().slice(0, 10);
    // No min date — allow any past date
    $("date-input").value = maxDate.toISOString().slice(0, 10);
    $("time-input").value = "";
    $("btn-fetch-past").disabled = false;
    $("past-preview").classList.add("hidden");
  }
});

$("date-input").addEventListener("change", () => {
  $("btn-fetch-past").disabled = !$("date-input").value;
  $("past-preview").classList.add("hidden");
});

$("time-input").addEventListener("change", () => {
  $("past-preview").classList.add("hidden");
});

$("btn-fetch-past").addEventListener("click", async () => {
  const date = $("date-input").value;
  const time = $("time-input").value;
  if (!date) return;
  setButtonsDisabled(true);
  setStatus("Getting your location…");
  try {
    const { lat, lon } = await Weather.getPosition();
    setStatus("Fetching historical weather…");
    const weather = await Weather.getHistorical(lat, lon, date, time);
    const preview = $("past-preview");
    const rows = Object.keys(FEATURE_LABELS)
      .filter((k) => weather[k] !== undefined && weather[k] !== null)
      .map((k) => `<div class="kv"><span>${FEATURE_LABELS[k]}</span><span>${round1(weather[k])}</span></div>`)
      .join("");
    const label = time ? `${date} at ${time}` : date;
    preview.innerHTML = `
      <h4>Weather for ${label}</h4>
      <div class="weather-grid">${rows}</div>
      <div class="buttons" style="margin-top:16px">
        <button class="mood-btn good" style="flex:1" onclick="savePastEntry('good', '${date}', ${JSON.stringify(weather).replace(/"/g, "&quot;")})">
          <span class="emoji">😊</span>
          <span class="label">Good day</span>
        </button>
        <button class="mood-btn bad" style="flex:1" onclick="savePastEntry('bad', '${date}', ${JSON.stringify(weather).replace(/"/g, "&quot;")})">
          <span class="emoji">😞</span>
          <span class="label">Bad day</span>
        </button>
      </div>
    `;
    preview.classList.remove("hidden");
    setStatus("");
  } catch (err) {
    setStatus("⚠️ " + err.message);
  } finally {
    setButtonsDisabled(false);
  }
});

window.savePastEntry = async (mood, date, weather) => {
  const { lat, lon } = await Weather.getPosition();
  await logMood(mood, date, weather, lat, lon);
};

$('btn-refresh').addEventListener('click', () => renderPredictions());

/* ---------- Sync UI ---------- */

function setSyncStatus(msg, isError = false) {
  const el = $("sync-status");
  el.textContent = msg;
  el.style.color = isError ? "var(--bad)" : "var(--muted)";
}

function setSyncBusy(busy) {
  $("btn-save-user").disabled = busy;
  $("btn-push").disabled = busy;
  $("btn-pull").disabled = busy;
}

function initSyncBar() {
  const savedUser = Sync.getUsername();
  const savedToken = Sync.getToken();
  if (savedUser) {
    $("sync-username").value = savedUser;
    $("sync-username").classList.add("saved");
  }
  if (savedToken) {
    $("sync-token").value = savedToken;
    $("sync-token").classList.add("saved");
  }
  if (savedUser && savedToken) {
    const last = Sync.getLastSync();
    setSyncStatus(last || "Ready to sync.");
  }
}

$("sync-username").addEventListener("input", () => {
  $("sync-username").classList.remove("saved");
  setSyncStatus("");
});
$("sync-token").addEventListener("input", () => {
  $("sync-token").classList.remove("saved");
  setSyncStatus("");
});

$("btn-save-user").addEventListener("click", () => {
  const u = $("sync-username").value.trim();
  const t = $("sync-token").value.trim();
  if (!u) { setSyncStatus("Enter a username.", true); return; }
  if (!t) { setSyncStatus("Enter your GitHub token.", true); return; }
  Sync.saveUsername(u);
  Sync.saveToken(t);
  $("sync-username").classList.add("saved");
  $("sync-token").classList.add("saved");
  // Clear cached gist ID for this username when credentials change
  Sync.saveGistId(u, "");
  setSyncStatus("Saved. Ready to Push ↑ or Pull ↓");
});

$("btn-push").addEventListener("click", async () => {
  const u = $("sync-username").value.trim();
  const t = $("sync-token").value.trim();
  if (!u || !t) { setSyncStatus("Save your username and GitHub token first.", true); return; }
  setSyncBusy(true);
  setSyncStatus("Pushing…");
  try {
    const entries = loadEntries();
    await Sync.push(t, u, entries);
    setSyncStatus("Pushed " + entries.length + " entries ↑ " + new Date().toLocaleTimeString());
  } catch (err) {
    setSyncStatus("⚠️ " + err.message, true);
  } finally {
    setSyncBusy(false);
  }
});

$("btn-pull").addEventListener("click", async () => {
  const u = $("sync-username").value.trim();
  const t = $("sync-token").value.trim();
  if (!u || !t) { setSyncStatus("Save your username and GitHub token first.", true); return; }
  setSyncBusy(true);
  setSyncStatus("Pulling…");
  try {
    const local = loadEntries();
    const merged = await Sync.pull(t, u, local);
    const added = merged.length - local.length;
    saveEntries(merged);
    renderHistory();
    renderPredictions();
    setSyncStatus("Pulled ↓ — " + (added > 0 ? "+" + added + " new entries" : "already up to date") + " (" + new Date().toLocaleTimeString() + ")");
  } catch (err) {
    setSyncStatus("⚠️ " + err.message, true);
  } finally {
    setSyncBusy(false);
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

renderHistory();
renderPredictions();
initSyncBar();

const todayEntry = loadEntries().find((e) => e.date === new Date().toISOString().slice(0, 10));
if (todayEntry) {
  renderTodayCard(todayEntry);
  setStatus("Already logged today — tap a button to update.");
}
