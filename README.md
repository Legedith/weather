# RainScope India

A responsive, dependency-free weather frontend with a free WeatherNext 2 ensemble and an optional server-side Google Weather integration. It runs on GitHub Pages; the Google proxy must run separately on a server.

## WeatherNext 3: what changed, and what has not

Verified against the provider documentation on **5 September 2026**:

- Google [announced WeatherNext 3 on 3 September](https://blog.google/innovation-and-ai/models-and-research/google-deepmind/introducing-weathernext-3/), including its rollout through the Google Maps Platform Weather API.
- [Open-Meteo's ensemble API](https://open-meteo.com/en/docs/ensemble-api) still documents `google_weathernext2_ensemble`. There is no documented WeatherNext 3 identifier to substitute. The free mode therefore remains honestly labelled **WeatherNext 2**.
- The [Google Weather API](https://developers.google.com/maps/documentation/weather/faq) is a blended weather service, not a version-pinned raw WeatherNext endpoint. Its hourly response does not expose a selectable model version or ensemble members. The UI labels it **Google Weather API**, never claims that each response is exclusively WeatherNext 3, and never invents uncertainty bands.
- Direct raw WeatherNext 3 datasets require Google's [access process](https://developers.google.com/weathernext/guides/access-forecast). That gridded-data pipeline is not implemented here.

**Shipping this repository alone does not activate Google Weather or pure WeatherNext 3.** Google remains disabled until a proxy is configured. Existing free forecasts continue to work without credentials. No Google project, key, billing account or cloud deployment was created by this change.

## What is better

The forecast loads automatically for the last selected pin (Hyderabad on first use). Search, an opt-in GPS button, a keyboard-accessible map and coordinates all select a place. Save up to five places locally or share a coordinate link. Select 24 hours, 3, 7 or 15 rolling days, or a custom hour count. Celsius/Fahrenheit switching is local and makes no API request.

The mobile-first layout puts the forecast before configuration. Daily cards control the chart and hourly table; a keyboard/touch slider exposes exact values. Temperature and rain have separate, labelled axes. Chart lines are not smoothed into misleading rain timing. Reduced-motion and visible keyboard focus are supported.

Open-Meteo's preceding-hour rain amounts are aligned to the displayed forward hour using one extra timestamp. Missing closing timestamps remain unknown instead of shifting rain into the wrong hour.

Nulls remain unknown, rather than becoming 0°C or dry weather. Missing hourly amounts suppress full-horizon totals. Requests are cancelled when the location or range changes, so an old request cannot relabel a new pin. Time labels and day boundaries use the forecast location's timezone, not the viewer's browser timezone. Fetch time is not presented as model initialization time.

WeatherNext 2's native six-hourly grid is interpolated to hourly by Open-Meteo. Its displayed rain signal is the fraction of valid members with at least 0.1 mm for that hour, **not a calibrated probability**. A daily percentage is the peak hourly signal, not a probability of any rain that day. Google provides precipitation probabilities and total precipitation (rain/snow), so those labels change with the source. The two sources are never combined into one forecast.

## Run locally

Requires Node.js 22 or newer. There are no JavaScript package dependencies.

```sh
npm test
npm run build
python3 -m http.server 8000 --directory dist
```

Open `http://localhost:8000`. Serve the files over HTTP/HTTPS; do not open the HTML via `file://`, because it uses ES modules.

`index.html` and `assets/` are the active source. `scripts/build.mjs` copies only static frontend files to `dist/`. The old `site-parts/` files are retained for history but are **not assembled or deployed** anymore. Neither the server nor `.env` is copied to GitHub Pages.

## Connecting Google Weather

1. Create or choose a Google Cloud project, enable the Weather API and production billing, and create an API key following [Google's setup instructions](https://developers.google.com/maps/documentation/weather/get-api-key). Restrict the key to the Weather API and apply suitable server restrictions. Set provider quotas and monitor cost before enabling public access.
2. Copy `.env.example` to a private `.env`. Set `GOOGLE_WEATHER_API_KEY` and the exact allowed website origin in `ALLOWED_ORIGINS`. For this repository's Pages site, the origin is `https://legedith.github.io`, **not** `https://legedith.github.io/weather/`. For development use `http://localhost:8000`.
3. Run the proxy in a separate terminal for local development:

   ```sh
   node --env-file=.env server/google-weather.mjs
   ```

   It listens on port 8080 by default. Set `GOOGLE_WEATHER_PROXY_URL=http://localhost:8080/forecast` when building the frontend locally. The Node environment file is read by that server command only, not automatically by `npm run build`.
4. For production, deploy the proxy behind HTTPS on your chosen host, storing the API key in that host's secret manager. An optional container is provided:

   ```sh
   docker build -f server/Dockerfile -t rainscope-weather .
   ```

   Supply server environment variables at runtime, not at image build time. The container runs as the `node` user. It exposes `/healthz` and `/forecast?lat=17.45&lon=78.30&hours=24`.
5. Set the GitHub **repository Actions variable** `GOOGLE_WEATHER_PROXY_URL` to the public HTTPS `/forecast` endpoint. Then run the Pages workflow or push to `main`. This variable must contain only the endpoint URL, **never a Google key**. Alternatively, configure `assets/config.js` with that same public URL.
6. Verify a live request, quotas, origin restrictions, attribution and billing in your deployment. An authenticated Google production request has not been tested in this implementation environment.

Automatic mode prefers Google when configured for up to 240 hours (10 days). If the Google request fails, it switches the whole forecast to WeatherNext 2 and visibly says so. An explicit Google selection fails visibly instead of silently falling back. The free ensemble retains the original 360-hour/15-day maximum; automatic 15-day requests use that ensemble and disclose the source.

### Proxy safety and cost

The proxy accepts a fixed route and validated coordinates/hours only, calls a hard-coded Google host, uses bounded pagination, and returns generic upstream errors. The key stays on the server. Google response data is not logged or persistently cached; responses use `Cache-Control: no-store`. The browser persists only place selections and preferences, not downloaded forecasts.

**CORS is not authentication or billing protection.** Non-browser clients can spoof an Origin header. This small proxy has process-wide concurrency and per-minute limits and a conservative per-process daily upstream-request ceiling (default 500). These reset with process restarts and are not shared across instances. A long forecast uses multiple Google requests because responses are paginated. Before exposing a production endpoint, add a gateway with appropriate authentication/abuse controls and shared limits, and enforce Google-side quotas. Budget alerts alone are not a hard spending cap. Restrict logging at your reverse proxy/host so it does not retain API keys or sensitive coordinates.

The app displays Google Maps attribution for Google forecasts and keeps Google weather data separate from the OpenStreetMap **location picker**, which does not render Google weather results on its map. Review the provider's [attribution and storage policies](https://developers.google.com/maps/documentation/weather/policies), your public terms/privacy policy and your commercial-use eligibility before production use. The free Open-Meteo endpoint has its own [terms](https://open-meteo.com/en/terms).

## Tests and checks

```sh
npm test                          # 38 native Node adapter/proxy tests
npm run build
python -m pip install playwright==1.57.0
python -m playwright install chromium
python tests/browser_smoke.py      # routed fixtures; no live paid APIs
```

The browser suite checks source labels, local unit conversion, timezone display, daily selection, keyboard chart and search controls, null responses, cancellation races, saved state, GPS denial, keyboard map selection, narrow screens and Google/fallback states. Screenshots and a JSON report go in ignored `test-results/`.

For environments that block all browser navigation, `python tests/browser_smoke.py --inline` runs the same 25 DOM checks using an in-memory bundle, simulated storage and synthetic API responses. **That mode does not verify real module loading, native storage persistence, live geolocation, map tiles or authenticated provider connectivity.** Local validation used this restricted mode: 38 Node tests and 25 in-memory DOM checks passed. The normal browser mode is configured in pull-request CI and must pass there before release.

The Pages workflow runs the Node tests and static build before deploying. Pull requests additionally run the normal browser suite. No test needs Google credentials.

## Provider references

- [Google hourly API guide and pagination](https://developers.google.com/maps/documentation/weather/hourly-forecast)
- [Google hourly response reference](https://developers.google.com/maps/documentation/weather/reference/rest/v1/forecast.hours/lookup)
- [WeatherNext access and model documentation](https://developers.google.com/weathernext)
- [Open-Meteo WeatherNext API](https://open-meteo.com/en/docs/google-weathernext-api)

Forecasts are not observations or emergency warnings. Follow [India Meteorological Department alerts](https://mausam.imd.gov.in/) for severe weather.
