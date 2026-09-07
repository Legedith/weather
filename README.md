# RainScope India

The original retro weather terminal: monospace type, bright pastels, bold window borders, offset shadows, scrolling marquee and weather-driven themes. Choose a pin, choose Hours or Days, then press **Show forecast**. The September 5 full redesign has been removed from the active site at the owner's request.

## Original theme, small improvements

The 12 original `site-parts/*.part` files are preserved **unchanged**. The build uses their HTML/CSS and original map/horizon controls. A build regression test checks that every byte of the original inline theme CSS survives assembly. `assets/retro-polish.css` adds only keyboard focus, an unobtrusive skip link, reduced-motion support and a few accessibility rules. It does not replace the layout, fonts or palette.

The tested data adapter from the previous update remains: nulls stay unknown, preceding-hour Open-Meteo rain is aligned to the displayed forward interval, and partial totals are not presented as complete. Small usability fixes add keyboard search/map/chart controls, prevent stale search/GPS/forecast responses from overwriting a newer choice, and let ordinary wheel scrolling pass over the map (Ctrl+scroll still zooms). The orange temperature line, blue rain area, day cards and hourly list retain their original appearance. The rain scale is now explicitly 0–100%, without smoothing or lines across missing values.

The app keeps its original **manual forecast** flow rather than the redesign's automatic dashboard. Existing selected places are migrated once from the redesigned version; stored favourites are left intact but no new favourites dashboard is added.

## Run locally

Node.js 22 or newer; no JavaScript package dependencies.

```sh
npm test
npm run build
python3 -m http.server 8000 --directory dist
```

Open `http://localhost:8000`. ES modules require HTTP/HTTPS, not `file://`.

The repository-root `index.html` is a source-checkout notice, **not** the deployment entry point. GitHub Pages publishes `dist/index.html`, assembled by `scripts/build.mjs` from the original `site-parts/`. `scripts/retro-build.mjs` performs checked transformations; `assets/retro-runtime.js` supplies the corrected forecast rendering inside the original map/search closure. `assets/forecast.js` is the shared, tested provider adapter. No server, credential file, or diagnostic report is copied to Pages.

## WeatherNext 3 access

See [the September 7 access report](docs/weathernext-access.md). The live GitHub check confirmed the existing WeatherNext 2 endpoint works. Anonymous WeatherNext 3 statistics access returned HTTP 401; the tested candidate Open-Meteo WeatherNext 3 model identifier returned HTTP 400. No approved-account credential was supplied to the check, and no Google Weather proxy Actions variable is configured. **A personal Google Account's approval status is not established by these anonymous checks.**

Free mode remains accurately labelled **WeatherNext 2**. Google documents raw WeatherNext 3 on Cloud Storage, BigQuery and Earth Engine behind an access request. No invented WeatherNext 3 identifier has been enabled in the app.

A reusable **Check weather provider access** Actions workflow is included. It makes only bounded, read-only metadata/tiny forecast requests. For an authenticated GCS test, supply the optional **GitHub Actions secret** `WEATHERNEXT_GOOGLE_CREDENTIALS` with credentials for the approved identity, then run the workflow manually. It supports Google `authorized_user` or `service_account` credential JSON; a personal account's approval does not establish that a different service account has access. Never put credentials in public files, issues or chat. The report logs only status codes and verification state, not credentials, tokens, forecast payloads or account details. It does not test differently named secrets automatically.

## Connecting Google Weather

The optional Google Weather API is a **blended service incorporating WeatherNext**, not a raw, version-pinned WeatherNext 3 endpoint. When a proxy is configured, the restored site automatically prefers it for ranges up to 240 hours. It displays Google Maps attribution, Google's precipitation probabilities and no invented ensemble band. If it fails, the whole forecast falls back to WeatherNext 2 with a visible notice. The original 15-day option uses the free ensemble and explains Google's 10-day limit.

1. Choose a Google Cloud project, enable the Weather API and billing, and create a restricted server-side API key following [Google's setup guide](https://developers.google.com/maps/documentation/weather/get-api-key). Review the [free allowance, billing and quotas](https://developers.google.com/maps/documentation/weather/usage-and-billing). A billing-enabled account is required even when usage stays within a free allowance.
2. Copy `.env.example` to a private `.env`. Set `GOOGLE_WEATHER_API_KEY` and `ALLOWED_ORIGINS`. The production origin is `https://legedith.github.io`, **not** the `/weather/` path. For local development use `http://localhost:8000`.
3. Run `node --env-file=.env server/google-weather.mjs` in a separate terminal. Set `GOOGLE_WEATHER_PROXY_URL=http://localhost:8080/forecast` when running `npm run build` locally. The server command reads `.env`; the build does not automatically read it.
4. Deploy the optional proxy behind HTTPS on your host. `docker build -f server/Dockerfile -t rainscope-weather .` builds its container. Inject secrets at runtime, never in the image. No cloud resource or billing account is created by this repository change.
5. Set the public GitHub Actions **variable** `GOOGLE_WEATHER_PROXY_URL` to that HTTPS `/forecast` URL, then run the Pages workflow. It must contain no credentials. `assets/config.js` can alternatively hold the same public URL.

The proxy has bounded pagination, timeouts, concurrency and per-process request ceilings. **CORS is not authentication or a hard spending cap.** Process counters reset on restart and do not cover multiple instances. A public deployment still needs provider quotas and appropriate shared abuse controls. Each 24-hour page is a separate upstream request. No Google forecast is persistently cached; responses use `Cache-Control: no-store`. Review [Google's weather policies](https://developers.google.com/maps/documentation/weather/policies), public terms/privacy and the provider's licensing before exposing data. Raw WeatherNext access and permission to publish a public data service are separate questions.

## Tests

```sh
npm test
npm run build
python -m pip install playwright==1.57.0
python -m playwright install chromium
python tests/browser_smoke.py
```

The Node suite covers forecast/proxy correctness and exact theme preservation. The native-module browser suite covers original desktop/mobile styling, manual controls, keyboard interaction, search sanitization/cancellation, GPS races, null forecasts, every weather theme, long horizons and Google fallback/attribution. Browser weather data is synthetic; live provider access is tested separately by `scripts/check_providers.py`. Screenshots and JSON reports are uploaded as CI artifacts. A passing fixture test does not prove authenticated Google access.

## Data and interpretation

Open-Meteo's WeatherNext 2 output is interpolated from a native six-hourly model. The displayed rain signal is the fraction of available members predicting at least 0.1 mm in an hour, not a calibrated probability. Daily percentages are peak **hourly** values. Missing data stays unknown. Fetch time is not model initialization time. These are forecasts, not live observations or official warnings; follow [IMD alerts](https://mausam.imd.gov.in/) for severe weather.

Search text and selected coordinates are sent to the geocoding/weather providers; the map requests OpenStreetMap tiles. Pin/preferences stay in this browser. GPS is requested only after a button press. Google forecast responses and API keys are not stored in browser storage. The free endpoint has [Open-Meteo's own terms](https://open-meteo.com/en/terms).
