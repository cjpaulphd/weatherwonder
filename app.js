// Weather App - Precipitation Forecast Visualization
// Uses Open-Meteo API (free, no API key required)

const API_BASE = 'https://api.open-meteo.com/v1/forecast';
const GEOCODING_API = 'https://geocoding-api.open-meteo.com/v1/search';
const RAINVIEWER_API = 'https://api.rainviewer.com/public/weather-maps.json';

// Default location (Durham, NC) - overridden by last used location if available
const DEFAULT_LOCATION = {
    name: 'Durham, NC',
    latitude: 35.994,
    longitude: -78.8986
};

const LAST_LOCATION_KEY = 'weatherwonder_last_location';

function getLastLocation() {
    try {
        const stored = localStorage.getItem(LAST_LOCATION_KEY);
        if (stored) {
            const loc = JSON.parse(stored);
            if (loc.name && loc.latitude && loc.longitude) return loc;
        }
    } catch (e) {}
    return null;
}

function saveLastLocation(location) {
    try {
        localStorage.setItem(LAST_LOCATION_KEY, JSON.stringify({
            name: location.name,
            latitude: location.latitude,
            longitude: location.longitude
        }));
    } catch (e) {
        console.error('Could not save last location:', e);
    }
}

let currentLocation = getLastLocation() || DEFAULT_LOCATION;

let forecastChart = null;
let weatherData = null;
let currentShareSection = null;
let radarMap = null;
let radarLayer = null;

// Favorites management with localStorage
const FAVORITES_KEY = 'weatherwonder_favorites';

function getFavorites() {
    try {
        const stored = localStorage.getItem(FAVORITES_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        return [];
    }
}

function saveFavorites(favorites) {
    try {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    } catch (e) {
        console.error('Could not save favorites:', e);
    }
}

function addFavorite(location) {
    const favorites = getFavorites();
    // Check if already exists
    const exists = favorites.some(f =>
        f.latitude === location.latitude && f.longitude === location.longitude
    );
    if (!exists) {
        favorites.push({
            name: location.name,
            latitude: location.latitude,
            longitude: location.longitude
        });
        saveFavorites(favorites);
    }
    updateFavoriteButton();
    renderFavoritesList();
}

function removeFavorite(latitude, longitude) {
    let favorites = getFavorites();
    favorites = favorites.filter(f =>
        !(f.latitude === latitude && f.longitude === longitude)
    );
    saveFavorites(favorites);
    updateFavoriteButton();
    renderFavoritesList();
}

function isFavorite(location) {
    const favorites = getFavorites();
    return favorites.some(f =>
        f.latitude === location.latitude && f.longitude === location.longitude
    );
}

function updateFavoriteButton() {
    const btn = document.getElementById('favorite-btn');
    if (btn) {
        if (isFavorite(currentLocation)) {
            btn.textContent = '★';
            btn.classList.add('active');
        } else {
            btn.textContent = '☆';
            btn.classList.remove('active');
        }
    }
}

function renderFavoritesList() {
    const list = document.getElementById('favorites-list');
    if (!list) return;

    const favorites = getFavorites();

    if (favorites.length === 0) {
        list.innerHTML = '<p class="no-favorites">No favorites yet. Tap the star next to a location to add it.</p>';
        return;
    }

    list.innerHTML = favorites.map(fav => `
        <div class="favorite-item" data-lat="${fav.latitude}" data-lon="${fav.longitude}" data-name="${fav.name}">
            <span class="favorite-item-name">${fav.name}</span>
            <button class="favorite-item-remove" data-lat="${fav.latitude}" data-lon="${fav.longitude}">&times;</button>
        </div>
    `).join('');

    // Add click handlers
    list.querySelectorAll('.favorite-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.classList.contains('favorite-item-remove')) return;

            const lat = parseFloat(item.dataset.lat);
            const lon = parseFloat(item.dataset.lon);
            const name = item.dataset.name;

            currentLocation = { name, latitude: lat, longitude: lon };
            updateLocationDisplay();
            closeMenu();

            // Reset radar for new location
            if (radarMap) {
                radarMap.remove();
                radarMap = null;
                radarLayer = null;
            }

            loadWeather();
        });
    });

    list.querySelectorAll('.favorite-item-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const lat = parseFloat(btn.dataset.lat);
            const lon = parseFloat(btn.dataset.lon);
            removeFavorite(lat, lon);
        });
    });
}

// Temperature unit management with localStorage
const TEMP_UNIT_KEY = 'weatherwonder_temp_unit';

function getTempUnit() {
    try {
        return localStorage.getItem(TEMP_UNIT_KEY) || 'F';
    } catch (e) {
        return 'F';
    }
}

function saveTempUnit(unit) {
    try {
        localStorage.setItem(TEMP_UNIT_KEY, unit);
    } catch (e) {
        console.error('Could not save temp unit:', e);
    }
}

function updateTempToggleUI() {
    const label = document.getElementById('temp-toggle-label');
    if (label) {
        const unit = getTempUnit();
        // Show the unit you'd switch TO
        label.textContent = unit === 'F' ? '°C' : '°F';
    }
}

function initializeTempToggle() {
    updateTempToggleUI();
    const toggle = document.getElementById('temp-toggle');
    if (toggle) {
        toggle.addEventListener('click', () => {
            const current = getTempUnit();
            const next = current === 'F' ? 'C' : 'F';
            saveTempUnit(next);
            updateTempToggleUI();
            // Re-render weather data with new unit
            if (weatherData) {
                renderDailyForecast(weatherData);
                renderHourlyForecast(weatherData);
                renderChart(weatherData);
                // Re-update location display with current temp
                reloadLocationTemp();
            }
        });
    }
}

// Time format management with localStorage
const TIME_FORMAT_KEY = 'weatherwonder_time_format';

function getTimeFormat() {
    try {
        return localStorage.getItem(TIME_FORMAT_KEY) || '12';
    } catch (e) {
        return '12';
    }
}

function saveTimeFormat(format) {
    try {
        localStorage.setItem(TIME_FORMAT_KEY, format);
    } catch (e) {
        console.error('Could not save time format:', e);
    }
}

function updateTimeToggleUI() {
    const label = document.getElementById('time-toggle-label');
    if (label) {
        const format = getTimeFormat();
        // Show the format you'd switch TO
        label.textContent = format === '12' ? '24hr' : '12hr';
    }
}

function initializeTimeToggle() {
    updateTimeToggleUI();
    const toggle = document.getElementById('time-toggle');
    if (toggle) {
        toggle.addEventListener('click', () => {
            const current = getTimeFormat();
            const next = current === '12' ? '24' : '12';
            saveTimeFormat(next);
            updateTimeToggleUI();
            // Re-render weather data with new time format
            if (weatherData) {
                renderHourlyForecast(weatherData);
                renderChart(weatherData);
                renderAstroData();
                // Update last-updated timestamp
                const lastUpdated = document.getElementById('last-updated');
                if (lastUpdated && lastUpdated.dataset.timestamp) {
                    const ts = new Date(lastUpdated.dataset.timestamp);
                    lastUpdated.textContent = `Updated ${formatTime(ts)}`;
                }
            }
        });
    }
}

// Helper to re-update location display temperature after unit change
function reloadLocationTemp() {
    if (!weatherData) return;
    const now = new Date();
    let currentTemp = null;
    let feelsLike = null;
    for (let i = 0; i < weatherData.hourly.time.length; i++) {
        const hourDate = new Date(weatherData.hourly.time[i]);
        if (hourDate >= now) {
            const idx = i > 0 ? i - 1 : 0;
            currentTemp = formatTempValue(weatherData.hourly.temperature_2m[idx]);
            feelsLike = formatTempValue(weatherData.hourly.apparent_temperature[idx]);
            break;
        }
    }
    updateLocationDisplay(currentTemp, feelsLike);
}

