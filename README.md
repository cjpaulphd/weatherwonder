# WeatherWonder

A mobile-first weather dashboard that provides comprehensive forecasts, live radar, NWS alerts, and astronomical data — all in a sleek dark-themed interface. No API keys required.

**Live Site:** [weatherwonder.app](https://weatherwonder.app/)

## Features

### Forecast
- **7-Day Daily Forecast** — AM/PM weather icons, high/low temperatures, dominant wind direction + max speed, precipitation probability and amounts
- **48-Hour Hourly Forecast** — Temperature, feels-like/windchill, compass wind direction + speed (e.g. NNW 12), precipitation breakdown
- **Interactive Chart** — Multi-axis line chart showing temperature, precipitation probability, precipitation amounts, and average wind speed, with colored grid lines, per-axis units, and day separators. Each line can be shown/hidden by tapping its legend entry (wind is off by default); the choice persists across day-range views
- **Tide Line** *(coastal locations)* — Optional hourly tide overlay on the forecast chart. Toggled from the footer button or the chart legend (default off); only offered where tide data is available. The same toggle adds/removes high/low tides in the Sun, Moon, and Tide table and tide heights in the hourly cards, and flips the section header's "Tide" wording. Heights follow the °F/°C unit toggle (feet/metres). US locations use accurate NOAA CO-OPS station predictions (nearest station within ~40 km); elsewhere it falls back to the Open-Meteo global marine model
- **Precipitation History** — 24h through 3-month totals with comparison to 10-year historical averages

### Radar & Alerts
- **Live Doppler Radar** — Real-time precipitation radar with 50-mile radius overlay via RainViewer
- **NWS Alerts Integration** — Active watches, warnings, and advisories from the National Weather Service API with direct links to alert details. Falls back to local weather-code detection if the NWS API is unavailable
- **RadarScope Link** — Quick link to open the RadarScope app for advanced radar viewing

### Astronomical Data
A single **Sun, Moon, and Tide** table, with all timed events (twilight, sunrise/sunset, moonrise/moonset, and — when Tides is on — high/low tides) interleaved in chronological order.
- **Twilight Times** — Astronomical, nautical, and civil dawn/dusk
- **Sun** — Sunrise, solar noon, sunset, day length with daily change comparison
- **Moon** — Moonrise, moonset, phase name with emoji, illumination percentage

### User Experience
- **Location Search** — Search any city or use GPS for current location
- **Timezone-Aware** — All times display in the viewed location's local timezone, not the browser's
- **Favorite Locations** — Save locations locally and switch between them from the side menu
- **Refresh Button** — One-tap weather data refresh
- **Feels-Like Temperature** — Displayed in the header when it differs significantly from actual temp
- **Weather Explainers** — Info (ⓘ) buttons on the conditions bar and the Daily Forecast, Radar, Sun/Moon, and Precipitation History headers open short, plain-spoken pop-ups covering the meteorology behind the app: relative humidity vs. dew point and feels-like; how the numerical-weather-prediction models are built and why confidence fades with lead time; how Doppler reflectivity (dBZ) maps to the radar colors; the tiers of twilight (civil/nautical/astronomical), solar noon, and moon phases; and how the rolling precipitation totals compare to the 10-year local average. Each links across to the related topics
- **Last Updated Timestamp** — Shows when data was last fetched
- **Sharing** — Screenshot, link copy, and native device sharing for individual forecast sections
- **Share This App** — Footer button to copy the app URL or share via native device sharing
- **Add to Home Screen** — Installable as a PWA on iOS (step-by-step instruction modal), Android, and desktop browsers
- **Dark/Light Theme** — Toggle between dark and light themes, defaults to system preference
- **Unit Toggles** — Switch between °F/°C and 12/24-hour time formats; coastal locations also get a tide-line toggle
- **Responsive Design** — Scales from mobile to desktop (max 960px)

### Accessibility
- **Keyboard & screen-reader friendly** — Visible focus indicators, modal dialogs that move focus in, trap Tab, close on Escape, and restore focus on close
- **Reduced motion** — Honors the `prefers-reduced-motion` system setting
- **Labeled visuals** — Weather-condition icons, the wind-direction arrow, and the forecast chart expose text alternatives to assistive technology; decorative emoji are hidden from it
- **AA contrast** — Theme text colors meet WCAG AA contrast

## Data Sources

All APIs are free and require no API keys:

| Source | Usage |
|--------|-------|
| [Open-Meteo](https://open-meteo.com/) | Weather forecasts (hourly + daily), temperature, precipitation, wind |
| [NOAA CO-OPS Tides & Currents](https://api.tidesandcurrents.noaa.gov/api/prod/) | High/low + hourly tide predictions for US coastal locations |
| [Open-Meteo Marine](https://open-meteo.com/en/docs/marine-weather-api) | Tide / sea-level heights for coastal locations (fallback outside the US) |
| [RainViewer](https://www.rainviewer.com/api.html) | Real-time Doppler radar imagery |
| [NWS API](https://www.weather.gov/documentation/services-web-api) | Active weather alerts, watches, and warnings (US locations) |
| [SunCalc](https://github.com/mourner/suncalc) | Sun/moon positions, twilight times, moon phases |
| [OpenStreetMap](https://www.openstreetmap.org/) + [CARTO](https://carto.com/) | Dark map tiles via Leaflet |
| [Nominatim](https://nominatim.openstreetmap.org/) | Reverse geocoding for GPS locations |

## Quick Start

Open `index.html` in any modern web browser. No build step or server required.

For local development:

```bash
# Python
python -m http.server 8000

# Node.js
npx serve .

# PHP
php -S localhost:8000
```

Then open `http://localhost:8000` in your browser.

## Deployment (GitHub Pages)

This project is deployed via GitHub Pages from the `main` branch:

1. Push changes to `main`
2. In GitHub repo Settings > Pages, set source to "Deploy from a branch" > `main` > `/ (root)`
3. Site is live at `https://weatherwonder.app/`

## Project Structure

```
weatherwonder/
├── index.html      # HTML structure and CDN script tags
├── app.js          # All application logic, API calls, and rendering
├── styles.css      # Dark/light theme styling and responsive layout
├── manifest.json   # PWA web app manifest
├── sw.js           # Service worker for offline shell caching
├── icon.svg        # Overlapping double-W logo (manifest + Apple touch icon)
├── LICENSE         # MIT License
├── CLAUDE.md       # AI assistant project context
└── README.md       # This file
```

## External Libraries (CDN)

- [Chart.js](https://www.chartjs.org/) — Interactive temperature/precipitation chart
- [Leaflet](https://leafletjs.com/) — Radar map display
- [html2canvas](https://html2canvas.hertzen.com/) — Screenshot functionality
- [SunCalc](https://github.com/mourner/suncalc) — Astronomical calculations

## API Endpoints

- **Weather:** `https://api.open-meteo.com/v1/forecast`
- **Tides (NOAA, US):** `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter` (stations via `.../mdapi/prod/webapi/stations.json`)
- **Tides (Marine fallback):** `https://marine-api.open-meteo.com/v1/marine`
- **Geocoding:** `https://geocoding-api.open-meteo.com/v1/search`
- **Reverse Geocoding:** `https://nominatim.openstreetmap.org/reverse`
- **Radar:** `https://api.rainviewer.com/public/weather-maps.json`
- **NWS Alerts:** `https://api.weather.gov/alerts/active`

## Browser Support

Works in all modern browsers (Chrome, Firefox, Safari, Edge). Optimized for mobile devices with touch interactions and responsive layout.

## Privacy

All favorite locations and preferences are stored locally in your browser via `localStorage`. No personal data is collected or sent to any server. Only anonymous weather API requests are made for the selected location coordinates.

This site uses [GoatCounter](https://www.goatcounter.com/) for privacy-friendly, anonymous usage statistics. GoatCounter does not use cookies, does not collect personal or identifiable data, and is fully GDPR/CCPA compliant without requiring a consent banner. The statistics collected are limited to anonymous page views and aggregate counts (browser type, screen size, country from IP — the IP itself is not stored).

## Related Projects

- **[Hilary's Sprout](https://cjpaulphd.github.io/hilary-sprout/)** — A sister app providing detailed precipitation history and analysis. Linked from WeatherWonder's Precipitation History section.

## License

This project is licensed under the [MIT License](LICENSE).

## Name Note

An unrelated project called WeatherWonder was independently created in 2017 as a class project at SUNY New Paltz (weatherwonder.andrewhaaland.com). This project was developed separately and is not affiliated with or derived from that work. Both projects are non-commercial and were built in academic/personal contexts.

## Author

**WeatherWonder by cjpaulphd**
