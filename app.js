// Weather App - Precipitation Forecast Visualization
// Uses Open-Meteo API (free, no API key required)

const API_BASE = 'https://api.open-meteo.com/v1/forecast';
const GEOCODING_API = 'https://geocoding-api.open-meteo.com/v1/search';
const RAINVIEWER_API = 'https://api.rainviewer.com/public/weather-maps.json';

// Default location (Durham, NC)
let currentLocation = {
    name: 'Durham, NC',
    latitude: 35.994,
    longitude: -78.8986
};

let forecastChart = null;
let weatherData = null;
let currentShareSection = null;
let radarMap = null;
let radarLayer = null;

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

// Format temperature (returns just the number)
function formatTempValue(temp) {
    return Math.round((temp * 9/5) + 32);
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

// Render daily forecast cards - starting from today (current day)
function renderDailyForecast(data) {
    const container = document.getElementById('daily-forecast');
    container.innerHTML = '';

    const daily = data.daily;
    const today = getMidnightToday();

    // Find the index for today
    let startIdx = 0;
    for (let i = 0; i < daily.time.length; i++) {
        const dayDate = new Date(daily.time[i]);
        dayDate.setHours(0, 0, 0, 0);
        if (dayDate.getTime() >= today.getTime()) {
            startIdx = i;
            break;
        }
    }

    // Render 7 days starting from today
    for (let i = startIdx; i < daily.time.length && i < startIdx + 7; i++) {
        const date = new Date(daily.time[i]);
        const card = document.createElement('div');
        card.className = 'daily-card';

        const weatherCode = daily.weather_code[i];
        const hasSnow = daily.snowfall_sum[i] > 0;
        const hasPrecip = daily.precipitation_sum[i] > 0;
        const precipProb = daily.precipitation_probability_max[i];

        // Changed to min/max order
        const lowTemp = formatTempValue(daily.temperature_2m_min[i]);
        const highTemp = formatTempValue(daily.temperature_2m_max[i]);

        let precipClass = hasSnow ? 'snow' : '';

        card.innerHTML = `
            <div class="day-name">${getDayName(date, true)}</div>
            <div class="weather-icon">${getWeatherIcon(weatherCode)}</div>
            <div class="temp-range">${lowTemp} | ${highTemp} °F</div>
            ${precipProb > 0 ? `
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
        const hour = date.getHours();
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
            <div class="hour">${hour}</div>
            <div class="weather-icon">${getWeatherIcon(weatherCode, isNight)}</div>
            <div class="temp">${temp}°F</div>
            ${showWindchill ? `<div class="windchill">Feels ${apparentTemp}°</div>` : ''}
            <div class="wind">
                <span class="wind-icon" style="transform: rotate(${windDir}deg)">${windArrow}</span>
                ${Math.round(windSpeed)} mph
            </div>
            ${precipProb > 0 ? `
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

// Custom plugin to draw grid lines
const gridLinesPlugin = {
    id: 'customGridLines',
    beforeDraw: (chart) => {
        const ctx = chart.ctx;
        const chartArea = chart.chartArea;
        const yTempScale = chart.scales['y-temp'];
        const yPrecipScale = chart.scales['y-precip-amount'];

        if (!chartArea || !yTempScale || !yPrecipScale) return;

        ctx.save();

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
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
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

    for (let i = startIndex; i < endIndex; i++) {
        const date = new Date(hourly.time[i]);
        labels.push(date);
        temps.push((hourly.temperature_2m[i] * 9/5) + 32);
        precipProbs.push(hourly.precipitation_probability[i]);
        precipAmounts.push(hourly.precipitation[i] / 25.4);
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
                    backgroundColor: '#333',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    padding: 12,
                    displayColors: true,
                    position: 'nearest',
                    yAlign: 'bottom',
                    caretPadding: 20,
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

            // Add dark tile layer
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
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
            timeDisplay.textContent = `Radar: ${radarTime.toLocaleString('en-US', {
                hour: 'numeric',
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

// Update location display with optional current temperature
function updateLocationDisplay(currentTemp = null) {
    const locationName = document.getElementById('location-name');
    if (currentTemp !== null) {
        locationName.textContent = `${currentLocation.name}: ${currentTemp}°F`;
    } else {
        locationName.textContent = currentLocation.name;
    }
}

// Load weather for current location
async function loadWeather() {
    try {
        document.getElementById('daily-forecast').innerHTML = '<div class="loading">Loading forecast</div>';
        document.getElementById('hourly-forecast').innerHTML = '';

        weatherData = await fetchWeatherData(currentLocation.latitude, currentLocation.longitude);

        // Get current temperature from hourly data
        const now = new Date();
        let currentTemp = null;
        for (let i = 0; i < weatherData.hourly.time.length; i++) {
            const hourDate = new Date(weatherData.hourly.time[i]);
            if (hourDate >= now) {
                currentTemp = formatTempValue(weatherData.hourly.temperature_2m[i > 0 ? i - 1 : 0]);
                break;
            }
        }
        updateLocationDisplay(currentTemp);

        renderDailyForecast(weatherData);
        renderHourlyForecast(weatherData);
        renderChart(weatherData);
        checkWeatherAlerts(weatherData);
        initializeRadar();

    } catch (error) {
        console.error('Error loading weather:', error);
        document.getElementById('daily-forecast').innerHTML =
            `<div class="error">Failed to load weather data: ${error.message}</div>`;
    }
}

// Check for weather alerts
function checkWeatherAlerts(data) {
    const alertBanner = document.getElementById('alert-banner');
    const alertText = document.getElementById('alert-text');

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
        const canvas = await html2canvas(section, {
            backgroundColor: '#1a1a1a',
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

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    updateLocationDisplay();
    initializeModal();
    initializeShareModal();
    loadWeather();

    // Initialize scroll handler after weather loads
    setTimeout(initializeHourlyScrollHandler, 500);
});