// Format a time according to user's 12/24 preference
function formatTime(date) {
    if (getTimeFormat() === '24') {
        return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// Format just the hour according to user's 12/24 preference
function formatHour(date) {
    if (getTimeFormat() === '24') {
        return date.getHours().toString().padStart(2, '0') + ':00';
    }
    const h = date.getHours();
    const suffix = h >= 12 ? 'p' : 'a';
    const hour12 = h % 12 || 12;
    return `${hour12}${suffix}`;
}

// Theme management with localStorage
const THEME_KEY = 'weatherwonder_theme';

function getStoredTheme() {
    try {
        return localStorage.getItem(THEME_KEY);
    } catch (e) {
        return null;
    }
}

function saveTheme(theme) {
    try {
        localStorage.setItem(THEME_KEY, theme);
    } catch (e) {
        console.error('Could not save theme:', e);
    }
}

function getEffectiveTheme() {
    const stored = getStoredTheme();
    if (stored) return stored;
    // Default to system preference, falling back to dark
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
        return 'light';
    }
    return 'dark';
}

function applyTheme(theme) {
    if (theme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }
    updateThemeToggleUI(theme);
    updateThemeColor(theme);
}

function updateThemeToggleUI(theme) {
    const icon = document.getElementById('theme-toggle-icon');
    const label = document.getElementById('theme-toggle-label');
    if (icon && label) {
        if (theme === 'light') {
            // In light mode, show option to switch to dark
            icon.textContent = '🌙';
            label.textContent = 'Dark';
        } else {
            // In dark mode, show option to switch to light
            icon.textContent = '☀️';
            label.textContent = 'Light';
        }
    }
}

function updateThemeColor(theme) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
        meta.setAttribute('content', theme === 'light' ? '#f5f5f5' : '#1a1a1a');
    }
}

function initializeTheme() {
    const theme = getEffectiveTheme();
    applyTheme(theme);

    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
        toggle.addEventListener('click', () => {
            const current = getEffectiveTheme();
            const next = current === 'dark' ? 'light' : 'dark';
            saveTheme(next);
            applyTheme(next);
            // Re-render radar with appropriate tile layer
            if (radarMap) {
                radarMap.remove();
                radarMap = null;
                radarLayer = null;
                initializeRadar();
            }
        });
    }

    // Listen for system theme changes (only if no stored preference)
    if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
            if (!getStoredTheme()) {
                applyTheme(getEffectiveTheme());
            }
        });
    }
}

function openMenu() {
    document.getElementById('menu-panel').classList.remove('hidden');
    document.getElementById('menu-overlay').classList.remove('hidden');
}

function closeMenu() {
    document.getElementById('menu-panel').classList.add('hidden');
    document.getElementById('menu-overlay').classList.add('hidden');
}

// Weather code mappings to icons and descriptions
const weatherCodes = {
    0: { icon: '☀️', desc: 'Clear sky' },
    1: { icon: '🌤️', desc: 'Mainly clear' },
    2: { icon: '⛅', desc: 'Partly cloudy' },
    3: { icon: '☁️', desc: 'Overcast' },
    45: { icon: '🌫️', desc: 'Fog' },
    48: { icon: '🌫️', desc: 'Depositing rime fog' },
    51: { icon: '🌧️', desc: 'Light drizzle' },
    53: { icon: '🌧️', desc: 'Moderate drizzle' },
    55: { icon: '🌧️', desc: 'Dense drizzle' },
    56: { icon: '🌧️', desc: 'Light freezing drizzle' },
    57: { icon: '🌧️', desc: 'Dense freezing drizzle' },
    61: { icon: '🌧️', desc: 'Slight rain' },
    63: { icon: '🌧️', desc: 'Moderate rain' },
    65: { icon: '🌧️', desc: 'Heavy rain' },
    66: { icon: '🌧️', desc: 'Light freezing rain' },
    67: { icon: '🌧️', desc: 'Heavy freezing rain' },
    71: { icon: '🌨️', desc: 'Slight snow' },
    73: { icon: '🌨️', desc: 'Moderate snow' },
    75: { icon: '❄️', desc: 'Heavy snow' },
    77: { icon: '🌨️', desc: 'Snow grains' },
    80: { icon: '🌦️', desc: 'Slight rain showers' },
    81: { icon: '🌦️', desc: 'Moderate rain showers' },
    82: { icon: '🌧️', desc: 'Violent rain showers' },
    85: { icon: '🌨️', desc: 'Slight snow showers' },
    86: { icon: '🌨️', desc: 'Heavy snow showers' },
    95: { icon: '⛈️', desc: 'Thunderstorm' },
    96: { icon: '⛈️', desc: 'Thunderstorm with slight hail' },
    99: { icon: '⛈️', desc: 'Thunderstorm with heavy hail' }
};

// Get weather icon from code
function getWeatherIcon(code, isNight = false) {
    const weather = weatherCodes[code] || { icon: '❓', desc: 'Unknown' };
    if (isNight && code <= 2) {
        return code === 0 ? '🌙' : '🌙';
    }
    return weather.icon;
}

// Check if snow based on weather code
function isSnow(code) {
    return [71, 73, 75, 77, 85, 86].includes(code);
}

// Format temperature (returns just the number in current unit)
function formatTempValue(temp) {
    if (getTempUnit() === 'C') {
        return Math.round(temp);
    }
    return Math.round((temp * 9/5) + 32);
}

// Get temperature unit label
function getTempUnitLabel() {
    return getTempUnit() === 'C' ? '°C' : '°F';
}

// Format precipitation amount
function formatPrecip(mm) {
    const inches = mm / 25.4;
    if (inches < 0.01) return '';
    return `${inches.toFixed(2)}"`;
}

// Get day name
function getDayName(date, short = false) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const dateOnly = new Date(date);
    dateOnly.setHours(0, 0, 0, 0);

    if (dateOnly.getTime() === today.getTime()) {
        return 'TODAY';
    }

    const days = short
        ? ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
        : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    const dayName = days[date.getDay()];
    return short ? `${dayName} ${date.getDate()}` : `${dayName} ${date.getDate()}`;

}

// Get midnight of current day
function getMidnightToday() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
}

// Fetch weather data from Open-Meteo API
async function fetchWeatherData(lat, lon) {
    const params = new URLSearchParams({
        latitude: lat,
        longitude: lon,
        hourly: [
            'temperature_2m',
            'apparent_temperature',
            'precipitation_probability',
            'precipitation',
            'snowfall',
            'weather_code',
            'wind_speed_10m',
            'wind_direction_10m',
            'is_day'
        ].join(','),
        daily: [
            'temperature_2m_max',
            'temperature_2m_min',
            'precipitation_probability_max',
            'precipitation_sum',
            'snowfall_sum',
            'weather_code'
        ].join(','),
        temperature_unit: 'celsius',
        wind_speed_unit: 'mph',
        precipitation_unit: 'mm',
        timezone: 'auto',
        forecast_days: 8
    });

    const response = await fetch(`${API_BASE}?${params}`);
    if (!response.ok) {
        throw new Error('Failed to fetch weather data');
    }
    return response.json();
}

// Geocode location name
async function geocodeLocation(query) {
    const params = new URLSearchParams({
        name: query,
        count: 5,
        language: 'en',
        format: 'json'
    });

    const response = await fetch(`${GEOCODING_API}?${params}`);
    if (!response.ok) {
        throw new Error('Failed to geocode location');
    }
    const data = await response.json();

    if (!data.results || data.results.length === 0) {
        throw new Error('Location not found');
    }

    return data.results[0];
}

