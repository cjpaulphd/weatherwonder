# WeatherWonder

A mobile-first weather dashboard that provides comprehensive forecasts, live radar, NWS alerts, and astronomical data — all in a sleek dark-themed interface. No API keys required.

**Live Site:** [cjpaulphd.github.io/weatherwonder](https://cjpaulphd.github.io/weatherwonder/)

## Features

### Forecast
- **7-Day Daily Forecast** — AM/PM weather icons, high/low temperatures, precipitation probability and amounts
- **48-Hour Hourly Forecast** — Temperature, feels-like/windchill, wind speed + direction, precipitation breakdown
- **Interactive Chart** — Multi-axis line chart showing temperature, precipitation probability, and precipitation amounts with colored grid lines and day separators

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
- **Favorite Locations** — Save locations locally and switch between them from the side menu
- **Refresh Button** — One-tap weather data refresh
- **Feels-Like Temperature** — Displayed in the header when it differs significantly from actual temp
- **Last Updated Timestamp** — Shows when data was last fetched
- **Sharing** — Screenshot, link copy, and native device sharing
- **Dark Theme** — Mobile-optimized dark UI
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
├── styles.css      # Dark theme styling and responsive layout
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

All favorite locations and preferences are stored locally in your browser via `localStorage`. No personal data is sent to any server. Only anonymous weather API requests are made for the selected location coordinates.

## Author

**WeatherWonder by cjpaulphd**
