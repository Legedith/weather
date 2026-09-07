# WeatherNext access check — 7 September 2026

## Live checks performed through GitHub Actions

[Provider check run 34087967957](https://github.com/Legedith/weather/actions/runs/34087967957), recorded at **2026-09-07 05:44:43 UTC**:

| Check | Observed result | What it establishes |
| --- | --- | --- |
| Anonymous list of the documented WeatherNext 3 statistics bucket | HTTP **401** | The tested request needs authentication. It says nothing about a personal account's approval. |
| Authenticated approved-account test | **Not run:** `WEATHERNEXT_GOOGLE_CREDENTIALS` was not configured | No approved Google identity was available to this check. No claim is made about differently named secrets or account email. |
| Existing `google_weathernext2_ensemble` endpoint | HTTP **200**, hourly data returned | The current free provider works. |
| Candidate `google_weathernext3_ensemble` on the same endpoint | HTTP **400**, no hourly data | This tested model identifier is not usable; it was a discovery probe, not an enabled provider. |
| `GOOGLE_WEATHER_PROXY_URL` Actions variable | **Not configured** | No proxy endpoint was available through that deployment variable to test. |

No account connector other than GitHub was used. No secrets, access tokens, account identifiers or forecast response bodies were printed. Only the precomputed statistics bucket was tested; the Requester Pays full-ensemble bucket was not accessed. These checks do **not** establish that an approval email has or has not arrived.

## Public alternatives verified in provider documentation

[Open-Meteo's WeatherNext API](https://open-meteo.com/en/docs/google-weathernext-api) still documents **WeatherNext 2** and `google_weathernext2_ensemble`. No newly available, documented, unauthenticated WeatherNext 3 replacement was verified in this research. The live rejection above strengthens that finding for the specific candidate identifier, but is not proof that every possible third-party endpoint is unavailable.

[Google Maps Platform Weather API](https://mapsplatform.google.com/maps-products/weather/) explicitly includes WeatherNext 3 among the models enhancing its blended forecasts. It is a usable alternative with a [recurring free allowance and billing requirements](https://developers.google.com/maps/documentation/weather/usage-and-billing), not a no-signup or pure WeatherNext 3 API. The app's server-side adapter remains ready for this route once a proxy/key is configured.

[Google's raw-data access guide](https://developers.google.com/weathernext/guides/access-forecast) provides account-gated WeatherNext 3 through Earth Engine, BigQuery and Cloud Storage. The [statistics Zarr bucket](https://developers.google.com/weathernext/guides/gcs) has Requester Pays OFF:

```text
gs://weathernext3_statistics_spatial/weathernext_3_0_0_statistics/zarr/
```

That removes requester data charges for this store, **not** the authentication requirement or any hosting/processing cost. A public website must also satisfy the real-time data's applicable terms. Means/percentiles cannot recover exact member-vote rain probabilities, so a future statistics adapter must not fabricate them.

## Next authenticated check

Use the **Check weather provider access** workflow with a credential for the Google identity that was approved, stored only in the optional GitHub secret `WEATHERNEXT_GOOGLE_CREDENTIALS`. The helper verifies listing and a small Zarr metadata object. A success is labelled **metadata access confirmed**, not a tested operational point forecast. The workflow can be rerun manually; no periodic/background schedule was enabled.