// Get AM/PM weather codes from hourly data for a specific date
function getAmPmWeatherCodes(data, targetDate) {
    const hourly = data.hourly;
    const targetDay = new Date(targetDate);
    targetDay.setHours(0, 0, 0, 0);

    let amCode = null;
    let pmCode = null;

    for (let i = 0; i < hourly.time.length; i++) {
        const hourDate = new Date(hourly.time[i]);
        const hourDay = new Date(hourDate);
        hourDay.setHours(0, 0, 0, 0);

        if (hourDay.getTime() === targetDay.getTime()) {
            const hour = hourDate.getHours();
            // AM: around 9-10 AM
            if (hour === 9 || hour === 10) {
                amCode = hourly.weather_code[i];
            }
            // PM: around 5-6 PM
            if (hour === 17 || hour === 18) {
                pmCode = hourly.weather_code[i];
            }
        }
    }

    return { amCode, pmCode };
}

// Render daily forecast cards - starting from today (current day)
function renderDailyForecast(data) {
    const container = document.getElementById('daily-forecast');
    container.innerHTML = '';

    const daily = data.daily;
    const today = getMidnightToday();

    // Find the index for today
    // Note: daily.time values are "YYYY-MM-DD" strings. new Date("YYYY-MM-DD") parses
    // as UTC midnight, which shifts to the previous day in US timezones. Appending
    // "T00:00:00" forces local time parsing and fixes the off-by-one offset.
    let startIdx = 0;
    for (let i = 0; i < daily.time.length; i++) {
        const dayDate = new Date(daily.time[i] + 'T00:00:00');
        dayDate.setHours(0, 0, 0, 0);
        if (dayDate.getTime() >= today.getTime()) {
            startIdx = i;
            break;
        }
    }

    // Render 7 days starting from today
    for (let i = startIdx; i < daily.time.length && i < startIdx + 7; i++) {
        const date = new Date(daily.time[i] + 'T00:00:00');
        const card = document.createElement('div');
        card.className = 'daily-card';

        const dailyWeatherCode = daily.weather_code[i];
        const hasSnow = daily.snowfall_sum[i] > 0;
        const hasPrecip = daily.precipitation_sum[i] > 0;
        const precipProb = daily.precipitation_probability_max[i];

        // Get AM/PM weather codes from hourly data
        const { amCode, pmCode } = getAmPmWeatherCodes(data, date);

        // Changed to min/max order
        const lowTemp = formatTempValue(daily.temperature_2m_min[i]);
        const highTemp = formatTempValue(daily.temperature_2m_max[i]);

        let precipClass = hasSnow ? 'snow' : '';

        // Use AM/PM icons if available, otherwise fall back to daily icon
        const amIcon = amCode !== null ? getWeatherIcon(amCode) : getWeatherIcon(dailyWeatherCode);
        const pmIcon = pmCode !== null ? getWeatherIcon(pmCode, true) : getWeatherIcon(dailyWeatherCode, true);

        card.innerHTML = `
            <div class="day-name">${getDayName(date, true)}</div>
            <div class="weather-icons">
                <div class="am-icon" title="Morning">${amIcon}</div>
                <div class="pm-icon" title="Evening">${pmIcon}</div>
            </div>
            <div class="temp-range">${lowTemp} | ${highTemp} ${getTempUnitLabel()}</div>
            ${precipProb >= 10 ? `
                <div class="precip-info ${precipClass}">
                    ${hasSnow ? '❄' : '💧'} ${precipProb}%
                </div>
            ` : ''}
            ${hasPrecip ? `
                <div class="precip-amount">${formatPrecip(daily.precipitation_sum[i])}</div>
            ` : ''}
        `;

        container.appendChild(card);
    }
}

// Render hourly forecast cards
function renderHourlyForecast(data) {
    const container = document.getElementById('hourly-forecast');
    container.innerHTML = '';

    const hourly = data.hourly;
    const now = new Date();

    let startIndex = 0;
    for (let i = 0; i < hourly.time.length; i++) {
        const hourDate = new Date(hourly.time[i]);
        if (hourDate >= now) {
            startIndex = i;
            break;
        }
    }

    let currentDay = null;

    for (let i = startIndex; i < Math.min(startIndex + 48, hourly.time.length); i++) {
        const date = new Date(hourly.time[i]);
        const isNight = hourly.is_day[i] === 0;

        const card = document.createElement('div');
        card.className = 'hourly-card';

        const dayStr = date.toDateString();
        let dayLabel = '';
        if (dayStr !== currentDay) {
            currentDay = dayStr;
            dayLabel = `<div class="day-label">${getDayName(date, true)}</div>`;
        }

        const weatherCode = hourly.weather_code[i];
        const precipProb = hourly.precipitation_probability[i];
        const precip = hourly.precipitation[i];
        const snowfall = hourly.snowfall[i];
        const hasSnow = snowfall > 0;
        const windSpeed = hourly.wind_speed_10m[i];
        const windDir = hourly.wind_direction_10m[i];
        const temp = formatTempValue(hourly.temperature_2m[i]);
        const apparentTemp = formatTempValue(hourly.apparent_temperature[i]);

        const windArrow = '↑';
        let precipClass = hasSnow ? 'snow' : '';

        // Show windchill if it differs from actual temp by more than 2 degrees
        const showWindchill = Math.abs(temp - apparentTemp) > 2;

        card.innerHTML = `
            ${dayLabel}
            <div class="hour">${formatHour(date)}</div>
            <div class="weather-icon">${getWeatherIcon(weatherCode, isNight)}</div>
            <div class="temp">${temp}${getTempUnitLabel()}</div>
            ${showWindchill ? `<div class="windchill">Feels ${apparentTemp}°</div>` : ''}
            <div class="wind">
                <span class="wind-icon" style="transform: rotate(${windDir}deg)">${windArrow}</span>
                ${Math.round(windSpeed)} mph
            </div>
            ${precipProb >= 10 ? `
                <div class="precip-chance ${precipClass}">
                    ${hasSnow ? '❄' : '💧'} ${precipProb}%
                </div>
            ` : ''}
            ${precip > 0 ? `
                <div class="precip-amount">${formatPrecip(precip)}</div>
            ` : ''}
        `;

        container.appendChild(card);
    }
}

