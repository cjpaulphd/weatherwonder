// Weather App - Precipitation Forecast Visualization
// Uses Open-Meteo API (free, no API key required)

const API_BASE = 'https://api.open-meteo.com/v1/forecast';
const GEOCODING_API = 'https://geocoding-api.open-meteo.com/v1/search';
const RAINVIEWER_API = 'https://api.rainviewer.com/public/weather-maps.json';
const AQI_API = 'https://air-quality-api.open-meteo.com/v1/air-quality';

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
        const obj = {
            name: location.name,
            latitude: location.latitude,
            longitude: location.longitude
        };
        if (location.timezone) obj.timezone = location.timezone;
        localStorage.setItem(LAST_LOCATION_KEY, JSON.stringify(obj));
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
let precipHistoryData = null;
let precipHistoricalAvg = null;

// Privacy-preserving usage events (GoatCounter)
// Only tracks action names, never location data, coordinates, or user info
function trackEvent(name) {
    if (window.goatcounter && window.goatcounter.count) {
        window.goatcounter.count({ path: 'event-' + name, title: name, event: true });
    }
}

// CIT2000 Easter Egg Mode
const CIT2000_KEY = 'weatherwonder_cit2000';

function isCIT2000() {
    try {
        return localStorage.getItem(CIT2000_KEY) === 'on';
    } catch (e) {
        return false;
    }
}

function setCIT2000(on) {
    try {
        localStorage.setItem(CIT2000_KEY, on ? 'on' : 'off');
    } catch (e) {}
}

function applyCIT2000(on) {
    const banner = document.getElementById('cit2000-banner');
    const seekJoy = document.getElementById('cit2000-seek-joy');
    // Section header renames for fun
    const sectionMap = {
        'daily-section': { normal: 'DAILY FORECAST', fun: 'DAILY PAHOOOOTIE FORECAST' },
        'hourly-section': { normal: 'HOURLY FORECAST', fun: 'HOURLY VIBE CHECK' },
        'radar-section': { normal: 'DOPPLER RADAR (50 mi)', fun: 'BLEEPS / SWEEPS / CREEPS' },
        'precip-history-section': { normal: 'PRECIPITATION HISTORY', fun: 'SKY JUICE HISTORY' },
        'astro-section': { normal: 'SUN & MOON', fun: 'SPACE ORBS' }
    };
    if (on) {
        document.documentElement.classList.add('cit2000-active');
        if (banner) banner.classList.remove('hidden');
        if (seekJoy) seekJoy.classList.remove('hidden');
        document.title = 'WeatherWonder CIT2000 - Pahooootie Edition';
        Object.entries(sectionMap).forEach(([id, texts]) => {
            const section = document.getElementById(id);
            if (section) {
                const h2 = section.querySelector('.section-header h2');
                if (h2) h2.textContent = texts.fun;
            }
        });
    } else {
        document.documentElement.classList.remove('cit2000-active');
        if (banner) banner.classList.add('hidden');
        if (seekJoy) seekJoy.classList.add('hidden');
        document.title = 'WeatherWonder - Precipitation Forecast';
        Object.entries(sectionMap).forEach(([id, texts]) => {
            const section = document.getElementById(id);
            if (section) {
                const h2 = section.querySelector('.section-header h2');
                if (h2) h2.textContent = texts.normal;
            }
        });
    }
    updateCIT2000ToggleUI();
    updateThemeColor(getEffectiveTheme());
}

function toggleCIT2000() {
    const on = !isCIT2000();
    setCIT2000(on);
    applyCIT2000(on);
    trackEvent('cit2000-' + (on ? 'on' : 'off'));
    if (on) {
        // Switch to Kelvin (microns) when entering CIT2000 mode
        saveTempUnit('K');
    } else if (getTempUnit() === 'K') {
        // If turning off CIT2000 and user was on Kelvin, revert to Fahrenheit
        saveTempUnit('F');
    }
    updateTempToggleUI();
    // Re-render everything with the new units
    if (weatherData) {
        renderDailyForecast(weatherData);
        renderHourlyForecast(weatherData);
        renderChart(weatherData);
        reloadLocationTemp();
        if (precipHistoryData) {
            renderPrecipHistory(precipHistoryData, precipHistoricalAvg);
        }
    }
    if (on) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function updateCIT2000ToggleUI() {
    const btn = document.getElementById('cit2000-btn');
    if (!btn) return;
    const label = btn.querySelector('.cit2000-label');
    if (label) {
        label.textContent = isCIT2000() ? 'CIT2000 On' : 'CIT2000';
    }
}

function initializeCIT2000() {
    const btn = document.getElementById('cit2000-btn');
    if (btn) {
        btn.addEventListener('click', toggleCIT2000);
    }
    // Restore state on load
    if (isCIT2000()) {
        applyCIT2000(true);
    }
    updateCIT2000ToggleUI();
}

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
    // Check if already exists (by name or coordinate proximity)
    const exists = favorites.some(f => locationsMatch(f, location));
    if (exists) {
        showToast('Already in favorites');
        return;
    }
    favorites.push({
        name: location.name,
        latitude: location.latitude,
        longitude: location.longitude
    });
    saveFavorites(favorites);
    updateFavoriteButton();
    renderFavoritesList();
}

function removeFavorite(location) {
    let favorites = getFavorites();
    favorites = favorites.filter(f => !locationsMatch(f, location));
    saveFavorites(favorites);
    updateFavoriteButton();
    renderFavoritesList();
}

// Match locations by case-insensitive name or coordinate proximity (~1.1km)
function locationsMatch(a, b) {
    if (a.name && b.name && a.name.toLowerCase() === b.name.toLowerCase()) return true;
    return Math.abs(a.latitude - b.latitude) < 0.01 &&
           Math.abs(a.longitude - b.longitude) < 0.01;
}

