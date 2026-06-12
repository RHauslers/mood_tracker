/* Weather data layer — Open-Meteo (free, no API key) */

const Weather = (() => {
  const FEATURES = [
    "temperature", "humidity", "pressure", "cloudcover", "windspeed",
    "precipitation", "uv_index", "pm2_5", "pm10", "ozone",
    "alder_pollen", "birch_pollen", "grass_pollen", "mugwort_pollen",
    "olive_pollen", "ragweed_pollen"
  ];

  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("Geolocation not supported"));
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        (err) => reject(new Error("Location denied: " + err.message)),
        { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 }
      );
    });
  }

  async function fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("API error " + res.status);
    return res.json();
  }

  // Current conditions for logging an entry
  async function getCurrent(lat, lon) {
    const wxUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,surface_pressure,cloud_cover,wind_speed_10m,precipitation,uv_index` +
      `&timezone=auto`;
    const aqUrl =
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
      `&current=pm2_5,pm10,ozone,alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen` +
      `&timezone=auto`;

    const [wx, aq] = await Promise.all([fetchJSON(wxUrl), fetchJSON(aqUrl)]);
    const c = wx.current, a = aq.current;

    return {
      temperature: c.temperature_2m,
      humidity: c.relative_humidity_2m,
      pressure: c.surface_pressure,
      cloudcover: c.cloud_cover,
      windspeed: c.wind_speed_10m,
      precipitation: c.precipitation,
      uv_index: c.uv_index,
      pm2_5: a.pm2_5 ?? 0,
      pm10: a.pm10 ?? 0,
      ozone: a.ozone ?? 0,
      alder_pollen: a.alder_pollen ?? 0,
      birch_pollen: a.birch_pollen ?? 0,
      grass_pollen: a.grass_pollen ?? 0,
      mugwort_pollen: a.mugwort_pollen ?? 0,
      olive_pollen: a.olive_pollen ?? 0,
      ragweed_pollen: a.ragweed_pollen ?? 0
    };
  }

  // 7-day forecast, one feature vector per day (daytime averages)
  async function getForecast(lat, lon) {
    const wxUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&daily=temperature_2m_mean,relative_humidity_2m_mean,surface_pressure_mean,cloud_cover_mean,wind_speed_10m_mean,precipitation_sum,uv_index_max` +
      `&forecast_days=7&timezone=auto`;
    const aqUrl =
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
      `&hourly=pm2_5,pm10,ozone,alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen` +
      `&forecast_days=7&timezone=auto`;

    const [wx, aq] = await Promise.all([fetchJSON(wxUrl), fetchJSON(aqUrl)]);

    // Average hourly air-quality values per day
    const aqDaily = {};
    const hours = aq.hourly.time;
    const keys = ["pm2_5", "pm10", "ozone", "alder_pollen", "birch_pollen",
      "grass_pollen", "mugwort_pollen", "olive_pollen", "ragweed_pollen"];
    hours.forEach((t, i) => {
      const day = t.slice(0, 10);
      if (!aqDaily[day]) aqDaily[day] = { n: 0 };
      aqDaily[day].n++;
      for (const k of keys) {
        aqDaily[day][k] = (aqDaily[day][k] || 0) + (aq.hourly[k][i] ?? 0);
      }
    });

    return wx.daily.time.map((date, i) => {
      const aqd = aqDaily[date] || { n: 1 };
      const features = {
        temperature: wx.daily.temperature_2m_mean[i],
        humidity: wx.daily.relative_humidity_2m_mean[i],
        pressure: wx.daily.surface_pressure_mean[i],
        cloudcover: wx.daily.cloud_cover_mean[i],
        windspeed: wx.daily.wind_speed_10m_mean[i],
        precipitation: wx.daily.precipitation_sum[i],
        uv_index: wx.daily.uv_index_max[i]
      };
      for (const k of keys) features[k] = (aqd[k] || 0) / aqd.n;
      return { date, features };
    });
  }

  return { FEATURES, getPosition, getCurrent, getForecast };
})();