// Custom plugin to draw grid lines and day/night bands
const gridLinesPlugin = {
    id: 'customGridLines',
    beforeDraw: (chart) => {
        const ctx = chart.ctx;
        const chartArea = chart.chartArea;
        const yTempScale = chart.scales['y-temp'];
        const yPrecipScale = chart.scales['y-precip-amount'];

        if (!chartArea || !yTempScale || !yPrecipScale) return;

        ctx.save();

        // Draw day/night background bands
        const isDayFlags = chart.data.isDayFlags;
        if (isDayFlags && isDayFlags.length > 0) {
            const xScale = chart.scales.x;
            const isLight = document.documentElement.getAttribute('data-theme') === 'light';
            const dayColor = isLight ? 'rgba(255, 255, 255, 0.4)' : 'rgba(255, 255, 255, 0.06)';
            const nightColor = isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(0, 0, 0, 0.15)';

            let bandStart = 0;
            let bandIsDay = isDayFlags[0];

            for (let i = 1; i <= isDayFlags.length; i++) {
                const currentIsDay = i < isDayFlags.length ? isDayFlags[i] : !bandIsDay;
                if (currentIsDay !== bandIsDay || i === isDayFlags.length) {
                    // Draw the band from bandStart to i
                    const x1 = bandStart === 0
                        ? chartArea.left
                        : (xScale.getPixelForValue(bandStart - 1) + xScale.getPixelForValue(bandStart)) / 2;
                    const x2 = i >= isDayFlags.length
                        ? chartArea.right
                        : (xScale.getPixelForValue(i - 1) + xScale.getPixelForValue(i)) / 2;

                    ctx.fillStyle = bandIsDay ? dayColor : nightColor;
                    ctx.fillRect(x1, chartArea.top, x2 - x1, chartArea.bottom - chartArea.top);

                    bandStart = i;
                    bandIsDay = currentIsDay;
                }
            }
        }

        // Draw temperature grid lines (every 10°F) - pink/red color
        const tempMin = Math.floor(yTempScale.min / 10) * 10;
        const tempMax = Math.ceil(yTempScale.max / 10) * 10;

        ctx.strokeStyle = 'rgba(239, 154, 154, 0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);

        for (let temp = tempMin; temp <= tempMax; temp += 10) {
            const y = yTempScale.getPixelForValue(temp);
            if (y >= chartArea.top && y <= chartArea.bottom) {
                ctx.beginPath();
                ctx.moveTo(chartArea.left, y);
                ctx.lineTo(chartArea.right, y);
                ctx.stroke();

                // Draw temperature label on left
                ctx.fillStyle = 'rgba(239, 154, 154, 0.7)';
                ctx.font = '9px sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText(`${temp}°`, chartArea.left + 2, y - 2);
            }
        }

        // Draw precipitation amount grid lines (every 0.10") - green color
        const precipMax = Math.ceil(yPrecipScale.max * 10) / 10;

        ctx.strokeStyle = 'rgba(102, 187, 106, 0.3)';
        ctx.setLineDash([3, 3]);

        for (let precip = 0.1; precip <= precipMax; precip += 0.1) {
            const y = yPrecipScale.getPixelForValue(precip);
            if (y >= chartArea.top && y <= chartArea.bottom) {
                ctx.beginPath();
                ctx.moveTo(chartArea.left, y);
                ctx.lineTo(chartArea.right, y);
                ctx.stroke();

                // Draw precip label on right
                ctx.fillStyle = 'rgba(102, 187, 106, 0.7)';
                ctx.font = '9px sans-serif';
                ctx.textAlign = 'right';
                ctx.fillText(`${precip.toFixed(1)}"`, chartArea.right - 2, y - 2);
            }
        }

        // Draw day separators
        const labels = chart.data.labels;
        const isLightTheme = document.documentElement.getAttribute('data-theme') === 'light';
        ctx.strokeStyle = isLightTheme ? 'rgba(0, 0, 0, 0.15)' : 'rgba(255, 255, 255, 0.15)';
        ctx.setLineDash([]);
        ctx.lineWidth = 1;

        let lastDay = null;
        labels.forEach((label, index) => {
            const date = new Date(label);
            const day = date.getDate();
            if (lastDay !== null && day !== lastDay) {
                const x = chart.scales.x.getPixelForValue(index);
                ctx.beginPath();
                ctx.moveTo(x, chartArea.top);
                ctx.lineTo(x, chartArea.bottom);
                ctx.stroke();
            }
            lastDay = day;
        });

        ctx.restore();
    }
};

// Register the plugin
Chart.register(gridLinesPlugin);

// Render the temperature/precipitation chart - starting from midnight today
function renderChart(data) {
    const ctx = document.getElementById('forecast-chart').getContext('2d');
    const hourly = data.hourly;

    const midnight = getMidnightToday();

    // Find index for midnight of current day
    let startIndex = 0;
    for (let i = 0; i < hourly.time.length; i++) {
        const hourDate = new Date(hourly.time[i]);
        if (hourDate >= midnight) {
            startIndex = i;
            break;
        }
    }

    const hours = 168; // 7 days
    const endIndex = Math.min(startIndex + hours, hourly.time.length);

    const labels = [];
    const temps = [];
    const precipProbs = [];
    const precipAmounts = [];
    const isDayFlags = [];

    for (let i = startIndex; i < endIndex; i++) {
        const date = new Date(hourly.time[i]);
        labels.push(date);
        temps.push(getTempUnit() === 'C' ? hourly.temperature_2m[i] : (hourly.temperature_2m[i] * 9/5) + 32);
        precipProbs.push(hourly.precipitation_probability[i]);
        precipAmounts.push(hourly.precipitation[i] / 25.4);
        isDayFlags.push(hourly.is_day[i]);
    }

    const minTemp = Math.min(...temps);
    const maxTemp = Math.max(...temps);
    const tempRange = maxTemp - minTemp;

    // Round to nearest 10 for cleaner grid
    const tempScaleMin = Math.floor((minTemp - tempRange * 0.1) / 10) * 10;
    const tempScaleMax = Math.ceil((maxTemp + tempRange * 0.1) / 10) * 10;

    const maxPrecipAmount = Math.max(0.1, ...precipAmounts);
    // Round up to nearest 0.1 for cleaner grid
    const precipScaleMax = Math.ceil(maxPrecipAmount * 1.2 * 10) / 10;

    if (forecastChart) {
        forecastChart.destroy();
    }

    forecastChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            isDayFlags: isDayFlags,
            datasets: [
                {
                    label: 'Temperature',
                    data: temps,
                    borderColor: '#ef9a9a',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    yAxisID: 'y-temp'
                },
                {
                    label: 'Precipitation Probability',
                    data: precipProbs,
                    borderColor: '#4fc3f7',
                    backgroundColor: 'rgba(79, 195, 247, 0.1)',
                    borderWidth: 2,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    fill: true,
                    yAxisID: 'y-precip-prob'
                },
                {
                    label: 'Precipitation Amount',
                    data: precipAmounts,
                    borderColor: '#66bb6a',
                    backgroundColor: 'rgba(102, 187, 106, 0.3)',
                    borderWidth: 2,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    fill: true,
                    yAxisID: 'y-precip-amount'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: getEffectiveTheme() === 'light' ? '#ffffff' : '#333',
                    titleColor: getEffectiveTheme() === 'light' ? '#1a1a1a' : '#fff',
                    bodyColor: getEffectiveTheme() === 'light' ? '#1a1a1a' : '#fff',
                    borderColor: getEffectiveTheme() === 'light' ? '#e0e0e0' : 'transparent',
                    borderWidth: getEffectiveTheme() === 'light' ? 1 : 0,
                    padding: 12,
                    displayColors: true,
                    position: 'nearest',
                    yAlign: 'bottom',
                    caretPadding: 20,
                    callbacks: {
                        title: function(context) {
                            const date = new Date(context[0].label);
                            const use24 = getTimeFormat() === '24';
                            return date.toLocaleString(use24 ? 'en-GB' : 'en-US', {
                                weekday: 'short',
                                month: 'short',
                                day: 'numeric',
                                hour: use24 ? '2-digit' : 'numeric',
                                ...(use24 ? { minute: '2-digit' } : {})
                            });
                        },
                        label: function(context) {
                            if (context.datasetIndex === 0) {
                                return `Temperature: ${Math.round(context.raw)}${getTempUnitLabel()}`;
                            } else if (context.datasetIndex === 1) {
                                return `Precip Chance: ${context.raw}%`;
                            } else {
                                const inches = context.raw;
                                if (inches < 0.01) return 'Precip Amount: 0.00"';
                                return `Precip Amount: ${inches.toFixed(2)}"`;
                            }
                        }
                    }
                }
            },
            scales: {
                x: {
                    display: false,
                    type: 'category'
                },
                'y-temp': {
                    display: false,
                    position: 'left',
                    min: tempScaleMin,
                    max: tempScaleMax
                },
                'y-precip-prob': {
                    display: false,
                    position: 'right',
                    min: 0,
                    max: 100
                },
                'y-precip-amount': {
                    display: false,
                    position: 'right',
                    min: 0,
                    max: precipScaleMax
                }
            }
        }
    });

    // Add legend below chart
    const container = document.querySelector('.chart-container');
    let legend = container.querySelector('.chart-legend');
    if (legend) {
        legend.remove();
    }
    legend = document.createElement('div');
    legend.className = 'chart-legend';
    legend.innerHTML = `
        <div class="legend-item">
            <span class="legend-color temp"></span>
            <span>Temp</span>
        </div>
        <div class="legend-item">
            <span class="legend-color precip-prob"></span>
            <span>Precip %</span>
        </div>
        <div class="legend-item">
            <span class="legend-color precip-amount"></span>
            <span>Precip Amt</span>
        </div>
    `;
    container.appendChild(legend);
}

