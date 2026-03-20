# WeatherWonder

A mobile-first weather dashboard that provides comprehensive forecasts, live radar, NWS alerts, and astronomical data — all in a sleek dark-themed interface. No API keys required.

**Live Site:** [cjpaulphd.github.io/weatherwonder](https://cjpaulphd.github.io/weatherwonder/)

## Features

### Forecast
- **7-Day Daily Forecast** — AM/PM weather icons, high/low temperatures, dominant wind direction + max speed, precipitation probability and amounts
- **48-Hour Hourly Forecast** — Temperature, feels-like/windchill, compass wind direction + speed (e.g. NNW 12), precipitation breakdown
- **Interactive Chart** — Multi-axis line chart showing temperature, precipitation probability, and precipitation amounts with colored grid lines and day separators
- **Precipitation History** — 24h through 3-month totals with comparison to 10-year historical averages

### Radar & Alerts
- **Live Doppler Radar** — Real-time precipitation radar with 50-mile radius overlay via RainViewer
- **NWS Alerts Integration** — Active watches, warnings, and advisories from the National Weather Service API with direct links to alert details. Falls back to local weather-code detection if the NWS API is unavailable
- **RadarScope Link** — Quick link to open the RadarScope app for advanced radar viewing

### Astronomical Data
- **Twilight Times** — Astronomical, nautical, and civil dawn/dusk
- **Sun** — Sunrise, solar noon, sunset, day length with daily change comparison
- **Moon** — Moonrise, moonset, phase name with emoji, illumination percentage

### User Experience
- **Location Search** — Search any city or use GPS for current location
- **Timezone-Aware** — All times display in the viewed location's local timezone, not the browser's
- **Favorite Locations** — Save locations locally and switch between them from the side menu
- **Refresh Button** — One-tap weather data refresh
- **Feels-Like Temperature** — Displayed in the header when it differs significantly from actual temp
- **Last Updated Timestamp** — Shows when data was last fetched
- **Sharing** — Screenshot, link copy, and native device sharing for individual forecast sections
- **Share This App** — Footer button to copy the app URL or share via native device sharing
- **Add to Home Screen** — Installable as a PWA on iOS (step-by-step instruction modal), Android, and desktop browsers
- **Dark/Light Theme** — Toggle between dark and light themes, defaults to system preference
- **Unit Toggles** — Switch between °F/°C and 12/24-hour time formats
- **Responsive Design** — Scales from mobile to desktop (max 960px)

## Data Sources

All APIs are free and require no API keys:

| Source | Usage |
|--------|-------|
| [Open-Meteo](https://open-meteo.com/) | Weather forecasts (hourly + daily), temperature, precipitation, wind |
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
3. Site is live at `https://<username>.github.io/weatherwonder/`

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
- **Geocoding:** `https://geocoding-api.open-meteo.com/v1/search`
- **Reverse Geocoding:** `https://nominatim.openstreetmap.org/reverse`
- **Radar:** `https://api.rainviewer.com/public/weather-maps.json`
- **NWS Alerts:** `https://api.weather.gov/alerts/active`

## Browser Support

Works in all modern browsers (Chrome, Firefox, Safari, Edge). Optimized for mobile devices with touch interactions and responsive layout.

## Privacy

All favorite locations and preferences are stored locally in your browser via `localStorage`. No personal data is collected or sent to any server. Only anonymous weather API requests are made for the selected location coordinates.

This site uses [GoatCounter](https://www.goatcounter.com/) for privacy-friendly, anonymous usage statistics. GoatCounter does not use cookies, does not collect personal or identifiable data, and is fully GDPR/CCPA compliant without requiring a consent banner. The statistics collected are limited to anonymous page views and aggregate counts (browser type, screen size, country from IP — the IP itself is not stored).

## License

This project is licensed under the [MIT License](LICENSE).

## Name Note

An unrelated project called WeatherWonder was independently created in 2017 as a class project at SUNY New Paltz (weatherwonder.andrewhaaland.com). This project was developed separately and is not affiliated with or derived from that work. Both projects are non-commercial and were built in academic/personal contexts.

## Author

**WeatherWonder by cjpaulphd**
