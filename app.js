// Weather App - Precipitation Forecast Visualization
// Uses Open-Meteo API (free, no API key required)

const API_BASE = 'https://api.open-meteo.com/v1/forecast';
const GEOCODING_API = 'https://geocoding-api.open-meteo.com/v1/search';
const RAINVIEWER_API = 'https://api.rainviewer.com/public/weather-maps.json';
const AQI_API = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const MARINE_API = 'https://marine-api.open-meteo.com/v1/marine';
// NOAA CO-OPS tide predictions (US stations). Used in preference to the
// Open-Meteo global model where a station is close enough; otherwise we fall
// back to Open-Meteo. Station list is large but static, so it's cached.
const NOAA_TIDE_DATAGETTER = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
const NOAA_TIDE_STATIONS = 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions';

// Default location (Durham, NC) - overridden by last used location if available
const DEFAULT_LOCATION = {
    name: 'Durham, NC',
    latitude: 35.994,
    longitude: -78.8986
};

const LAST_LOCATION_KEY = 'weatherwonder_last_location';

// Escape untrusted strings before inserting them into innerHTML, to prevent XSS.
// Used for API-provided text (NWS alerts, geocoding results) and user-entered
// favorite names, all of which are rendered via template literals + innerHTML.
function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getLastLocation() {
    try {
        const stored = localStorage.getItem(LAST_LOCATION_KEY);
        if (stored) {
            const loc = JSON.parse(stored);
            // Use finite-number checks, not truthiness: lat 0 (equator) or
            // lon 0 (prime meridian) are valid but falsy.
            if (loc.name && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude)) return loc;
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
// Incremented on each loadWeather() call. Async secondary fetches capture the
// value at start and bail out if it changes, so results for a location the user
// has navigated away from can't overwrite the current view.
let currentLoadId = 0;

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
        'daily-section': { normal: 'DAILY FORECAST', fun: 'DAILY VIBES FORECAST' },
        'hourly-section': { normal: 'HOURLY FORECAST', fun: 'HOURLY VIBE CHECK' },
        'radar-section': { normal: 'DOPPLER RADAR (50 mi)', fun: 'BLEEPS / SWEEPS / CREEPS' },
        'precip-history-section': { normal: 'PRECIPITATION HISTORY', fun: 'SKY JUICE HISTORY' }
        // 'astro-section' is handled by updateAstroHeader() so the header can
        // also reflect whether tides are currently shown.
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
    updateAstroHeader();
    updateThemeColor(getEffectiveTheme());
}

// Set the astro section header. It reflects both CIT2000 mode and whether
// tides are currently shown — the "Tide"/"Waves" word toggles with the tide
// buttons (header shortcut + chart legend).
function updateAstroHeader() {
    const section = document.getElementById('astro-section');
    if (!section) return;
    const h2 = section.querySelector('.section-header h2');
    if (!h2) return;
    const tide = isTideLineOn();
    if (isCIT2000()) {
        h2.textContent = tide ? 'SKY ORB WAVES' : 'SKY ORBS';
    } else {
        h2.textContent = tide ? 'SUN, MOON, AND TIDE' : 'SUN AND MOON';
    }
}

function toggleCIT2000() {
    const on = !isCIT2000();
    setCIT2000(on);
    applyCIT2000(on);
    trackEvent('cit2000-' + (on ? 'on' : 'off'));
    // Entering CIT2000 no longer forces Kelvin/microns — the in-mode
    // "Do you have your micrometer?" button toggles those units. But if we're
    // leaving CIT2000 while on Kelvin, revert to Fahrenheit since Kelvin/micron
    // units are only available inside CIT2000 mode.
    if (!on && getTempUnit() === 'K') {
        saveTempUnit('F');
    }
    updateTempToggleUI();
    updateMicrometerToggleUI();
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
        label.textContent = isCIT2000() ? 'CIT2000 Mode On' : 'CIT2000 Mode';
    }
}

// The "Do you have your micrometer?" button is shown only inside CIT2000 mode
// (visibility is driven by the .cit2000-active class in CSS) and toggles the
// Kelvin/micron (µm) units on and off.
function toggleMicrometer() {
    const on = getTempUnit() === 'K';
    saveTempUnit(on ? 'F' : 'K');
    trackEvent('micrometer-' + (on ? 'off' : 'on'));
    updateTempToggleUI();
    updateMicrometerToggleUI();
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
}

function updateMicrometerToggleUI() {
    const btn = document.getElementById('micrometer-toggle');
    if (!btn) return;
    const on = getTempUnit() === 'K';
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.classList.toggle('active', on);
}

function initializeCIT2000() {
    const btn = document.getElementById('cit2000-btn');
    if (btn) {
        btn.addEventListener('click', toggleCIT2000);
    }
    const micrometerBtn = document.getElementById('micrometer-toggle');
    if (micrometerBtn) {
        micrometerBtn.addEventListener('click', toggleMicrometer);
    }
    // Restore state on load
    if (isCIT2000()) {
        applyCIT2000(true);
    }
    updateCIT2000ToggleUI();
    updateMicrometerToggleUI();
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
            btn.setAttribute('aria-label', 'Remove from favorites');
        } else {
            btn.textContent = '☆';
            btn.classList.remove('active');
            btn.setAttribute('aria-label', 'Add to favorites');
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
        <div class="favorite-item" draggable="true" data-lat="${fav.latitude}" data-lon="${fav.longitude}" data-name="${escapeHtml(fav.name)}">
            <span class="drag-handle" title="Drag to reorder">⠿</span>
            <span class="favorite-item-name">${escapeHtml(fav.name)}</span>
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
                renderPrecipOutlook(weatherData);
                renderHourlyForecast(weatherData);
                renderChart(weatherData);
                renderAstroData();
                // Update last-updated timestamp
                const lastUpdated = document.getElementById('last-updated');
                if (lastUpdated && lastUpdated.dataset.timestamp) {
                    const ts = new Date(lastUpdated.dataset.timestamp);
                    lastUpdated.textContent = formatUpdatedTimestamp(ts);
                }
            }
        });
    }
}

// Tide line management. The toggle is only shown for coastal locations (where
// the Open-Meteo Marine API returns tide data). State is session-only and
// always starts off — the tide line is opt-in on each load, not persisted.
let tideLineOn = false;

// Holds the normalized tide data for the current location, or null when the
// location is inland / has no tide data. Shape:
//   { times: string[],      // "YYYY-MM-DDTHH:mm" local wall-clock
//     heightsFt: number[],  // tide height in feet
//     extremes: [{ type, date, heightFt }] | null,  // exact hi/lo (NOAA only)
//     source: 'noaa' | 'open-meteo', stationName?: string }
let tideData = null;

function isTideLineOn() {
    return tideLineOn;
}

function saveTideLine(on) {
    tideLineOn = !!on;
}

// A usable hourly tide series — the per-hour heights that power the chart
// curve and the hourly-card tide values. NOAA subordinate (high/low-only)
// stations have extremes but no series, so this is false for them.
function hasTideSeries() {
    return !!(tideData && Array.isArray(tideData.heightsFt) &&
        tideData.heightsFt.some(v => v != null));
}

// Any usable tide information for this location: an hourly series, high/low
// extremes, or both. A coastal location may have valid high/low events even
// without an hourly series.
function hasTideData() {
    if (!tideData) return false;
    return hasTideSeries() ||
        (Array.isArray(tideData.extremes) && tideData.extremes.length > 0);
}

// Source-aware terminology. NOAA station predictions are true tides; the
// Open-Meteo Marine fallback reports a modeled sea-level height, so it is
// labeled "Sea Level" / "High Water" / "Low Water" instead of the NOAA
// "Tide" / "High Tide" / "Low Tide".
function isMarineTideSource() {
    return !!(tideData && tideData.source === 'open-meteo');
}
function tideSeriesLabel() {
    return isMarineTideSource() ? 'Sea Level' : 'Tide';
}
function tideExtremeLabel(type) {
    if (isMarineTideSource()) return type === 'High' ? 'High Water' : 'Low Water';
    return type === 'High' ? 'High Tide' : 'Low Tide';
}

// Find today's high/low tide events, in chronological order. Returns [] for
// inland locations. NOAA provides exact hi/lo predictions, so those are used
// directly; for the Open-Meteo fallback the series is only sampled hourly, so
// we detect local maxima/minima and fit a parabola through the three samples
// around each extreme to recover a sub-hour time (and the true peak height).
// Times are local wall-clock (no UTC offset), so format them WITHOUT a tz.
function getTodayTideExtremes() {
    if (!hasTideData()) return [];
    const ln = getLocationNow();
    const pad = n => String(n).padStart(2, '0');
    const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const today = `${ln.getFullYear()}-${pad(ln.getMonth() + 1)}-${pad(ln.getDate())}`;

    // Exact extremes from NOAA — just keep today's.
    if (tideData.extremes) {
        return tideData.extremes.filter(e => dayKey(e.date) === today);
    }

    // Otherwise derive them from the hourly series.
    const time = tideData.times;
    const h = tideData.heightsFt;
    const events = [];
    for (let i = 1; i < h.length - 1; i++) {
        const prev = h[i - 1], cur = h[i], next = h[i + 1];
        if (prev == null || cur == null || next == null) continue;
        let type = null;
        if (cur > prev && cur >= next) type = 'High';
        else if (cur < prev && cur <= next) type = 'Low';
        if (!type) continue;

        // Parabolic interpolation: y = a·x² + b·x + c through x = -1, 0, +1.
        // Vertex offset (in hours from `cur`) and the value there.
        const denom = prev - 2 * cur + next;
        let offsetHours = 0;
        let peakVal = cur;
        if (denom !== 0) {
            offsetHours = Math.max(-0.5, Math.min(0.5, 0.5 * (prev - next) / denom));
            peakVal = cur - 0.25 * (prev - next) * offsetHours;
        }

        const date = new Date(time[i]);
        date.setMinutes(date.getMinutes() + Math.round(offsetHours * 60));

        if (dayKey(date) !== today) continue;
        events.push({ type, date, heightFt: peakVal });
    }
    return events;
}

