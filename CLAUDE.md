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
| `app.js` | All application logic (~1400 lines) |
| `styles.css` | Dark theme, responsive layout, component styles (~900 lines) |

## APIs Used (no keys required)

- **Open-Meteo** (`api.open-meteo.com`) — hourly + daily forecast, temperature in Celsius (converted to Fahrenheit client-side)
- **RainViewer** (`api.rainviewer.com`) — radar tile imagery
- **NWS** (`api.weather.gov`) — active weather alerts; requires `User-Agent` header
- **SunCalc** (JS library) — astronomical calculations, moon phases
- **Nominatim** (`nominatim.openstreetmap.org`) — reverse geocoding for GPS

## Important Patterns

### Date Parsing
Open-Meteo returns daily dates as `"YYYY-MM-DD"` strings. JavaScript's `new Date("YYYY-MM-DD")` parses these as **UTC midnight**, which shifts to the previous day in US timezones. Always append `"T00:00:00"` when parsing daily dates to force local time interpretation. See `renderDailyForecast()`.

### Temperature Conversion
All temps from Open-Meteo arrive in Celsius. Conversion: `Math.round((celsius * 9/5) + 32)` via `formatTempValue()`.

### Radar Map
Leaflet map is initialized once and reused. When changing locations, the map must be fully destroyed (`radarMap.remove()`) and re-created — just calling `setView` causes stale layers.

### NWS Alerts
The app fetches real NWS alerts from `api.weather.gov/alerts/active?point={lat},{lon}`. If the NWS API is unavailable (non-US locations, network issues), it falls back to local weather-code-based detection using Open-Meteo's hourly `weather_code` values.

## Deployment

Hosted on GitHub Pages from the `main` branch root. Push to `main` and the site updates automatically at `https://cjpaulphd.github.io/weatherwonder/`.

## Testing

No automated tests. Manual testing: open index.html in a browser, verify all sections load, try different locations, check radar loads, verify alerts appear for severe-weather areas.

## Common Tasks

- **Add a new weather data field**: Add the parameter to `fetchWeatherData()`, then render it in the appropriate `render*()` function
- **Change default location**: Update `currentLocation` at the top of `app.js`
- **Add a new section**: Add HTML in `index.html`, CSS in `styles.css`, render function in `app.js`, call it from `loadWeather()`
- **Modify chart**: See `renderChart()` and `gridLinesPlugin` in `app.js`
