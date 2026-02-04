// Weather App - Precipitation Forecast Visualization
// Uses Open-Meteo API (free, no API key required)

const API_BASE = 'https://api.open-meteo.com/v1/forecast';
const GEOCODING_API = 'https://geocoding-api.open-meteo.com/v1/search';

// Default location (Durham, NC)
let currentLocation = {
    name: 'Durham, NC',
    latitude: 35.994,
    longitude: -78.8986
};

let forecastChart = null;
let weatherData = null;

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
    // Adjust for night time
    if (isNight && code <= 2) {
        return code === 0 ? '🌙' : '🌙';
    }
    return weather.icon;
}

// Check if snow based on weather code
function isSnow(code) {
    return [71, 73, 75, 77, 85, 86].includes(code);
}

// Format temperature
function formatTemp(temp, unit = 'F') {
    const value = unit === 'F' ? (temp * 9/5) + 32 : temp;
    return `${Math.round(value)}°${unit}`;
}

// Format precipitation amount
function formatPrecip(mm) {
    // Convert mm to inches
    const inches = mm / 25.4;
    if (inches < 0.01) return '';
    return `${inches.toFixed(2)}"`;
}

// Get day name
function getDayName(date, short = false) {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) {
        return 'TODAY';
    }
    if (date.toDateString() === tomorrow.toDateString()) {
        return 'TOMORROW';
    }

    const days = short
        ? ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
        : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    const dayName = days[date.getDay()];
    return `${dayName} ${date.getDate()}`;
}