// Initialize and render radar map
async function initializeRadar() {
    const mapContainer = document.getElementById('radar-map');
    const timeDisplay = document.getElementById('radar-time');

    if (!mapContainer) return;

    try {
        // Initialize Leaflet map centered on current location
        if (!radarMap) {
            radarMap = L.map('radar-map', {
                center: [currentLocation.latitude, currentLocation.longitude],
                zoom: 7, // Zoomed to show 50 mile radius with radar coverage
                zoomControl: false,
                attributionControl: true
            });

            // Add tile layer matching current theme
            const tileUrl = getEffectiveTheme() === 'light'
                ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
                : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
            L.tileLayer(tileUrl, {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
                subdomains: 'abcd',
                maxZoom: 19
            }).addTo(radarMap);

            // Add location marker
            L.circleMarker([currentLocation.latitude, currentLocation.longitude], {
                radius: 6,
                fillColor: '#00bcd4',
                color: '#fff',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.8
            }).addTo(radarMap);

            // Add 50 mile radius circle (approximately 80 km)
            L.circle([currentLocation.latitude, currentLocation.longitude], {
                radius: 80467, // 50 miles in meters
                color: '#00bcd4',
                fillColor: 'transparent',
                weight: 1,
                opacity: 0.5,
                dashArray: '5, 5'
            }).addTo(radarMap);
        } else {
            // Update map center for new location
            radarMap.setView([currentLocation.latitude, currentLocation.longitude], 7);
        }

        // Fetch radar data from RainViewer
        const response = await fetch(RAINVIEWER_API);
        const radarData = await response.json();

        if (radarData.radar && radarData.radar.past && radarData.radar.past.length > 0) {
            // Get the most recent radar frame
            const latestFrame = radarData.radar.past[radarData.radar.past.length - 1];
            const radarHost = radarData.host;

            // Remove existing radar layer
            if (radarLayer) {
                radarMap.removeLayer(radarLayer);
            }

            // Add new radar layer
            radarLayer = L.tileLayer(`${radarHost}${latestFrame.path}/256/{z}/{x}/{y}/2/1_1.png`, {
                opacity: 0.7,
                zIndex: 100
            }).addTo(radarMap);

            // Update time display
            const radarTime = new Date(latestFrame.time * 1000);
            const use24 = getTimeFormat() === '24';
            timeDisplay.textContent = `Radar: ${radarTime.toLocaleString(use24 ? 'en-GB' : 'en-US', {
                hour: use24 ? '2-digit' : 'numeric',
                minute: '2-digit',
                month: 'short',
                day: 'numeric'
            })}`;
        }

    } catch (error) {
        console.error('Error loading radar:', error);
        mapContainer.innerHTML = '<div class="radar-loading">Radar unavailable</div>';
    }
}

// Format time for astronomical display
function formatAstroTime(date) {
    if (!date || isNaN(date.getTime())) return '—';
    return formatTime(date);
}

// Get moon phase name and emoji
function getMoonPhaseInfo(phase) {
    // phase is 0-1: 0=new, 0.25=first quarter, 0.5=full, 0.75=last quarter
    if (phase < 0.0625) return { name: 'New Moon', emoji: '🌑' };
    if (phase < 0.1875) return { name: 'Waxing Crescent', emoji: '🌒' };
    if (phase < 0.3125) return { name: 'First Quarter', emoji: '🌓' };
    if (phase < 0.4375) return { name: 'Waxing Gibbous', emoji: '🌔' };
    if (phase < 0.5625) return { name: 'Full Moon', emoji: '🌕' };
    if (phase < 0.6875) return { name: 'Waning Gibbous', emoji: '🌖' };
    if (phase < 0.8125) return { name: 'Last Quarter', emoji: '🌗' };
    if (phase < 0.9375) return { name: 'Waning Crescent', emoji: '🌘' };
    return { name: 'New Moon', emoji: '🌑' };
}

// Render astronomical data (sun, moon, twilight)
function renderAstroData() {
    const container = document.getElementById('astro-data');
    if (!container) return;

    const now = new Date();
    const lat = currentLocation.latitude;
    const lng = currentLocation.longitude;

    // Get sun times
    const sunTimes = SunCalc.getTimes(now, lat, lng);

    // Get moon times
    const moonTimes = SunCalc.getMoonTimes(now, lat, lng);

    // Get moon illumination
    const moonIllum = SunCalc.getMoonIllumination(now);
    const moonPhase = getMoonPhaseInfo(moonIllum.phase);
    const illuminationPct = Math.round(moonIllum.fraction * 100);

    // Calculate day length
    let dayLengthStr = '—';
    let dayChangeStr = '';
    if (sunTimes.sunrise && sunTimes.sunset && !isNaN(sunTimes.sunrise.getTime()) && !isNaN(sunTimes.sunset.getTime())) {
        const dayLengthMs = sunTimes.sunset - sunTimes.sunrise;
        const dayHours = Math.floor(dayLengthMs / 3600000);
        const dayMins = Math.round((dayLengthMs % 3600000) / 60000);
        dayLengthStr = `${dayHours}h ${dayMins}m`;

        // Compare with yesterday
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdaySun = SunCalc.getTimes(yesterday, lat, lng);
        if (yesterdaySun.sunrise && yesterdaySun.sunset && !isNaN(yesterdaySun.sunrise.getTime()) && !isNaN(yesterdaySun.sunset.getTime())) {
            const yesterdayLengthMs = yesterdaySun.sunset - yesterdaySun.sunrise;
            const diffMs = dayLengthMs - yesterdayLengthMs;
            const diffMins = Math.round(Math.abs(diffMs) / 60000);
            if (diffMins > 0) {
                const diffSecs = Math.round(Math.abs(diffMs) / 1000) % 60;
                dayChangeStr = `${diffMs >= 0 ? '+' : '-'}${diffMins}m ${diffSecs}s vs yesterday`;
            }
        }
    }

    container.innerHTML = `
        <div class="astro-group">
            <h4 class="astro-group-title">Twilight &amp; Sun</h4>
            <div class="astro-grid">
                <div class="astro-row">
                    <span class="astro-label">Astronomical Dawn</span>
                    <span class="astro-value">${formatAstroTime(sunTimes.nightEnd)}</span>
                </div>
                <div class="astro-row">
                    <span class="astro-label">Nautical Dawn</span>
                    <span class="astro-value">${formatAstroTime(sunTimes.nauticalDawn)}</span>
                </div>
                <div class="astro-row">
                    <span class="astro-label">Civil Dawn</span>
                    <span class="astro-value">${formatAstroTime(sunTimes.dawn)}</span>
                </div>
                <div class="astro-row highlight">
                    <span class="astro-label">☀️ Sunrise</span>
                    <span class="astro-value">${formatAstroTime(sunTimes.sunrise)}</span>
                </div>
                <div class="astro-row">
                    <span class="astro-label">Solar Noon</span>
                    <span class="astro-value">${formatAstroTime(sunTimes.solarNoon)}</span>
                </div>
                <div class="astro-row highlight">
                    <span class="astro-label">🌅 Sunset</span>
                    <span class="astro-value">${formatAstroTime(sunTimes.sunset)}</span>
                </div>
                <div class="astro-row">
                    <span class="astro-label">Civil Dusk</span>
                    <span class="astro-value">${formatAstroTime(sunTimes.dusk)}</span>
                </div>
                <div class="astro-row">
                    <span class="astro-label">Nautical Dusk</span>
                    <span class="astro-value">${formatAstroTime(sunTimes.nauticalDusk)}</span>
                </div>
                <div class="astro-row">
                    <span class="astro-label">Astronomical Dusk</span>
                    <span class="astro-value">${formatAstroTime(sunTimes.night)}</span>
                </div>
                <div class="astro-row highlight">
                    <span class="astro-label">Day Length</span>
                    <span class="astro-value">${dayLengthStr}</span>
                </div>
                ${dayChangeStr ? `<div class="astro-row">
                    <span class="astro-label"></span>
                    <span class="astro-value astro-change">${dayChangeStr}</span>
                </div>` : ''}
            </div>
        </div>
        <div class="astro-group">
            <h4 class="astro-group-title">Moon</h4>
            <div class="astro-grid">
                <div class="astro-row">
                    <span class="astro-label">Moonrise</span>
                    <span class="astro-value">${moonTimes.rise ? formatAstroTime(moonTimes.rise) : 'No rise today'}</span>
                </div>
                <div class="astro-row">
                    <span class="astro-label">Moonset</span>
                    <span class="astro-value">${moonTimes.set ? formatAstroTime(moonTimes.set) : 'No set today'}</span>
                </div>
                <div class="astro-row highlight">
                    <span class="astro-label">${moonPhase.emoji} Phase</span>
                    <span class="astro-value">${moonPhase.name}</span>
                </div>
                <div class="astro-row">
                    <span class="astro-label">Illumination</span>
                    <span class="astro-value">${illuminationPct}%</span>
                </div>
            </div>
        </div>
    `;
}