function isFavorite(location) {
    const favorites = getFavorites();
    return favorites.some(f => locationsMatch(f, location));
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
        <div class="favorite-item" draggable="true" data-lat="${fav.latitude}" data-lon="${fav.longitude}" data-name="${fav.name}">
            <span class="drag-handle" title="Drag to reorder">⠿</span>
            <span class="favorite-item-name">${fav.name}</span>
            <div class="favorite-item-actions">
                <button class="favorite-item-rename" data-lat="${fav.latitude}" data-lon="${fav.longitude}" title="Rename">✏️</button>
                <button class="favorite-item-remove" data-lat="${fav.latitude}" data-lon="${fav.longitude}">&times;</button>
            </div>
        </div>
    `).join('');

    // Drag-and-drop reordering
    let dragSrcIndex = null;
    const items = list.querySelectorAll('.favorite-item');

    items.forEach((item, index) => {
        item.addEventListener('dragstart', (e) => {
            dragSrcIndex = index;
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });

        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
            list.querySelectorAll('.favorite-item').forEach(i => i.classList.remove('drag-over'));
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            item.classList.add('drag-over');
        });

        item.addEventListener('dragleave', () => {
            item.classList.remove('drag-over');
        });

        item.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            item.classList.remove('drag-over');
            if (dragSrcIndex === null || dragSrcIndex === index) return;
            const favs = getFavorites();
            const [moved] = favs.splice(dragSrcIndex, 1);
            favs.splice(index, 0, moved);
            saveFavorites(favs);
            dragSrcIndex = null;
            renderFavoritesList();
        });
    });

    // Touch drag-and-drop for mobile (iOS doesn't support HTML5 drag API)
    let touchSrcIndex = null;
    let touchClone = null;
    let touchItemOffsetY = 0;

    function onTouchMove(e) {
        if (touchSrcIndex === null) return;
        e.preventDefault(); // stops page/menu scroll while dragging
        const touch = e.touches[0];
        touchClone.style.top = (touch.clientY - touchItemOffsetY) + 'px';

        // Temporarily hide clone so elementFromPoint sees what's underneath
        touchClone.style.visibility = 'hidden';
        const el = document.elementFromPoint(touch.clientX, touch.clientY);
        touchClone.style.visibility = '';

        items.forEach(i => i.classList.remove('drag-over'));
        const target = el && el.closest('.favorite-item');
        if (target && Array.from(items).includes(target)) {
            target.classList.add('drag-over');
        }
    }

    function onTouchEnd(e) {
        if (touchSrcIndex === null) return;
        const touch = e.changedTouches[0];

        // Remove clone before elementFromPoint so we see the item underneath
        if (touchClone) { touchClone.remove(); touchClone = null; }

        const el = document.elementFromPoint(touch.clientX, touch.clientY);
        const targetItem = el && el.closest('.favorite-item');
        const targetIndex = targetItem ? Array.from(items).indexOf(targetItem) : -1;

        items.forEach(i => i.classList.remove('dragging', 'drag-over'));

        const srcIdx = touchSrcIndex;
        touchSrcIndex = null;
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', onTouchEnd);

        if (targetIndex !== -1 && targetIndex !== srcIdx) {
            const favs = getFavorites();
            const [moved] = favs.splice(srcIdx, 1);
            favs.splice(targetIndex, 0, moved);
            saveFavorites(favs);
            renderFavoritesList();
        }
    }

    items.forEach((item, index) => {
        item.querySelector('.drag-handle').addEventListener('touchstart', (e) => {
            touchSrcIndex = index;
            item.classList.add('dragging');

            const touch = e.touches[0];
            const rect = item.getBoundingClientRect();
            touchItemOffsetY = touch.clientY - rect.top;

            touchClone = item.cloneNode(true);
            Object.assign(touchClone.style, {
                position: 'fixed',
                left: rect.left + 'px',
                top: rect.top + 'px',
                width: rect.width + 'px',
                opacity: '0.85',
                pointerEvents: 'none',
                zIndex: '9999',
                boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                transition: 'none'
            });
            document.body.appendChild(touchClone);

            document.addEventListener('touchmove', onTouchMove, { passive: false });
            document.addEventListener('touchend', onTouchEnd);
        }, { passive: true });
    });

    // Add click handlers
    list.querySelectorAll('.favorite-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.classList.contains('favorite-item-remove') ||
                e.target.classList.contains('favorite-item-rename') ||
                e.target.classList.contains('drag-handle')) return;

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
            const item = btn.closest('.favorite-item');
            removeFavorite({
                name: item.dataset.name,
                latitude: parseFloat(btn.dataset.lat),
                longitude: parseFloat(btn.dataset.lon)
            });
        });
    });

    // Rename handlers
    list.querySelectorAll('.favorite-item-rename').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const lat = parseFloat(btn.dataset.lat);
            const lon = parseFloat(btn.dataset.lon);
            const favorites = getFavorites();
            const fav = favorites.find(f => f.latitude === lat && f.longitude === lon);
            if (!fav) return;

            const newName = prompt('Rename location:', fav.name);
            if (newName && newName.trim()) {
                fav.name = newName.trim();
                saveFavorites(favorites);
                renderFavoritesList();

                // Update current location name if this is the active location
                if (currentLocation.latitude === lat && currentLocation.longitude === lon) {
                    currentLocation.name = newName.trim();
                    updateLocationDisplay();
                    reloadLocationTemp();
                }
            }
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
        const cit = isCIT2000();
        // Show the unit you'd switch TO
        if (unit === 'F') label.textContent = '°C';
        else if (unit === 'C') label.textContent = cit ? 'K' : '°F';
        else label.textContent = '°F'; // K → F
    }
}

function initializeTempToggle() {
    updateTempToggleUI();
    const toggle = document.getElementById('temp-toggle');
    if (toggle) {
        toggle.addEventListener('click', () => {
            const current = getTempUnit();
            const cit = isCIT2000();
            // F → C → K (only in CIT2000) → F
            const next = current === 'F' ? 'C' : (current === 'C' && cit) ? 'K' : 'F';
            saveTempUnit(next);
            trackEvent('temp-' + next);
            updateTempToggleUI();
            // Re-render weather data with new unit
            if (weatherData) {
                renderDailyForecast(weatherData);
                renderHourlyForecast(weatherData);
                renderChart(weatherData);
                // Re-update location display with current temp
                reloadLocationTemp();
                // Re-render precipitation history with new unit
                if (precipHistoryData) {
                    renderPrecipHistory(precipHistoryData, precipHistoricalAvg);
                }
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
            trackEvent('time-' + next + 'hr');
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

// Locale detection for first-time users
function extractCountry(primaryLocale, allLocales) {
    for (const loc of [primaryLocale, ...allLocales]) {
        const parts = loc.split('-');
        if (parts.length >= 2) {
            const candidate = parts[parts.length - 1].toUpperCase();
            if (candidate.length === 2) return candidate;
        }
    }
    return '';
}

function detectLocaleDefaults() {
    try {
        // Temperature unit: imperial only in US and a few small nations
        if (localStorage.getItem(TEMP_UNIT_KEY) === null) {
            const country = extractCountry(navigator.language || '', navigator.languages || []);
            const imperialCountries = ['US', 'LR', 'MM', 'FM', 'MH', 'PW'];
            localStorage.setItem(TEMP_UNIT_KEY, imperialCountries.includes(country) ? 'F' : 'C');
        }

        // Time format: use Intl hourCycle detection
        if (localStorage.getItem(TIME_FORMAT_KEY) === null) {
            let hourCycle = null;
            try {
                hourCycle = Intl.DateTimeFormat(undefined, { hour: 'numeric' })
                    .resolvedOptions().hourCycle;
            } catch (e) { /* Intl not available */ }
            localStorage.setItem(TIME_FORMAT_KEY,
                (hourCycle === 'h23' || hourCycle === 'h24') ? '24' : '12');
        }
    } catch (e) {
        // localStorage unavailable; getters will use hardcoded defaults
    }
}

// Helper to re-update location display temperature after unit change
function reloadLocationTemp() {
    if (!weatherData) return;
    const now = getLocationNow();
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
    renderConditionsBar();
}

// Format a time according to user's 12/24 preference.
// Pass tz (IANA timezone string) to format a UTC-correct Date in a specific timezone
// (e.g. SunCalc results, radar timestamps). Omit tz for Open-Meteo times that are
// already parsed as browser-local with the correct hour digits.
function formatTime(date, tz) {
    const opts = { hour: '2-digit', minute: '2-digit' };
    if (tz) opts.timeZone = tz;
    if (getTimeFormat() === '24') {
        return date.toLocaleTimeString('en-GB', opts);
    }
    opts.hour = 'numeric';
    return date.toLocaleTimeString('en-US', opts);
}

// Format just the hour according to user's 12/24 preference.
// Pass tz for UTC-correct dates that need timezone conversion.
function formatHour(date, tz) {
    let h;
    if (tz) {
        h = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false }).format(date), 10);
        if (h === 24) h = 0;
    } else {
        h = date.getHours();
    }
    if (getTimeFormat() === '24') {
        return h.toString().padStart(2, '0');
    }
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
    if (!meta) return;
    const cit = document.documentElement.classList.contains('cit2000-active');
    if (cit) {
        meta.setAttribute('content', theme === 'light' ? '#f0e0ff' : '#1a0a2e');
    } else {
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
            trackEvent('theme-' + next);
            applyTheme(next);
            // Re-render chart with correct theme colors
            if (weatherData) {
                renderChart(weatherData);
            }
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

// CIT2000 silly weather descriptions
const cit2000Descs = {
    0: 'Aggressive sunshine',
    1: 'Suspiciously clear',
    2: 'Clouds plotting something',
    3: 'Sky fully loaded',
    45: 'Ghost weather',
    48: 'Extra spooky ghost weather',
    51: 'Sky is misting you',
    53: 'Medium sky juice',
    55: 'Maximum sky juice',
    61: 'Rain (water edition)',
    63: 'Serious rain business',
    65: 'Sky waterfall activated',
    71: 'Frozen confetti',
    73: 'Frozen confetti deluxe',
    75: 'Snow apocalypse',
    77: 'Tiny ice pellet party',
    80: 'Surprise water attack',
    81: 'Rain ambush',
    82: 'Rain boss fight',
    85: 'Snow surprise',
    86: 'Snow boss fight',
    95: 'Zeus is angry',
    96: 'Zeus throwing ice cubes',
    99: 'Zeus rage mode'
};

function getWeatherDesc(code) {
    if (isCIT2000() && cit2000Descs[code]) return cit2000Descs[code];
    const weather = weatherCodes[code] || { icon: '❓', desc: 'Unknown' };
    return weather.desc;
}

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

// Map a snow weather code to its nearest rain equivalent.
// Used when temperature is above freezing but Open-Meteo still returns a snow code.
const SNOW_TO_RAIN = { 71: 61, 73: 63, 75: 65, 77: 51, 85: 80, 86: 82 };

// Return the weather code to use for icon display, substituting a rain code when
// the weather code indicates snow but the temperature is above 2°C (35.6°F).
function tempGuardedCode(code, tempCelsius) {
    if (isSnow(code) && tempCelsius !== null && tempCelsius > 2) {
        return SNOW_TO_RAIN[code] ?? 63;
    }
    return code;
}

// Format temperature (returns just the number in current unit)
function formatTempValue(temp) {
    const unit = getTempUnit();
    if (unit === 'K') return Math.round(temp + 273.15);
    if (unit === 'C') return Math.round(temp);
    return Math.round((temp * 9/5) + 32);
}

// Get temperature unit label
function getTempUnitLabel() {
    const unit = getTempUnit();
    if (unit === 'K') return ' K';
    return unit === 'C' ? '°C' : '°F';
}

// Format precipitation amount (mm in metric, inches in imperial, microns in Kelvin mode)
function formatPrecip(mm) {
    const unit = getTempUnit();
    if (unit === 'K') {
        const microns = mm * 1000;
        if (microns < 100) return '';
        return `${Math.round(microns).toLocaleString()} µm`;
    }
    if (unit === 'C') {
        if (mm < 0.1) return '';
        return `${mm.toFixed(1)} mm`;
    }
    const inches = mm / 25.4;
    if (inches < 0.01) return '';
    return `${inches.toFixed(2)}"`;
}