// The tide toggle currently lives in one place — the icon+label shortcut
// beside the "Sun, Moon, and Tide" header — but is addressed generically via
// data-tide-toggle so any future duplicate (like the chart legend's own
// "Tide" entry, which is rebuilt fresh each render instead) stays in sync
// for free.
function updateTideToggleUI() {
    // Keep the section header's "Tide"/"Waves" word in sync with the toggle.
    updateAstroHeader();
    // Offer the toggle wherever there's any tide info (a series OR high/low
    // events), so high/low-only stations still expose their events.
    const coastal = hasTideData();
    const on = coastal && isTideLineOn();
    document.querySelectorAll('[data-tide-toggle]').forEach(btn => {
        // Only offer the toggle where there's actually tide data to show.
        btn.classList.toggle('hidden', !coastal);
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
}

// Flips the tide-line preference and refreshes every surface that reflects
// it: the toggle button(s), the chart's tide line, the hourly cards' tide
// row, and the Sun/Moon/Tide table.
function toggleTideLine() {
    const next = !isTideLineOn();
    saveTideLine(next);
    trackEvent('tide-' + (next ? 'on' : 'off'));
    updateTideToggleUI();
    if (weatherData) {
        renderChart(weatherData);
        renderHourlyForecast(weatherData);
    }
    renderAstroData();
}

function initializeTideToggle() {
    updateTideToggleUI();
    document.querySelectorAll('[data-tide-toggle]').forEach(btn => {
        btn.addEventListener('click', toggleTideLine);
    });
}

// Storm & intensity detail toggle — reveals a precipitation-character row on
// the hourly and daily forecast cards. Off by default so the cards stay clean;
// the preference persists in localStorage.
const PRECIP_DETAIL_KEY = 'weatherwonder_precip_detail';

function isPrecipDetailOn() {
    try {
        return localStorage.getItem(PRECIP_DETAIL_KEY) === '1';
    } catch (e) {
        return false;
    }
}

function savePrecipDetail(on) {
    try {
        localStorage.setItem(PRECIP_DETAIL_KEY, on ? '1' : '0');
    } catch (e) {
        console.error('Could not save precip detail preference:', e);
    }
}

// Any button carrying data-precip-detail-toggle (currently just the
// icon-only shortcut in the Daily Forecast section header) reflects the
// Stormcast on/off state; the chart legend's "Stormcast" entry is rebuilt
// fresh from isPrecipDetailOn() on every chart render, so it doesn't need
// this attribute to stay in sync.
function updatePrecipDetailToggleUI() {
    const on = isPrecipDetailOn();
    document.querySelectorAll('[data-precip-detail-toggle]').forEach(btn => {
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
}

// Flips the Stormcast preference and refreshes every surface that reflects
// it: the toggle button(s), the card detail rows, the outlook strip, and the
// chart's intensity-colored fill.
function togglePrecipDetail() {
    const next = !isPrecipDetailOn();
    savePrecipDetail(next);
    trackEvent('precip-detail-' + (next ? 'on' : 'off'));
    updatePrecipDetailToggleUI();
    if (weatherData) {
        renderDailyForecast(weatherData);
        renderPrecipOutlook(weatherData);
        renderHourlyForecast(weatherData);
        renderChart(weatherData);
    }
}

function initializePrecipDetailToggle() {
    updatePrecipDetailToggleUI();
    document.querySelectorAll('[data-precip-detail-toggle]').forEach(btn => {
        btn.addEventListener('click', togglePrecipDetail);
    });
}

// Chart line visibility — each forecast-chart line can be toggled on/off from
// its legend entry. State persists in localStorage and applies across every
// day-range view. Tide is handled separately via isTideLineOn().
const CHART_LINES_KEY = 'weatherwonder_chart_lines';
const CHART_LINE_DEFAULTS = { temp: true, feelsLike: false, precipProb: true, precipAmount: true, wind: false, uv: false };

function getChartLineVisibility() {
    try {
        const stored = JSON.parse(localStorage.getItem(CHART_LINES_KEY) || '{}');
        return { ...CHART_LINE_DEFAULTS, ...stored };
    } catch (e) {
        return { ...CHART_LINE_DEFAULTS };
    }
}

function isChartLineVisible(key) {
    return getChartLineVisibility()[key] !== false;
}

function toggleChartLine(key) {
    const vis = getChartLineVisibility();
    vis[key] = !isChartLineVisible(key);
    try {
        localStorage.setItem(CHART_LINES_KEY, JSON.stringify(vis));
    } catch (e) {
        console.error('Could not save chart line visibility:', e);
    }
    return vis[key];
}

// Set a chart line's visibility to an explicit value (used to default wind off
// when switching into a longer-range view).
function setChartLineVisible(key, on) {
    const vis = getChartLineVisibility();
    vis[key] = !!on;
    try {
        localStorage.setItem(CHART_LINES_KEY, JSON.stringify(vis));
    } catch (e) {
        console.error('Could not save chart line visibility:', e);
    }
}

// Chart day-range management with localStorage
const CHART_DAYS_KEY = 'weatherwonder_chart_days';
const CHART_DAYS_OPTIONS = [1, 3, 5, 7, 10];

function getChartDays() {
    try {
        const v = parseInt(localStorage.getItem(CHART_DAYS_KEY), 10);
        return CHART_DAYS_OPTIONS.includes(v) ? v : 7;
    } catch (e) {
        return 7;
    }
}

function saveChartDays(days) {
    try {
        localStorage.setItem(CHART_DAYS_KEY, String(days));
    } catch (e) {
        console.error('Could not save chart days:', e);
    }
}

function updateChartRangeToggleUI() {
    const current = getChartDays();
    document.querySelectorAll('.chart-range-btn').forEach(btn => {
        const days = parseInt(btn.dataset.days, 10);
        btn.classList.toggle('active', days === current);
        btn.setAttribute('aria-pressed', days === current ? 'true' : 'false');
    });
}

function initializeChartRangeToggle() {
    updateChartRangeToggleUI();
    document.querySelectorAll('.chart-range-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const days = parseInt(btn.dataset.days, 10);
            if (!CHART_DAYS_OPTIONS.includes(days)) return;
            const prevDays = getChartDays();
            saveChartDays(days);
            trackEvent('chart-range-' + days + 'd');
            updateChartRangeToggleUI();
            // Moving from a short (1/3-day) view into a longer (5/7/10-day) one
            // defaults the wind and tide lines off to keep the busier chart
            // readable — the user can still re-enable them from the legend.
            if (prevDays < 5 && days >= 5) {
                setChartLineVisible('wind', false);
                if (isTideLineOn()) {
                    saveTideLine(false);
                    updateTideToggleUI();
                    renderAstroData();
                    if (weatherData) renderHourlyForecast(weatherData);
                }
            }
            if (weatherData) {
                renderDailyForecast(weatherData);
                renderChart(weatherData);
            }
        });
    });
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
    const { currentTemp, feelsLike } = applyCurrentConditions();
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

// Build the "Refreshed ..." timestamp label. This marks when WeatherWonder
// finished loading its data, not a common issuance time across providers.
// When the viewed location is in a different timezone from the user's device,
// shows both times with abbreviations and the hour offset, e.g.
//   "Refreshed 5:11 AM ET · 9:11 PM NZST (+16hr)"
// When timezones match, shows just "Refreshed 5:11 AM".
function formatUpdatedTimestamp(date) {
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const locationTz = getLocationTimezone();

    const localTime = formatTime(date);

    if (!locationTz || browserTz === locationTz) {
        return `Refreshed ${localTime}`;
    }

    // Get short timezone abbreviations (e.g. "EST", "NZST")
    const tzAbbr = (d, tz) => {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(d);
        const p = parts.find(p => p.type === 'timeZoneName');
        return p ? p.value : '';
    };

    const localAbbr = tzAbbr(date, browserTz);
    const locationTime = formatTime(date, locationTz);
    const locationAbbr = tzAbbr(date, locationTz);

    // Compute offset difference in minutes between the two timezones
    const utcMs = date.getTime();
    const toOffsetMin = (tz) => {
        const s = date.toLocaleString('en-US', { timeZone: tz });
        return (new Date(s).getTime() - utcMs) / 60000;
    };
    const diffMin = toOffsetMin(locationTz) - toOffsetMin(browserTz);
    const sign = diffMin >= 0 ? '+' : '\u2212';
    const absMin = Math.abs(diffMin);
    const hrs = Math.floor(absMin / 60);
    const mins = absMin % 60;
    const diffLabel = mins === 0 ? `${sign}${hrs}hr` : `${sign}${hrs}:${mins.toString().padStart(2, '0')}`;

    return `Refreshed ${localTime} ${localAbbr} \u00B7 ${locationTime} ${locationAbbr} (${diffLabel})`;
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
    const panel = document.getElementById('menu-panel');
    panel.classList.remove('hidden');
    panel.inert = false;
    document.getElementById('menu-overlay').classList.remove('hidden');
}

function closeMenu() {
    const panel = document.getElementById('menu-panel');
    panel.classList.add('hidden');
    // Make the hidden panel inert so its controls aren't keyboard-focusable
    // while off-screen.
    panel.inert = true;
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
function getWeatherIcon(code, isNight = false, moonEmoji = '🌙') {
    const weather = weatherCodes[code] || { icon: '❓', desc: 'Unknown' };
    if (isNight && code <= 2) {
        return moonEmoji;
    }
    return weather.icon;
}

// Check if snow based on weather code
function isSnow(code) {
    return [71, 73, 75, 77, 85, 86].includes(code);
}

// Check if a code is rain, drizzle, or a rain shower (including freezing forms).
// Used with isSnow() to detect a half-day period that mixes rain and snow.
function isRainCode(code) {
    return [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code);
}

// Explicit significance ranking for WMO weather codes (lower = more
// significant), used to summarize an AM/PM half-day. This replaces the old
// assumption that the numerically highest code is the best summary — that
// mis-ranked, e.g., fog (45–48) above heavy rain (65). Precipitation type is
// determined by the code itself, never by temperature.
function weatherCodeCategory(code) {
    if (code >= 95) return 1;                        // Thunderstorm (95, 96, 99)
    if ([56, 57, 66, 67].includes(code)) return 2;   // Freezing rain / freezing drizzle
    if ([75, 86].includes(code)) return 3;           // Heavy snow / heavy snow showers
    if ([65, 82].includes(code)) return 4;           // Heavy rain / heavy rain showers
    if ([71, 73, 77, 85].includes(code)) return 5;   // Other snow / snow showers
    if ([61, 63, 80, 81].includes(code)) return 6;   // Other rain / rain showers
    if ([45, 48].includes(code)) return 7;           // Fog / rime fog
    if ([51, 53, 55].includes(code)) return 8;       // Drizzle
    if (code === 3) return 9;                         // Overcast
    if (code === 1 || code === 2) return 10;         // Partly cloudy
    return 11;                                        // Clear (0) and anything else
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

// Chart precipitation-axis units. The hourly API returns precipitation in mm;
// the chart shows it in the same unit as the rest of the UI — inches in °F
// mode, mm in °C, microns in the Kelvin easter-egg mode. `factor` converts mm
// to the display unit and `step` is the gridline spacing in that unit.
function getChartPrecipConfig() {
    const unit = getTempUnit();
    if (unit === 'C') return { factor: 1, step: 1, gridDecimals: 0, tipDecimals: 1, suffix: ' mm' };
    if (unit === 'K') return { factor: 1000, step: 1000, gridDecimals: 0, tipDecimals: 0, suffix: ' µm' };
    return { factor: 1 / 25.4, step: 0.1, gridDecimals: 1, tipDecimals: 2, suffix: '"' };
}

// Format precipitation amount (mm in metric, inches in imperial, microns in Kelvin mode)
function formatPrecip(mm, compact = false) {
    const unit = getTempUnit();
    if (unit === 'K') {
        const microns = mm * 1000;
        if (microns < 100) return '';
        if (compact) {
            if (microns >= 1e6) return `${(microns / 1e6).toFixed(1)}M µm`;
            if (microns >= 1e4) return `${Math.round(microns / 1e3)}K µm`;
            if (microns >= 1e3) return `${(microns / 1e3).toFixed(1)}K µm`;
        }
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

// Classify an hour's precipitation rate into a coarse intensity tier, using
// standard meteorological thresholds: rain light < 2.5 mm/h, moderate
// 2.5–7.6 mm/h, heavy > 7.6 mm/h; snow light < 1 cm/h, moderate 1–2.5 cm/h,
// heavy > 2.5 cm/h. The tier describes the rate IF precipitation falls — it
// says nothing about the probability, which the 💧% row covers.
function getPrecipIntensity(precipMm, snowfallCm) {
    if (snowfallCm > 0) {
        if (snowfallCm > 2.5) return { label: 'Heavy', cls: 'heavy' };
        if (snowfallCm >= 1) return { label: 'Moderate', cls: 'moderate' };
        return { label: 'Light', cls: 'light' };
    }
    if (precipMm > 0) {
        if (precipMm > 7.6) return { label: 'Heavy', cls: 'heavy' };
        if (precipMm >= 2.5) return { label: 'Moderate', cls: 'moderate' };
        return { label: 'Light', cls: 'light' };
    }
    return null;
}

// Storm signal for an hour. The model's own thunderstorm weather codes
// (95/96/99) are the primary, vetted signal. High CAPE (the convective energy
// available to fuel a storm) combined with a real precipitation chance flags
// latent storm potential the deterministic code hasn't committed to — shown
// with softer "risk" wording since CAPE alone is not a forecast of a storm.
function getStormSignal(weatherCode, cape, precipProb) {
    if (weatherCode >= 95) return { label: '⛈ Storm', cls: 'storm' };
    if (cape >= 2000 && precipProb >= 40) return { label: '⚡ Storm risk', cls: 'storm-risk' };
    return null;
}

// One short phrase describing a wet day's character, derived from how many of
// its hours see precipitation vs. how much falls in total. Turns identical
// daily sums into different, actionable reads: a brief soaking vs. all-day rain.
function getDayPrecipCharacter(weatherCode, precipSumMm, precipHours, snowfallCm) {
    if (weatherCode >= 95) return { label: '⛈ Storms', cls: 'storm' };
    if (!(precipSumMm > 0) || !(precipHours > 0)) return null;
    const snowy = snowfallCm >= 1;
    if (precipHours <= 4) {
        if (!snowy && precipSumMm / precipHours >= 2.5) return { label: 'Brief downpour', cls: 'heavy' };
        return { label: snowy ? 'Brief snow' : 'Brief showers', cls: 'light' };
    }
    if (precipHours >= 10) return { label: snowy ? 'Steady snow' : 'Steady rain', cls: 'moderate' };
    return { label: snowy ? 'Passing snow' : 'Passing showers', cls: 'light' };
}

// Format a tide height (stored internally in feet) per the active unit toggle,
// matching the temperature/precip units: F → feet, C → metres, K → microns.
function formatTideHeight(ft, compact = false) {
    const unit = getTempUnit();
    if (unit === 'K') {
        const microns = ft * 304800; // 1 ft = 304,800 µm
        const abs = Math.abs(microns);
        if (compact) {
            if (abs >= 1e6) return `${(microns / 1e6).toFixed(1)}M µm`;
            if (abs >= 1e3) return `${Math.round(microns / 1e3)}K µm`;
        }
        return `${Math.round(microns).toLocaleString()} µm`;
    }
    if (unit === 'C') {
        return `${(ft * 0.3048).toFixed(2)} m`;
    }
    return `${ft.toFixed(1)} ft`;
}

// Convert wind direction degrees to compass abbreviation
function getWindDirection(deg) {
    const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return dirs[Math.round(deg / 22.5) % 16];
}

// Format wind speed in current unit (API returns mph; convert to km/h in metric mode, µm/s in Kelvin mode)
function formatWindSpeed(mph, compact = false) {
    const unit = getTempUnit();
    if (unit === 'K') {
        // 1 mph = 447,040 µm/s
        const microns = Math.round(mph * 447040);
        if (compact) {
            if (microns >= 1e6) return `${(microns / 1e6).toFixed(1)}M µm/s`;
            if (microns >= 1e3) return `${Math.round(microns / 1e3)}K µm/s`;
            return `${microns} µm/s`;
        }
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
        // Dedicated current-conditions block. Open-Meteo returns a single
        // best-available snapshot for "now" rather than making us pick the
        // nearest hourly index ourselves.
        current: [
            'temperature_2m',
            'apparent_temperature',
            'relative_humidity_2m',
            'dew_point_2m',
            'weather_code',
            'wind_speed_10m',
            'wind_direction_10m',
            'wind_gusts_10m',
            'precipitation',
            'is_day'
        ].join(','),
        hourly: [
            'temperature_2m',
            'apparent_temperature',
            'relative_humidity_2m',
            'dew_point_2m',
            'precipitation_probability',
            'precipitation',
            'snowfall',
            'weather_code',
            'wind_speed_10m',
            'wind_direction_10m',
            'wind_gusts_10m',
            'uv_index',
            'is_day',
            'cape'
        ].join(','),
        // 15-minute precipitation for the short-term outlook strip. Native
        // resolution in North America / Central Europe; elsewhere Open-Meteo
        // interpolates from hourly, which still yields a usable outlook.
        minutely_15: 'precipitation',
        daily: [
            'temperature_2m_max',
            'temperature_2m_min',
            'precipitation_probability_max',
            'precipitation_sum',
            'precipitation_hours',
            'snowfall_sum',
            'weather_code',
            'wind_speed_10m_max',
            'wind_direction_10m_dominant'
        ].join(','),
        temperature_unit: 'celsius',
        wind_speed_unit: 'mph',
        precipitation_unit: 'mm',
        timezone: 'auto',
        forecast_days: 11
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

// Fetch tide data for a location, normalized to { times, heightsFt, extremes,
// source }. Prefers NOAA CO-OPS station predictions (accurate, US-only) and
// falls back to Open-Meteo's global marine model elsewhere or on any failure.
// Returns null for inland locations with no tide data.
async function fetchTideData(lat, lon) {
    try {
        const noaa = await fetchNoaaTideData(lat, lon);
        if (noaa) return noaa;
    } catch (e) {
        // NOAA unavailable (network/CORS/etc.) — fall back to Open-Meteo.
    }
    return fetchOpenMeteoTideData(lat, lon);
}

// Great-circle distance between two lat/lon points, in kilometres.
function haversineKm(lat1, lon1, lat2, lon2) {
    const toRad = d => d * Math.PI / 180;
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

// NOAA's tide-prediction station list, cached in localStorage (it's large but
// effectively static). Falls back to a session cache and an empty list.
let noaaStationsCache = null;
const NOAA_STATIONS_CACHE_KEY = 'weatherwonder_noaa_stations';
const NOAA_STATIONS_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

async function getNoaaTideStations() {
    if (noaaStationsCache) return noaaStationsCache;
    try {
        const cached = JSON.parse(localStorage.getItem(NOAA_STATIONS_CACHE_KEY) || 'null');
        if (cached && Date.now() - cached.ts < NOAA_STATIONS_TTL && Array.isArray(cached.stations)) {
            noaaStationsCache = cached.stations;
            return noaaStationsCache;
        }
    } catch (e) { /* ignore cache read errors */ }

    const response = await fetch(NOAA_TIDE_STATIONS);
    if (!response.ok) throw new Error('Failed to fetch NOAA stations');
    const data = await response.json();
    noaaStationsCache = (data.stations || []).map(s => ({
        id: s.id, name: s.name, lat: s.lat, lng: s.lng
    }));
    try {
        localStorage.setItem(NOAA_STATIONS_CACHE_KEY, JSON.stringify({ ts: Date.now(), stations: noaaStationsCache }));
    } catch (e) { /* storage full / unavailable — session cache still set */ }
    return noaaStationsCache;
}

// Find the nearest NOAA tide station within ~40 km. Returns { station,
// distanceKm } so the provenance line can report how far away it is, or null
// when none is close enough.
async function findNearestNoaaStation(lat, lon) {
    const stations = await getNoaaTideStations();
    let best = null, bestKm = Infinity;
    for (const s of stations) {
        if (s.lat == null || s.lng == null) continue;
        const km = haversineKm(lat, lon, s.lat, s.lng);
        if (km < bestKm) { bestKm = km; best = s; }
    }
    return best && bestKm <= 40 ? { station: best, distanceKm: bestKm } : null;
}

// Fetch tide predictions from NOAA for the nearest station. Returns the
// normalized tide object, or null when no station is close enough.
async function fetchNoaaTideData(lat, lon) {
    const nearest = await findNearestNoaaStation(lat, lon);
    if (!nearest) return null;
    const { station, distanceKm } = nearest;

    const ln = getLocationNow();
    const pad = n => String(n).padStart(2, '0');
    const begin = `${ln.getFullYear()}${pad(ln.getMonth() + 1)}${pad(ln.getDate())}`;
    const endDate = new Date(ln);
    endDate.setDate(endDate.getDate() + 10);
    const end = `${endDate.getFullYear()}${pad(endDate.getMonth() + 1)}${pad(endDate.getDate())}`;

    const common = `&datum=MLLW&units=english&time_zone=lst_ldt&format=json&application=weatherwonder.app&station=${station.id}`;
    // Hourly series powers the chart curve; hi/lo powers the table.
    const seriesUrl = `${NOAA_TIDE_DATAGETTER}?product=predictions&interval=h&begin_date=${begin}&end_date=${end}${common}`;
    const hiloUrl = `${NOAA_TIDE_DATAGETTER}?product=predictions&interval=hilo&begin_date=${begin}&end_date=${end}${common}`;

    // Fetch the two products independently: NOAA subordinate stations often
    // provide high/low predictions but not an hourly series, so one request
    // failing must not discard the other.
    const [seriesRes, hiloRes] = await Promise.allSettled([fetch(seriesUrl), fetch(hiloUrl)]);

    // NOAA "t" is local station wall-clock "YYYY-MM-DD HH:mm" (no offset).
    const toIso = t => t.replace(' ', 'T');

    let times = [];
    let heightsFt = [];
    if (seriesRes.status === 'fulfilled' && seriesRes.value.ok) {
        try {
            const series = await seriesRes.value.json();
            if (series.predictions && series.predictions.length) {
                times = series.predictions.map(p => toIso(p.t));
                heightsFt = series.predictions.map(p => parseFloat(p.v));
            }
        } catch (e) { /* leave series empty */ }
    }

    let extremes = null;
    if (hiloRes.status === 'fulfilled' && hiloRes.value.ok) {
        try {
            const hilo = await hiloRes.value.json();
            if (hilo.predictions && hilo.predictions.length) {
                extremes = hilo.predictions.map(p => ({
                    type: p.type === 'H' ? 'High' : 'Low',
                    date: new Date(toIso(p.t)),
                    heightFt: parseFloat(p.v)
                }));
            }
        } catch (e) { /* leave extremes null */ }
    }

    const hasSeries = heightsFt.some(v => Number.isFinite(v));
    const hasExtremes = Array.isArray(extremes) && extremes.length > 0;
    // No usable NOAA predictions at all → null so the caller falls back to
    // Open-Meteo Marine.
    if (!hasSeries && !hasExtremes) return null;

    return {
        times: hasSeries ? times : [],
        heightsFt: hasSeries ? heightsFt : [],
        extremes: hasExtremes ? extremes : null,
        source: 'noaa',
        stationName: station.name,
        stationDistanceKm: distanceKm
    };
}

// Fetch hourly tide heights from Open-Meteo's Marine API (global model).
// Returns the normalized tide object, or null for inland points (the API
// responds with an error or all-null values when no marine data exists there).
async function fetchOpenMeteoTideData(lat, lon) {
    const params = new URLSearchParams({
        latitude: lat,
        longitude: lon,
        hourly: 'sea_level_height_msl',
        timezone: 'auto',
        // The marine grid doesn't cover the full 11-day atmospheric horizon, so
        // request only 8 days; partial/null values are still handled gracefully.
        // cell_selection: 'sea' picks the nearest marine cell for coastal points.
        cell_selection: 'sea',
        forecast_days: 8
    });
    const response = await fetch(`${MARINE_API}?${params}`);
    if (!response.ok) return null;
    const data = await response.json();
    if (data.error || !data.hourly) return null;
    const times = data.hourly.time;
    // sea_level_height_msl is in metres relative to mean sea level → feet.
    const heightsFt = data.hourly.sea_level_height_msl.map(m => m == null ? null : m * 3.28084);
    if (!heightsFt.some(v => v != null)) return null;
    return { times, heightsFt, extremes: null, source: 'open-meteo' };
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

// Get color for dew point (comfort), based on the dew point in °F regardless
// of the display unit. Below ~55°F feels dry/pleasant; above ~70°F is oppressive.
function getDewpointColor(dewpointC) {
    const f = (dewpointC * 9 / 5) + 32;
    if (f < 55) return '#00e400';   // Dry / pleasant - green
    if (f < 60) return '#9ccc65';   // Comfortable - light green
    if (f < 65) return '#e6d700';   // Slightly humid - yellow
    if (f < 70) return '#ff9800';   // Humid - orange
    return '#ff5252';               // Oppressive - red
}

// A gust is worth showing only when it's genuinely stronger than the sustained
// wind — at least 18 mph and at least 5 mph above the sustained speed. Below
// that it's noise that would only clutter the compact wind display. Thresholds
// are in mph (the API's native wind unit), independent of the display unit.
function isMaterialGust(windSpeed, windGust) {
    return typeof windGust === 'number' && typeof windSpeed === 'number' &&
        windGust >= 18 && (windGust - windSpeed) >= 5;
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
let currentConditions = { aqi: null, humidity: null, dewpoint: null, windSpeed: null, windDir: null, windGust: null };

// The hourly index whose time is the last one at or before "now" in the
// location's timezone. Used only as a fallback when Open-Meteo's dedicated
// current-conditions block (or an individual variable within it) is missing.
function getNearestHourlyIndex() {
    const times = weatherData.hourly.time;
    const now = getLocationNow();
    let idx = 0;
    for (let i = 0; i < times.length; i++) {
        if (new Date(times[i]) <= now) idx = i;
        else break;
    }
    return idx;
}

// Populate currentConditions (humidity, dew point, wind, gust) and return the
// header temperature and feels-like, preferring Open-Meteo's dedicated
// `current` snapshot and falling back to the nearest hourly value for any
// variable the current block doesn't supply.
function applyCurrentConditions() {
    if (!weatherData) return { currentTemp: null, feelsLike: null };
    const cur = weatherData.current || {};
    const hourly = weatherData.hourly;
    const idx = getNearestHourlyIndex();
    // Prefer the current value when it's a finite number; otherwise fall back
    // to the nearest hour. `null`/`undefined`/NaN all trip the fallback.
    const pick = (curVal, hourlyArr) =>
        (typeof curVal === 'number' && Number.isFinite(curVal))
            ? curVal
            : (hourlyArr ? hourlyArr[idx] : null);

    const tempC = pick(cur.temperature_2m, hourly.temperature_2m);
    const feelsC = pick(cur.apparent_temperature, hourly.apparent_temperature);
    currentConditions.humidity = pick(cur.relative_humidity_2m, hourly.relative_humidity_2m);
    currentConditions.dewpoint = pick(cur.dew_point_2m, hourly.dew_point_2m);
    currentConditions.windSpeed = pick(cur.wind_speed_10m, hourly.wind_speed_10m);
    currentConditions.windDir = pick(cur.wind_direction_10m, hourly.wind_direction_10m);
    currentConditions.windGust = pick(cur.wind_gusts_10m, hourly.wind_gusts_10m);

    return {
        currentTemp: tempC == null ? null : formatTempValue(tempC),
        feelsLike: feelsC == null ? null : formatTempValue(feelsC)
    };
}

// Render conditions bar (AQI, humidity, wind) on a single compact line
function renderConditionsBar() {
    const el = document.getElementById('conditions-bar');
    if (!el) return;

    const { aqi, humidity, dewpoint, windSpeed, windDir, windGust } = currentConditions;
    const parts = [];

    if (aqi != null) {
        const color = getAQIColor(aqi);
        parts.push(`<span style="color:${color}">AQI ${Math.round(aqi)}</span>`);
    }

    // RH and DP describe the same thing — atmospheric moisture / comfort — so
    // they share one color scale, keyed off the dew point (the better comfort
    // indicator). RH falls back to its own scale only when DP is unavailable.
    const comfortColor = dewpoint != null ? getDewpointColor(dewpoint) : null;

    if (humidity != null) {
        const color = comfortColor || getHumidityColor(humidity);
        parts.push(`<span style="color:${color}">${Math.round(humidity)}% RH</span>`);
    }

    if (dewpoint != null) {
        parts.push(`<span style="color:${comfortColor}">DP ${formatTempValue(dewpoint)}${getTempUnitLabel()}</span>`);
    }

    if (windSpeed != null && windDir != null) {
        // Append a gust only when it's materially stronger than the sustained
        // wind; when shown, color by the larger of the two speeds.
        const showGust = isMaterialGust(windSpeed, windGust);
        const color = getWindColor(showGust ? Math.max(windSpeed, windGust) : windSpeed);
        const dir = getWindDirection(windDir);
        const arrow = String.fromCharCode(8593); // ↑
        const rotation = windDir + 180; // Point arrow in direction wind is going
        const gustStr = showGust ? ` &middot; G ${formatWindSpeed(windGust)}` : '';
        parts.push(`<span style="color:${color}"><span class="cond-wind-icon" style="display:inline-block;transform:rotate(${rotation}deg)">${arrow}</span> ${dir} ${formatWindSpeed(windSpeed)}${gustStr}</span>`);
    }

    if (parts.length === 0) {
        el.innerHTML = '';
        return;
    }

    // Info button explaining the metrics shown in this bar (RH/DP, feels-like,
    // AQI, wind). Content is app-authored, so no escaping needed.
    const infoBtn = '<button class="info-btn cond-info" data-explain="conditions" aria-label="About these conditions">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>' +
        '</svg></button>';

    el.innerHTML = parts.join('<span class="cond-sep">&middot;</span>') +
        '<span class="cond-sep">&middot;</span>' + infoBtn;
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

        item.innerHTML = `<span>${escapeHtml(label)}</span>${alreadyFav ? '<span class="disambiguation-fav-star" title="Already in favorites">★</span>' : ''}`;
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

// Summarize the AM (6am–noon) and PM (noon–6pm) half-days for a date into a
// single most-significant weather code each, using the explicit category
// ranking, with precipitation probability then amount as tie-breakers within a
// category. Also reports whether each half-day mixes rain and snow codes, for
// the compact dual icon. Precipitation type comes from the codes, not the
// temperature.
function getAmPmWeatherCodes(data, targetDate) {
    const hourly = data.hourly;
    const targetDay = new Date(targetDate);
    targetDay.setHours(0, 0, 0, 0);

    let am = null, pm = null; // { code, cat, prob, amt }
    let amHasRain = false, amHasSnow = false;
    let pmHasRain = false, pmHasSnow = false;

    // A candidate beats the current pick if it's a more significant category,
    // or the same category with a higher precip probability, or same category
    // and probability with a higher precip amount.
    const better = (cand, cur) => {
        if (!cur) return true;
        if (cand.cat !== cur.cat) return cand.cat < cur.cat;
        if (cand.prob !== cur.prob) return cand.prob > cur.prob;
        return cand.amt > cur.amt;
    };

    for (let i = 0; i < hourly.time.length; i++) {
        const hourDate = new Date(hourly.time[i]);
        const hourDay = new Date(hourDate);
        hourDay.setHours(0, 0, 0, 0);
        if (hourDay.getTime() !== targetDay.getTime()) continue;

        const hour = hourDate.getHours();
        const code = hourly.weather_code[i];
        const cand = {
            code,
            cat: weatherCodeCategory(code),
            prob: hourly.precipitation_probability[i] || 0,
            amt: hourly.precipitation[i] || 0
        };
        const rainy = isRainCode(code);
        const snowy = isSnow(code);

        if (hour >= 6 && hour < 12) {
            if (better(cand, am)) am = cand;
            if (rainy) amHasRain = true;
            if (snowy) amHasSnow = true;
        } else if (hour >= 12 && hour < 18) {
            if (better(cand, pm)) pm = cand;
            if (rainy) pmHasRain = true;
            if (snowy) pmHasSnow = true;
        }
    }

    return {
        amCode: am ? am.code : null,
        pmCode: pm ? pm.code : null,
        amMixed: amHasRain && amHasSnow,
        pmMixed: pmHasRain && pmHasSnow
    };
}

// Render daily forecast cards - starting from today (current day)
function renderDailyForecast(data) {
    const container = document.getElementById('daily-forecast');
    container.innerHTML = '';
    const days = getChartDays();
    container.dataset.days = String(days);
    container.style.gridTemplateColumns = `repeat(${days}, minmax(0, 1fr))`;

    const daily = data.daily;
    const today = getMidnightToday();
    const showPrecipDetail = isPrecipDetailOn();

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

    for (let i = startIdx; i < daily.time.length && i < startIdx + days; i++) {
        const date = new Date(daily.time[i] + 'T00:00:00');
        const card = document.createElement('div');
        card.className = 'daily-card' + (getTempUnit() === 'K' ? ' kelvin-temp' : '');

        const dailyWeatherCode = daily.weather_code[i];
        const hasSnow = daily.snowfall_sum[i] >= 1; // at least 1 cm to be called a snow day
        const hasPrecip = daily.precipitation_sum[i] > 0;
        const precipProb = daily.precipitation_probability_max[i];
        const windSpeed = daily.wind_speed_10m_max[i];
        const windDir = daily.wind_direction_10m_dominant[i];

        // Get AM/PM summary codes (and mixed rain/snow flags) from hourly data.
        const { amCode, pmCode, amMixed, pmMixed } = getAmPmWeatherCodes(data, date);

        // Changed to min/max order
        const lowTemp = formatTempValue(daily.temperature_2m_min[i]);
        const highTemp = formatTempValue(daily.temperature_2m_max[i]);

        let precipClass = hasSnow ? 'snow' : '';

        // Use AM/PM icons if available, otherwise fall back to the daily icon.
        // Codes are used exactly as reported by Open-Meteo — no temperature
        // override. A half-day that mixes rain and snow gets a compact dual
        // icon with an accessible "Rain and snow during the period" label.
        const amCodeFinal = amCode !== null ? amCode : dailyWeatherCode;
        const pmCodeFinal = pmCode !== null ? pmCode : dailyWeatherCode;
        const mixedIcon = '🌧️❄️';
        const mixedLabel = 'Rain and snow during the period';
        const amIconHtml = amMixed
            ? `<div class="am-icon mixed" title="Morning" role="img" aria-label="Morning: ${mixedLabel}">${mixedIcon}</div>`
            : `<div class="am-icon" title="Morning" role="img" aria-label="Morning: ${getWeatherDesc(amCodeFinal)}">${getWeatherIcon(amCodeFinal)}</div>`;
        const pmIconHtml = pmMixed
            ? `<div class="pm-icon mixed" title="Afternoon" role="img" aria-label="Afternoon: ${mixedLabel}">${mixedIcon}</div>`
            : `<div class="pm-icon" title="Afternoon" role="img" aria-label="Afternoon: ${getWeatherDesc(pmCodeFinal)}">${getWeatherIcon(pmCodeFinal)}</div>`;

        const kClass = getTempUnit() === 'K' ? ' kelvin-units' : '';
        const compact = days >= 10;

        // Always emit the precip rows (empty placeholder when there's no value)
        // so every card has the same rows on the same lines and the data reads
        // straight across the cards.
        const precipInfoHtml = precipProb >= 10
            ? `<div class="precip-info ${precipClass}">${hasSnow ? '❄' : '💧'} ${precipProb}%</div>`
            : `<div class="precip-info placeholder">&nbsp;</div>`;
        const precipAmtStr = hasPrecip ? formatPrecip(daily.precipitation_sum[i], compact) : '';
        const precipAmountHtml = precipAmtStr
            ? `<div class="precip-amount${kClass}">${precipAmtStr}</div>`
            : `<div class="precip-amount placeholder">&nbsp;</div>`;
        // Day-character row ("Brief showers" vs "Steady rain"), only when the
        // Stormcast toggle is on and the cards are wide enough (not the 10-day
        // view). Last row in the card so a wrapped phrase can't misalign the
        // rows above it across cards.
        let precipCharacterHtml = '';
        if (showPrecipDetail && !compact) {
            const character = getDayPrecipCharacter(
                dailyWeatherCode, daily.precipitation_sum[i],
                daily.precipitation_hours ? daily.precipitation_hours[i] : 0,
                daily.snowfall_sum[i]);
            precipCharacterHtml = character
                ? `<div class="precip-character ${character.cls}">${character.label}</div>`
                : `<div class="precip-character placeholder">&nbsp;</div>`;
        }

        if (compact) {
            // Compact daily cards use the daily Open-Meteo code unchanged.
            const dayCode = dailyWeatherCode;
            const dayIcon = getWeatherIcon(dayCode);
            const windRotation = windDir + 180;
            card.innerHTML = `
                <div class="day-name">${getDayName(date, true)}</div>
                <div class="weather-icons">
                    <div class="day-icon" title="${getDayName(date)}" role="img" aria-label="${getDayName(date)}: ${getWeatherDesc(dayCode)}">${dayIcon}</div>
                </div>
                <div class="temp-range">${lowTemp}/${highTemp}${getTempUnitLabel()}</div>
                <div class="wind-info${kClass}"><span class="wind-arrow" style="transform:rotate(${windRotation}deg)" role="img" aria-label="Wind ${getWindDirection(windDir)}">↑</span> ${formatWindSpeed(windSpeed, true)}</div>
                ${precipInfoHtml}
                ${precipAmountHtml}
            `;
        } else {
            card.innerHTML = `
                <div class="day-name">${getDayName(date, true)}</div>
                <div class="weather-icons">
                    ${amIconHtml}
                    ${pmIconHtml}
                </div>
                <div class="temp-range">${lowTemp} | ${highTemp} ${getTempUnitLabel()}</div>
                <div class="wind-info${kClass}">${getWindDirection(windDir)} ${formatWindSpeed(windSpeed)}</div>
                ${precipInfoHtml}
                ${precipAmountHtml}
                ${precipCharacterHtml}
            `;
        }

        container.appendChild(card);
    }
}

// Render the short-term precipitation outlook strip above the forecast chart:
// a ~2-hour nowcast from the 15-minute precipitation series ("Rain expected
// around 3:15 PM"), or — when nothing is imminent — the next hour with a
// likely (≥50%) chance of precipitation from the hourly forecast ("Next likely
// rain Tue at 2:00 PM · 60%"). One short line; hidden entirely via CSS when
// empty. All content is internally generated, so no escaping is needed.
//
// Day-of-week label for the outlook strip: just the weekday name (e.g.
// "Mon"), since within the 11-day forecast window that's unambiguous. The
// day-of-month is appended only when the date is more than a week out,
// where a bare weekday name could otherwise mean either of two Mondays.
const OUTLOOK_DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function outlookDayLabel(date, now) {
    const todayMid = new Date(now);
    todayMid.setHours(0, 0, 0, 0);
    const dateMid = new Date(date);
    dateMid.setHours(0, 0, 0, 0);
    const diffDays = Math.round((dateMid - todayMid) / 86400000);
    const name = OUTLOOK_DAY_NAMES[date.getDay()];
    return diffDays > 7 ? `${name} ${date.getDate()}` : name;
}

// Minimum precipitation for a 15-minute nowcast interval to count as
// materially wet. A presentation threshold, not a meteorological one: it keeps
// a trace value (drizzle a hundredth of a millimeter, model noise) from
// triggering a "rain expected" message. In millimeters, matching the API.
const MIN_NOWCAST_PRECIP_MM = 0.05;

// "Likely" is an hourly precipitation probability of at least this percent.
// Used internally to pick the next notable hour; not surfaced as a definition
// in the main interface.
const OUTLOOK_LIKELY_PROB = 50;

function renderPrecipOutlook(data) {
    const el = document.getElementById('precip-outlook');
    if (!el) return;
    // Opt-in alongside the rest of the storm/intensity detail; hidden (via
    // the :empty CSS rule) when the Stormcast toggle is off.
    if (!isPrecipDetailOn()) {
        el.innerHTML = '';
        return;
    }
    const now = getLocationNow();
    const hourly = data.hourly;
    const emoji = (e) => `<span aria-hidden="true">${e}</span>`;
    let html = '';

    // A 15-minute interval is materially wet only when its precipitation is a
    // finite number at or above the presentation threshold.
    const wet = (v) => Number.isFinite(v) && v >= MIN_NOWCAST_PRECIP_MM;

    // The hourly index covering a given instant (last hour at or before it),
    // used to tell whether precipitation at that time is snow.
    const hourIndexFor = (date) => {
        let idx = 0;
        for (let i = 0; i < hourly.time.length; i++) {
            if (new Date(hourly.time[i]) <= date) idx = i;
            else break;
        }
        return idx;
    };
    // Snow if the covering hour reports snowfall or carries a snow weather code.
    const snowAt = (date) => {
        const i = hourIndexFor(date);
        return (hourly.snowfall && hourly.snowfall[i] > 0) || isSnow(hourly.weather_code[i]);
    };

    // Nowcast: scan the next ~2 hours of 15-minute steps.
    const m15 = data.minutely_15;
    if (m15 && Array.isArray(m15.time) && Array.isArray(m15.precipitation)) {
        let idx = -1;
        for (let i = 0; i < m15.time.length; i++) {
            if (new Date(m15.time[i]) > now) { idx = i - 1; break; }
        }
        if (idx >= 0) {
            const horizon = Math.min(idx + 9, m15.precipitation.length);
            if (wet(m15.precipitation[idx])) {
                // Materially wet now — find when it eases (two consecutive dry
                // steps so a single dry gap between cells doesn't read as an end).
                let ease = -1;
                for (let i = idx + 1; i < horizon; i++) {
                    if (!wet(m15.precipitation[i]) &&
                        (i + 1 >= m15.precipitation.length || !wet(m15.precipitation[i + 1]))) {
                        ease = i;
                        break;
                    }
                }
                const snow = snowAt(now);
                const word = snow ? 'Snow' : 'Rain';
                const ic = snow ? '❄' : '🌧';
                html = ease >= 0
                    ? `${emoji(ic)} ${word} expected through ${formatTime(new Date(m15.time[ease]))}`
                    : `${emoji(ic)} ${word} expected now`;
            } else {
                // Dry now — find the first materially-wet step within the window.
                let start = -1;
                for (let i = idx + 1; i < horizon; i++) {
                    if (wet(m15.precipitation[i])) { start = i; break; }
                }
                if (start >= 0) {
                    const startDate = new Date(m15.time[start]);
                    const snow = snowAt(startDate);
                    const word = snow ? 'Snow' : 'Rain';
                    const ic = snow ? '🌨' : '🌦';
                    html = `${emoji(ic)} ${word} expected around ${formatTime(startDate)}`;
                }
            }
        }
    }

    // Nothing imminent: point at the next likely (≥50%) hour in the forecast.
    if (!html) {
        let next = -1;
        for (let i = 0; i < hourly.time.length; i++) {
            if (new Date(hourly.time[i]) < now) continue;
            if (hourly.precipitation_probability[i] >= OUTLOOK_LIKELY_PROB) { next = i; break; }
        }
        if (next >= 0) {
            const d = new Date(hourly.time[next]);
            const snow = snowAt(d);
            const what = snow ? 'snow' : 'rain';
            html = `${emoji(snow ? '❄' : '💧')} Next likely ${what} ${outlookDayLabel(d, now)} at ${formatTime(d)} · ${hourly.precipitation_probability[next]}%`;
        } else {
            const last = new Date(hourly.time[hourly.time.length - 1]);
            html = `${emoji('☀')} No likely rain through ${outlookDayLabel(last, now)}`;
        }
    }

    el.innerHTML = html;
}

// Render hourly forecast cards
function renderHourlyForecast(data) {
    const container = document.getElementById('hourly-forecast');
    container.innerHTML = '';

    const hourly = data.hourly;
    const now = getLocationNow();

    // Tide height per hour, shown in the cards only when the Tides toggle is on
    // (same on/off state as the chart tide line and the table rows).
    const showTide = isTideLineOn() && hasTideSeries();
    const showPrecipDetail = isPrecipDetailOn();
    let tideByTime = null;
    if (showTide) {
        tideByTime = {};
        for (let i = 0; i < tideData.times.length; i++) {
            tideByTime[tideData.times[i]] = tideData.heightsFt[i];
        }
    }

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
        // For clear/partly-cloudy night hours, show the actual lunar phase glyph
        // (matching the astronomy table) instead of a generic crescent.
        const moonEmoji = isNight
            ? getMoonPhaseInfo(SunCalc.getMoonIllumination(date).phase).emoji
            : '🌙';

        const card = document.createElement('div');
        card.className = 'hourly-card';

        const dayStr = date.toDateString();
        // Every card reserves the day-banner slot so the rows below line up
        // across cards; only the first card of each day fills it.
        let dayLabelHtml;
        if (dayStr !== currentDay) {
            currentDay = dayStr;
            dayLabelHtml = `<div class="day-label">${getDayName(date, true)}</div>`;
        } else {
            dayLabelHtml = `<div class="day-label placeholder">&nbsp;</div>`;
        }

        const weatherCode = hourly.weather_code[i];
        const precipProb = hourly.precipitation_probability[i];
        const precip = hourly.precipitation[i];
        const snowfall = hourly.snowfall[i];
        const hasSnow = snowfall > 0;
        const windSpeed = hourly.wind_speed_10m[i];
        const windDir = hourly.wind_direction_10m[i];
        const windGust = hourly.wind_gusts_10m ? hourly.wind_gusts_10m[i] : null;
        const temp = formatTempValue(hourly.temperature_2m[i]);
        const apparentTemp = formatTempValue(hourly.apparent_temperature[i]);
        const tideFt = showTide ? tideByTime[hourly.time[i]] : null;

        let precipClass = hasSnow ? 'snow' : '';

        // Show windchill if it differs from actual temp by more than 2 degrees
        const showWindchill = Math.abs(temp - apparentTemp) > 2;

        const feelsLabel = isCIT2000() ? 'Vibes' : 'Feels';
        const hkClass = getTempUnit() === 'K' ? ' kelvin-units' : '';

        // Each optional row is always emitted (empty placeholder when it has no
        // value) so the same fields sit on the same line across every card.
        const windchillHtml = showWindchill
            ? `<div class="windchill">${feelsLabel} ${apparentTemp}${getTempUnitLabel()}</div>`
            : `<div class="windchill placeholder">&nbsp;</div>`;
        const precipChanceHtml = precipProb >= 10
            ? `<div class="precip-chance ${precipClass}">${hasSnow ? '❄' : '💧'} ${precipProb}%</div>`
            : `<div class="precip-chance placeholder">&nbsp;</div>`;
        const precipStr = precip > 0 ? formatPrecip(precip) : '';
        const precipAmountHtml = precipStr
            ? `<div class="precip-amount${hkClass}">${precipStr}</div>`
            : `<div class="precip-amount placeholder">&nbsp;</div>`;
        // Storm/intensity row, only when the Stormcast toggle is on. Like
        // the tide row, it reserves its slot on every card so values line up.
        let precipDetailHtml = '';
        if (showPrecipDetail) {
            const tag = getStormSignal(weatherCode, hourly.cape ? hourly.cape[i] : 0, precipProb || 0)
                || getPrecipIntensity(precip, snowfall);
            precipDetailHtml = tag
                ? `<div class="precip-detail ${tag.cls}">${tag.label}</div>`
                : `<div class="precip-detail placeholder">&nbsp;</div>`;
        }
        // The tide row only exists when the Tides toggle is on; then it reserves
        // a slot on every card so the tide values line up.
        let tideHtml = '';
        if (showTide) {
            tideHtml = tideFt != null
                ? `<div class="hourly-tide">🌊 ${formatTideHeight(tideFt, true)}</div>`
                : `<div class="hourly-tide placeholder">&nbsp;</div>`;
        }

        card.innerHTML = `
            ${dayLabelHtml}
            <div class="hour">${formatHour(date)}</div>
            <div class="weather-icon" role="img" aria-label="${getWeatherDesc(weatherCode)}">${getWeatherIcon(weatherCode, isNight, moonEmoji)}</div>
            <div class="temp">${temp}${getTempUnitLabel()}</div>
            ${windchillHtml}
            <div class="wind${hkClass}">
                ${getWindDirection(windDir)} ${formatWindSpeed(windSpeed)}${showPrecipDetail && isMaterialGust(windSpeed, windGust) ? ` &middot; G ${formatWindSpeed(windGust)}` : ''}
            </div>
            ${precipChanceHtml}
            ${precipAmountHtml}
            ${precipDetailHtml}
            ${tideHtml}
        `;

        container.appendChild(card);
    }

    // Seed the section-header day indicator immediately so it shows the current
    // day/date without waiting for the user to scroll. The scroll handler keeps
    // it updated thereafter.
    const dayIndicator = document.getElementById('hourly-day-indicator');
    if (dayIndicator) {
        const firstLabel = container.querySelector('.day-label:not(.placeholder)');
        dayIndicator.textContent = firstLabel ? firstLabel.textContent : '';
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

        // Draw temperature grid lines (every 10°F) - pink/red color.
        // Skipped when the temperature line is toggled off via its legend.
        const tempMin = Math.floor(yTempScale.min / 10) * 10;
        const tempMax = Math.ceil(yTempScale.max / 10) * 10;

        ctx.strokeStyle = gridColors.tempGridLine;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);

        const showTempGrid = isChartLineVisible('temp') || isChartLineVisible('feelsLike');
        for (let temp = tempMin; showTempGrid && temp <= tempMax; temp += 10) {
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

        // Draw precipitation amount grid lines (one per unit step) - green color.
        // Skipped when the precip-amount line is toggled off via its legend.
        const precipCfg = getChartPrecipConfig();
        const precipMax = Math.ceil(yPrecipScale.max / precipCfg.step) * precipCfg.step;

        ctx.strokeStyle = gridColors.precipGridLine;
        ctx.setLineDash([3, 3]);

        for (let n = 1; isChartLineVisible('precipAmount'); n++) {
            const precip = n * precipCfg.step;
            if (precip > precipMax + precipCfg.step * 0.001) break;
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
                ctx.fillText(`${precip.toFixed(precipCfg.gridDecimals)}${precipCfg.suffix}`, chartArea.right - 2, y - 2);
            }
        }

        // Wind (left) and tide (right) axis units. These lines have their own
        // scales, so rather than add more full-width gridlines we draw a few
        // short edge ticks labelled with units. Labels sit below each tick so
        // they don't collide with the temp/precip labels (which sit above).
        const drawUnitAxis = (scale, side, color, fmt) => {
            if (!scale || typeof scale.min !== 'number') return;
            const vals = [scale.min, (scale.min + scale.max) / 2, scale.max];
            ctx.setLineDash([]);
            ctx.strokeStyle = color;
            ctx.fillStyle = color;
            ctx.font = '9px sans-serif';
            ctx.lineWidth = 1;
            const isLeft = side === 'left';
            ctx.textAlign = isLeft ? 'left' : 'right';
            const xEdge = isLeft ? chartArea.left : chartArea.right;
            const xTick = isLeft ? chartArea.left + 6 : chartArea.right - 6;
            const xText = isLeft ? chartArea.left + 8 : chartArea.right - 8;
            vals.forEach(v => {
                const y = scale.getPixelForValue(v);
                if (y < chartArea.top || y > chartArea.bottom) return;
                ctx.beginPath();
                ctx.moveTo(xEdge, y);
                ctx.lineTo(xTick, y);
                ctx.stroke();
                ctx.fillText(fmt(v), xText, Math.min(chartArea.bottom - 1, y + 10));
            });
        };
        if (isChartLineVisible('wind')) {
            drawUnitAxis(chart.scales['y-wind'], 'left', gridColors.windBorder, v => formatWindSpeed(v, true));
        }
        if (isTideLineOn() && hasTideSeries()) {
            drawUnitAxis(chart.scales['y-tide'], 'right', gridColors.tideBorder, v => formatTideHeight(v, true));
        }
        if (isChartLineVisible('uv')) {
            drawUnitAxis(chart.scales['y-uv'], 'right', gridColors.uvBorder, v => `UV ${Math.round(v)}`);
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

        // Hour-of-day markers — only when the visible range is short enough
        // for the chart to have room for them. 1 day: every hour. 3 days:
        // every 6h. 5 days: noon only. Labels sit near the top of the chart
        // (below the "now" label, which is drawn afterward at the same edge).
        const days = (typeof getChartDays === 'function') ? getChartDays() : 7;
        let hourTicks = null;
        if (days === 1) {
            // Label density follows the real pixel width: an hour label needs
            // ~26px to stay legible, so narrow (portrait phone) charts drop to
            // every 2nd or 3rd hour instead of overlapping all 24.
            const pxPerHour = (chartArea.right - chartArea.left) / Math.max(1, labels.length);
            const step = pxPerHour >= 26 ? 1 : (pxPerHour >= 14 ? 2 : 3);
            hourTicks = Array.from({ length: 24 }, (_, h) => h).filter(h => h % step === 0);
        } else if (days <= 3) {
            hourTicks = [6, 12, 18];
        } else if (days <= 5) {
            hourTicks = [12];
        }

        if (hourTicks) {
            const use24 = (typeof getTimeFormat === 'function') && getTimeFormat() === '24';
            const hourLabel = (h) => {
                if (use24) return String(h).padStart(2, '0');
                if (h === 0) return '12a';
                if (h === 12) return 'noon';
                return h < 12 ? `${h}a` : `${h - 12}p`;
            };

            ctx.strokeStyle = isLightTheme ? 'rgba(0, 0, 0, 0.07)' : 'rgba(255, 255, 255, 0.08)';
            ctx.setLineDash([2, 4]);
            ctx.lineWidth = 1;
            ctx.fillStyle = isLightTheme ? 'rgba(0, 0, 0, 0.5)' : 'rgba(255, 255, 255, 0.55)';
            ctx.font = '9px sans-serif';
            ctx.textAlign = 'center';

            labels.forEach((label, index) => {
                const date = new Date(label);
                if (date.getMinutes() !== 0) return;
                if (!hourTicks.includes(date.getHours())) return;
                const x = chart.scales.x.getPixelForValue(index);
                ctx.beginPath();
                ctx.moveTo(x, chartArea.top);
                ctx.lineTo(x, chartArea.bottom);
                ctx.stroke();
                ctx.fillText(hourLabel(date.getHours()), x, chartArea.top + 20);
            });
        }

        // "Now" marker — a thin vertical line separating past actuals from
        // future forecast, plus a subtle tint behind the past hours.
        const nowIndex = chart.data.nowIndex;
        if (typeof nowIndex === 'number' && nowIndex > 0 && nowIndex < labels.length) {
            const xScale = chart.scales.x;
            const nowX = xScale.getPixelForValue(nowIndex - 0.5);

            ctx.fillStyle = isLightTheme ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.03)';
            ctx.fillRect(chartArea.left, chartArea.top, nowX - chartArea.left, chartArea.bottom - chartArea.top);

            ctx.strokeStyle = isLightTheme ? 'rgba(0, 0, 0, 0.45)' : 'rgba(255, 255, 255, 0.5)';
            ctx.setLineDash([3, 3]);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(nowX, chartArea.top);
            ctx.lineTo(nowX, chartArea.bottom);
            ctx.stroke();

            ctx.setLineDash([]);
            ctx.fillStyle = isLightTheme ? 'rgba(0, 0, 0, 0.6)' : 'rgba(255, 255, 255, 0.7)';
            ctx.font = '9px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText('now', nowX + 3, chartArea.top + 10);
        }

        ctx.restore();
    }
};

// Register the plugin. This runs at module-parse time, so guard against Chart
// being unavailable (CDN blocked/down, or a bad "latest" build that failed to
// define the global): a bare `Chart.register(...)` would throw a ReferenceError
// that aborts the rest of app.js, leaving the whole app — forecast, radar,
// tides, alerts — dead with no data. Degrade to "chart missing" instead.
if (typeof Chart !== 'undefined') {
    Chart.register(gridLinesPlugin);
} else {
    console.error('Chart.js failed to load; the forecast chart will be unavailable, but the rest of the app will still load.');
}

// Custom tooltip positioner — anchors the tooltip in the corner diagonally
// opposite the cursor's quadrant so the highlighted point is never covered.
if (typeof Chart !== 'undefined' && Chart.Tooltip && Chart.Tooltip.positioners) {
    Chart.Tooltip.positioners.corner = function(elements, eventPosition) {
        const chart = this.chart;
        const area = chart.chartArea;
        if (!area) return false;
        const cx = (area.left + area.right) / 2;
        const cy = (area.top + area.bottom) / 2;
        const inset = 6;
        const inLeft = eventPosition.x < cx;
        const inTop = eventPosition.y < cy;
        return {
            x: inLeft ? area.right - inset : area.left + inset,
            y: inTop ? area.bottom - inset : area.top + inset,
            xAlign: inLeft ? 'right' : 'left',
            yAlign: inTop ? 'bottom' : 'top'
        };
    };
}

// Get theme-aware chart colors (adapts to dark/light/CIT2000 modes)
function getChartColors() {
    const styles = getComputedStyle(document.documentElement);
    const tempRed = styles.getPropertyValue('--temp-red').trim();
    const precipBlue = styles.getPropertyValue('--precip-blue').trim();
    const precipGreen = styles.getPropertyValue('--precip-green').trim();
    const tidePurple = styles.getPropertyValue('--tide-purple').trim();
    const windOrange = styles.getPropertyValue('--wind-orange').trim();
    const uvViolet = styles.getPropertyValue('--uv-violet').trim();
    const stormIndigo = styles.getPropertyValue('--storm-indigo').trim();

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
        feelsBorder: tempRed,
        precipProbBorder: precipBlue,
        precipProbBg: hexToRgba(precipBlue, 0.1),
        precipAmountBorder: precipGreen,
        precipAmountBg: hexToRgba(precipGreen, 0.3),
        tideBorder: tidePurple,
        windBorder: windOrange,
        uvBorder: uvViolet,
        tempGridLine: hexToRgba(tempRed, 0.3),
        tempGridLabel: hexToRgba(tempRed, 0.7),
        precipGridLine: hexToRgba(precipGreen, 0.3),
        precipGridLabel: hexToRgba(precipGreen, 0.7),
        // Intensity-tier colors for the storm-detail chart fill
        moderateBorder: precipBlue,
        moderateBg: hexToRgba(precipBlue, 0.3),
        heavyBorder: windOrange,
        heavyBg: hexToRgba(windOrange, 0.35),
        stormBorder: stormIndigo,
        stormBg: hexToRgba(stormIndigo, 0.4)
    };
}

// True on phone-class viewports (either dimension under 480px) — used to pick
// compact chart tooltip sizing at render time.
function isCompactChartViewport() {
    return Math.min(window.innerWidth, window.innerHeight) < 480;
}

// Re-render the chart when the viewport class changes (rotation, split-screen
// or window resize across the phone/desktop threshold). Chart.js already
// redraws the canvas responsively — including the gridLinesPlugin, which reads
// the live chart area — but tooltip sizing is fixed at render time, so a full
// re-render is needed only when the compact flag flips. Debounced, and a no-op
// for iOS toolbar collapse/expand resizes, which never cross the threshold.
let lastChartViewportCompact = isCompactChartViewport();
let chartViewportResizeTimer = null;
window.addEventListener('resize', () => {
    clearTimeout(chartViewportResizeTimer);
    chartViewportResizeTimer = setTimeout(() => {
        const compact = isCompactChartViewport();
        if (compact !== lastChartViewportCompact) {
            lastChartViewportCompact = compact;
            if (weatherData) renderChart(weatherData);
        }
    }, 150);
});

// Render the temperature/precipitation chart - starting from midnight today
function renderChart(data) {
    // If Chart.js is unavailable, skip the chart rather than throwing — the
    // caller (loadWeather) renders the radar, alerts, and astro sections after
    // this, and they must not be taken down by a missing chart library.
    if (typeof Chart === 'undefined') return;
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

    const hours = getChartDays() * 24;
    const endIndex = Math.min(startIndex + hours, hourly.time.length);

    // Tide line is only drawn for coastal locations when the toggle is on.
    // Tide times are hourly local wall-clock strings that line up with the
    // weather API's hourly times, so look heights up by time string (feet).
    const showTide = isTideLineOn() && hasTideSeries();
    let tideByTime = null;
    if (showTide) {
        tideByTime = {};
        for (let i = 0; i < tideData.times.length; i++) {
            tideByTime[tideData.times[i]] = tideData.heightsFt[i];
        }
    }

    const labels = [];
    const temps = [];
    const feelsLikeTemps = [];
    const precipProbs = [];
    const precipAmounts = [];
    const tideHeights = [];
    const windSpeeds = [];
    const uvValues = [];
    const isDayFlags = [];
    const precipCfg = getChartPrecipConfig();

    for (let i = startIndex; i < endIndex; i++) {
        const date = new Date(hourly.time[i]);
        labels.push(date);
        const tu = getTempUnit();
        temps.push(tu === 'K' ? hourly.temperature_2m[i] + 273.15 : (tu === 'C' ? hourly.temperature_2m[i] : (hourly.temperature_2m[i] * 9/5) + 32));
        const fl = hourly.apparent_temperature[i];
        feelsLikeTemps.push(fl == null ? null : (tu === 'K' ? fl + 273.15 : (tu === 'C' ? fl : (fl * 9/5) + 32)));
        precipProbs.push(hourly.precipitation_probability[i]);
        precipAmounts.push(hourly.precipitation[i] * precipCfg.factor);
        // Wind speed is stored in mph; the tooltip converts for display.
        windSpeeds.push(hourly.wind_speed_10m[i]);
        // UV index is a unitless 0–11+ scale, the same across all display modes.
        uvValues.push(hourly.uv_index ? hourly.uv_index[i] : null);
        isDayFlags.push(hourly.is_day[i]);
        if (showTide) {
            const ft = tideByTime[hourly.time[i]];
            tideHeights.push(ft == null ? null : ft);
        }
    }

    // Index of the first future hour, used to draw the "now" marker and its
    // subtle tint behind elapsed hours. The forecast values for past hours are
    // shown as returned by Open-Meteo — the probabilities are not overwritten.
    const locationNow = getLocationNow();
    let nowIndex = -1;
    for (let i = 0; i < labels.length; i++) {
        if (labels[i] >= locationNow) {
            nowIndex = i;
            break;
        }
    }
    if (nowIndex === -1) nowIndex = labels.length;

    // When the feels-like line is on, factor its values into the axis range so
    // the dashed line never clips outside the temperature scale.
    const tempScaleValues = isChartLineVisible('feelsLike')
        ? temps.concat(feelsLikeTemps.filter(v => v != null))
        : temps;
    const minTemp = Math.min(...tempScaleValues);
    const maxTemp = Math.max(...tempScaleValues);
    const tempRange = maxTemp - minTemp;

    // Round to nearest 10 for cleaner grid
    const tempScaleMin = Math.floor((minTemp - tempRange * 0.1) / 10) * 10;
    const tempScaleMax = Math.ceil((maxTemp + tempRange * 0.1) / 10) * 10;

    const maxPrecipAmount = Math.max(precipCfg.step, ...precipAmounts);
    // Round up to the nearest gridline step for a cleaner grid
    const precipScaleMax = Math.ceil(maxPrecipAmount * 1.2 / precipCfg.step) * precipCfg.step;

    // Text alternative for the chart canvas (it's role="img"). The detailed
    // hourly numbers are also available as text in the hourly forecast cards.
    const chartCanvas = document.getElementById('forecast-chart');
    if (chartCanvas) {
        const peakProb = Math.round(Math.max(0, ...precipProbs.filter(p => p != null)));
        chartCanvas.setAttribute('aria-label',
            `Forecast chart over ${getChartDays()} days. Temperature ranges from ${Math.round(minTemp)} to ${Math.round(maxTemp)} ${getTempUnitLabel()}. Peak precipitation chance ${peakProb} percent. Hourly details are listed below in the hourly forecast.`);
    }

    // Tide axis scale (feet), padded so the curve doesn't touch the edges.
    let tideScaleMin = 0, tideScaleMax = 1;
    if (showTide) {
        const tideVals = tideHeights.filter(v => v != null);
        if (tideVals.length) {
            const minTide = Math.min(...tideVals);
            const maxTide = Math.max(...tideVals);
            const pad = Math.max((maxTide - minTide) * 0.15, 0.5);
            tideScaleMin = minTide - pad;
            tideScaleMax = maxTide + pad;
        }
    }

    // Wind axis scale (mph), from 0 up to a padded max.
    const maxWind = Math.max(5, ...windSpeeds.filter(v => v != null));
    const windScaleMax = Math.ceil(maxWind * 1.2 / 5) * 5;

    // UV axis scale (unitless), from 0 up to a padded whole-number max. A floor
    // of 2 keeps the line readable on low-UV days.
    const maxUv = Math.max(2, ...uvValues.filter(v => v != null));
    const uvScaleMax = Math.ceil(maxUv * 1.1);

    if (forecastChart) {
        forecastChart.destroy();
    }

    const colors = getChartColors();

    // Intensity-colored precip fill: when the Stormcast toggle is on and the
    // range is short enough to read hour-level detail (1D/3D), color the
    // precip-amount line and fill by the same tiers as the cards — green
    // light, blue moderate, orange heavy — with thunderstorm-coded hours in
    // the storm indigo. Longer ranges keep the flat green: at 5+ days the
    // segments are too narrow to read as anything but noise.
    const stormFill = isPrecipDetailOn() && getChartDays() <= 3;
    let precipSegBorders = null;
    let precipSegBgs = null;
    if (stormFill) {
        precipSegBorders = [];
        precipSegBgs = [];
        for (let i = startIndex; i < endIndex; i++) {
            const tier = getPrecipIntensity(hourly.precipitation[i], hourly.snowfall[i]);
            if (hourly.weather_code[i] >= 95) {
                precipSegBorders.push(colors.stormBorder);
                precipSegBgs.push(colors.stormBg);
            } else if (tier && tier.cls === 'heavy') {
                precipSegBorders.push(colors.heavyBorder);
                precipSegBgs.push(colors.heavyBg);
            } else if (tier && tier.cls === 'moderate') {
                precipSegBorders.push(colors.moderateBorder);
                precipSegBgs.push(colors.moderateBg);
            } else {
                precipSegBorders.push(colors.precipAmountBorder);
                precipSegBgs.push(colors.precipAmountBg);
            }
        }
    }

    forecastChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            isDayFlags: isDayFlags,
            nowIndex: nowIndex,
            datasets: [
                ...(isChartLineVisible('temp') ? [{
                    label: 'Temperature',
                    data: temps,
                    borderColor: colors.tempBorder,
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    yAxisID: 'y-temp'
                }] : []),
                ...(isChartLineVisible('feelsLike') ? [{
                    label: 'Feels Like',
                    data: feelsLikeTemps,
                    borderColor: colors.feelsBorder,
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    borderDash: [5, 4],
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    spanGaps: true,
                    yAxisID: 'y-temp'
                }] : []),
                ...(isChartLineVisible('precipProb') ? [{
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
                }] : []),
                ...(isChartLineVisible('precipAmount') ? [{
                    label: 'Precipitation Amount',
                    data: precipAmounts,
                    borderColor: colors.precipAmountBorder,
                    backgroundColor: colors.precipAmountBg,
                    borderWidth: 2,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    fill: true,
                    yAxisID: 'y-precip-amount',
                    // A segment spans points p1DataIndex-1 → p1DataIndex;
                    // color it by the tier of the hour it leads into.
                    ...(stormFill ? {
                        segment: {
                            borderColor: (c) => precipSegBorders[c.p1DataIndex],
                            backgroundColor: (c) => precipSegBgs[c.p1DataIndex]
                        }
                    } : {})
                }] : []),
                ...(isChartLineVisible('wind') ? [{
                    label: 'Wind',
                    data: windSpeeds,
                    borderColor: colors.windBorder,
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    yAxisID: 'y-wind'
                }] : []),
                ...(isChartLineVisible('uv') ? [{
                    label: 'UV Index',
                    data: uvValues,
                    borderColor: colors.uvBorder,
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    spanGaps: true,
                    yAxisID: 'y-uv'
                }] : []),
                ...(showTide ? [{
                    label: tideSeriesLabel(),
                    data: tideHeights,
                    borderColor: colors.tideBorder,
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    borderDash: [5, 4],
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    spanGaps: true,
                    yAxisID: 'y-tide'
                }] : [])
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            // Headroom above the plot: gridLinesPlugin draws axis labels 2px
            // above each gridline, so the topmost label (e.g. the max precip
            // amount) needs canvas space above the chart area or it clips.
            layout: {
                padding: { top: 14 }
            },
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
                    // Compact tooltip on phones so it covers less of the plot
                    padding: isCompactChartViewport() ? 7 : 12,
                    titleFont: { size: isCompactChartViewport() ? 11 : 12 },
                    bodyFont: { size: isCompactChartViewport() ? 11 : 12 },
                    displayColors: true,
                    position: 'corner',
                    caretSize: 0,
                    caretPadding: 0,
                    callbacks: {
                        title: function(context) {
                            const date = new Date(context[0].label);
                            const use24 = getTimeFormat() === '24';
                            const formatted = date.toLocaleString(use24 ? 'en-GB' : 'en-US', {
                                weekday: 'short',
                                month: 'short',
                                day: 'numeric',
                                hour: use24 ? '2-digit' : 'numeric',
                                ...(use24 ? { minute: '2-digit' } : {})
                            });
                            const isPast = date < getLocationNow();
                            return isPast ? `${formatted} · past` : formatted;
                        },
                        label: function(context) {
                            const axis = context.dataset.yAxisID;
                            if (axis === 'y-temp') {
                                if (context.raw == null) return null;
                                return `${context.dataset.label}: ${Math.round(context.raw)}${getTempUnitLabel()}`;
                            } else if (axis === 'y-precip-prob') {
                                if (context.raw == null) return null;
                                return `Precip Chance: ${context.raw}%`;
                            } else if (axis === 'y-tide') {
                                if (context.raw == null) return null;
                                const sign = context.raw >= 0 ? '+' : '';
                                return `${tideSeriesLabel()}: ${sign}${formatTideHeight(context.raw, true)}`;
                            } else if (axis === 'y-wind') {
                                return `Wind: ${formatWindSpeed(context.raw)}`;
                            } else if (axis === 'y-uv') {
                                if (context.raw == null) return null;
                                return `UV Index: ${Math.round(context.raw)}`;
                            } else {
                                const cfg = getChartPrecipConfig();
                                const amt = context.raw < cfg.step / 10 ? 0 : context.raw;
                                return `Precip Amount: ${amt.toFixed(cfg.tipDecimals)}${cfg.suffix}`;
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
                },
                'y-tide': {
                    display: false,
                    position: 'right',
                    min: tideScaleMin,
                    max: tideScaleMax
                },
                'y-wind': {
                    display: false,
                    position: 'right',
                    min: 0,
                    max: windScaleMax
                },
                'y-uv': {
                    display: false,
                    position: 'right',
                    min: 0,
                    max: uvScaleMax
                }
            }
        }
    });

    // Add legend below chart
    const container = document.querySelector('.chart-container');
    const parent = container.parentNode;
    let legend = parent.querySelector(':scope > .chart-legend');
    if (legend) {
        legend.remove();
    }
    legend = document.createElement('div');
    legend.className = 'chart-legend';

    // Each legend entry is a toggle button that shows/hides its line. The
    // on/off state persists in localStorage, so it carries across every
    // day-range view and reload. Tide reuses the shared isTideLineOn() flag
    // and is only offered for coastal locations. Wind and tide stay selectable
    // on every view, but default off when switching into a 5/7/10-day view.
    // Order matters: the legend is a two-row column-flow grid, so consecutive
    // pairs stack into columns — Temp/Feels Like, Precip %/Precip Amt,
    // Wind/Stormcast, UV/Tide. Stormcast and Tide mirror their respective
    // section-header shortcuts (same state), shown here so the toggles stay
    // discoverable next to what they affect.
    const items = [
        { key: 'temp', cls: 'temp', label: 'Temp', on: isChartLineVisible('temp') },
        { key: 'feelsLike', cls: 'feels', label: 'Feels Like', on: isChartLineVisible('feelsLike') },
        { key: 'precipProb', cls: 'precip-prob', label: 'Precip %', on: isChartLineVisible('precipProb') },
        { key: 'precipAmount', cls: 'precip-amount', label: 'Precip Amt', on: isChartLineVisible('precipAmount') },
        { key: 'wind', cls: 'wind', label: 'Wind', on: isChartLineVisible('wind') },
        { key: 'storms', cls: 'storm', label: 'Stormcast', on: isPrecipDetailOn() },
        { key: 'uv', cls: 'uv', label: 'UV', on: isChartLineVisible('uv') }
    ];
    if (hasTideSeries()) {
        items.push({ key: 'tide', cls: 'tide', label: tideSeriesLabel(), on: isTideLineOn() });
    }
    legend.innerHTML = items.map(it => `
        <button type="button" class="legend-item${it.on ? '' : ' off'}" data-line="${it.key}" aria-pressed="${it.on}">
            <span class="legend-color ${it.cls}"></span>
            <span>${it.label}</span>
        </button>
    `).join('');

    legend.querySelectorAll('.legend-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.dataset.line;
            // Tide and Stormcast are shared toggles with their own render
            // paths (including the chart), so they return early rather than
            // falling through to the plain chart-line tail below.
            if (key === 'tide') {
                toggleTideLine();
                return;
            }
            if (key === 'storms') {
                togglePrecipDetail();
                return;
            }
            const next = toggleChartLine(key);
            trackEvent('chart-line-' + key + '-' + (next ? 'on' : 'off'));
            if (weatherData) renderChart(weatherData);
        });
    });

    container.insertAdjacentElement('afterend', legend);
}

// Cooperative gesture handling for the radar map: never hijack page scroll.
// Desktop: Ctrl/Cmd + wheel zooms; plain wheel falls through to the page.
// Touch: two-finger drag pans; one-finger drag lets the page scroll.
// Idempotent: handlers always act on the current global `radarMap`, so this
// only needs to run once even though the map is destroyed/recreated on
// location changes.
function setupRadarGestureHandling(mapEl) {
    if (mapEl.dataset.gestureSetup === 'true') return;
    mapEl.dataset.gestureSetup = 'true';

    // Attach hint to the .radar-container parent so it survives Leaflet's
    // container teardown when the map is rebuilt for a new location.
    const hintHost = mapEl.parentElement || mapEl;
    const hint = document.createElement('div');
    hint.className = 'radar-gesture-hint';
    hintHost.appendChild(hint);

    let hintTimer = null;
    const showHint = (msg) => {
        hint.textContent = msg;
        hint.classList.add('visible');
        clearTimeout(hintTimer);
        hintTimer = setTimeout(() => hint.classList.remove('visible'), 1400);
    };

    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    const zoomHint = isMac ? 'Hold ⌘ + scroll to zoom' : 'Hold Ctrl + scroll to zoom';

    mapEl.addEventListener('wheel', (e) => {
        if (!radarMap) return;
        if (e.ctrlKey || e.metaKey) {
            if (!radarMap.scrollWheelZoom.enabled()) radarMap.scrollWheelZoom.enable();
        } else {
            if (radarMap.scrollWheelZoom.enabled()) radarMap.scrollWheelZoom.disable();
            showHint(zoomHint);
        }
    }, { passive: true });

    let singleTouchHintShown = false;
    mapEl.addEventListener('touchstart', (e) => {
        if (!radarMap) return;
        if (e.touches.length >= 2) {
            if (!radarMap.dragging.enabled()) radarMap.dragging.enable();
        } else {
            if (radarMap.dragging.enabled()) radarMap.dragging.disable();
            singleTouchHintShown = false;
        }
    }, { capture: true, passive: true });

    mapEl.addEventListener('touchmove', (e) => {
        if (e.touches.length < 2 && !singleTouchHintShown) {
            singleTouchHintShown = true;
            showHint('Use two fingers to move the map');
        }
    }, { passive: true });

    mapEl.addEventListener('touchend', (e) => {
        if (!radarMap) return;
        if (e.touches.length === 0 && radarMap.dragging.enabled()) {
            radarMap.dragging.disable();
        }
    }, { capture: true });
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
                attributionControl: true,
                // Cooperative gestures: page scroll is never hijacked.
                // Ctrl/Cmd + wheel to zoom on desktop; two-finger drag to pan on mobile.
                scrollWheelZoom: false,
                dragging: !L.Browser.mobile
            });
            setupRadarGestureHandling(mapContainer);

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

            // Add new radar layer. color=2 is RainViewer's Universal Blue
            // scheme; the 1_0 option keeps smoothing but drops the separate
            // snow-color layer, so the single compact legend stays accurate.
            // maxNativeZoom caps tile requests at level 7 — the map may upscale
            // beyond that visually, but no higher-resolution radar tiles exist.
            radarLayer = L.tileLayer(`${radarHost}${latestFrame.path}/256/{z}/{x}/{y}/2/1_0.png`, {
                opacity: 0.7,
                zIndex: 100,
                maxNativeZoom: 7
            }).addTo(radarMap);

            // Update time display — show in location's timezone. The label is
            // the composite frame-generation time; append "· delayed" only when
            // that frame is more than 30 minutes old.
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
            const frameAgeMin = (Date.now() - latestFrame.time * 1000) / 60000;
            const delayedSuffix = frameAgeMin > 30 ? ' · delayed' : '';
            timeDisplay.textContent = `Radar: ${radarTime.toLocaleString(use24 ? 'en-GB' : 'en-US', radarOpts)}${delayedSuffix}`;
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
            // Show the change down to the second so it stays visible even near
            // the solstices, when the day-to-day difference is under a minute.
            const sign = diffMs >= 0 ? '+' : '−';
            const absSecs = Math.round(Math.abs(diffMs) / 1000);
            const dMins = Math.floor(absSecs / 60);
            const dSecs = absSecs % 60;
            dayChangeStr = dMins > 0
                ? `${sign}${dMins}m ${dSecs}s vs yesterday`
                : `${sign}${dSecs}s vs yesterday`;
        }
    }

    // Build the Twilight & Sun rows, interleaving today's high/low tides (for
    // coastal locations) in chronological order. Sun events are real instants,
    // so sort by minutes-of-day in the location's timezone; tide dates are
    // wall-clock strings, so use their local hour/minute directly. Invalid
    // (e.g. polar) sun times sort to the end.
    const tz = getLocationTimezone();
    const sunMinutes = (d) => {
        if (!d || isNaN(d.getTime())) return Infinity;
        const parts = {};
        new Intl.DateTimeFormat('en-GB', { timeZone: tz || undefined, hour: '2-digit', minute: '2-digit', hour12: false })
            .formatToParts(d).forEach(p => { if (p.type === 'hour' || p.type === 'minute') parts[p.type] = parseInt(p.value, 10); });
        return ((parts.hour % 24) || 0) * 60 + (parts.minute || 0);
    };

    const rows = [
        { label: 'Astronomical Dawn', value: formatAstroTime(sunTimes.nightEnd), sortMin: sunMinutes(sunTimes.nightEnd) },
        { label: 'Nautical Dawn', value: formatAstroTime(sunTimes.nauticalDawn), sortMin: sunMinutes(sunTimes.nauticalDawn) },
        { label: 'Civil Dawn', value: formatAstroTime(sunTimes.dawn), sortMin: sunMinutes(sunTimes.dawn) },
        { label: '☀️ Sunrise', value: formatAstroTime(sunTimes.sunrise), sortMin: sunMinutes(sunTimes.sunrise), highlight: true },
        { label: 'Solar Noon', value: formatAstroTime(sunTimes.solarNoon), sortMin: sunMinutes(sunTimes.solarNoon) },
        { label: '🌅 Sunset', value: formatAstroTime(sunTimes.sunset), sortMin: sunMinutes(sunTimes.sunset), highlight: true },
        { label: 'Civil Dusk', value: formatAstroTime(sunTimes.dusk), sortMin: sunMinutes(sunTimes.dusk) },
        { label: 'Nautical Dusk', value: formatAstroTime(sunTimes.nauticalDusk), sortMin: sunMinutes(sunTimes.nauticalDusk) },
        { label: 'Astronomical Dusk', value: formatAstroTime(sunTimes.night), sortMin: sunMinutes(sunTimes.night) }
    ];

    // Condense the moon's phase + illumination into the Moonrise row label as a
    // left-justified parenthetical, keeping the moonrise time in the right
    // column. When there's no moonrise today, attach it to the Moonset row
    // instead. Moonrise/Moonset still interleave chronologically with the sun
    // & tide events.
    const hasRise = moonTimes.rise && !isNaN(moonTimes.rise.getTime());
    const hasSet = moonTimes.set && !isNaN(moonTimes.set.getTime());
    const moonInfo = `${moonPhase.name} ${moonPhase.emoji} ${illuminationPct}%`;
    const infoOnRise = hasRise;
    const infoOnSet = !hasRise && hasSet;

    rows.push({
        label: infoOnRise ? `🌙 Moonrise (${moonInfo})` : '🌙 Moonrise',
        value: hasRise ? formatAstroTime(moonTimes.rise) : 'No rise today',
        sortMin: sunMinutes(moonTimes.rise),
        moon: true, moonrise: true, highlight: infoOnRise
    });
    rows.push({
        label: infoOnSet ? `🌙 Moonset (${moonInfo})` : '🌙 Moonset',
        value: hasSet ? formatAstroTime(moonTimes.set) : 'No set today',
        sortMin: sunMinutes(moonTimes.set),
        moon: true, highlight: infoOnSet
    });
    // Rare polar case: neither a moonrise nor moonset today — keep the phase
    // visible on its own row so the info is never lost.
    if (!hasRise && !hasSet) {
        rows.push({ label: `🌙 Moon (${moonInfo})`, value: '—', moon: true });
    }

    // High/low tide rows are shown only when the Tide toggle is on (header
    // shortcut / chart legend), so the toggle adds or removes them from the table.
    if (isTideLineOn()) {
        getTodayTideExtremes().forEach(t => {
            // Source-aware wording: "High/Low Tide" for NOAA, "High/Low Water"
            // for the Open-Meteo Marine sea-level fallback.
            rows.push({
                label: `${t.type === 'High' ? '🌊' : '🏝️'} ${tideExtremeLabel(t.type)}`,
                value: formatTime(t.date),
                sortMin: t.date.getHours() * 60 + t.date.getMinutes(),
                highlight: true,
                tide: true
            });
        });
    }

    rows.sort((a, b) => a.sortMin - b.sortMin);

    const rowsHtml = rows.map(r => `
                <div class="astro-row${r.highlight ? ' highlight' : ''}${r.tide ? ' tide' : ''}${r.moon ? ' moon' : ''}">
                    <span class="astro-label">${r.label}</span>
                    <span class="astro-value">${r.value}</span>
                </div>`).join('');

    // Subdued provenance line for NOAA station data only (never for the
    // Open-Meteo Marine model), shown when tide info is enabled. Distance is in
    // miles in Fahrenheit mode and kilometers in Celsius mode.
    let tideSourceHtml = '';
    if (isTideLineOn() && tideData && tideData.source === 'noaa' && tideData.stationName) {
        const km = tideData.stationDistanceKm;
        let distStr = '';
        if (typeof km === 'number' && Number.isFinite(km)) {
            distStr = getTempUnit() === 'C'
                ? ` · ${Math.round(km)} km away`
                : ` · ${Math.round(km * 0.621371)} mi away`;
        }
        tideSourceHtml = `<div class="astro-tide-source">NOAA · ${escapeHtml(tideData.stationName)}${distStr}</div>`;
    }

    container.innerHTML = `
        <div class="astro-group">
            <div class="astro-grid">
                ${rowsHtml}
                <div class="astro-row highlight">
                    <span class="astro-label">Day Length</span>
                    <span class="astro-value">${dayLengthStr}</span>
                </div>
                ${dayChangeStr ? `<div class="astro-row">
                    <span class="astro-label"></span>
                    <span class="astro-value astro-change">${dayChangeStr}</span>
                </div>` : ''}
            </div>
            ${tideSourceHtml}
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

    // Open-Meteo's Historical Forecast API combines the initial hours of
    // successive operational model runs into a continuous time series. It is
    // Open-Meteo's recommended product for representing recent past conditions,
    // but precipitation values remain model estimates rather than rain-gauge
    // measurements.
    const response = await fetch(`https://historical-forecast-api.open-meteo.com/v1/forecast?${params}`);
    if (!response.ok) throw new Error('Failed to fetch precipitation history');
    return response.json();
}

// Format a Date's local calendar components as YYYY-MM-DD. toISOString()
// expresses the date in UTC, which can shift to a different calendar day
// than intended when the browser's offset differs from the requested
// location's — use this instead for any locally-meaningful calendar date.
function formatLocalDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Request a 10-year daily precipitation series from Open-Meteo's Historical
// Weather (reanalysis) archive. ERA5-Land is requested first because the
// goal is a temporally consistent year-to-year baseline rather than the
// best individual reconstruction for each day; some coastal or unusual
// coordinates aren't covered by ERA5-Land, so on failure this retries once
// against the default reanalysis blend before giving up.
async function requestHistoricalAverage(params, useEra5Land = true) {
    const requestParams = new URLSearchParams(params);
    if (useEra5Land) requestParams.set('models', 'era5_land');

    let response;
    try {
        response = await fetch(`https://archive-api.open-meteo.com/v1/archive?${requestParams}`);
    } catch (err) {
        if (useEra5Land) return requestHistoricalAverage(params, false);
        throw err;
    }

    if (!response.ok) {
        if (useEra5Land) return requestHistoricalAverage(params, false);
        throw new Error('Failed to fetch historical precipitation');
    }

    const data = await response.json();

    if (
        !data.daily ||
        !Array.isArray(data.daily.time) ||
        !Array.isArray(data.daily.precipitation_sum)
    ) {
        if (useEra5Land) return requestHistoricalAverage(params, false);
        throw new Error('Historical precipitation response was incomplete');
    }

    return data;
}

// Construct a midnight Date for the given year/month/day, clamping the day to
// the last valid day of that month in that year. This keeps Feb 29 from
// silently rolling into Mar 1 for non-leap comparison years: Feb 29 becomes
// Feb 28, while every other date is left unchanged. (`new Date(year, month+1,
// 0)` is the last day of `month`.)
function makeComparisonEndDate(year, month, day) {
    const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
    return new Date(year, month, Math.min(day, lastDayOfMonth));
}

// Fetch a 10-year modeled average precipitation for the 30- and 90-calendar-date
// windows ending "today" in the selected location's timezone. Returns null (rather
// than throwing) on failure so the caller can still render recent totals without
// the comparison.
async function fetchHistoricalPrecipAvg(lat, lon) {
    const now = getLocationNow();
    const endYear = now.getFullYear() - 1; // most recent full year with reliable archive data
    const startYear = endYear - 9; // 10 years of data

    // The archive must span from 89 days before the earliest comparison year's
    // end date through the latest comparison year's end date. Anchor the start
    // on startYear's clamped end date and step back 89 days, rather than
    // transplanting an already-shifted month/day into startYear — the latter
    // drops the earliest year whenever the 90-day window crosses January 1.
    const archiveStart = makeComparisonEndDate(startYear, now.getMonth(), now.getDate());
    archiveStart.setDate(archiveStart.getDate() - 89);
    const archiveEnd = makeComparisonEndDate(endYear, now.getMonth(), now.getDate());

    const params = {
        latitude: lat,
        longitude: lon,
        daily: 'precipitation_sum',
        start_date: formatLocalDate(archiveStart),
        end_date: formatLocalDate(archiveEnd),
        timezone: 'auto'
    };

    let data;
    try {
        data = await requestHistoricalAverage(params, true);
    } catch (err) {
        console.error('Historical precipitation average unavailable:', err);
        return null;
    }

    const daily = data.daily;
    const thirtyDayTotals = [];
    const ninetyDayTotals = [];

    // ERA5-Land is expected to be gap-free, so require the complete number of
    // valid daily values for each window before trusting a year's total: an
    // incomplete window would understate the year's precipitation if its gaps
    // were summed as zeros.
    const THIRTY_DAY_MIN_VALID = 30;
    const NINETY_DAY_MIN_VALID = 90;

    for (let year = startYear; year <= endYear; year++) {
        // Clamp the comparison end date so a Feb 29 "today" maps to Feb 28 in
        // non-leap comparison years rather than rolling into March.
        const yearEnd = makeComparisonEndDate(year, now.getMonth(), now.getDate());
        const yearThirtyStart = new Date(yearEnd);
        yearThirtyStart.setDate(yearThirtyStart.getDate() - 29);
        const yearNinetyStart = new Date(yearEnd);
        yearNinetyStart.setDate(yearNinetyStart.getDate() - 89);

        let thirtySum = 0, thirtyCount = 0;
        let ninetySum = 0, ninetyCount = 0;

        for (let i = 0; i < daily.time.length; i++) {
            const d = new Date(daily.time[i] + 'T00:00:00');
            if (d < yearNinetyStart || d > yearEnd) continue;

            const value = daily.precipitation_sum[i];
            if (typeof value !== 'number' || !Number.isFinite(value)) continue;

            ninetySum += value;
            ninetyCount++;
            if (d >= yearThirtyStart) {
                thirtySum += value;
                thirtyCount++;
            }
        }

        if (thirtyCount >= THIRTY_DAY_MIN_VALID) thirtyDayTotals.push(thirtySum);
        if (ninetyCount >= NINETY_DAY_MIN_VALID) ninetyDayTotals.push(ninetySum);
    }

    const avg = values =>
        values.length
            ? values.reduce((sum, value) => sum + value, 0) / values.length
            : null;

    return {
        thirtyDayAvg: avg(thirtyDayTotals),   // in mm, or null if no valid years
        ninetyDayAvg: avg(ninetyDayTotals)    // in mm, or null if no valid years
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
        { label: '30 Days', hours: 720, avgKey: 'thirtyDayAvg' },
        { label: '90 Days', hours: 2160, avgKey: 'ninetyDayAvg' }
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

    // Require nearly complete hourly coverage before showing a total. The
    // Historical Forecast series is expected to be dense, so a materially
    // incomplete window means an understated sum — show an em dash instead.
    const RECENT_MIN_COVERAGE = 0.95;

    const results = periods.map(period => {
        const startIndex = Math.max(0, nowIndex - period.hours + 1);
        const expectedHours = period.hours;
        let sum = 0;
        let validCount = 0;
        for (let i = startIndex; i <= nowIndex; i++) {
            const v = hourly.precipitation[i];
            // Preserve null / non-finite values as missing rather than summing
            // them as zero, so gaps lower the coverage instead of the total.
            if (typeof v === 'number' && Number.isFinite(v)) {
                sum += v;
                validCount++;
            }
        }
        const complete = expectedHours > 0 && (validCount / expectedHours) >= RECENT_MIN_COVERAGE;

        let formatted;
        if (!complete) {
            formatted = '—';
        } else if (isKelvin) {
            const microns = sum * 1000;
            formatted = `${Math.round(microns).toLocaleString()} µm`;
        } else if (isMetric) {
            formatted = `${sum.toFixed(1)} mm`;
        } else {
            const inches = sum / 25.4;
            formatted = `${inches.toFixed(2)}"`;
        }

        // Build historical average comparison HTML for the 30-Day and 90-Day
        // periods — only when the recent total itself is complete, so an
        // understated total never drives a misleading percentage difference.
        let avgHtml = '';
        if (complete && period.avgKey && histAvg && histAvg[period.avgKey] != null) {
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

            avgHtml = `<div class="precip-history-avg${isKelvin ? ' kelvin-units' : ''}">vs. ${avgFormatted} 10-yr modeled avg</div>${diffHtml}`;
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
        <a href="https://cjpaulphd.github.io/hilary-sprout/?lat=${currentLocation.latitude}&lon=${currentLocation.longitude}&name=${encodeURIComponent(currentLocation.name)}" target="_blank" rel="noopener noreferrer" class="sprout-link">
            <span class="sprout-icon">🌱</span>
            <span>See detailed precipitation history on Hilary's Sprout</span>
        </a>
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

        // Token guard for this load. Async secondary fetches below compare against
        // currentLoadId before touching shared state, so a slow response for a
        // previous location can't paint over a newer one.
        const loadId = ++currentLoadId;
        const lat = currentLocation.latitude;
        const lon = currentLocation.longitude;

        // Start the independent secondary fetches in parallel with the main
        // forecast fetch — they only need lat/lon, not weatherData. Handlers are
        // attached after the initial render, once weatherData is ready. Attach a
        // no-op catch now so a rejection before then isn't reported as unhandled.
        const aqiPromise = fetchAQI(lat, lon);
        const tidePromise = fetchTideData(lat, lon);
        aqiPromise.catch(() => {});
        tidePromise.catch(() => {});

        weatherData = await fetchWeatherData(lat, lon);

        // Store the location's IANA timezone from the API response (e.g.
        // "Pacific/Auckland"). If the response omits it, clear any stale value
        // from a previous location so getLocationNow() falls back to browser time
        // rather than silently using the wrong zone.
        if (weatherData.timezone) {
            currentLocation.timezone = weatherData.timezone;
        } else {
            delete currentLocation.timezone;
            console.warn('Weather API response lacked a timezone; falling back to browser time.');
        }

        // Current temperature, feels-like, humidity, dew point, and wind (incl.
        // gust) from Open-Meteo's dedicated `current` snapshot, falling back to
        // the nearest hourly value for anything it omits.
        const { currentTemp, feelsLike } = applyCurrentConditions();
        updateLocationDisplay(currentTemp, feelsLike);

        // Reset tide state before the initial render so a previous coastal
        // location's tide data and toggle don't leak into an inland one.
        tideData = null;
        updateTideToggleUI();

        // Clear the previous location's AQI so the conditions bar doesn't show a
        // stale value during the new fetch; it's refreshed when aqiPromise resolves.
        currentConditions.aqi = null;

        // Render conditions bar immediately with humidity/wind (AQI will update when ready)
        renderConditionsBar();

        renderDailyForecast(weatherData);
        renderPrecipOutlook(weatherData);
        renderHourlyForecast(weatherData);
        renderChart(weatherData);
        checkWeatherAlerts();
        initializeRadar();
        renderAstroData();

        // weatherData and the initial render are ready, so attach handlers to the
        // secondary fetches started above. The token guard discards stale results.
        aqiPromise
            .then(aqi => {
                if (loadId !== currentLoadId) return;
                currentConditions.aqi = aqi;
                renderConditionsBar();
            })
            .catch(() => {
                if (loadId !== currentLoadId) return;
                currentConditions.aqi = null;
                renderConditionsBar();
            });

        // When tide data arrives for a coastal location, reveal the toggle and
        // redraw the chart/hourly so the tide line appears if it's enabled.
        tidePromise
            .then(data => {
                if (loadId !== currentLoadId) return;
                tideData = data;
                updateTideToggleUI();
                if (hasTideData()) {
                    // Chart/hourly redraw internally requires an hourly series;
                    // the astro table shows high/low events even without one.
                    if (weatherData) {
                        renderChart(weatherData);
                        renderHourlyForecast(weatherData);
                    }
                    renderAstroData();
                }
            })
            .catch(() => {
                if (loadId !== currentLoadId) return;
                tideData = null;
                updateTideToggleUI();
            });

        // Fetch and render precipitation history + historical averages
        Promise.all([
            fetchPrecipHistory(currentLocation.latitude, currentLocation.longitude),
            fetchHistoricalPrecipAvg(currentLocation.latitude, currentLocation.longitude).catch(() => null)
        ])
            .then(([data, histAvg]) => {
                if (loadId !== currentLoadId) return;
                precipHistoryData = data;
                precipHistoricalAvg = histAvg;
                renderPrecipHistory(data, histAvg);
            })
            .catch(err => {
                if (loadId !== currentLoadId) return;
                console.error('Error loading precipitation history:', err);
                const container = document.getElementById('precip-history');
                if (container) container.innerHTML = '<div class="error">Precipitation history unavailable</div>';
            });

        // Update last-updated timestamp
        const lastUpdated = document.getElementById('last-updated');
        if (lastUpdated) {
            const now2 = new Date();
            lastUpdated.dataset.timestamp = now2.toISOString();
            lastUpdated.textContent = formatUpdatedTimestamp(now2);
        }

        trackEvent('weather-loaded');

    } catch (error) {
        console.error('Error loading weather:', error);
        document.getElementById('daily-forecast').innerHTML =
            `<div class="error">Failed to load weather data: ${escapeHtml(error.message)}</div>`;
    } finally {
        if (refreshBtn) refreshBtn.classList.remove('spinning');
    }
}

// Check for official NWS alerts. The prominent alert container holds only real
// NWS alerts — on any failure or unsupported coverage it is cleared and hidden
// rather than backfilled with a heuristic, forecast-derived look-alike.
async function checkWeatherAlerts() {
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
                    <span class="alert-text-content">${escapeHtml(headline)}</span>
                    <span class="alert-arrow">›</span>
                `;

                // Open alert detail modal on click
                alertEl.addEventListener('click', () => {
                    showAlertDetail(props, nwsUrl);
                });

                alertContainer.appendChild(alertEl);
            });

            alertContainer.classList.remove('hidden');
        } else {
            alertContainer.innerHTML = '';
            alertContainer.classList.add('hidden');
        }
    } catch (error) {
        // NWS unavailable (non-US coverage, network/CORS, or an API error).
        // Clear and hide the official-alert container; do not substitute a
        // forecast-derived banner. WeatherWonder's Stormcast tags, snow icons,
        // precipitation character, and short-term outlook already surface the
        // model-derived signals.
        console.warn('NWS Alerts API unavailable; clearing official alerts:', error.message);
        alertContainer.innerHTML = '';
        alertContainer.classList.add('hidden');
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
    const instruction = escapeHtml(props.instruction || '').replace(/\n/g, '<br>');
    const areaDesc = props.areaDesc || '';
    const alertTimeLocale = getTimeFormat() === '24' ? 'en-GB' : 'en-US';
    const alertTimeOpts = { weekday: 'short', month: 'short', day: 'numeric', hour: getTimeFormat() === '24' ? '2-digit' : 'numeric', minute: '2-digit' };
    const tz = getLocationTimezone();
    if (tz) alertTimeOpts.timeZone = tz;
    const onset = props.onset ? new Date(props.onset).toLocaleString(alertTimeLocale, alertTimeOpts) : '';
    const ends = props.ends ? new Date(props.ends).toLocaleString(alertTimeLocale, alertTimeOpts) : '';
    const expires = props.expires ? new Date(props.expires).toLocaleString(alertTimeLocale, alertTimeOpts) : '';
    const sender = props.senderName || '';

    header.innerHTML = `<h3>${escapeHtml(event)}</h3>`;
    if (severity) {
        header.innerHTML += `<span class="alert-detail-severity alert-severity-${escapeHtml(severity.toLowerCase())}">${escapeHtml(severity)}</span>`;
    }

    let bodyHtml = '';
    if (headline) bodyHtml += `<p class="alert-detail-headline">${escapeHtml(headline)}</p>`;
    if (onset || ends) {
        bodyHtml += `<div class="alert-detail-timing">`;
        if (onset) bodyHtml += `<div><strong>From:</strong> ${onset}</div>`;
        if (ends) bodyHtml += `<div><strong>Until:</strong> ${ends}</div>`;
        else if (expires) bodyHtml += `<div><strong>Expires:</strong> ${expires}</div>`;
        bodyHtml += `</div>`;
    }
    if (areaDesc) bodyHtml += `<div class="alert-detail-area"><strong>Areas:</strong> ${escapeHtml(areaDesc)}</div>`;
    if (description) bodyHtml += `<div class="alert-detail-desc">${escapeHtml(description)}</div>`;
    if (instruction) bodyHtml += `<div class="alert-detail-instruction"><strong>Instructions:</strong><br>${instruction}</div>`;
    if (sender) bodyHtml += `<div class="alert-detail-sender">Issued by ${escapeHtml(sender)}</div>`;

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

    const shareData = {
        title: `Weather Forecast - ${currentLocation.name}`,
        text: `Check out the weather forecast for ${currentLocation.name} on WeatherWonder`,
        url: window.location.href
    };

    // Try to include the OG image as a share file for richer previews
    try {
        if (navigator.canShare && currentShareSection) {
            const section = document.getElementById(currentShareSection);
            if (section && typeof html2canvas === 'function') {
                const screenshotBg = getEffectiveTheme() === 'light' ? '#f5f5f5' : '#1a1a1a';
                const canvas = await html2canvas(section, { backgroundColor: screenshotBg, scale: 2 });
                const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                const file = new File([blob], `weatherwonder-${currentLocation.name.replace(/[^a-z0-9]/gi, '-')}.png`, { type: 'image/png' });
                const dataWithFile = { ...shareData, files: [file] };
                if (navigator.canShare(dataWithFile)) {
                    await navigator.share(dataWithFile);
                    return;
                }
            }
        }
    } catch (e) {
        // Fall through to share without file
    }

    try {
        await navigator.share(shareData);
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

    // Close any open modal (or the side menu) with the Escape key. Registered
    // once here for all modals; clicks the modal's own close button so its
    // cleanup runs.
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const openModal = Array.from(document.querySelectorAll('.modal'))
            .find(m => !m.classList.contains('hidden'));
        if (openModal) {
            const close = openModal.querySelector('.close-btn');
            if (close) close.click();
            else openModal.classList.add('hidden');
            return;
        }
        const menuPanel = document.getElementById('menu-panel');
        if (menuPanel && !menuPanel.classList.contains('hidden')) closeMenu();
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
                const dayLabel = card.querySelector('.day-label:not(.placeholder)');
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
                    const dayLabel = card.querySelector('.day-label:not(.placeholder)');
                    if (dayLabel) {
                        visibleDay = dayLabel.textContent;
                    }
                } else if (cardRect.left <= containerCenter) {
                    // Current visible card - check if it has a label or use the previous one
                    const dayLabel = card.querySelector('.day-label:not(.placeholder)');
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
        const firstDayLabel = hourlyContainer.querySelector('.day-label:not(.placeholder)');
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

    const appUrl = 'https://weatherwonder.app/';
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
                const shareData = {
                    title: 'WeatherWonder',
                    text: 'Check out WeatherWonder — a free, open-source weather dashboard with radar, precipitation history, and more!',
                    url: appUrl
                };

                // Try to include the OG image for richer share previews
                try {
                    if (navigator.canShare) {
                        const response = await fetch('./og-image.png');
                        const blob = await response.blob();
                        const file = new File([blob], 'weatherwonder-preview.png', { type: 'image/png' });
                        const dataWithFile = { ...shareData, files: [file] };
                        if (navigator.canShare(dataWithFile)) {
                            await navigator.share(dataWithFile);
                            hide();
                            return;
                        }
                    }
                } catch (e) {
                    // Fall through to share without file
                }

                try {
                    await navigator.share(shareData);
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

// Accessible modal focus management: move focus into a dialog when it opens,
// trap Tab within it, and restore focus to the triggering element on close.
// Modals are opened/closed by toggling the `hidden` class from many call sites,
// so we observe that class rather than wrapping every call site.
// Weather Explainer content. Each entry is opened by an info ("ⓘ") button
// carrying data-explain="<key>". The bodies are app-authored HTML (not from any
// API or user input), so they are assigned to innerHTML without escaping. The
// tone aims to be technical but plain-spoken — explaining both what the app
// shows and the meteorology behind it. Cross-links at the bottom are plain
// data-explain buttons, so the shared handler swaps content within the same
// modal.
const EXPLAINERS = {
    conditions: {
        title: 'Current Conditions',
        body: `
            <p class="explainer-intro">WeatherWonder displays the latest available Open-Meteo model estimate for the selected location. These values represent a forecast grid cell rather than a measurement at your exact position, so conditions may differ because of elevation, terrain, buildings, shade, or proximity to water.</p>

            <h4>Temperature and Feels-Like Temperature</h4>
            <p>Air temperature is the modeled temperature approximately 2 meters above the ground.</p>
            <p>Feels-like temperature, also called apparent temperature, estimates human thermal exposure by accounting for factors such as wind, humidity, and solar radiation. Humid conditions can reduce evaporative cooling, while wind can increase heat loss in cold conditions. Apparent temperature is an index, not a thermometer measurement.</p>
            <p>WeatherWonder displays the feels-like value when it differs from the air temperature by more than 2 degrees in the selected unit.</p>

            <h4>Relative Humidity and Dew Point</h4>
            <p>Relative humidity indicates how close the air is to saturation at its current temperature. Because warmer air can hold more water vapor, relative humidity can change substantially as temperature changes even when the amount of moisture in the air remains similar.</p>
            <p>Dew point is the temperature to which air would need to cool to become saturated. It is generally more useful than relative humidity for assessing how humid the air will feel.</p>
            <p>As a general warm-season comfort guide:</p>
            <ul>
                <li>Below 55&deg;F: generally comfortable</li>
                <li>55&ndash;64&deg;F: increasingly humid</li>
                <li>65&ndash;69&deg;F: humid</li>
                <li>70&deg;F or higher: very humid or oppressive</li>
            </ul>
            <p>Individual comfort varies, especially with sunlight, wind, exertion, clothing, and acclimatization. WeatherWonder's humidity color is based on dew point rather than relative humidity.</p>

            <h4>Air Quality Index</h4>
            <p>The U.S. Air Quality Index, or AQI, summarizes estimated concentrations of several pollutants, including fine particles, coarse particles, ozone, carbon monoxide, nitrogen dioxide, and sulfur dioxide. The displayed AQI is determined by the pollutant with the highest individual index.</p>
            <ul>
                <li>0&ndash;50: Good</li>
                <li>51&ndash;100: Moderate</li>
                <li>101&ndash;150: Unhealthy for sensitive groups</li>
                <li>151&ndash;200: Unhealthy</li>
                <li>201&ndash;300: Very unhealthy</li>
                <li>301&ndash;500: Hazardous</li>
            </ul>
            <p>WeatherWonder's AQI is a regional model estimate, not a reading from a local air-quality monitor. People who are sensitive to air pollution should consult official local monitoring and public-health guidance before changing outdoor plans.</p>

            <h4>Wind</h4>
            <p>Wind direction describes where the wind is coming from. The arrow shows the direction in which the air is moving.</p>
            <p>The primary wind value is the sustained wind. When a gust is materially stronger than the sustained wind, it may be displayed separately, marked with a "G." Gusts and sustained wind are both model estimates at approximately 10 meters above the ground. Trees, buildings, ridgelines, valleys, and other terrain can produce large local differences.</p>

            <p>Data and limitations: <a href="https://open-meteo.com/en/docs" target="_blank" rel="noopener noreferrer">Open-Meteo Forecast</a> and <a href="https://open-meteo.com/en/docs/air-quality-api" target="_blank" rel="noopener noreferrer">Air Quality</a> APIs, with AQI categories from the <a href="https://www.airnow.gov/aqi/aqi-basics/" target="_blank" rel="noopener noreferrer">U.S. EPA</a>. Values are model estimates for the selected grid cells.</p>

            <div class="explainer-related">
                <div class="explainer-related-label">Related</div>
                <button class="explainer-link" data-explain="forecast">How the forecast works</button>
                <button class="explainer-link" data-explain="radar">Reading the radar</button>
            </div>
        `
    },
    forecast: {
        title: 'How the Forecast Works',
        body: `
            <p class="explainer-intro">A weather forecast is a model-based estimate of future atmospheric conditions, not a guarantee. Near-term hours are most useful for planning timing; later days are more useful for identifying broad patterns and possible changes.</p>

            <h4>Forecast Models</h4>
            <p>Open-Meteo's Best Match system selects model data appropriate to the location and forecast horizon. WeatherWonder does not rely on a fixed blend of the same models everywhere.</p>
            <p>Different models use different spatial resolutions, update schedules, physical assumptions, and methods for representing terrain and atmospheric processes. As a result, forecasts can change when new observations are incorporated and a new model run becomes available.</p>

            <h4>Forecast Uncertainty</h4>
            <p>Forecast uncertainty generally increases with time. Temperature and large-scale weather patterns are often more predictable than the exact location or timing of thunderstorms, fog, showers, snow bands, or terrain-driven weather.</p>
            <p>For decisions sensitive to timing:</p>
            <ul>
                <li>Review consecutive forecast updates rather than relying on one model run.</li>
                <li>Use radar to assess precipitation already occurring nearby.</li>
                <li>Consult official watches, warnings, and advisories for hazardous weather.</li>
                <li>Allow additional margin when thunderstorms, freezing conditions, strong winds, or flooding would create serious consequences.</li>
            </ul>

            <h4>Precipitation Probability and Amount</h4>
            <p>Hourly precipitation probability is the modeled probability that more than 0.1 millimeter of precipitation will occur during the preceding hour at the forecast location.</p>
            <p>The precipitation amount is the model's estimated total accumulation during that hour, including rain and the liquid-water equivalent of frozen precipitation. It is not an estimate of "how much will fall if precipitation occurs."</p>
            <p>Read probability and amount together:</p>
            <ul>
                <li>High probability and low amount: precipitation is relatively likely but expected to be minor.</li>
                <li>High probability and high amount: precipitation is both likely and potentially consequential.</li>
                <li>Low probability and high amount: a lower-confidence event that could still have significant effects.</li>
                <li>Low probability and low amount: limited evidence for meaningful precipitation.</li>
            </ul>
            <p>On WeatherWonder's daily cards, the precipitation percentage is the highest hourly probability during that day, while the displayed amount is the sum of the hourly forecast amounts.</p>

            <h4>Other Forecast Variables</h4>
            <p>Temperature is the modeled air temperature. Feels-like temperature estimates human thermal exposure.</p>
            <p>Wind is the sustained modeled speed approximately 10 meters above the ground; a materially stronger gust may be shown separately.</p>
            <p>The UV Index estimates the potential for ultraviolet exposure. Protection becomes increasingly important at values of 3 or higher, particularly around solar noon.</p>

            <p>Data and limitations: <a href="https://open-meteo.com/en/docs" target="_blank" rel="noopener noreferrer">Open-Meteo Forecast API</a> using its Best Match model selection. Forecast values are estimates for a model grid cell and may not capture highly localized conditions.</p>

            <div class="explainer-related">
                <div class="explainer-related-label">Related</div>
                <button class="explainer-link" data-explain="stormDetail">Storm &amp; intensity detail</button>
                <button class="explainer-link" data-explain="radar">Reading the radar</button>
                <button class="explainer-link" data-explain="conditions">Current conditions</button>
            </div>
        `
    },
    stormDetail: {
        title: 'Storm and Intensity Detail',
        body: `
            <p class="explainer-intro">Stormcast is a WeatherWonder interpretation layer designed to make precipitation timing and intensity easier to scan. Its categories are derived from forecast variables and should not be treated as standardized meteorological classifications, official warnings, or evidence that a storm will occur.</p>

            <h4>Precipitation Intensity</h4>
            <p>WeatherWonder classifies forecast rain using the hourly modeled accumulation:</p>
            <ul>
                <li>Light: less than 2.5 mm per hour</li>
                <li>Moderate: 2.5&ndash;7.6 mm per hour</li>
                <li>Heavy: more than 7.6 mm per hour</li>
            </ul>
            <p>Forecast snowfall is classified using the modeled hourly snowfall depth:</p>
            <ul>
                <li>Light: less than 1 cm per hour</li>
                <li>Moderate: 1&ndash;2.5 cm per hour</li>
                <li>Heavy: more than 2.5 cm per hour</li>
            </ul>
            <p>These thresholds are display conventions used by WeatherWonder. Meteorological agencies and applications use differing definitions, particularly for snow.</p>
            <p>The intensity category describes the modeled rate if that forecast is realized. Precipitation probability should be considered separately because an intense modeled event may still have a relatively low probability.</p>

            <h4>Storm and Storm-Risk Signals</h4>
            <p>WeatherWonder displays Storm when the forecast weather code identifies a thunderstorm.</p>
            <p>It displays Storm risk when no thunderstorm code is present but both of the following app-defined criteria are met:</p>
            <ul>
                <li>CAPE of at least 2,000 joules per kilogram</li>
                <li>Precipitation probability of at least 40 percent</li>
            </ul>
            <p>CAPE measures atmospheric buoyancy that may be available to support convection. High CAPE alone does not produce a thunderstorm; storms also require sufficient moisture, a lifting mechanism, and an atmospheric structure that permits organized convection.</p>
            <p>Storm risk is therefore a screening indicator, not a severe-weather forecast. Consult National Weather Service alerts and local radar whenever thunderstorms could affect safety.</p>

            <h4>Daily Precipitation Character</h4>
            <p>WeatherWonder summarizes the number of forecast hours with precipitation as follows:</p>
            <ul>
                <li>Brief: precipitation during 4 or fewer hours</li>
                <li>Passing: precipitation during 5&ndash;9 hours</li>
                <li>Steady: precipitation during 10 or more hours</li>
                <li>Brief downpour: 4 or fewer precipitation hours averaging at least 2.5 mm per wet hour</li>
            </ul>
            <p>These labels summarize forecast duration and average intensity. They do not indicate that precipitation will be continuous, precisely timed, or uniform across the area.</p>

            <h4>Chart Interpretation</h4>
            <p>In the one-day and three-day views, precipitation shading reflects WeatherWonder's intensity categories. Longer-range charts use a single precipitation color because detailed timing and intensity become less reliable farther into the forecast.</p>

            <p>Data and limitations: WeatherWonder-derived classifications based on <a href="https://open-meteo.com/en/docs" target="_blank" rel="noopener noreferrer">Open-Meteo</a> forecast variables. Stormcast is not an official alerting product.</p>

            <div class="explainer-related">
                <div class="explainer-related-label">Related</div>
                <button class="explainer-link" data-explain="forecast">How the forecast works</button>
                <button class="explainer-link" data-explain="radar">Reading the radar</button>
            </div>
        `
    },
    radar: {
        title: 'Reading the Radar',
        body: `
            <p class="explainer-intro">The radar map shows the most recent composite-reflectivity image available from RainViewer. The timestamp is the composite frame-generation time; the individual radar images combined into that frame may not share identical acquisition times. Radar is an observation of precipitation-related echoes aloft, not a forecast, and the image may be several minutes old.</p>

            <h4>What Radar Measures</h4>
            <p>Weather radar sends pulses of microwave energy into the atmosphere and measures the energy reflected back toward the radar. Reflectivity is expressed in dBZ.</p>
            <p>Higher reflectivity generally indicates a greater concentration of large or numerous particles such as raindrops, snowflakes, ice, or hail. Reflectivity does not directly measure rainfall at the ground.</p>

            <h4>Interpreting the Colors</h4>
            <p>In WeatherWonder's radar palette, cooler colors generally represent weaker echoes and warmer colors represent stronger echoes.</p>
            <p>Stronger echoes may indicate heavier precipitation, hail, melting snow, or mixtures of different particle types. Reflectivity color alone cannot confirm:</p>
            <ul>
                <li>Whether lightning is occurring</li>
                <li>Whether hail is reaching the ground</li>
                <li>The exact rainfall rate</li>
                <li>Whether precipitation is reaching the surface</li>
            </ul>
            <p>Official warnings, lightning data, dual-polarization products, and ground reports provide information that a simple reflectivity image cannot.</p>

            <h4>Using Radar for Decisions</h4>
            <p>Check the image timestamp before interpreting the map. Radar is most useful when viewed as an animation because movement, growth, weakening, and storm structure are often more informative than a single frame.</p>
            <p>The distance circle provides a geographic reference; it does not indicate guaranteed radar coverage or forecast how far a storm will travel.</p>
            <p>For hazardous or rapidly developing weather, consult National Weather Service alerts and a full-featured radar application rather than relying on this summary image alone.</p>

            <h4>Radar Limitations</h4>
            <p>Radar beams rise above the ground as they travel away from a radar site. Distant radar may therefore detect precipitation high in the atmosphere while missing shallow precipitation near the surface.</p>
            <p>Mountains and buildings can block or distort the beam. Ground clutter, insects, anomalous propagation, and other non-weather targets can produce false echoes. Some precipitation evaporates before reaching the ground, while intense precipitation can reduce radar visibility behind a storm.</p>

            <p>Data and limitations: <a href="https://www.rainviewer.com/api.html" target="_blank" rel="noopener noreferrer">RainViewer</a> composite reflectivity, interpreted using <a href="https://www.weather.gov/jetstream/radar" target="_blank" rel="noopener noreferrer">National Weather Service</a> radar guidance. The map is a recent radar observation, not a precipitation forecast or official warning product.</p>

            <div class="explainer-related">
                <div class="explainer-related-label">Related</div>
                <button class="explainer-link" data-explain="conditions">Current conditions</button>
                <button class="explainer-link" data-explain="forecast">How the forecast works</button>
                <button class="explainer-link" data-explain="stormDetail">Storm &amp; intensity detail</button>
            </div>
        `
    },
    astro: {
        title: 'Sun, Moon, and Tide',
        body: `
            <p class="explainer-intro">Sun and moon times are calculated astronomical estimates for the selected coordinates. Tide information is available for coastal locations and represents predicted or modeled water levels rather than direct observations.</p>

            <h4>Twilight</h4>
            <p>Twilight is divided according to how far the center of the sun is below the ideal horizon:</p>
            <ul>
                <li>Civil twilight: 0&ndash;6 degrees below the horizon. Outdoor activity is often possible without artificial lighting.</li>
                <li>Nautical twilight: 6&ndash;12 degrees below the horizon. The horizon may remain distinguishable at sea.</li>
                <li>Astronomical twilight: 12&ndash;18 degrees below the horizon. Beyond this point, the sky is considered fully dark for most astronomical purposes.</li>
            </ul>

            <h4>Sunrise, Sunset, and Solar Noon</h4>
            <p>Calculated sunrise and sunset occur when the apparent upper edge of the sun crosses an ideal, unobstructed horizon. Local terrain, buildings, trees, elevation, and atmospheric refraction can cause the visible sunrise or sunset to occur at a different time.</p>
            <p>Solar noon is the time when the sun reaches its highest point in the sky for that date and location. It does not necessarily occur at 12:00 p.m. by the clock.</p>

            <h4>Day Length and Seasons</h4>
            <p>Day length changes throughout the year because Earth's axis is tilted about 23.5 degrees relative to its orbit around the sun. As Earth travels around the sun, each hemisphere alternately tilts toward or away from it.</p>
            <p>When your location is tilted toward the sun, the sun takes a longer path across the sky, producing longer days and higher sun angles&mdash;this is summer. When it is tilted away, the sun's path is shorter and lower, resulting in shorter days and lower sun angles&mdash;this is winter. Around the equinoxes in spring and fall, day and night are nearly equal in length.</p>
            <p>The amount of change in day length depends on latitude. Near the equator, day length varies little over the year, while higher latitudes experience much larger seasonal swings, including very long summer days and very short winter days.</p>

            <h4>Moon Information</h4>
            <p>Moon phase describes the geometric relationship among the sun, Earth, and moon. Illumination is the estimated percentage of the moon's visible disk that is sunlit.</p>
            <p>Moonrise and moonset vary with latitude, season, and lunar position. The moon rises approximately 50 minutes later from one day to the next on average, but the daily difference can vary substantially. At some locations and dates, the moon may not rise or set during the local calendar day.</p>

            <h4>Moon Phases</h4>
            <p>The moon does not produce its own light; it reflects sunlight. As the moon orbits Earth, we see different portions of its sunlit half, creating the familiar cycle of phases over about 29.5 days.</p>
            <p>The main phases are:</p>
            <ul>
                <li>New moon: The moon is between Earth and the sun, and its sunlit side faces away from us, making it largely invisible.</li>
                <li>First quarter: About one week later, half of the visible disk is illuminated, appearing as a half moon.</li>
                <li>Full moon: Earth is between the sun and the moon, and the entire visible disk is illuminated.</li>
                <li>Last (third) quarter: Another half moon appears as the cycle continues back toward new moon.</li>
            </ul>
            <p>Between these primary phases, the moon appears as crescents when less than half is illuminated or gibbous when more than half is illuminated. The phase affects how bright the night sky appears and can influence visibility for outdoor activities and astronomy.</p>

            <h4>Tide Information</h4>
            <p>For supported U.S. locations, WeatherWonder uses predictions from the nearest suitable NOAA tide station within approximately 40 kilometers. Heights are referenced to Mean Lower Low Water, or MLLW, unless otherwise indicated.</p>
            <p>For other coastal locations, WeatherWonder uses modeled hourly sea-level height relative to mean sea level from Open-Meteo Marine. These values are not equivalent to a local tide-gauge observation.</p>
            <p>Astronomical tides are driven primarily by the gravitational effects of the moon and sun. Spring tides produce a larger tidal range near new and full moons; neap tides produce a smaller range near first- and third-quarter moons.</p>
            <p>Actual water levels may differ from predictions because of wind, atmospheric pressure, waves, currents, river discharge, storm surge, and local coastal geometry. Do not use WeatherWonder tide information for navigation, flood safety, or other decisions requiring official observations and predictions.</p>

            <p>Data and limitations: Sun and moon calculations use <a href="https://github.com/mourner/suncalc" target="_blank" rel="noopener noreferrer">SunCalc</a>. U.S. tide predictions use <a href="https://tidesandcurrents.noaa.gov/" target="_blank" rel="noopener noreferrer">NOAA CO-OPS</a>; other coastal estimates use <a href="https://open-meteo.com/en/docs/marine-weather-api" target="_blank" rel="noopener noreferrer">Open-Meteo Marine</a>.</p>

            <div class="explainer-related">
                <div class="explainer-related-label">Related</div>
                <button class="explainer-link" data-explain="conditions">Current conditions</button>
                <button class="explainer-link" data-explain="forecast">How the forecast works</button>
                <button class="explainer-link" data-explain="precip">Precipitation history</button>
            </div>
        `
    },
    precip: {
        title: 'Precipitation History',
        body: `
            <p class="explainer-intro">This section summarizes modeled estimates of past precipitation. It should not be interpreted as a rain-gauge record or a measurement at the selected point.</p>

            <h4>Rolling Totals</h4>
            <p>WeatherWonder calculates estimated precipitation totals for the preceding:</p>
            <ul>
                <li>24 hours</li>
                <li>48 hours</li>
                <li>72 hours</li>
                <li>7 days</li>
                <li>30 days</li>
                <li>90 days</li>
            </ul>
            <p>The totals include modeled rain, showers, and the liquid-water equivalent of frozen precipitation.</p>

            <h4>Comparison with Recent-Average Conditions</h4>
            <p>The 30-day and 90-day periods are compared with a 10-year modeled average for the corresponding calendar windows. A positive percentage indicates wetter estimated conditions; a negative percentage indicates drier estimated conditions.</p>
            <p>A 10-year average provides recent context but is not a formal 30-year climate normal. It may also be influenced by unusually wet or dry years within the comparison period.</p>

            <h4>Data Sources</h4>
            <p>Recent rolling totals use Open-Meteo's Historical Forecast API. This product combines the initial hours of successive operational model runs into a continuous hourly time series. The models incorporate recent observations during initialization, but the resulting precipitation values remain model estimates rather than rain-gauge measurements.</p>
            <p>The 10-year comparisons use Open-Meteo Historical Weather reanalysis, normally ERA5-Land for a consistent year-to-year baseline. Reanalysis combines observations with numerical models to produce spatially complete estimates of past atmospheric conditions.</p>
            <p>The recent totals and historical averages come from different model products and may have different systematic biases. The percentages should therefore be interpreted as contextual estimates rather than precise climate anomalies.</p>
            <p>Both products can understate or overstate localized precipitation, particularly during thunderstorms, in complex terrain, or where precipitation varies sharply over short distances.</p>

            <h4>Appropriate Use</h4>
            <p>Use these totals to evaluate broad recent wetness or dryness, vegetation and soil-moisture context, and general precipitation patterns.</p>
            <p>For site-specific verification&mdash;such as documenting flooding, drought, facility conditions, or rainfall at a particular property&mdash;use a calibrated rain gauge or nearby official observation network.</p>

            <p>Data and limitations: Recent totals use <a href="https://open-meteo.com/en/docs/historical-forecast-api" target="_blank" rel="noopener noreferrer">Open-Meteo Historical Forecast</a> data. Comparisons use <a href="https://open-meteo.com/en/docs/historical-weather-api" target="_blank" rel="noopener noreferrer">Open-Meteo Historical Weather</a> reanalysis, preferably ERA5-Land. These are modeled estimates, not local measurements.</p>

            <h4>Go Deeper</h4>
            <p>For day-by-day breakdowns and additional analysis, the link at the bottom of the section opens Hilary's Sprout, a companion application focused on precipitation history for the same location.</p>

            <div class="explainer-related">
                <div class="explainer-related-label">Related</div>
                <button class="explainer-link" data-explain="forecast">How the forecast works</button>
                <button class="explainer-link" data-explain="conditions">Current conditions</button>
                <button class="explainer-link" data-explain="astro">Sun, moon, and tide</button>
            </div>
        `
    }
};

// Open the explainer modal on a given topic. Also used by the in-modal
// cross-links to swap content without closing.
function openExplainer(key) {
    const topic = EXPLAINERS[key];
    if (!topic) return;
    const modal = document.getElementById('explainer-modal');
    const titleEl = document.getElementById('explainer-title');
    const bodyEl = document.getElementById('explainer-body');
    if (!modal || !titleEl || !bodyEl) return;

    titleEl.textContent = topic.title;
    bodyEl.innerHTML = topic.body;

    const content = modal.querySelector('.explainer-content');
    if (content) content.scrollTop = 0;

    modal.classList.remove('hidden');
    // Move focus to the heading synchronously so the shared focus-management
    // observer sees focus already inside the modal and doesn't override it.
    // This also lands keyboard/screen-reader users on the title, and resets
    // focus sensibly when a cross-link swaps the content in place.
    titleEl.focus();
    trackEvent('explain-' + key);
}

function initializeExplainers() {
    const modal = document.getElementById('explainer-modal');
    if (!modal) return;

    const closeBtn = document.getElementById('close-explainer');
    if (closeBtn) closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.add('hidden');
    });

    // One delegated handler for every info button and in-modal cross-link.
    document.addEventListener('click', (e) => {
        const trigger = e.target.closest('[data-explain]');
        if (!trigger) return;
        openExplainer(trigger.getAttribute('data-explain'));
    });
}

// Welcome / getting-started modal. Auto-opens once for brand-new users and
// stays reachable from the footer "Welcome Guide" link and the side-menu
// "Welcome & Settings" entry. Doubles as a quick-settings panel: its toggle
// buttons proxy the footer toggles so every save/re-render side effect stays
// in one place.
const WELCOME_SEEN_KEY = 'weatherwonder_welcome_seen';

function hasSeenWelcome() {
    try {
        return localStorage.getItem(WELCOME_SEEN_KEY) === '1';
    } catch (e) {
        // No storage means no way to remember a dismissal — treat as seen so
        // the modal doesn't nag on every load.
        return true;
    }
}

function markWelcomeSeen() {
    try {
        localStorage.setItem(WELCOME_SEEN_KEY, '1');
    } catch (e) {}
}

// The quick-settings buttons show the CURRENT value (settings semantics),
// unlike the footer toggles which show the value you'd switch to.
function updateWelcomeSettingsUI() {
    const theme = getEffectiveTheme();
    const themeIcon = document.getElementById('welcome-theme-icon');
    const themeLabel = document.getElementById('welcome-theme-label');
    if (themeIcon) themeIcon.textContent = theme === 'light' ? '☀️' : '🌙';
    if (themeLabel) themeLabel.textContent = theme === 'light' ? 'Light' : 'Dark';

    const unit = getTempUnit();
    const tempLabel = document.getElementById('welcome-temp-label');
    if (tempLabel) tempLabel.textContent = unit === 'K' ? 'K' : '°' + unit;

    const timeLabel = document.getElementById('welcome-time-label');
    if (timeLabel) timeLabel.textContent = getTimeFormat() + 'hr';
}

function openWelcome() {
    const modal = document.getElementById('welcome-modal');
    if (!modal) return;
    updateWelcomeSettingsUI();
    const content = modal.querySelector('.welcome-content');
    if (content) content.scrollTop = 0;
    modal.classList.remove('hidden');
    // Focus the heading synchronously so the shared focus-management observer
    // sees focus already inside the modal (same pattern as openExplainer).
    const titleEl = document.getElementById('welcome-title');
    if (titleEl) titleEl.focus();
    markWelcomeSeen();
    trackEvent('welcome-open');
}

function initializeWelcome() {
    const modal = document.getElementById('welcome-modal');
    if (!modal) return;
    const close = () => modal.classList.add('hidden');

    const closeBtn = document.getElementById('close-welcome');
    if (closeBtn) closeBtn.addEventListener('click', close);
    const dismissBtn = document.getElementById('welcome-dismiss');
    if (dismissBtn) dismissBtn.addEventListener('click', close);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
    });

    const setLocationBtn = document.getElementById('welcome-set-location');
    if (setLocationBtn) setLocationBtn.addEventListener('click', () => {
        close();
        clearDisambiguation();
        document.getElementById('location-modal').classList.remove('hidden');
        document.getElementById('location-input').focus();
        trackEvent('welcome-set-location');
    });

    [
        ['welcome-theme-toggle', 'theme-toggle'],
        ['welcome-temp-toggle', 'temp-toggle'],
        ['welcome-time-toggle', 'time-toggle']
    ].forEach(([welcomeId, footerId]) => {
        const btn = document.getElementById(welcomeId);
        if (!btn) return;
        btn.addEventListener('click', () => {
            const footerBtn = document.getElementById(footerId);
            if (footerBtn) footerBtn.click();
            updateWelcomeSettingsUI();
        });
    });

    const footerLink = document.getElementById('welcome-footer-link');
    if (footerLink) footerLink.addEventListener('click', openWelcome);
    const menuWelcome = document.getElementById('menu-welcome');
    if (menuWelcome) menuWelcome.addEventListener('click', () => {
        closeMenu();
        openWelcome();
    });

    // Auto-open for genuinely new users only. Anyone who used the app before
    // this feature existed already has a saved location or favorites — mark
    // them as seen silently instead of interrupting a familiar dashboard.
    if (!hasSeenWelcome()) {
        if (getLastLocation() || getFavorites().length) markWelcomeSeen();
        else openWelcome();
    }
}

function initializeModalFocusManagement() {
    const modals = Array.from(document.querySelectorAll('.modal'));
    if (!modals.length) return;

    const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const getFocusable = (modal) =>
        Array.from(modal.querySelectorAll(FOCUSABLE)).filter(el => el.getClientRects().length > 0);

    // Continuously track the last element focused OUTSIDE any modal, so we know
    // where to return focus when a modal closes. Tracking it live (rather than
    // reading activeElement at open time) is important because some modals focus
    // their own input synchronously as they open.
    let lastFocusedOutsideModal = null;
    document.addEventListener('focusin', (e) => {
        if (e.target && !e.target.closest('.modal')) {
            lastFocusedOutsideModal = e.target;
        }
    });

    const onOpen = (modal) => {
        // Only move focus in if it isn't already inside (modals that focus their
        // own input have already done so by the time this observer fires).
        if (!modal.contains(document.activeElement)) {
            const focusable = getFocusable(modal);
            const target = focusable[0] || modal;
            if (target === modal) modal.setAttribute('tabindex', '-1');
            target.focus();
        }
    };

    const onClose = () => {
        const el = lastFocusedOutsideModal;
        const usable = el && typeof el.focus === 'function' && document.contains(el)
            && !el.closest('[inert]') && el.getClientRects().length > 0;
        if (usable) {
            el.focus();
        } else {
            // The trigger is gone or now hidden (e.g. a menu button after the
            // menu closed); fall back to a stable, always-visible control.
            const fallback = document.querySelector('.menu-btn');
            if (fallback) fallback.focus();
        }
    };

    modals.forEach((modal) => {
        const observer = new MutationObserver(() => {
            const isOpen = !modal.classList.contains('hidden');
            if (isOpen && !modal.dataset.focusActive) {
                modal.dataset.focusActive = 'true';
                onOpen(modal);
            } else if (!isOpen && modal.dataset.focusActive) {
                delete modal.dataset.focusActive;
                onClose();
            }
        });
        observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
    });

    // Trap Tab / Shift+Tab within the open modal.
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        const openModal = modals.find(m => !m.classList.contains('hidden'));
        if (!openModal) return;
        const focusable = getFocusable(openModal);
        if (!focusable.length) { e.preventDefault(); return; }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (e.shiftKey) {
            if (active === first || !openModal.contains(active)) {
                e.preventDefault();
                last.focus();
            }
        } else {
            if (active === last || !openModal.contains(active)) {
                e.preventDefault();
                first.focus();
            }
        }
    });
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
        initializeTideToggle,
        initializePrecipDetailToggle,
        initializeChartRangeToggle,
        updateLocationDisplay,
        initializeModal,
        initializeShareModal,
        initializeMenu,
        initializeAlertDetailModal,
        initializeInstallButton,
        initializeIOSInstallModal,
        initializeShareAppModal,
        initializeExplainers,
        initializeModalFocusManagement,
        initializeWelcome,
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