// Update location display with optional current temperature and feels-like
function updateLocationDisplay(currentTemp = null, feelsLike = null) {
    const locationName = document.getElementById('location-name');
    if (currentTemp !== null) {
        let display = `${currentLocation.name}: ${currentTemp}${getTempUnitLabel()}`;
        if (feelsLike !== null && Math.abs(currentTemp - feelsLike) > 2) {
            display += ` (feels ${feelsLike}°)`;
        }
        locationName.textContent = display;
    } else {
        locationName.textContent = currentLocation.name;
    }
    // Update favorite button state
    updateFavoriteButton();
}

// Load weather for current location
async function loadWeather() {
    try {
        // Save as last used location
        saveLastLocation(currentLocation);

        document.getElementById('daily-forecast').innerHTML = '<div class="loading">Loading forecast</div>';
        document.getElementById('hourly-forecast').innerHTML = '';

        weatherData = await fetchWeatherData(currentLocation.latitude, currentLocation.longitude);

        // Get current temperature and feels-like from hourly data
        const now = new Date();
        let currentTemp = null;
        let feelsLike = null;
        for (let i = 0; i < weatherData.hourly.time.length; i++) {
            const hourDate = new Date(weatherData.hourly.time[i]);
            if (hourDate >= now) {
                const idx = i > 0 ? i - 1 : 0;
                currentTemp = formatTempValue(weatherData.hourly.temperature_2m[idx]);
                feelsLike = formatTempValue(weatherData.hourly.apparent_temperature[idx]);
                break;
            }
        }
        updateLocationDisplay(currentTemp, feelsLike);

        renderDailyForecast(weatherData);
        renderHourlyForecast(weatherData);
        renderChart(weatherData);
        checkWeatherAlerts(weatherData);
        initializeRadar();
        renderAstroData();

        // Update last-updated timestamp
        const lastUpdated = document.getElementById('last-updated');
        if (lastUpdated) {
            const now2 = new Date();
            lastUpdated.dataset.timestamp = now2.toISOString();
            lastUpdated.textContent = `Updated ${formatTime(now2)}`;
        }

    } catch (error) {
        console.error('Error loading weather:', error);
        document.getElementById('daily-forecast').innerHTML =
            `<div class="error">Failed to load weather data: ${error.message}</div>`;
    }
}

// Check for weather alerts via NWS API, with local fallback
async function checkWeatherAlerts(data) {
    const alertBanner = document.getElementById('alert-banner');
    const alertText = document.getElementById('alert-text');
    const alertContainer = document.getElementById('alert-container');

    // NWS forecast link for this location
    const nwsUrl = `https://forecast.weather.gov/MapClick.php?lat=${currentLocation.latitude}&lon=${currentLocation.longitude}`;

    try {
        // Fetch real NWS active alerts for this point
        const response = await fetch(
            `https://api.weather.gov/alerts/active?point=${currentLocation.latitude},${currentLocation.longitude}`,
            { headers: { 'User-Agent': 'WeatherWonder (cjpaulphd)' } }
        );

        if (!response.ok) throw new Error('NWS API error');

        const alertData = await response.json();
        const alerts = alertData.features || [];

        if (alerts.length > 0) {
            // Build alert display - show all active alerts
            alertContainer.innerHTML = '';
            alerts.forEach(alert => {
                const props = alert.properties;
                const severity = props.severity || 'Unknown';
                const event = props.event || 'Weather Alert';
                const headline = props.headline || event;

                // Build URL to the specific alert
                // props['@id'] is the direct API URL for this alert (e.g. https://api.weather.gov/alerts/urn:oid:...)
                // alert.id at the GeoJSON feature level is the same URL
                const alertUrl = props['@id'] || alert.id || nwsUrl;

                let icon = '⚠️';
                let bgColor = '#ff9800';
                if (severity === 'Extreme') { icon = '🚨'; bgColor = '#d32f2f'; }
                else if (severity === 'Severe') { icon = '⛈️'; bgColor = '#f44336'; }
                else if (event.toLowerCase().includes('winter') || event.toLowerCase().includes('snow') || event.toLowerCase().includes('ice') || event.toLowerCase().includes('freeze') || event.toLowerCase().includes('cold') || event.toLowerCase().includes('blizzard')) {
                    icon = '❄️';
                }
                else if (event.toLowerCase().includes('thunder') || event.toLowerCase().includes('tornado')) {
                    icon = '⛈️';
                }
                else if (event.toLowerCase().includes('flood')) { icon = '🌊'; }
                else if (event.toLowerCase().includes('wind')) { icon = '💨'; }
                else if (event.toLowerCase().includes('heat')) { icon = '🌡️'; bgColor = '#ff5722'; }
                else if (event.toLowerCase().includes('fog')) { icon = '🌫️'; }
                else if (event.toLowerCase().includes('fire')) { icon = '🔥'; bgColor = '#ff5722'; }

                const alertEl = document.createElement('div');
                alertEl.className = 'alert-banner';
                alertEl.style.backgroundColor = bgColor;
                alertEl.innerHTML = `
                    <span class="alert-icon">${icon}</span>
                    <span class="alert-text-content">${headline}</span>
                    <span class="alert-arrow">›</span>
                `;

                // Open alert detail modal on click
                alertEl.addEventListener('click', () => {
                    showAlertDetail(props, nwsUrl);
                });

                alertContainer.appendChild(alertEl);
            });

            alertContainer.classList.remove('hidden');
            alertBanner.classList.add('hidden');
        } else {
            alertContainer.innerHTML = '';
            alertContainer.classList.add('hidden');
            alertBanner.classList.add('hidden');
        }
    } catch (error) {
        // Fallback to local weather-code detection if NWS API fails
        console.warn('NWS Alerts API unavailable, using local detection:', error.message);
        alertContainer.innerHTML = '';
        alertContainer.classList.add('hidden');

        const hourly = data.hourly;
        let hasWinterWeather = false;
        let hasThunderstorm = false;

        for (let i = 0; i < Math.min(24, hourly.weather_code.length); i++) {
            const code = hourly.weather_code[i];
            if ([71, 73, 75, 77, 85, 86, 66, 67].includes(code)) {
                hasWinterWeather = true;
            }
            if ([95, 96, 99].includes(code)) {
                hasThunderstorm = true;
            }
        }

        alertBanner.onclick = () => window.open(nwsUrl, '_blank');

        if (hasWinterWeather) {
            alertBanner.classList.remove('hidden');
            alertText.textContent = 'Winter Weather Advisory';
            document.querySelector('.alert-icon').textContent = '❄️';
        } else if (hasThunderstorm) {
            alertBanner.classList.remove('hidden');
            alertText.textContent = 'Thunderstorm Warning';
            document.querySelector('.alert-icon').textContent = '⛈️';
        } else {
            alertBanner.classList.add('hidden');
        }
    }
}

