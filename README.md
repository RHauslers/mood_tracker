# Mood & Weather Tracker

Does weather affect how you feel? This app finds out.

Every day, tap one of two buttons: 😊 **Good day** or 😞 **Bad day**.
The app records the weather at your location (temperature, humidity, air
pressure, clouds, wind, air quality, pollen and more). After a handful of
entries, a built-in AI learns your personal pattern and predicts which of
the next 7 days will probably feel good — and which won't.

## 📱 Get it on your phone (takes 1 minute)

1. On your Android phone, open this link in **Chrome**:

   ### 👉 https://rhauslers.github.io/mood_tracker/

2. When the phone asks for **location permission**, tap **Allow**
   (the app needs it to look up your local weather).
3. Tap the **⋮** menu (top-right corner of Chrome) → tap
   **"Add to Home screen"** → tap **Add**.
4. Done! There is now an app icon on your home screen.
   Open it like any other app — no browser bar, full screen.

*iPhone: open the same link in Safari → tap the Share button →
"Add to Home Screen".*

## 🖥️ Use it on a computer

Just open https://rhauslers.github.io/mood_tracker/ in any browser and
bookmark it. (Note: phone and computer each keep their own separate diary —
entries don't sync between devices.)

## How to use it

- **Once a day**, open the app and tap the green or red button. That's it.
- The **History** tab shows everything you've logged.
- The **Predict** tab wakes up after **5 entries** (you need at least one
  good AND one bad day). It shows a percentage for each of the next 7 days:
  how likely that day is to feel good for *you*. It also tells you which
  weather factors seem to affect you most.
- The more days you log, the smarter the predictions get.

## Your privacy

Everything stays on **your own device**. There is no account, no sign-up,
and nothing is uploaded anywhere. Nobody — not even the app's author — can
see your entries. Weather data comes from the free
[Open-Meteo](https://open-meteo.com) service.

⚠️ One thing to know: if you clear your browser's data, your entries are
deleted too.

---

## For developers

### Data captured per entry
Temperature, humidity, pressure, cloud cover, wind speed, precipitation,
UV index, PM2.5, PM10, ozone, and 6 pollen types (alder, birch, grass,
mugwort, olive, ragweed) — via the free Open-Meteo weather and air-quality
APIs. No API key required.

### Run locally
```
python -m http.server 8000
```
Open http://localhost:8000

### How the AI works
- After **5+ entries** (with at least one good and one bad day), a logistic
  regression model is trained in-browser on your data (z-score normalized
  features, L2 regularization).
- It scores the 7-day forecast: percentage = likelihood the day feels good.
- It also shows which weather features correlate most with your mood.
- All data stays on your device (localStorage). Nothing is uploaded.

### Files
- `index.html` / `style.css` — UI
- `weather.js` — Open-Meteo API layer (current + 7-day forecast)
- `model.js` — logistic regression training/prediction
- `app.js` — app logic, storage, rendering
- `manifest.json` / `sw.js` / `icon.svg` — PWA install + offline support

### Later: native APK
When ready, wrap with [Capacitor](https://capacitorjs.com):
```
npm init -y
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init MoodWeather com.example.moodweather --web-dir .
npx cap add android
npx cap open android   # requires Android Studio to build the APK
```
