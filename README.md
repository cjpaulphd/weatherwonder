# WeatherWonder

A web application that displays weather forecasts with a focus on precipitation probability and amounts.

## Features

- **Daily Forecast**: 7-day forecast with AM/PM weather icons, high/low temperatures, and precipitation probability
- **Hourly Forecast**: Detailed 48-hour breakdown showing temperature, wind, windchill, and precipitation
- **Interactive Chart**: Multi-axis line chart showing temperature, precipitation probability, and precipitation amount trends with colored grid lines
- **Doppler Radar**: Live radar imagery with 50-mile radius overlay using RainViewer API
- **Location Search**: Search for any location or use your current GPS position
- **Favorite Locations**: Save and quickly switch between favorite locations (stored locally)
- **Weather Alerts**: Automatic detection and display of winter weather and thunderstorm conditions
- **Sharing**: Share screenshots, copy links, or use native device sharing
- **Dark Theme**: Mobile-friendly dark UI
- **Responsive Design**: Scales from mobile to desktop (up to 960px)

## Data Sources

This app uses free APIs with no API keys required:

- **Weather Data**: [Open-Meteo API](https://open-meteo.com/) - accurate worldwide forecasts
- **Radar Imagery**: [RainViewer API](https://www.rainviewer.com/api.html) - real-time precipitation radar
- **Maps**: [OpenStreetMap](https://www.openstreetmap.org/) via Leaflet with CartoDB dark tiles

## Usage

1. Open `index.html` in a web browser
2. The app will load weather data for Durham, NC by default
3. Click on the location name to search for a different location
4. Tap the star icon to save a location to favorites
5. Use the hamburger menu to access favorite locations
6. Scroll horizontally through hourly forecasts
7. Touch/hover the chart to see detailed data at any point
8. Use share buttons to save screenshots or share links

## Running Locally

Simply open `index.html` in any modern web browser. No build step or server required.

For local development with live reload, you can use any static file server:

```bash
# Using Python
python -m http.server 8000

# Using Node.js (npx)
npx serve .

# Using PHP
php -S localhost:8000
```

## Files

- `index.html` - Main HTML structure
- `styles.css` - Dark theme styling
- `app.js` - Weather data fetching, favorites management, and UI rendering

## External Libraries

- [Chart.js](https://www.chartjs.org/) - Interactive charts
- [Leaflet](https://leafletjs.com/) - Radar map display
- [html2canvas](https://html2canvas.hertzen.com/) - Screenshot functionality

## API Endpoints Used

- **Weather**: `https://api.open-meteo.com/v1/forecast`
- **Geocoding**: `https://geocoding-api.open-meteo.com/v1/search`
- **Reverse Geocoding**: `https://nominatim.openstreetmap.org/reverse`
- **Radar**: `https://api.rainviewer.com/public/weather-maps.json`

## Browser Support

Works in all modern browsers (Chrome, Firefox, Safari, Edge). Optimized for mobile devices.

## Privacy

All favorite locations are stored locally in your browser using localStorage. No data is sent to any server except for weather API requests.