// Show alert detail modal with formatted NWS alert text
function showAlertDetail(props, nwsUrl) {
    const modal = document.getElementById('alert-detail-modal');
    const header = document.getElementById('alert-detail-header');
    const body = document.getElementById('alert-detail-body');
    const nwsLink = document.getElementById('alert-detail-nws-link');

    const event = props.event || 'Weather Alert';
    const severity = props.severity || '';
    const headline = props.headline || event;
    const description = (props.description || '').replace(/\n/g, '<br>');
    const instruction = (props.instruction || '').replace(/\n/g, '<br>');
    const areaDesc = props.areaDesc || '';
    const alertTimeLocale = getTimeFormat() === '24' ? 'en-GB' : 'en-US';
    const alertTimeOpts = { weekday: 'short', month: 'short', day: 'numeric', hour: getTimeFormat() === '24' ? '2-digit' : 'numeric', minute: '2-digit' };
    const onset = props.onset ? new Date(props.onset).toLocaleString(alertTimeLocale, alertTimeOpts) : '';
    const ends = props.ends ? new Date(props.ends).toLocaleString(alertTimeLocale, alertTimeOpts) : '';
    const expires = props.expires ? new Date(props.expires).toLocaleString(alertTimeLocale, alertTimeOpts) : '';
    const sender = props.senderName || '';

    header.innerHTML = `<h3>${event}</h3>`;
    if (severity) {
        header.innerHTML += `<span class="alert-detail-severity alert-severity-${severity.toLowerCase()}">${severity}</span>`;
    }

    let bodyHtml = '';
    if (headline) bodyHtml += `<p class="alert-detail-headline">${headline}</p>`;
    if (onset || ends) {
        bodyHtml += `<div class="alert-detail-timing">`;
        if (onset) bodyHtml += `<div><strong>From:</strong> ${onset}</div>`;
        if (ends) bodyHtml += `<div><strong>Until:</strong> ${ends}</div>`;
        else if (expires) bodyHtml += `<div><strong>Expires:</strong> ${expires}</div>`;
        bodyHtml += `</div>`;
    }
    if (areaDesc) bodyHtml += `<div class="alert-detail-area"><strong>Areas:</strong> ${areaDesc}</div>`;
    if (description) bodyHtml += `<div class="alert-detail-desc">${description}</div>`;
    if (instruction) bodyHtml += `<div class="alert-detail-instruction"><strong>Instructions:</strong><br>${instruction}</div>`;
    if (sender) bodyHtml += `<div class="alert-detail-sender">Issued by ${sender}</div>`;

    body.innerHTML = bodyHtml;
    nwsLink.href = nwsUrl;
    modal.classList.remove('hidden');
}

// Initialize alert detail modal close handler
function initializeAlertDetailModal() {
    const modal = document.getElementById('alert-detail-modal');
    const closeBtn = document.getElementById('close-alert-detail');

    closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.add('hidden');
    });
}

// Get user's current location
function getCurrentLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocation is not supported'));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                resolve({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude
                });
            },
            (error) => {
                reject(error);
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    });
}

// Show toast notification
function showToast(message, isSuccess = false) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast ${isSuccess ? 'success' : ''}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 3000);
}

// Take screenshot of a section
async function takeScreenshot(sectionId) {
    const section = document.getElementById(sectionId);
    if (!section) return;

    try {
        const screenshotBg = getEffectiveTheme() === 'light' ? '#f5f5f5' : '#1a1a1a';
        const canvas = await html2canvas(section, {
            backgroundColor: screenshotBg,
            scale: 2
        });

        canvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `weather-forecast-${currentLocation.name.replace(/[^a-z0-9]/gi, '-')}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast('Screenshot saved!', true);
        }, 'image/png');
    } catch (error) {
        console.error('Screenshot error:', error);
        showToast('Failed to capture screenshot');
    }
}

// Copy link to clipboard
function copyLink() {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
        showToast('Link copied!', true);
    }).catch(() => {
        showToast('Failed to copy link');
    });
}

// Native share
async function nativeShare() {
    if (!navigator.share) {
        showToast('Sharing not supported on this device');
        return;
    }

    try {
        await navigator.share({
            title: `Weather Forecast - ${currentLocation.name}`,
            text: `Check out the weather forecast for ${currentLocation.name}`,
            url: window.location.href
        });
    } catch (error) {
        if (error.name !== 'AbortError') {
            showToast('Failed to share');
        }
    }
}

// Initialize share modal
function initializeShareModal() {
    const shareModal = document.getElementById('share-modal');
    const closeShareBtn = document.getElementById('close-share-modal');
    const shareDailyBtn = document.getElementById('share-daily-btn');
    const shareHourlyBtn = document.getElementById('share-hourly-btn');
    const shareRadarBtn = document.getElementById('share-radar-btn');
    const shareScreenshotBtn = document.getElementById('share-screenshot');
    const shareLinkBtn = document.getElementById('share-link');
    const shareBothBtn = document.getElementById('share-both');
    const shareNativeBtn = document.getElementById('share-native');

    // Open share modal for daily section
    shareDailyBtn.addEventListener('click', () => {
        currentShareSection = 'daily-section';
        shareModal.classList.remove('hidden');
    });

    // Open share modal for hourly section
    shareHourlyBtn.addEventListener('click', () => {
        currentShareSection = 'hourly-section';
        shareModal.classList.remove('hidden');
    });

    // Open share modal for radar section
    if (shareRadarBtn) {
        shareRadarBtn.addEventListener('click', () => {
            currentShareSection = 'radar-section';
            shareModal.classList.remove('hidden');
        });
    }

    // Close share modal
    closeShareBtn.addEventListener('click', () => {
        shareModal.classList.add('hidden');
    });

    shareModal.addEventListener('click', (e) => {
        if (e.target === shareModal) {
            shareModal.classList.add('hidden');
        }
    });

    // Screenshot button
    shareScreenshotBtn.addEventListener('click', async () => {
        shareModal.classList.add('hidden');
        await takeScreenshot(currentShareSection);
    });

    // Copy link button
    shareLinkBtn.addEventListener('click', () => {
        copyLink();
        shareModal.classList.add('hidden');
    });

    // Share both screenshot and link
    shareBothBtn.addEventListener('click', async () => {
        shareModal.classList.add('hidden');
        // Take screenshot
        await takeScreenshot(currentShareSection);
        // Copy link after a small delay
        setTimeout(() => {
            copyLink();
        }, 500);
    });

    // Native share button (iOS/Android share sheet)
    shareNativeBtn.addEventListener('click', async () => {
        shareModal.classList.add('hidden');
        await nativeShare();
    });
}

// Initialize location modal handlers
function initializeModal() {
    const modal = document.getElementById('location-modal');
    const locationInput = document.getElementById('location-input');
    const searchBtn = document.getElementById('search-location');
    const useCurrentBtn = document.getElementById('use-current-location');
    const closeBtn = document.getElementById('close-modal');
    const clearInputBtn = document.getElementById('clear-location-input');
    const locationDisplay = document.querySelector('.location');

    // Clear input button
    clearInputBtn.addEventListener('click', () => {
        locationInput.value = '';
        locationInput.focus();
    });

    locationDisplay.addEventListener('click', () => {
        modal.classList.remove('hidden');
        locationInput.focus();
    });

    closeBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.add('hidden');
        }
    });

    searchBtn.addEventListener('click', async () => {
        const query = locationInput.value.trim();
        if (!query) return;

        try {
            searchBtn.disabled = true;
            searchBtn.textContent = 'Searching...';

            const result = await geocodeLocation(query);
            currentLocation = {
                name: `${result.name}${result.admin1 ? ', ' + result.admin1 : ''}`,
                latitude: result.latitude,
                longitude: result.longitude
            };

            updateLocationDisplay();
            modal.classList.add('hidden');

            // Reset radar map for new location
            if (radarMap) {
                radarMap.remove();
                radarMap = null;
                radarLayer = null;
            }

            loadWeather();

        } catch (error) {
            alert('Location not found: ' + error.message);
        } finally {
            searchBtn.disabled = false;
            searchBtn.textContent = 'Search';
        }
    });

    locationInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            searchBtn.click();
        }
    });

    useCurrentBtn.addEventListener('click', async () => {
        try {
            useCurrentBtn.disabled = true;
            useCurrentBtn.textContent = 'Getting location...';

            const coords = await getCurrentLocation();

            const response = await fetch(
                `https://nominatim.openstreetmap.org/reverse?lat=${coords.latitude}&lon=${coords.longitude}&format=json`
            );
            const data = await response.json();

            const city = data.address.city || data.address.town || data.address.village || 'Unknown';
            const state = data.address.state || data.address.country || '';

            currentLocation = {
                name: `${city}, ${state}`,
                latitude: coords.latitude,
                longitude: coords.longitude
            };

            updateLocationDisplay();
            modal.classList.add('hidden');

            // Reset radar map for new location
            if (radarMap) {
                radarMap.remove();
                radarMap = null;
                radarLayer = null;
            }

            loadWeather();

        } catch (error) {
            alert('Could not get your location: ' + error.message);
        } finally {
            useCurrentBtn.disabled = false;
            useCurrentBtn.textContent = 'Use Current Location';
        }
    });
}

