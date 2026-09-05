/** Provider adapters and forecast calculations. No DOM, credentials, or storage. */
export const HOUR = 3_600_000;
export const DEFAULT_PLACE = Object.freeze({ lat: 17.45, lon: 78.30, name: 'Hyderabad area' });
export const BOUNDS = Object.freeze({ minLat: 6.2, maxLat: 37.7, minLon: 68, maxLon: 97.6 });
export const SOURCES = Object.freeze({
  openmeteo: Object.freeze({ id: 'openmeteo', name: 'WeatherNext 2', attribution: 'Open-Meteo / Google DeepMind', maxHours: 360, ensemble: true, precipitation: 'Rain', chance: 'Ensemble rain signal', detail: 'Hourly values interpolated from a 6-hourly, approximately 25 km model. Rain timing is indicative, not a minute-by-minute prediction.' }),
  google: Object.freeze({ id: 'google', name: 'Google Weather API', attribution: 'Google Maps', maxHours: 240, ensemble: false, precipitation: 'Rain / snow', chance: 'Precipitation chance', detail: 'Google’s blended weather service. WeatherNext 3 began rolling out on 3 September 2026. This API does not expose or let us pin a model version or retrieve ensemble members.' })
});
export function numeric(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
export function coordinate(value) {
  if (typeof value === 'number') return numeric(value);
  return typeof value === 'string' && value.trim() !== '' ? numeric(Number(value)) : null;
}
export function insideBounds(lat, lon) {
  return numeric(lat) !== null && numeric(lon) !== null && lat >= BOUNDS.minLat && lat <= BOUNDS.maxLat && lon >= BOUNDS.minLon && lon <= BOUNDS.maxLon;
}
export const validValues = values => values.filter(v => numeric(v) !== null);
export const average = values => { const v = validValues(values); return v.length ? v.reduce((a,b) => a+b, 0) / v.length : null; };
export function quantile(values, q) {
  const v = validValues(values).sort((a,b) => a-b);
  if (!v.length) return null;
  const pos = (v.length-1)*q, i = Math.floor(pos);
  return v[i] + (v[Math.min(i+1, v.length-1)]-v[i])*(pos-i);
}
export function zoneName(zone) {
  try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(); return zone || 'Asia/Kolkata'; }
  catch { return 'Asia/Kolkata'; }
}
export function dateKey(time, zone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zoneName(zone), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(time)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function timestamp(value, offsetSeconds = 0) {
  if (numeric(value) !== null) return value * 1000;
  if (typeof value !== 'string') return NaN;
  const zoned = /(?:Z|[+-]\d\d:\d\d)$/.test(value);
  return Date.parse(zoned ? value : value + 'Z') - (zoned ? 0 : offsetSeconds * 1000);
}
function finish(points, source, zone, hours, now) {
  const seen = new Set();
  points = points.filter(p => Number.isFinite(p.time) && p.time + HOUR > now && p.time < now + hours*HOUR)
    .sort((a,b) => a.time-b.time).filter(p => !seen.has(p.time) && seen.add(p.time)).slice(0,hours);
  if (!points.some(p => p.temp !== null || p.rain !== null)) throw new Error('The service returned no usable forecast values. Please try again later.');
  return { points, source, timezone: zoneName(zone), requestedHours: hours, fetchedAt: now,
    partial: points.length < hours || points.some(p => p.temp === null || p.rain === null), notice: '' };
}
export function parseOpenMeteo(data, hours, now = Date.now()) {
  const h = data?.hourly;
  if (!h || !Array.isArray(h.time)) throw new Error('The forecast response is missing its hourly timeline.');
  const series = field => Object.keys(h).filter(k => new RegExp(`^${field}(?:_member\\d+)?$`).test(k) && Array.isArray(h[k])).map(k => h[k]);
  const ts = series('temperature_2m'), rs = series('rain'), cs = series('cloud_cover');
  const valuesAt = (series, i) => validValues(series.map(v => v[i]));
  // Open-Meteo rain is a preceding-hour sum. Align it with the displayed
  // forward interval [time, time + 1h), unlike instantaneous temperature.
  const times = h.time.map(t => timestamp(t, data.utc_offset_seconds || 0));
  const indices = new Map(times.map((t,i) => [t,i]));
  const points = times.map((time, i) => {
    const rainIndex = indices.get(time + HOUR);
    const t = valuesAt(ts,i), r = rainIndex === undefined ? [] : valuesAt(rs,rainIndex).filter(v => v >= 0), c = valuesAt(cs,i).filter(v => v >= 0 && v <= 100);
    return { time, temp: quantile(t,.5),
      low: t.length > 1 ? quantile(t,.1) : null, high: t.length > 1 ? quantile(t,.9) : null,
      rain: average(r), probability: r.length ? r.filter(v => v >= .1).length/r.length*100 : null,
      cloud: average(c), isDay: h.is_day?.[i] === 1 ? true : h.is_day?.[i] === 0 ? false : null,
      members: t.length, rainMembers: r.length, feelsLike: null, description: '' };
  });
  return finish(points, SOURCES.openmeteo, data.timezone, hours, now);
}
function celsius(t) {
  if (numeric(t?.degrees) === null) return null;
  return t.unit === 'CELSIUS' ? t.degrees : t.unit === 'FAHRENHEIT' ? (t.degrees-32)*5/9 : null;
}
function millimetres(qpf) {
  if (numeric(qpf?.quantity) === null || qpf.quantity < 0) return null;
  return qpf.unit === 'MILLIMETERS' ? qpf.quantity : qpf.unit === 'INCHES' ? qpf.quantity*25.4 : null;
}
export function parseGoogle(data, hours, now = Date.now()) {
  if (!Array.isArray(data?.forecastHours)) throw new Error('Google Weather returned an invalid hourly response.');
  const points = data.forecastHours.map(h => {
    const prob = numeric(h.precipitation?.probability?.percent), cloud = numeric(h.cloudCover);
    return { time: timestamp(h.interval?.startTime), temp: celsius(h.temperature), low: null, high: null,
      rain: millimetres(h.precipitation?.qpf), probability: prob !== null && prob >= 0 && prob <= 100 ? prob : null,
      cloud: cloud !== null && cloud >= 0 && cloud <= 100 ? cloud : null,
      isDay: typeof h.isDaytime === 'boolean' ? h.isDaytime : null, members: 0, rainMembers: 0,
      feelsLike: celsius(h.feelsLikeTemperature), description: typeof h.weatherCondition?.description?.text === 'string' ? h.weatherCondition.description.text.slice(0,160) : '' };
  });
  return finish(points, SOURCES.google, data.timeZone?.id, hours, now);
}
export function summarize(points) {
  const temps = validValues(points.map(p => p.temp)), amounts = validValues(points.map(p => p.rain));
  const probabilities = points.filter(p => p.probability !== null);
  return { low: temps.length ? Math.min(...temps) : null, high: temps.length ? Math.max(...temps) : null,
    total: amounts.length === points.length && points.length ? amounts.reduce((a,b) => a+b,0) : null,
    peak: probabilities.length ? probabilities.reduce((a,b) => a.probability >= b.probability ? a : b) : null,
    missingRain: points.length - amounts.length };
}
export function groupDays(points, zone) {
  const groups = new Map();
  for (const p of points) { const key = dateKey(p.time,zone); if (!groups.has(key)) groups.set(key,[]); groups.get(key).push(p); }
  return [...groups].map(([date, hours]) => ({ date, hours, ...summarize(hours), partial: hours.length !== 24 || hours.some(p => p.temp === null || p.rain === null) }));
}
/** This is a relative comparison of model rain signals, not a safety recommendation. */
export function lowestRainWindow(points, length = 3) {
  let best = null;
  for (let i=0; i<=points.length-length; i++) {
    const window = points.slice(i,i+length);
    if (window.some((p,j) => p.probability === null || (j && p.time-window[j-1].time !== HOUR))) continue;
    const signal = average(window.map(p => p.probability));
    if (!best || signal < best.signal) best = { start: window[0].time, end: window.at(-1).time+HOUR, signal };
  }
  return best;
}
export function validatedProxyUrl(value) {
  if (!value) return '';
  const url = new URL(value);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash) throw new Error('Configure a credential-free HTTPS Google Weather proxy URL.');
  return url.toString();
}
export async function fetchJSON(url, { signal, timeoutMs=12000, fetchImpl=globalThis.fetch } = {}) {
  const abort = new AbortController();
  const cancel = () => abort.abort(signal?.reason);
  if (signal?.aborted) cancel(); else signal?.addEventListener('abort',cancel,{once:true});
  const timer = setTimeout(() => abort.abort(new DOMException('The weather service took too long. Try again.', 'TimeoutError')), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: abort.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(response.status === 429 ? 'The service is busy. Try again shortly.' : `The weather service returned HTTP ${response.status}.`);
    return await response.json();
  } finally { clearTimeout(timer); signal?.removeEventListener('abort',cancel); }
}
export async function loadForecast({ lat, lon, hours, provider='auto', proxyUrl='' }, { signal, fetchImpl=globalThis.fetch, now=Date.now() } = {}) {
  if (!insideBounds(lat,lon)) throw new Error('Choose coordinates within the India region (6.2–37.7°N, 68–97.6°E).');
  if (!Number.isInteger(hours) || hours<1 || hours>360) throw new Error('Choose between 1 and 360 hours.');
  if (!['auto','google','openmeteo'].includes(provider)) throw new Error('Choose a supported forecast source.');
  const proxy = validatedProxyUrl(proxyUrl);
  if (provider === 'google' && !proxy) throw new Error('Google Weather is not connected. Use the free forecast or configure the server proxy.');
  if (provider === 'google' && hours>240) throw new Error('Google Weather supports up to 10 days. Choose a shorter range or the free 15-day ensemble.');
  let notice = '';
  if (proxy && provider !== 'openmeteo' && hours <= 240) {
    try {
      const url = new URL(proxy); url.search = new URLSearchParams({ lat:String(lat), lon:String(lon), hours:String(hours) }).toString();
      const result = parseGoogle(await fetchJSON(url,{signal,fetchImpl,timeoutMs:35000}),hours,now);
      if (signal?.aborted) throw signal.reason;
      return result;
    } catch (error) {
      if (signal?.aborted || provider === 'google') throw error;
      notice = 'Google Weather is unavailable. Showing WeatherNext 2 from Open-Meteo instead; the sources have not been mixed.';
    }
  } else if (proxy && provider === 'auto' && hours>240) notice = 'This range uses WeatherNext 2. Google Weather provides at most 10 days of hourly data.';
  const url = new URL('https://ensemble-api.open-meteo.com/v1/ensemble');
  url.search = new URLSearchParams({ latitude:lat.toFixed(5), longitude:lon.toFixed(5), hourly:'temperature_2m,rain,cloud_cover,is_day', timezone:'auto', forecast_hours:String(hours+1), models:'google_weathernext2_ensemble', timeformat:'unixtime', temperature_unit:'celsius', precipitation_unit:'mm' }).toString();
  const result = parseOpenMeteo(await fetchJSON(url,{signal,fetchImpl}),hours,now);
  if (signal?.aborted) throw signal.reason;
  return { ...result, notice };
}