// Fetch weather data from Open-Meteo API
async function fetchWeatherData(lat, lon) {
    const params = new URLSearchParams({
        latitude: lat,
        longitude: lon,
        hourly: [
            'temperature_2m',
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
        forecast_days: 7
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

// Render daily forecast cards
function renderDailyForecast(data) {
    const container = document.getElementById('daily-forecast');
    container.innerHTML = '';

    const daily = data.daily;

    for (let i = 0; i < daily.time.length && i < 7; i++) {
        const date = new Date(daily.time[i]);
        const card = document.createElement('div');
        card.className = 'daily-card';

        const weatherCode = daily.weather_code[i];
        const hasSnow = daily.snowfall_sum[i] > 0;
        const hasPrecip = daily.precipitation_sum[i] > 0;
        const precipProb = daily.precipitation_probability_max[i];

        // Determine precipitation type icon
        let precipIcon = '💧';
        if (hasSnow) {
            precipIcon = '❄️';
        }

        let precipClass = hasPrecip || precipProb > 30 ? (hasSnow ? 'snow' : '') : '';

        card.innerHTML = `
            <div class="day-name">${getDayName(date, true)}</div>
            <div class="weather-icons">
                ${getWeatherIcon(weatherCode)}
                ${hasPrecip ? getWeatherIcon(hasSnow ? 75 : 61) : ''}
            </div>
            <div class="temp-range">
                ${formatTemp(daily.temperature_2m_max[i])} | ${formatTemp(daily.temperature_2m_min[i])}
            </div>
            ${precipProb > 0 ? `
                <div class="precip-info ${precipClass}">
                    ${hasSnow ? '❄️' : '💧'} ${precipProb}%
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
    const currentHour = now.getHours();

    // Find the starting index (current hour)
    let startIndex = 0;
    for (let i = 0; i < hourly.time.length; i++) {
        const hourDate = new Date(hourly.time[i]);
        if (hourDate >= now) {
            startIndex = i;
            break;
        }
    }

    let currentDay = null;

    // Show next 48 hours
    for (let i = startIndex; i < Math.min(startIndex + 48, hourly.time.length); i++) {
        const date = new Date(hourly.time[i]);
        const hour = date.getHours();
        const isNight = hourly.is_day[i] === 0;

        const card = document.createElement('div');
        card.className = 'hourly-card';

        // Check if we need a day label
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

        // Wind direction arrow
        const windArrow = '↑';

        let precipClass = hasSnow ? 'snow' : '';

        card.innerHTML = `
            ${dayLabel}
            <div class="hour">${hour}</div>
            <div class="weather-icon">${getWeatherIcon(weatherCode, isNight)}</div>
            <div class="temp">${formatTemp(hourly.temperature_2m[i])}</div>
            <div class="wind">
                <span class="wind-icon" style="transform: rotate(${windDir}deg)">${windArrow}</span>
                ${Math.round(windSpeed)} mph
            </div>
            ${precipProb > 0 ? `
                <div class="precip-chance ${precipClass}">
                    ${hasSnow ? '❄️' : '💧'} ${precipProb}%
                </div>
            ` : ''}
            ${precip > 0 ? `
                <div class="precip-amount">${formatPrecip(precip)}</div>
            ` : ''}
        `;

        container.appendChild(card);
    }
}

// Render the temperature/precipitation chart
function renderChart(data) {
    const ctx = document.getElementById('forecast-chart').getContext('2d');
    const hourly = data.hourly;

    // Get data for next 7 days (168 hours)
    const now = new Date();
    let startIndex = 0;
    for (let i = 0; i < hourly.time.length; i++) {
        const hourDate = new Date(hourly.time[i]);
        if (hourDate >= now) {
            startIndex = i;
            break;
        }
    }

    const hours = 168; // 7 days
    const endIndex = Math.min(startIndex + hours, hourly.time.length);

    const labels = [];
    const temps = [];
    const precipProbs = [];

    for (let i = startIndex; i < endIndex; i++) {
        const date = new Date(hourly.time[i]);
        labels.push(date);
        temps.push((hourly.temperature_2m[i] * 9/5) + 32); // Convert to F
        precipProbs.push(hourly.precipitation_probability[i]);
    }

    // Calculate temperature range for scaling
    const minTemp = Math.min(...temps);
    const maxTemp = Math.max(...temps);
    const tempRange = maxTemp - minTemp;

    // Destroy existing chart if it exists
    if (forecastChart) {
        forecastChart.destroy();
    }

    // Create chart
    forecastChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
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
                    yAxisID: 'y-precip'
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
                    backgroundColor: '#333',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    padding: 12,
                    displayColors: true,
                    callbacks: {
                        title: function(context) {
                            const date = context[0].label;
                            return new Date(date).toLocaleString('en-US', {
                                weekday: 'short',
                                month: 'short',
                                day: 'numeric',
                                hour: 'numeric'
                            });
                        },
                        label: function(context) {
                            if (context.datasetIndex === 0) {
                                return `Temperature: ${Math.round(context.raw)}°F`;
                            } else {
                                return `Precip Chance: ${context.raw}%`;
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
                    min: minTemp - tempRange * 0.2,
                    max: maxTemp + tempRange * 0.2
                },
                'y-precip': {
                    display: false,
                    position: 'right',
                    min: 0,
                    max: 100
                }
            }
        }
    });

    // Add legend below chart
    const container = document.querySelector('.chart-container');
    let legend = container.querySelector('.chart-legend');
    if (!legend) {
        legend = document.createElement('div');
        legend.className = 'chart-legend';
        legend.innerHTML = `
            <div class="legend-item">
                <span class="legend-color temp"></span>
                <span>Temperature</span>
            </div>
            <div class="legend-item">
                <span class="legend-color precip"></span>
                <span>Precip Probability</span>
            </div>
        `;
        container.appendChild(legend);
    }
}

// Update location display
function updateLocationDisplay() {
    document.getElementById('location-name').textContent = currentLocation.name;
}

// Load weather for current location
async function loadWeather() {
    try {
        // Show loading state
        document.getElementById('daily-forecast').innerHTML = '<div class="loading">Loading forecast</div>';
        document.getElementById('hourly-forecast').innerHTML = '';

        // Fetch weather data
        weatherData = await fetchWeatherData(currentLocation.latitude, currentLocation.longitude);

        // Render all components
        renderDailyForecast(weatherData);
        renderHourlyForecast(weatherData);
        renderChart(weatherData);

        // Check for weather alerts (simplified - based on weather codes)
        checkWeatherAlerts(weatherData);

    } catch (error) {
        console.error('Error loading weather:', error);
        document.getElementById('daily-forecast').innerHTML =
            `<div class="error">Failed to load weather data: ${error.message}</div>`;
    }
}

// Check for weather alerts (simplified version based on conditions)
function checkWeatherAlerts(data) {
    const alertBanner = document.getElementById('alert-banner');
    const alertText = document.getElementById('alert-text');

    // Check next 24 hours for significant weather
    const hourly = data.hourly;
    const now = new Date();

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

// Initialize modal handlers
function initializeModal() {
    const modal = document.getElementById('location-modal');
    const locationInput = document.getElementById('location-input');
    const searchBtn = document.getElementById('search-location');
    const useCurrentBtn = document.getElementById('use-current-location');
    const closeBtn = document.getElementById('close-modal');
    const locationDisplay = document.querySelector('.location');

    // Open modal when clicking location
    locationDisplay.addEventListener('click', () => {
        modal.classList.remove('hidden');
        locationInput.focus();
    });

    // Close modal
    closeBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
    });

    // Close on outside click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.add('hidden');
        }
    });

    // Search location
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
            loadWeather();

        } catch (error) {
            alert('Location not found: ' + error.message);
        } finally {
            searchBtn.disabled = false;
            searchBtn.textContent = 'Search';
        }
    });

    // Enter key in input
    locationInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            searchBtn.click();
        }
    });

    // Use current location
    useCurrentBtn.addEventListener('click', async () => {
        try {
            useCurrentBtn.disabled = true;
            useCurrentBtn.textContent = 'Getting location...';

            const coords = await getCurrentLocation();

            // Reverse geocode to get location name
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
            loadWeather();

        } catch (error) {
            alert('Could not get your location: ' + error.message);
        } finally {
            useCurrentBtn.disabled = false;
            useCurrentBtn.textContent = 'Use Current Location';
        }
    });
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    updateLocationDisplay();
    initializeModal();
    loadWeather();
});