// Convert wind direction degrees to compass abbreviation
function getWindDirection(deg) {
    const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return dirs[Math.round(deg / 22.5) % 16];
}

// Format wind speed in current unit (API returns mph; convert to km/h in metric mode, µm/s in Kelvin mode)
function formatWindSpeed(mph) {
    const unit = getTempUnit();
    if (unit === 'K') {
        // 1 mph = 447,040 µm/s
        const microns = Math.round(mph * 447040);
        return `${microns.toLocaleString()} µm/s`;
    }
    if (unit === 'C') {
        return `${Math.round(mph * 1.60934)} km/h`;
    }
    return `${Math.round(mph)} mph`;
}

// Get day name
function getDayName(date, short = false) {
    const today = getLocationNow();
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

// Get midnight of current day in the location's timezone.
// Returns a "fake-local" Date whose local components match the location's wall-clock.
// This is used for comparing against Open-Meteo time strings that are parsed as browser-local.
function getMidnightToday() {
    const now = getLocationNow();
    now.setHours(0, 0, 0, 0);
    return now;
}

// Get a Date whose local components (getHours, getDate, etc.) reflect the current
// wall-clock time in the viewed location's timezone. This allows correct comparison
// with Open-Meteo time strings, which are parsed by new Date() as browser-local but
// actually represent the location's local time.
function getLocationNow() {
    const tz = currentLocation.timezone;
    if (!tz) return new Date();
    const parts = {};
    new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    }).formatToParts(new Date()).forEach(p => { parts[p.type] = parseInt(p.value, 10); });
    return new Date(parts.year, parts.month - 1, parts.day, parts.hour === 24 ? 0 : parts.hour, parts.minute, parts.second);
}

// Get the IANA timezone string for the current location, or undefined
function getLocationTimezone() {
    return currentLocation.timezone;
}