// Initialize hourly scroll handler to update day indicator
function initializeHourlyScrollHandler() {
    const hourlyContainer = document.getElementById('hourly-forecast');
    const dayIndicator = document.getElementById('hourly-day-indicator');

    if (!hourlyContainer || !dayIndicator) return;

    hourlyContainer.addEventListener('scroll', () => {
        const cards = hourlyContainer.querySelectorAll('.hourly-card');
        if (cards.length === 0) return;

        const containerRect = hourlyContainer.getBoundingClientRect();
        const containerCenter = containerRect.left + containerRect.width / 3;

        let visibleDay = null;

        for (const card of cards) {
            const cardRect = card.getBoundingClientRect();
            if (cardRect.left <= containerCenter && cardRect.right >= containerCenter) {
                // Find the day label for this card or the most recent one before it
                const dayLabel = card.querySelector('.day-label');
                if (dayLabel) {
                    visibleDay = dayLabel.textContent;
                }
                break;
            }
        }

        // If no day label on current card, find the most recent one
        if (!visibleDay) {
            for (const card of cards) {
                const cardRect = card.getBoundingClientRect();
                if (cardRect.right < containerCenter) {
                    const dayLabel = card.querySelector('.day-label');
                    if (dayLabel) {
                        visibleDay = dayLabel.textContent;
                    }
                } else if (cardRect.left <= containerCenter) {
                    // Current visible card - check if it has a label or use the previous one
                    const dayLabel = card.querySelector('.day-label');
                    if (dayLabel) {
                        visibleDay = dayLabel.textContent;
                    }
                    break;
                }
            }
        }

        if (visibleDay) {
            dayIndicator.textContent = visibleDay;
        }
    });

    // Set initial value
    setTimeout(() => {
        const firstDayLabel = hourlyContainer.querySelector('.day-label');
        if (firstDayLabel) {
            dayIndicator.textContent = firstDayLabel.textContent;
        }
    }, 100);
}

// Initialize menu handlers
function initializeMenu() {
    const menuBtn = document.querySelector('.menu-btn');
    const closeMenuBtn = document.getElementById('close-menu');
    const menuOverlay = document.getElementById('menu-overlay');
    const menuChangeLocation = document.getElementById('menu-change-location');
    const favoriteBtn = document.getElementById('favorite-btn');

    // Open menu
    menuBtn.addEventListener('click', () => {
        renderFavoritesList();
        openMenu();
    });

    // Close menu
    closeMenuBtn.addEventListener('click', closeMenu);
    menuOverlay.addEventListener('click', closeMenu);

    // Change location from menu
    menuChangeLocation.addEventListener('click', () => {
        closeMenu();
        document.getElementById('location-modal').classList.remove('hidden');
        document.getElementById('location-input').focus();
    });

    // Toggle favorite
    favoriteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isFavorite(currentLocation)) {
            removeFavorite(currentLocation.latitude, currentLocation.longitude);
            showToast('Removed from favorites');
        } else {
            addFavorite(currentLocation);
            showToast('Added to favorites', true);
        }
    });

    // Initialize favorite button state
    updateFavoriteButton();

    // Refresh button
    const refreshBtn = document.getElementById('refresh-btn');
    refreshBtn.addEventListener('click', () => {
        // Reset radar map so it fully re-initializes
        if (radarMap) {
            radarMap.remove();
            radarMap = null;
            radarLayer = null;
        }
        loadWeather();
    });
}

// PWA Install prompt handling
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    showInstallButton();
});

function showInstallButton() {
    const btn = document.getElementById('install-btn');
    if (btn) btn.classList.remove('hidden');
}

function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

function isInStandaloneMode() {
    return window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
}

function initializeInstallButton() {
    const btn = document.getElementById('install-btn');
    const btnText = document.getElementById('install-btn-text');
    if (!btn) return;

    // Don't show if already installed as PWA
    if (isInStandaloneMode()) return;

    // On iOS, show the button with manual instructions
    if (isIOS()) {
        btn.classList.remove('hidden');
        btn.addEventListener('click', () => {
            showToast('Tap the Share button (box with arrow) then "Add to Home Screen"');
        });
        return;
    }

    // On Chrome/Edge/Android, use the deferred prompt if available
    btn.addEventListener('click', async () => {
        if (deferredInstallPrompt) {
            deferredInstallPrompt.prompt();
            const result = await deferredInstallPrompt.userChoice;
            if (result.outcome === 'accepted') {
                btn.classList.add('hidden');
                showToast('WeatherWonder added to home screen!', true);
            }
            deferredInstallPrompt = null;
        } else {
            // Fallback instructions for browsers without install prompt
            showToast('Use your browser menu to "Add to Home Screen" or "Install App"');
        }
    });
}

// Register service worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    const inits = [
        initializeTheme,
        initializeTempToggle,
        initializeTimeToggle,
        updateLocationDisplay,
        initializeModal,
        initializeShareModal,
        initializeMenu,
        initializeAlertDetailModal,
        initializeInstallButton
    ];
    inits.forEach(fn => {
        try { fn(); } catch (e) { console.error('Init error in ' + fn.name + ':', e); }
    });
    loadWeather();

    // Initialize scroll handler after weather loads
    setTimeout(initializeHourlyScrollHandler, 500);
});
