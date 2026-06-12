# Mood & Weather Tracker

A PWA that logs how you feel (good/bad) along with the current weather at your
location, then uses an on-device AI (logistic regression) to predict which
upcoming days are likely to feel good.

## Data captured per entry
Temperature, humidity, pressure, cloud cover, wind speed, precipitation,
UV index, PM2.5, PM10, ozone, and 6 pollen types (alder, birch, grass,
mugwort, olive, ragweed) — via the free [Open-Meteo](https://open-meteo.com)
weather and air-quality APIs. No API key required.

## Run locally
```
python -m http.server 8000
```
Open http://localhost:8000

## Install on Android
1. Host the folder over **HTTPS** (geolocation requires it; localhost is exempt).
   Easiest options: GitHub Pages, Netlify, or `npx serve` + a tunnel.
2. Open the URL in Chrome on your phone.
3. Menu → **Add to Home screen**. It now behaves like a native app.

## How the AI works
- After **5+ entries** (with at least one good and one bad day), a logistic
  regression model is trained in-browser on your data (z-score normalized
  features, L2 regularization).
- It scores the 7-day forecast: percentage = likelihood the day feels good.
- It also shows which weather features correlate most with your mood.
- All data stays on your device (localStorage). Nothing is uploaded.

## Files
- `index.html` / `style.css` — UI
- `weather.js` — Open-Meteo API layer (current + 7-day forecast)
- `model.js` — logistic regression training/prediction
- `app.js` — app logic, storage, rendering
- `manifest.json` / `sw.js` / `icon.svg` — PWA install + offline support

## Later: native APK
When ready, wrap with [Capacitor](https://capacitorjs.com):
```
npm init -y
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init MoodWeather com.example.moodweather --web-dir .
npx cap add android
npx cap open android   # requires Android Studio to build the APK
```
