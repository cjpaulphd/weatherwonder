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
- **NOAA CO-OPS Tides** (`api.tidesandcurrents.noaa.gov`) — US tide predictions (hi/lo + hourly) from the nearest station; preferred tide source
- **Open-Meteo Marine** (`marine-api.open-meteo.com`) — global tide/sea-level model; fallback when no NOAA station is nearby
- **SunCalc** (JS library) — astronomical calculations, moon phases
- **Nominatim** (`nominatim.openstreetmap.org`) — reverse geocoding for GPS

## Important Patterns

### Timezone Handling
Open-Meteo returns times in the location's timezone (via `timezone: 'auto'`), but the time strings lack a UTC offset, so `new Date()` parses them as browser-local. The IANA timezone (e.g. `"Pacific/Auckland"`) is stored in `currentLocation.timezone` from the API response. Key helpers:
- **`getLocationNow()`** — returns a Date whose local components match the location's wall-clock time, for correct comparison with parsed Open-Meteo strings
- **`getLocationTimezone()`** — returns the IANA timezone string
- **`formatTime(date, tz)` / `formatHour(date, tz)`** — pass `tz` for UTC-correct dates (SunCalc, radar, alerts); omit for Open-Meteo times already parsed with correct hour digits

### Clock Changes (DST)
`findClockChanges(tz, startMs, endMs)` detects DST transitions from the browser's IANA data via `Intl` (any geography, incl. 30-min shifts; none for non-DST zones). Wall-clock times are returned as **wall Dates** (wall clock in UTC components) — never build a browser-local Date for them, because e.g. 2:00 AM on a spring-forward night doesn't exist in a browser that observes the same change. Use `formatWallTime()` / `wallDateKey()`. Consumers: a heads-up card atop the Sun & Moon section (today/tonight/tomorrow, with tomorrow's sun/moon times and the wall-clock shift), an amber marker on the chart, a `⏰ ±1h` flag on the hourly card, and `⏰` on the daily card.

### Date Parsing
Open-Meteo returns daily dates as `"YYYY-MM-DD"` strings. JavaScript's `new Date("YYYY-MM-DD")` parses these as **UTC midnight**, which shifts to the previous day in US timezones. Always append `"T00:00:00"` when parsing daily dates to force local time interpretation. See `renderDailyForecast()`.

### Temperature Conversion
All temps from Open-Meteo arrive in Celsius. Conversion: `Math.round((celsius * 9/5) + 32)` via `formatTempValue()`.

### Display Units (precipitation)
Precipitation amounts arrive in mm. Cards use `formatPrecip()`; the forecast chart uses `getChartPrecipConfig()`, which returns the conversion factor, gridline step, and label suffix for the active unit mode (inches in °F, mm in °C, microns in the Kelvin easter-egg mode). Keep the chart and cards consistent — the chart must not hard-code inches.

### Barometric Pressure
Uses Open-Meteo `pressure_msl` (sea-level, hPa) — never `surface_pressure`, which varies with elevation. `formatPressure()` / `formatPressureDelta()` display inHg in °F mode, hPa in °C, Pa in Kelvin mode. `getPressureTrend(series, idx)` computes the 3-hour tendency from hourly values (steady < 1 hPa, rapid ≥ 3.5 hPa; constants `PRESSURE_STEADY_HPA` / `PRESSURE_RAPID_HPA`); before 03:00 local there aren't 3 past hours in the series, so it falls back to the next-3-hour change and reports `basis: 'next'`. The chart's `y-pressure` axis keeps a minimum 20 hPa span so small wobbles don't look dramatic.

### Conditions Bar Layout
`renderConditionsBar()` emits two `.cond-group`s (AQI/RH/DP, then wind/pressure/info). `updateConditionsBarWrap()` adds `.wrapped` when they don't fit on one line, stacking them as two centered rows and hiding the separator between them. It re-runs on resize.

### Chart Legend
A three-column grid filled row by row (3×3; Tide adds a centered 4th row at coastal locations). The order of `items` in `renderChart()` defines the rows.

### Security: Escaping Untrusted HTML
Rendering is done with template literals assigned to `innerHTML`; there is no framework auto-escaping. Any value that comes from an API (NWS alert text, geocoding labels) or from the user (favorite names entered via the rename prompt) **must** be wrapped in `escapeHtml()` before interpolation. `escapeHtml()` lives near the top of `app.js`. For text that intentionally contains markup (e.g. alert `instruction` newlines → `<br>`), escape first, then apply the substitution.

### Avoiding Stale Renders
`loadWeather()` increments a module-level `currentLoadId` and captures it per call. The non-blocking secondary fetches (AQI, tides, precipitation history) compare their captured id against `currentLoadId` before mutating state or the DOM, so responses for a location the user has already navigated away from are discarded. Reuse this guard for any new async render path.

### Accessibility
- **Modals** (`.modal`) use `role="dialog"` / `aria-modal`. `initializeModalFocusManagement()` observes the `hidden` class to move focus into a dialog on open, trap Tab within it, and restore focus to the opener on close. The shared Escape-to-close handler is registered in `initializeModal()`. The hidden side menu is marked `inert`.
- **Motion & focus**: a global `:focus-visible` outline and a `@media (prefers-reduced-motion: reduce)` reset live in `styles.css`; new animations are covered automatically.
- **Icons**: weather-condition icons, the compact wind arrow, and the forecast `<canvas>` carry `role="img"` + an `aria-label` (from `getWeatherDesc()` / `getWindDirection()`, or the summary set in `renderChart()`). Purely decorative emoji get `aria-hidden="true"`. Use the `.sr-only` class for screen-reader-only text.

### Radar Map
Leaflet map is initialized once and reused. When changing locations, the map must be fully destroyed (`radarMap.remove()`) and re-created — just calling `setView` causes stale layers.

### NWS Alerts
The app fetches real NWS alerts from `api.weather.gov/alerts/active?point={lat},{lon}`. If the NWS API is unavailable (non-US locations, network issues), it falls back to local weather-code-based detection using Open-Meteo's hourly `weather_code` values.

### PWA / Add to Home Screen
The app is installable as a PWA. `manifest.json` defines the app metadata, `sw.js` caches the shell assets with a network-first strategy. Only same-origin shell assets are cached — the fetch handler matches requests against resolved `SHELL_URLS`, never third-party API/tile responses. Bump `CACHE_NAME` (e.g. `weatherwonder-v10`) whenever shell assets change so old caches are purged on activate. On Chrome/Android the `beforeinstallprompt` event is captured and re-triggered from the footer install button. On iOS, the button opens a step-by-step instruction modal (not a toast) showing how to tap Share > Add to Home Screen. The button hides itself if the app is already running in standalone mode.

### Branding / Footer
The footer includes: install button, "Share This App" button (opens modal with copy-URL + native share), toggle buttons (theme/temp/time), tagline linking to the GitHub repo, data attribution links, and MIT license line. The side menu header shows an inline WW logo mark next to the app name.

## Deployment

Hosted on GitHub Pages from the `main` branch root with a custom domain. Push to `main` and the site updates automatically at `https://weatherwonder.app/`.

## Testing

No automated tests. Manual testing: open index.html in a browser, verify all sections load, try different locations, check radar loads, verify alerts appear for severe-weather areas.

## Common Tasks

- **Add a new weather data field**: Add the parameter to `fetchWeatherData()`, then render it in the appropriate `render*()` function
- **Change default location**: Update `currentLocation` at the top of `app.js`
- **Add a new section**: Add HTML in `index.html`, CSS in `styles.css`, render function in `app.js`, call it from `loadWeather()`
- **Modify chart**: See `renderChart()` and `gridLinesPlugin` in `app.js`
