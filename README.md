# Weather Precipitation Forecast

A web application that displays weather forecasts with a focus on precipitation probability and amounts, inspired by the Weather Underground mobile app.

## Features

- **Daily Forecast**: 7-day forecast with high/low temperatures, weather icons, and precipitation probability
- **Hourly Forecast**: Detailed hourly breakdown showing temperature, wind, and precipitation
- **Interactive Chart**: Dual-axis line chart showing temperature and precipitation probability trends
- **Location Search**: Search for any location or use your current GPS position
- **Weather Alerts**: Automatic detection and display of winter weather and thunderstorm conditions
- **Dark Theme**: Mobile-friendly dark UI similar to Weather Underground

## Data Source

This app uses the [Open-Meteo API](https://open-meteo.com/), which is:
- Free for non-commercial use
- No API key required
- Provides accurate weather data worldwide

## Usage

1. Open `index.html` in a web browser
2. The app will load weather data for Durham, NC by default
3. Click on the location name to search for a different location
4. Scroll horizontally through daily and hourly forecasts
5. Hover over the chart to see detailed temperature and precipitation data

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
- `app.js` - Weather data fetching and UI rendering

## API Endpoints Used

- **Weather**: `https://api.open-meteo.com/v1/forecast`
- **Geocoding**: `https://geocoding-api.open-meteo.com/v1/search`
- **Reverse Geocoding**: `https://nominatim.openstreetmap.org/reverse`

## Browser Support

Works in all modern browsers (Chrome, Firefox, Safari, Edge).
