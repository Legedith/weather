/** Assemble the archived original theme without modifying its CSS or layout. */
export function compileRetro(original, runtime) {
  const script = original.match(/<script>\s*([\s\S]*?)<\/script>/);
  if (!script) throw new Error('Original inline application script was not found.');
  const boundary = script[1].indexOf('    // ---------- Forecast ----------');
  if (boundary < 0) throw new Error('Original forecast boundary was not found.');
  let prefix = script[1].slice(0, boundary);
  function patch(before, after) {
    if (!prefix.includes(before)) throw new Error(`Retro source changed near: ${before.slice(0,65)}`);
    prefix = prefix.replace(before, after);
  }
  patch('if (!insideIndia(pin.lat, pin.lon))', 'if (!insideIndia(pin?.lat, pin?.lon))');
  patch('function insideIndia(lat, lon){ return lat >= INDIA.minLat && lat <= INDIA.maxLat && lon >= INDIA.minLon && lon <= INDIA.maxLon; }', 'function insideIndia(lat, lon){ return insideBounds(lat, lon); }');
  patch("if (selectedPlaceName) storageSet('rainscope-place', selectedPlaceName);", "storageSet('rainscope-place', selectedPlaceName);");
  const request = 'const r=await axios.get(u.toString(),{signal});\n      const data=r.data;';
  patch(request, 'const data=await fetchJSON(u.toString(),{signal});');
  patch(request, 'const data=await fetchJSON(u.toString(),{signal});');
  patch('function endMapPointer(e){', "function endMapPointer(e){\n      if(e.type==='pointercancel'){activePointers.delete(e.pointerId);drag=null;pinch=null;tiles.style.transform='';marker.style.translate='';map.classList.remove('dragging');return;}");
  patch("if(e.target.closest(mapUiSelector)) return;\n      e.preventDefault();", "if(e.target.closest(mapUiSelector) || (!e.ctrlKey && !e.metaKey)) return;\n      e.preventDefault();");
  patch("const p=f&&f.properties||{};", "const p=f&&f.properties||{};\n      if(p.countrycode && String(p.countrycode).toUpperCase()!=='IN') return null;");
  const imports = "import { config } from './config.js';\nimport { loadForecast, fetchJSON, insideBounds, HOUR, average, summarize, groupDays, validatedProxyUrl } from './forecast.js';\n";
  const app = imports + prefix + runtime + '\n})();\n';
  let html = original.replace(script[0], '<script type="module" src="./assets/app.js"></script>')
    .replace(/\s*<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/axios[^\"]*"><\/script>/, '')
    .replace('</head>', '  <link rel="stylesheet" href="./assets/retro-polish.css">\n</head>')
    .replace('<body data-weather-theme="sunny">', '<body data-weather-theme="sunny">\n  <a class="skip-link" href="#forecastPanel">Skip to forecast</a>')
    .replace('<section class="panel forecast-panel" aria-live="polite">', '<section id="forecastPanel" class="panel forecast-panel" tabindex="-1" aria-label="Weather forecast">')
    .replace('<div id="map" role="application" aria-label="Interactive map of India. Click to drop a weather forecast pin.">', '<div id="map" role="region" tabindex="0" aria-label="Location map. Arrow keys pan; plus and minus zoom; Enter selects the centre.">')
    .replace('id="placeSearch" type="search"', 'id="placeSearch" role="combobox" aria-autocomplete="list" aria-controls="searchResults" aria-expanded="false" type="search"')
    .replace('<div id="locationError" class="error-card">', '<div id="locationError" class="error-card" role="alert">')
    .replace('<div id="loadingOverlay" class="loading-overlay">', '<div id="loadingOverlay" class="loading-overlay" role="status">')
    .replace('64 WEATHER FUTURES LOADED', 'WEATHER FUTURES ON DEMAND')
    .replace('Reading 64 possible weather futures…', 'Reading possible weather futures…')
    .replace('64-member AI ensemble · up to 15 days', 'WeatherNext 2 ensemble · up to 15 days')
    .replace('Temperature now-ish', 'This hour’s forecast')
    .replace('ensemble rain chance', 'ensemble rain signal')
    .replace('Rain chance', 'Rain signal')
    .replace('Tap to pin · drag to pan · pinch or +/− to zoom.', 'Tap to pin · drag to pan · pinch, +/− or Ctrl+scroll to zoom.')
    .replace('<div class="hero-grid">', '<p id="sourceNotice" class="microcopy" role="status" hidden></p>\n          <div class="hero-grid">')
    .replace('<canvas id="forecastChart" aria-label="Temperature and rain forecast chart">', '<canvas id="forecastChart" tabindex="0" role="img" aria-describedby="chartA11y" aria-label="Temperature and rain forecast. Left and right arrow keys explore hours; the hourly table provides the same values.">')
    .replace('<div id="chartTooltip" class="tooltip"></div>', '<div id="chartTooltip" class="tooltip"></div><span id="chartA11y" class="sr-only" aria-live="polite"></span>')
    .replace('Blue bars: rain chance scaled to the full chart height · expected mm stays in the tooltip', 'Blue: hourly rain signal, right axis · missing values leave gaps · arrow keys explore hours')
    .replace('</body>', '<noscript><p class="app">Enable JavaScript to load weather forecasts. No forecast is shown without a live data request.</p></noscript>\n</body>');
  if (html.match(/<style>([\s\S]*?)<\/style>/)?.[1] !== original.match(/<style>([\s\S]*?)<\/style>/)?.[1]) throw new Error('Original theme CSS must remain unchanged.');
  return { html, app };
}
