# WeatherWonder - Project Context

## Overview

WeatherWonder is a client-side weather dashboard deployed on GitHub Pages. It's a single-page app with no build step — just static HTML, CSS, and JavaScript served directly.

## Architecture

- **No framework** — vanilla HTML/CSS/JS, no build tools, no bundler, no package.json
- **All logic in `app.js`** — API fetching, rendering, state management, event handlers
- **CDN dependencies** — Chart.js, Leaflet, html2canvas, SunCalc (loaded via `<script>` tags in index.html)
- **State** — global variables (`currentLocation`, `weatherData`, `radarMap`, etc.); favorites persisted in localStorage

## Key Files

| File | Purpose |
|------|---------|
| `index.html` | HTML structure, CDN script/style tags, modal dialogs |
| `app.js` | All application logic (~1600 lines) |
| `styles.css` | Dark theme, responsive layout, component styles (~1000 lines) |
| `manifest.json` | PWA web app manifest (name, icons, theme) |
| `sw.js` | Service worker for offline shell caching |
| `icon.svg` | App icon — overlapping double-W logo (used in manifest and as Apple touch icon) |
| `LICENSE` | MIT License |

## APIs Used (no keys required)

- **Open-Meteo** (`api.open-meteo.com`) — hourly + daily forecast, temperature in Celsius (converted to Fahrenheit client-side)
- **RainViewer** (`api.rainviewer.com`) — radar tile imagery
- **NWS** (`api.weather.gov`) — active weather alerts; requires `User-Agent` header
- **SunCalc** (JS library) — astronomical calculations, moon phases
- **Nominatim** (`nominatim.openstreetmap.org`) — reverse geocoding for GPS

## Important Patterns

### Timezone Handling
Open-Meteo returns times in the location's timezone (via `timezone: 'auto'`), but the time strings lack a UTC offset, so `new Date()` parses them as browser-local. The IANA timezone (e.g. `"Pacific/Auckland"`) is stored in `currentLocation.timezone` from the API response. Key helpers:
- **`getLocationNow()`** — returns a Date whose local components match the location's wall-clock time, for correct comparison with parsed Open-Meteo strings
- **`getLocationTimezone()`** — returns the IANA timezone string
- **`formatTime(date, tz)` / `formatHour(date, tz)`** — pass `tz` for UTC-correct dates (SunCalc, radar, alerts); omit for Open-Meteo times already parsed with correct hour digits

### Date Parsing
Open-Meteo returns daily dates as `"YYYY-MM-DD"` strings. JavaScript's `new Date("YYYY-MM-DD")` parses these as **UTC midnight**, which shifts to the previous day in US timezones. Always append `"T00:00:00"` when parsing daily dates to force local time interpretation. See `renderDailyForecast()`.

### Temperature Conversion
All temps from Open-Meteo arrive in Celsius. Conversion: `Math.round((celsius * 9/5) + 32)` via `formatTempValue()`.

### Radar Map
Leaflet map is initialized once and reused. When changing locations, the map must be fully destroyed (`radarMap.remove()`) and re-created — just calling `setView` causes stale layers.

### NWS Alerts
The app fetches real NWS alerts from `api.weather.gov/alerts/active?point={lat},{lon}`. If the NWS API is unavailable (non-US locations, network issues), it falls back to local weather-code-based detection using Open-Meteo's hourly `weather_code` values.

### PWA / Add to Home Screen
The app is installable as a PWA. `manifest.json` defines the app metadata, `sw.js` caches the shell assets with a network-first strategy. On Chrome/Android the `beforeinstallprompt` event is captured and re-triggered from the footer install button. On iOS, the button opens a step-by-step instruction modal (not a toast) showing how to tap Share > Add to Home Screen. The button hides itself if the app is already running in standalone mode.

### Branding / Footer
The footer includes: install button, "Share This App" button (opens modal with copy-URL + native share), toggle buttons (theme/temp/time), tagline linking to the GitHub repo, data attribution links, and MIT license line. The side menu header shows an inline WW logo mark next to the app name.

## Deployment

Hosted on GitHub Pages from the `main` branch root. Push to `main` and the site updates automatically at `https://cjpaulphd.github.io/weatherwonder/`.

## Testing

No automated tests. Manual testing: open index.html in a browser, verify all sections load, try different locations, check radar loads, verify alerts appear for severe-weather areas.

## Common Tasks

- **Add a new weather data field**: Add the parameter to `fetchWeatherData()`, then render it in the appropriate `render*()` function
- **Change default location**: Update `currentLocation` at the top of `app.js`
- **Add a new section**: Add HTML in `index.html`, CSS in `styles.css`, render function in `app.js`, call it from `loadWeather()`
- **Modify chart**: See `renderChart()` and `gridLinesPlugin` in `app.js`