// Fetch weather data from Open-Meteo API
async function fetchWeatherData(lat, lon) {
    const params = new URLSearchParams({
        latitude: lat,
        longitude: lon,
        hourly: [
            'temperature_2m',
            'apparent_temperature',
            'relative_humidity_2m',
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
            'weather_code',
            'wind_speed_10m_max',
            'wind_direction_10m_dominant'
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

// Fetch current AQI from Open-Meteo Air Quality API
async function fetchAQI(lat, lon) {
    const params = new URLSearchParams({
        latitude: lat,
        longitude: lon,
        current: 'us_aqi'
    });
    const response = await fetch(`${AQI_API}?${params}`);
    if (!response.ok) throw new Error('Failed to fetch AQI');
    const data = await response.json();
    return data.current.us_aqi;
}

// Get EPA color for AQI value
function getAQIColor(aqi) {
    if (aqi <= 50) return '#00e400';
    if (aqi <= 100) return '#e6d700';
    if (aqi <= 150) return '#ff7e00';
    if (aqi <= 200) return '#ff0000';
    if (aqi <= 300) return '#8f3f97';
    return '#cc00cc';
}

// Get color for humidity level
function getHumidityColor(humidity) {
    if (humidity <= 30) return '#ff9800';   // Dry - orange
    if (humidity <= 60) return '#00e400';   // Comfortable - green
    if (humidity <= 80) return '#e6d700';   // Humid - yellow
    return '#4fc3f7';                       // Very humid - blue
}

// Get color for wind speed (mph)
function getWindColor(mph) {
    if (mph <= 5) return 'var(--text-secondary)';  // Calm - muted
    if (mph <= 15) return '#00e400';                // Light - green
    if (mph <= 25) return '#e6d700';                // Moderate - yellow
    if (mph <= 40) return '#ff7e00';                // Strong - orange
    return '#ff0000';                               // Severe - red
}

// Store current conditions for re-rendering on unit change
let currentConditions = { aqi: null, humidity: null, windSpeed: null, windDir: null };

// Render conditions bar (AQI, humidity, wind) on a single compact line
function renderConditionsBar() {
    const el = document.getElementById('conditions-bar');
    if (!el) return;

    const { aqi, humidity, windSpeed, windDir } = currentConditions;
    const parts = [];

    if (aqi != null) {
        const color = getAQIColor(aqi);
        parts.push(`<span style="color:${color}">AQI ${Math.round(aqi)}</span>`);
    }

    if (humidity != null) {
        const color = getHumidityColor(humidity);
        parts.push(`<span style="color:${color}">${Math.round(humidity)}% RH</span>`);
    }

    if (windSpeed != null && windDir != null) {
        const color = getWindColor(windSpeed);
        const dir = getWindDirection(windDir);
        const arrow = String.fromCharCode(8593); // ↑
        const rotation = windDir + 180; // Point arrow in direction wind is going
        parts.push(`<span style="color:${color}"><span class="cond-wind-icon" style="display:inline-block;transform:rotate(${rotation}deg)">${arrow}</span> ${dir} ${formatWindSpeed(windSpeed)}</span>`);
    }

    if (parts.length === 0) {
        el.innerHTML = '';
        return;
    }

    el.innerHTML = parts.join('<span class="cond-sep">&middot;</span>');
}

// US state abbreviation lookup for "city, state" search parsing
const US_STATE_ABBREVS = {
    'al': 'alabama', 'ak': 'alaska', 'az': 'arizona', 'ar': 'arkansas',
    'ca': 'california', 'co': 'colorado', 'ct': 'connecticut', 'de': 'delaware',
    'fl': 'florida', 'ga': 'georgia', 'hi': 'hawaii', 'id': 'idaho',
    'il': 'illinois', 'in': 'indiana', 'ia': 'iowa', 'ks': 'kansas',
    'ky': 'kentucky', 'la': 'louisiana', 'me': 'maine', 'md': 'maryland',
    'ma': 'massachusetts', 'mi': 'michigan', 'mn': 'minnesota', 'ms': 'mississippi',
    'mo': 'missouri', 'mt': 'montana', 'ne': 'nebraska', 'nv': 'nevada',
    'nh': 'new hampshire', 'nj': 'new jersey', 'nm': 'new mexico', 'ny': 'new york',
    'nc': 'north carolina', 'nd': 'north dakota', 'oh': 'ohio', 'ok': 'oklahoma',
    'or': 'oregon', 'pa': 'pennsylvania', 'ri': 'rhode island', 'sc': 'south carolina',
    'sd': 'south dakota', 'tn': 'tennessee', 'tx': 'texas', 'ut': 'utah',
    'vt': 'vermont', 'va': 'virginia', 'wa': 'washington', 'wv': 'west virginia',
    'wi': 'wisconsin', 'wy': 'wyoming', 'dc': 'district of columbia'
};

// Geocode location name (supports city names, "city, state", and zip codes)
async function geocodeLocation(query) {
    const trimmed = query.trim();
    const isZip = /^\d{5}(-\d{4})?$/.test(trimmed);

    if (!isZip) {
        // Parse "city, state" or "city, country" patterns
        let searchName = trimmed;
        let regionFilter = null;

        const commaMatch = trimmed.match(/^(.+?),\s*(.+)$/);
        if (commaMatch) {
            searchName = commaMatch[1].trim();
            regionFilter = commaMatch[2].trim().toLowerCase();
        }

        const params = new URLSearchParams({
            name: searchName,
            count: 10,
            language: 'en',
            format: 'json'
        });

        const response = await fetch(`${GEOCODING_API}?${params}`);
        if (!response.ok) throw new Error('Failed to geocode location');
        const data = await response.json();

        if (data.results && data.results.length > 0) {
            let results = data.results;

            // If the user provided a state/region filter, narrow results
            if (regionFilter) {
                const expandedFilter = US_STATE_ABBREVS[regionFilter] || regionFilter;
                const filtered = results.filter(r => {
                    const admin1 = (r.admin1 || '').toLowerCase();
                    const country = (r.country || '').toLowerCase();
                    const countryCode = (r.country_code || '').toLowerCase();
                    return admin1 === expandedFilter
                        || admin1.startsWith(expandedFilter)
                        || country.startsWith(expandedFilter)
                        || countryCode === regionFilter;
                });
                if (filtered.length > 0) {
                    results = filtered;
                }
            }

            return results;
        }
    }

    // For zip codes or when Open-Meteo returns no results, try Nominatim
    // US ZIP codes get countrycodes=us to avoid false matches from other countries
    const nomParams = new URLSearchParams({ q: trimmed, format: 'json', limit: 5, addressdetails: 1 });
    if (isZip) nomParams.set('countrycodes', 'us');
    const nomResponse = await fetch(
        `https://nominatim.openstreetmap.org/search?${nomParams}`,
        { headers: { 'User-Agent': 'WeatherWonder (cjpaulphd)' } }
    );
    if (!nomResponse.ok) throw new Error('Failed to geocode location');
    const nomData = await nomResponse.json();

    if (!nomData || nomData.length === 0) {
        throw new Error('Location not found');
    }

    return nomData.map(r => ({
        name: r.address ? (r.address.city || r.address.town || r.address.village || r.address.hamlet || r.display_name.split(',')[0]) : r.display_name.split(',')[0],
        admin1: r.address ? (r.address.state || '') : '',
        admin2: r.address ? (r.address.county || '') : '',
        country: r.address ? (r.address.country || '') : '',
        latitude: parseFloat(r.lat),
        longitude: parseFloat(r.lon)
    }));
}

// Select a geocoded location and load its weather
function selectLocation(result) {
    trackEvent('location-search');
    currentLocation = {
        name: `${result.name}${result.admin1 ? ', ' + result.admin1 : ''}`,
        latitude: result.latitude,
        longitude: result.longitude
    };
    updateLocationDisplay();

    if (radarMap) {
        radarMap.remove();
        radarMap = null;
        radarLayer = null;
    }

    loadWeather();
}

// Show disambiguation list for multiple geocoding results
function showDisambiguation(results) {
    const container = document.getElementById('disambiguation-results');
    container.innerHTML = '<p class="disambiguation-title">Multiple locations found:</p>';

    results.forEach(result => {
        const alreadyFav = isFavorite(result);
        const item = document.createElement('div');
        item.className = 'disambiguation-item' + (alreadyFav ? ' is-favorite' : '');

        let label = result.name;
        if (result.admin1) label += `, ${result.admin1}`;
        if (result.country) label += `, ${result.country}`;

        item.innerHTML = `<span>${label}</span>${alreadyFav ? '<span class="disambiguation-fav-star" title="Already in favorites">★</span>' : ''}`;
        item.addEventListener('click', () => {
            selectLocation(result);
            document.getElementById('location-modal').classList.add('hidden');
            clearDisambiguation();
        });

        container.appendChild(item);
    });

    container.classList.remove('hidden');
}

// Clear disambiguation results
function clearDisambiguation() {
    const container = document.getElementById('disambiguation-results');
    if (container) {
        container.classList.add('hidden');
        container.innerHTML = '';
    }
}

// Get AM/PM weather codes (and temperatures) from hourly data for a specific date
function getAmPmWeatherCodes(data, targetDate) {
    const hourly = data.hourly;
    const targetDay = new Date(targetDate);
    targetDay.setHours(0, 0, 0, 0);

    let amCode = null;
    let pmCode = null;
    let amTemp = null;
    let pmTemp = null;

    for (let i = 0; i < hourly.time.length; i++) {
        const hourDate = new Date(hourly.time[i]);
        const hourDay = new Date(hourDate);
        hourDay.setHours(0, 0, 0, 0);

        if (hourDay.getTime() === targetDay.getTime()) {
            const hour = hourDate.getHours();
            // AM: around 9-10 AM
            if (hour === 9 || hour === 10) {
                amCode = hourly.weather_code[i];
                amTemp = hourly.temperature_2m[i];
            }
            // PM: around 5-6 PM
            if (hour === 17 || hour === 18) {
                pmCode = hourly.weather_code[i];
                pmTemp = hourly.temperature_2m[i];
            }
        }
    }

    return { amCode, pmCode, amTemp, pmTemp };
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
        const hasSnow = daily.snowfall_sum[i] >= 1; // at least 1 cm to be called a snow day
        const hasPrecip = daily.precipitation_sum[i] > 0;
        const precipProb = daily.precipitation_probability_max[i];
        const windSpeed = daily.wind_speed_10m_max[i];
        const windDir = daily.wind_direction_10m_dominant[i];

        // Get AM/PM weather codes from hourly data
        const { amCode, pmCode, amTemp, pmTemp } = getAmPmWeatherCodes(data, date);

        // Changed to min/max order
        const lowTemp = formatTempValue(daily.temperature_2m_min[i]);
        const highTemp = formatTempValue(daily.temperature_2m_max[i]);

        let precipClass = hasSnow ? 'snow' : '';

        // Use AM/PM icons if available, otherwise fall back to daily icon.
        // Guard snow codes against the actual temperature at that hour: if it's
        // above 2°C (35.6°F), substitute the nearest rain equivalent so that a
        // brief overnight snow transition doesn't show a snowflake on a warm day.
        const rawAmCode = amCode !== null ? amCode : dailyWeatherCode;
        const rawPmCode = pmCode !== null ? pmCode : dailyWeatherCode;
        const guardedAmCode = tempGuardedCode(rawAmCode, amTemp ?? daily.temperature_2m_min[i]);
        const guardedPmCode = tempGuardedCode(rawPmCode, pmTemp ?? daily.temperature_2m_max[i]);
        const amIcon = getWeatherIcon(guardedAmCode);
        const pmIcon = getWeatherIcon(guardedPmCode, true);

        const kClass = getTempUnit() === 'K' ? ' kelvin-units' : '';
        card.innerHTML = `
            <div class="day-name">${getDayName(date, true)}</div>
            <div class="weather-icons">
                <div class="am-icon" title="Morning">${amIcon}</div>
                <div class="pm-icon" title="Evening">${pmIcon}</div>
            </div>
            <div class="temp-range">${lowTemp} | ${highTemp} ${getTempUnitLabel()}</div>
            <div class="wind-info${kClass}">${getWindDirection(windDir)} ${formatWindSpeed(windSpeed)}</div>
            ${precipProb >= 10 ? `
                <div class="precip-info ${precipClass}">
                    ${hasSnow ? '❄' : '💧'} ${precipProb}%
                </div>
            ` : ''}
            ${hasPrecip ? `
                <div class="precip-amount${kClass}">${formatPrecip(daily.precipitation_sum[i])}</div>
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
    const now = getLocationNow();

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

        let precipClass = hasSnow ? 'snow' : '';

        // Show windchill if it differs from actual temp by more than 2 degrees
        const showWindchill = Math.abs(temp - apparentTemp) > 2;

        const feelsLabel = isCIT2000() ? 'Vibes' : 'Feels';
        const hkClass = getTempUnit() === 'K' ? ' kelvin-units' : '';
        card.innerHTML = `
            ${dayLabel}
            <div class="hour">${formatHour(date)}</div>
            <div class="weather-icon">${getWeatherIcon(weatherCode, isNight)}</div>
            <div class="temp">${temp}${getTempUnitLabel()}</div>
            ${showWindchill ? `<div class="windchill">${feelsLabel} ${apparentTemp}${getTempUnitLabel()}</div>` : ''}
            <div class="wind${hkClass}">
                ${getWindDirection(windDir)} ${formatWindSpeed(windSpeed)}
            </div>
            ${precipProb >= 10 ? `
                <div class="precip-chance ${precipClass}">
                    ${hasSnow ? '❄' : '💧'} ${precipProb}%
                </div>
            ` : ''}
            ${precip > 0 ? `
                <div class="precip-amount${hkClass}">${formatPrecip(precip)}</div>
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
            const isCit = document.documentElement.classList.contains('cit2000-active');
            let dayColor, nightColor;
            if (isCit && !isLight) {
                dayColor = 'rgba(255, 255, 255, 0.04)';
                nightColor = 'rgba(0, 0, 0, 0.2)';
            } else if (isCit && isLight) {
                dayColor = 'rgba(255, 255, 255, 0.3)';
                nightColor = 'rgba(128, 0, 128, 0.08)';
            } else if (isLight) {
                dayColor = 'rgba(255, 255, 255, 0.4)';
                nightColor = 'rgba(0, 0, 0, 0.08)';
            } else {
                dayColor = 'rgba(255, 255, 255, 0.06)';
                nightColor = 'rgba(0, 0, 0, 0.15)';
            }

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

        // Get dynamic theme-aware grid colors
        const gridColors = getChartColors();

        // Draw temperature grid lines (every 10°F) - pink/red color
        const tempMin = Math.floor(yTempScale.min / 10) * 10;
        const tempMax = Math.ceil(yTempScale.max / 10) * 10;

        ctx.strokeStyle = gridColors.tempGridLine;
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
                ctx.fillStyle = gridColors.tempGridLabel;
                ctx.font = '9px sans-serif';
                ctx.textAlign = 'left';
                const tLabel = getTempUnit() === 'K' ? `${temp}K` : `${temp}°`;
                ctx.fillText(tLabel, chartArea.left + 2, y - 2);
            }
        }

        // Draw precipitation amount grid lines (every 0.10") - green color
        const precipMax = Math.ceil(yPrecipScale.max * 10) / 10;

        ctx.strokeStyle = gridColors.precipGridLine;
        ctx.setLineDash([3, 3]);

        for (let precip = 0.1; precip <= precipMax; precip += 0.1) {
            const y = yPrecipScale.getPixelForValue(precip);
            if (y >= chartArea.top && y <= chartArea.bottom) {
                ctx.beginPath();
                ctx.moveTo(chartArea.left, y);
                ctx.lineTo(chartArea.right, y);
                ctx.stroke();

                // Draw precip label on right
                ctx.fillStyle = gridColors.precipGridLabel;
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

// Get theme-aware chart colors (adapts to dark/light/CIT2000 modes)
function getChartColors() {
    const styles = getComputedStyle(document.documentElement);
    const tempRed = styles.getPropertyValue('--temp-red').trim();
    const precipBlue = styles.getPropertyValue('--precip-blue').trim();
    const precipGreen = styles.getPropertyValue('--precip-green').trim();

    // Parse hex color to rgba with alpha
    function hexToRgba(hex, alpha) {
        // Handle both #rgb and #rrggbb and named-style from CSS vars
        let r, g, b;
        hex = hex.replace('#', '');
        if (hex.length === 3) {
            r = parseInt(hex[0] + hex[0], 16);
            g = parseInt(hex[1] + hex[1], 16);
            b = parseInt(hex[2] + hex[2], 16);
        } else {
            r = parseInt(hex.substring(0, 2), 16);
            g = parseInt(hex.substring(2, 4), 16);
            b = parseInt(hex.substring(4, 6), 16);
        }
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    return {
        tempBorder: tempRed,
        precipProbBorder: precipBlue,
        precipProbBg: hexToRgba(precipBlue, 0.1),
        precipAmountBorder: precipGreen,
        precipAmountBg: hexToRgba(precipGreen, 0.3),
        tempGridLine: hexToRgba(tempRed, 0.3),
        tempGridLabel: hexToRgba(tempRed, 0.7),
        precipGridLine: hexToRgba(precipGreen, 0.3),
        precipGridLabel: hexToRgba(precipGreen, 0.7)
    };
}

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
        const tu = getTempUnit();
        temps.push(tu === 'K' ? hourly.temperature_2m[i] + 273.15 : (tu === 'C' ? hourly.temperature_2m[i] : (hourly.temperature_2m[i] * 9/5) + 32));
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

    const colors = getChartColors();

    forecastChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            isDayFlags: isDayFlags,
            datasets: [
                {
                    label: 'Temperature',
                    data: temps,
                    borderColor: colors.tempBorder,
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
                    borderColor: colors.precipProbBorder,
                    backgroundColor: colors.precipProbBg,
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
                    borderColor: colors.precipAmountBorder,
                    backgroundColor: colors.precipAmountBg,
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

            // Update time display — show in location's timezone
            const radarTime = new Date(latestFrame.time * 1000);
            const use24 = getTimeFormat() === '24';
            const radarOpts = {
                hour: use24 ? '2-digit' : 'numeric',
                minute: '2-digit',
                month: 'short',
                day: 'numeric'
            };
            const tz = getLocationTimezone();
            if (tz) radarOpts.timeZone = tz;
            timeDisplay.textContent = `Radar: ${radarTime.toLocaleString(use24 ? 'en-GB' : 'en-US', radarOpts)}`;
        }

    } catch (error) {
        console.error('Error loading radar:', error);
        mapContainer.innerHTML = '<div class="radar-loading">Radar unavailable</div>';
    }
}

// Format time for astronomical display — always in the location's timezone
function formatAstroTime(date) {
    if (!date || isNaN(date.getTime())) return '—';
    return formatTime(date, getLocationTimezone());
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

    // Use a Date that represents "today noon" in the location's timezone so SunCalc
    // calculates for the correct calendar date even when the browser is in a different day.
    const locationNow = getLocationNow();
    const utcNow = new Date(Date.UTC(locationNow.getFullYear(), locationNow.getMonth(), locationNow.getDate(), 12, 0, 0));
    const lat = currentLocation.latitude;
    const lng = currentLocation.longitude;

    // Get sun times
    const sunTimes = SunCalc.getTimes(utcNow, lat, lng);

    // Get moon times
    const moonTimes = SunCalc.getMoonTimes(utcNow, lat, lng);

    // Get moon illumination
    const moonIllum = SunCalc.getMoonIllumination(utcNow);
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
        const yesterday = new Date(utcNow);
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

// Fetch precipitation history from Open-Meteo (past 92 days)
async function fetchPrecipHistory(lat, lon) {
    const params = new URLSearchParams({
        latitude: lat,
        longitude: lon,
        hourly: 'precipitation',
        past_days: 92,
        forecast_days: 1,
        timezone: 'auto'
    });

    const response = await fetch(`${API_BASE}?${params}`);
    if (!response.ok) throw new Error('Failed to fetch precipitation history');
    return response.json();
}

// Fetch historical precipitation averages from Open-Meteo Archive API
// Returns 10-year average precipitation for the same 30-day and 90-day calendar windows
async function fetchHistoricalPrecipAvg(lat, lon) {
    const now = new Date();
    const endYear = now.getFullYear() - 1; // most recent full year with reliable archive data
    const startYear = endYear - 9; // 10 years of data

    // Define the calendar window: 90 days back from today's month/day
    // Use the 3-month window (which contains the 1-month window)
    const threeMonthsAgo = new Date(now);
    threeMonthsAgo.setDate(threeMonthsAgo.getDate() - 90);
    const oneMonthAgo = new Date(now);
    oneMonthAgo.setDate(oneMonthAgo.getDate() - 30);

    const fmt = d => d.toISOString().split('T')[0];

    // Build start/end for the full 10-year span
    const archiveStart = new Date(startYear, threeMonthsAgo.getMonth(), threeMonthsAgo.getDate());
    const archiveEnd = new Date(endYear, now.getMonth(), now.getDate());

    const params = new URLSearchParams({
        latitude: lat,
        longitude: lon,
        daily: 'precipitation_sum',
        start_date: fmt(archiveStart),
        end_date: fmt(archiveEnd),
        timezone: 'auto'
    });

    const response = await fetch(`https://archive-api.open-meteo.com/v1/archive?${params}`);
    if (!response.ok) throw new Error('Failed to fetch historical precipitation');
    const data = await response.json();

    const daily = data.daily;
    const oneMonthTotals = [];
    const threeMonthTotals = [];

    // For each year, sum precipitation in the matching calendar windows
    for (let year = startYear; year <= endYear; year++) {
        const yearEnd = new Date(year, now.getMonth(), now.getDate());
        const yearOneMonthStart = new Date(yearEnd);
        yearOneMonthStart.setDate(yearOneMonthStart.getDate() - 30);
        const yearThreeMonthStart = new Date(yearEnd);
        yearThreeMonthStart.setDate(yearThreeMonthStart.getDate() - 90);

        let oneMonthSum = 0;
        let threeMonthSum = 0;

        for (let i = 0; i < daily.time.length; i++) {
            const d = new Date(daily.time[i] + 'T00:00:00');
            if (d >= yearThreeMonthStart && d <= yearEnd) {
                threeMonthSum += daily.precipitation_sum[i] || 0;
                if (d >= yearOneMonthStart) {
                    oneMonthSum += daily.precipitation_sum[i] || 0;
                }
            }
        }

        oneMonthTotals.push(oneMonthSum);
        threeMonthTotals.push(threeMonthSum);
    }

    const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;

    return {
        oneMonthAvg: avg(oneMonthTotals),   // in mm
        threeMonthAvg: avg(threeMonthTotals) // in mm
    };
}

// Render precipitation history for past 24/48/72/168 hours
function renderPrecipHistory(data, histAvg) {
    const container = document.getElementById('precip-history');
    if (!container) return;

    const hourly = data.hourly;
    const now = getLocationNow();
    const tempUnit = getTempUnit();
    const isMetric = tempUnit === 'C';
    const isKelvin = tempUnit === 'K';

    const periods = [
        { label: '24 Hours', hours: 24 },
        { label: '48 Hours', hours: 48 },
        { label: '72 Hours', hours: 72 },
        { label: '7 Days', hours: 168 },
        { label: '1 Month', hours: 720, avgKey: 'oneMonthAvg' },
        { label: '3 Months', hours: 2160, avgKey: 'threeMonthAvg' }
    ];

    // Find the last hour that's <= now (in the location's timezone)
    let nowIndex = 0;
    for (let i = 0; i < hourly.time.length; i++) {
        const t = new Date(hourly.time[i]);
        if (t <= now) {
            nowIndex = i;
        } else {
            break;
        }
    }

    const results = periods.map(period => {
        let sum = 0;
        const startIndex = Math.max(0, nowIndex - period.hours + 1);
        for (let i = startIndex; i <= nowIndex; i++) {
            sum += hourly.precipitation[i] || 0;
        }

        let formatted;
        if (isKelvin) {
            const microns = sum * 1000;
            formatted = `${Math.round(microns).toLocaleString()} µm`;
        } else if (isMetric) {
            formatted = `${sum.toFixed(1)} mm`;
        } else {
            const inches = sum / 25.4;
            formatted = `${inches.toFixed(2)}"`;
        }

        // Build historical average comparison HTML for 1 Month and 3 Months
        let avgHtml = '';
        if (period.avgKey && histAvg && histAvg[period.avgKey] != null) {
            const avgMm = histAvg[period.avgKey];
            let avgFormatted;
            if (isKelvin) {
                avgFormatted = `${Math.round(avgMm * 1000).toLocaleString()} µm`;
            } else if (isMetric) {
                avgFormatted = `${avgMm.toFixed(1)} mm`;
            } else {
                avgFormatted = `${(avgMm / 25.4).toFixed(2)}"`;
            }

            let diffHtml = '';
            if (avgMm > 0) {
                const pctDiff = ((sum - avgMm) / avgMm) * 100;
                const absPct = Math.abs(Math.round(pctDiff));
                if (pctDiff >= 5) {
                    diffHtml = `<div class="precip-history-diff precip-above">+${absPct}% above</div>`;
                } else if (pctDiff <= -5) {
                    diffHtml = `<div class="precip-history-diff precip-below">&minus;${absPct}% below</div>`;
                } else {
                    diffHtml = `<div class="precip-history-diff precip-near">Near avg</div>`;
                }
            }

            avgHtml = `<div class="precip-history-avg${isKelvin ? ' kelvin-units' : ''}">vs. ${avgFormatted} 10-yr avg</div>${diffHtml}`;
        }

        return { label: period.label, value: formatted, avgHtml };
    });

    const pkClass = isKelvin ? ' kelvin-units' : '';
    container.innerHTML = `
        <div class="precip-history-grid">
            ${results.map(r => `
                <div class="precip-history-item">
                    <div class="precip-history-label">${r.label}</div>
                    <div class="precip-history-value${pkClass}">${r.value}</div>
                    ${r.avgHtml}
                </div>
            `).join('')}
        </div>
    `;
}

// Update location display with optional current temperature and feels-like
function updateLocationDisplay(currentTemp = null, feelsLike = null) {
    const locationName = document.getElementById('location-name');
    if (currentTemp !== null) {
        let display = `${currentLocation.name}: ${currentTemp}${getTempUnitLabel()}`;
        if (feelsLike !== null && Math.abs(currentTemp - feelsLike) > 2) {
            const feelsWord = isCIT2000() ? 'vibes' : 'feels';
            display += ` (${feelsWord} ${feelsLike}${getTempUnitLabel()})`;
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
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) refreshBtn.classList.add('spinning');
    try {
        // Save as last used location
        saveLastLocation(currentLocation);

        document.getElementById('daily-forecast').innerHTML = '<div class="loading">Loading forecast</div>';
        document.getElementById('hourly-forecast').innerHTML = '';

        weatherData = await fetchWeatherData(currentLocation.latitude, currentLocation.longitude);

        // Store the location's IANA timezone from the API response (e.g. "Pacific/Auckland")
        if (weatherData.timezone) {
            currentLocation.timezone = weatherData.timezone;
        }

        // Get current temperature, feels-like, humidity, and wind from hourly data
        const now = getLocationNow();
        let currentTemp = null;
        let feelsLike = null;
        for (let i = 0; i < weatherData.hourly.time.length; i++) {
            const hourDate = new Date(weatherData.hourly.time[i]);
            if (hourDate >= now) {
                const idx = i > 0 ? i - 1 : 0;
                currentTemp = formatTempValue(weatherData.hourly.temperature_2m[idx]);
                feelsLike = formatTempValue(weatherData.hourly.apparent_temperature[idx]);
                currentConditions.humidity = weatherData.hourly.relative_humidity_2m[idx];
                currentConditions.windSpeed = weatherData.hourly.wind_speed_10m[idx];
                currentConditions.windDir = weatherData.hourly.wind_direction_10m[idx];
                break;
            }
        }
        updateLocationDisplay(currentTemp, feelsLike);

        // Fetch AQI (non-blocking), then render full conditions bar
        fetchAQI(currentLocation.latitude, currentLocation.longitude)
            .then(aqi => { currentConditions.aqi = aqi; renderConditionsBar(); })
            .catch(() => { currentConditions.aqi = null; renderConditionsBar(); });

        // Render conditions bar immediately with humidity/wind (AQI will update when ready)
        renderConditionsBar();

        renderDailyForecast(weatherData);
        renderHourlyForecast(weatherData);
        renderChart(weatherData);
        checkWeatherAlerts(weatherData);
        initializeRadar();
        renderAstroData();

        // Fetch and render precipitation history + historical averages
        Promise.all([
            fetchPrecipHistory(currentLocation.latitude, currentLocation.longitude),
            fetchHistoricalPrecipAvg(currentLocation.latitude, currentLocation.longitude).catch(() => null)
        ])
            .then(([data, histAvg]) => {
                precipHistoryData = data;
                precipHistoricalAvg = histAvg;
                renderPrecipHistory(data, histAvg);
            })
            .catch(err => {
                console.error('Error loading precipitation history:', err);
                const container = document.getElementById('precip-history');
                if (container) container.innerHTML = '<div class="error">Precipitation history unavailable</div>';
            });

        // Update last-updated timestamp
        const lastUpdated = document.getElementById('last-updated');
        if (lastUpdated) {
            const now2 = new Date();
            lastUpdated.dataset.timestamp = now2.toISOString();
            lastUpdated.textContent = `Updated ${formatTime(now2)}`;
        }

        trackEvent('weather-loaded');

    } catch (error) {
        console.error('Error loading weather:', error);
        document.getElementById('daily-forecast').innerHTML =
            `<div class="error">Failed to load weather data: ${error.message}</div>`;
    } finally {
        if (refreshBtn) refreshBtn.classList.remove('spinning');
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
    const tz = getLocationTimezone();
    if (tz) alertTimeOpts.timeZone = tz;
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
        trackEvent('share-screenshot');
        shareModal.classList.add('hidden');
        await takeScreenshot(currentShareSection);
    });

    // Copy link button
    shareLinkBtn.addEventListener('click', () => {
        trackEvent('share-link');
        copyLink();
        shareModal.classList.add('hidden');
    });

    // Share both screenshot and link
    shareBothBtn.addEventListener('click', async () => {
        trackEvent('share-both');
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
        trackEvent('share-native');
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
        clearDisambiguation();
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
            clearDisambiguation();

            const results = await geocodeLocation(query);

            if (results.length === 1) {
                selectLocation(results[0]);
                modal.classList.add('hidden');
            } else {
                showDisambiguation(results);
            }

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

            trackEvent('gps-location');
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
        clearDisambiguation();
        document.getElementById('location-modal').classList.remove('hidden');
        document.getElementById('location-input').focus();
    });

    // Toggle favorite
    favoriteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isFavorite(currentLocation)) {
            removeFavorite(currentLocation);
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

    // On iOS, show the button and open the step-by-step instruction modal
    if (isIOS()) {
        btn.classList.remove('hidden');
        btn.addEventListener('click', () => {
            const modal = document.getElementById('ios-install-modal');
            if (modal) modal.classList.remove('hidden');
        });
        return;
    }

    // On Chrome/Edge/Android, use the deferred prompt if available
    btn.addEventListener('click', async () => {
        if (deferredInstallPrompt) {
            deferredInstallPrompt.prompt();
            const result = await deferredInstallPrompt.userChoice;
            if (result.outcome === 'accepted') {
                trackEvent('pwa-installed');
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

function initializeIOSInstallModal() {
    const modal = document.getElementById('ios-install-modal');
    if (!modal) return;
    const closeX = document.getElementById('close-ios-install-x');
    const closeBtn = document.getElementById('close-ios-install');
    const hide = () => modal.classList.add('hidden');
    if (closeX) closeX.addEventListener('click', hide);
    if (closeBtn) closeBtn.addEventListener('click', hide);
    modal.addEventListener('click', (e) => { if (e.target === modal) hide(); });
}

function initializeShareAppModal() {
    const btn = document.getElementById('share-app-btn');
    const modal = document.getElementById('share-app-modal');
    if (!btn || !modal) return;

    const appUrl = 'https://cjpaulphd.github.io/weatherwonder/';
    const closeBtn = document.getElementById('close-share-app-modal');
    const copyBtn = document.getElementById('copy-app-url');
    const nativeBtn = document.getElementById('share-app-native');

    btn.addEventListener('click', () => modal.classList.remove('hidden'));

    const hide = () => modal.classList.add('hidden');
    if (closeBtn) closeBtn.addEventListener('click', hide);
    modal.addEventListener('click', (e) => { if (e.target === modal) hide(); });

    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(appUrl).then(() => {
                copyBtn.textContent = 'Copied!';
                copyBtn.classList.add('success');
                setTimeout(() => {
                    copyBtn.textContent = 'Copy';
                    copyBtn.classList.remove('success');
                }, 2000);
            }).catch(() => showToast('Failed to copy link'));
        });
    }

    if (nativeBtn) {
        if (navigator.share) {
            nativeBtn.addEventListener('click', async () => {
                try {
                    await navigator.share({
                        title: 'WeatherWonder',
                        text: 'Check out WeatherWonder — a free, open-source weather dashboard with radar, precipitation history, and more!',
                        url: appUrl
                    });
                    hide();
                } catch (e) {
                    if (e.name !== 'AbortError') showToast('Failed to share');
                }
            });
        } else {
            nativeBtn.style.display = 'none';
        }
    }
}

// Pull-to-Refresh
function initializePullToRefresh() {
    const indicator = document.getElementById('pull-to-refresh');
    if (!indicator) return;

    let startY = 0;
    let currentY = 0;
    let pulling = false;
    let refreshing = false;
    const THRESHOLD = 80;
    const MAX_PULL = 120;

    function getScrollTop() {
        return window.scrollY || document.documentElement.scrollTop;
    }

    document.addEventListener('touchstart', (e) => {
        if (refreshing) return;
        if (getScrollTop() > 5) return;
        startY = e.touches[0].clientY;
        pulling = true;
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (!pulling || refreshing) return;
        currentY = e.touches[0].clientY;
        const pullDistance = currentY - startY;

        if (pullDistance < 0 || getScrollTop() > 5) {
            pulling = false;
            indicator.classList.remove('visible');
            indicator.style.transform = 'translateX(-50%) translateY(-60px)';
            return;
        }

        const cappedDistance = Math.min(pullDistance, MAX_PULL);
        const progress = Math.min(cappedDistance / THRESHOLD, 1);

        indicator.classList.add('visible');
        indicator.style.transform = `translateX(-50%) translateY(${cappedDistance - 20}px)`;

        // Rotate the WW logo based on pull progress
        const svg = indicator.querySelector('svg');
        if (svg) {
            svg.style.transform = `rotate(${progress * 180}deg)`;
        }
    }, { passive: true });

    document.addEventListener('touchend', () => {
        if (!pulling || refreshing) return;
        const pullDistance = currentY - startY;
        pulling = false;

        if (pullDistance >= THRESHOLD) {
            // Trigger refresh
            refreshing = true;
            indicator.classList.add('refreshing');
            indicator.style.transform = 'translateX(-50%) translateY(20px)';

            // Reset radar map for full re-initialization
            if (radarMap) {
                radarMap.remove();
                radarMap = null;
                radarLayer = null;
            }

            loadWeather().then(() => {
                setTimeout(() => {
                    indicator.classList.remove('visible', 'refreshing');
                    indicator.style.transform = 'translateX(-50%) translateY(-60px)';
                    const svg = indicator.querySelector('svg');
                    if (svg) svg.style.transform = '';
                    refreshing = false;
                }, 400);
            });
            trackEvent('pull-to-refresh');
        } else {
            // Snap back
            indicator.classList.remove('visible');
            indicator.style.transform = 'translateX(-50%) translateY(-60px)';
            const svg = indicator.querySelector('svg');
            if (svg) svg.style.transform = '';
        }

        startY = 0;
        currentY = 0;
    }, { passive: true });
}

// Register service worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    detectLocaleDefaults();
    const inits = [
        initializeTheme,
        initializeTempToggle,
        initializeTimeToggle,
        updateLocationDisplay,
        initializeModal,
        initializeShareModal,
        initializeMenu,
        initializeAlertDetailModal,
        initializeInstallButton,
        initializeIOSInstallModal,
        initializeShareAppModal,
        initializeCIT2000,
        initializePullToRefresh
    ];
    inits.forEach(fn => {
        try { fn(); } catch (e) { console.error('Init error in ' + fn.name + ':', e); }
    });
    loadWeather();

    // Initialize scroll handler after weather loads
    setTimeout(initializeHourlyScrollHandler, 500);
});
