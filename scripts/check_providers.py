"""Read-only, bounded provider probes. Never print credentials or response bodies.
An anonymous denial does not establish the approval status of a personal account.
Optional GitHub secret: WEATHERNEXT_GOOGLE_CREDENTIALS (Google credential JSON).
"""
import datetime as dt
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.parse
import urllib.request

BASE = 'https://storage.googleapis.com/storage/v1/b/weathernext3_statistics_spatial/o'
PREFIX = 'weathernext_3_0_0_statistics/zarr/2026_to_present/'
LIMIT = 262144


def read(url, headers=None):
    try:
        req = urllib.request.Request(url, headers={'Accept': 'application/json', **(headers or {})})
        with urllib.request.urlopen(req, timeout=20) as response:
            data = response.read(LIMIT + 1)
            if len(data) > LIMIT:
                return response.status, None
            try:
                return response.status, json.loads(data)
            except (ValueError, UnicodeError):
                return response.status, None
    except urllib.error.HTTPError as error:
        return error.code, None
    except (urllib.error.URLError, TimeoutError, OSError):
        return 'network_error', None


def probe_gcs(token=None):
    headers = {'Authorization': 'Bearer ' + token} if token else {}
    params = urllib.parse.urlencode({'prefix': PREFIX, 'delimiter': '/', 'maxResults': 1, 'fields': 'prefixes'})
    status, data = read(BASE + '?' + params, headers)
    report = {'list_http': status, 'status': 'unverified'}
    if status in (401, 403):
        report['status'] = 'credential_rejected_or_permission_denied' if token else 'anonymous_access_denied'
        return report
    if status != 200 or not isinstance(data, dict):
        return report
    prefixes = data.get('prefixes', [])
    if not prefixes or not prefixes[0].startswith(PREFIX):
        report['status'] = 'listing_allowed_no_run_verified'
        return report
    obj = prefixes[0] + 'predictions.zarr/zarr.json'
    status, meta = read(BASE + '/' + urllib.parse.quote(obj, safe='') + '?alt=media', headers)
    report['metadata_http'] = status
    report['status'] = 'zarr_metadata_access_confirmed' if status == 200 and isinstance(meta, dict) and meta.get('zarr_format') == 3 else 'listing_allowed_metadata_unverified'
    report['note'] = 'Metadata only; not a live point forecast or permission to redistribute.'
    return report


def main():
    results = {'checked_at_utc': dt.datetime.now(dt.timezone.utc).isoformat(), 'statistics_bucket_anonymous': probe_gcs()}
    credential_json = os.environ.get('WEATHERNEXT_GOOGLE_CREDENTIALS', '').strip()
    results['account_access'] = {'status': 'not_tested_no_WEATHERNEXT_GOOGLE_CREDENTIALS_configured', 'note': 'This does not establish whether a personal Google Account was approved, or whether a differently named secret exists.'}
    if credential_json:
        try:
            import google.auth
            from google.auth.transport.requests import Request
            info = json.loads(credential_json)
            if info.get('type') not in ('service_account', 'authorized_user'):
                raise ValueError('Unsupported credential type')
            if info.get('type') == 'service_account' and info.get('token_uri') != 'https://oauth2.googleapis.com/token':
                raise ValueError('Unexpected token host')
            credentials, _ = google.auth.load_credentials_from_dict(info, scopes=['https://www.googleapis.com/auth/devstorage.read_only'])
            credentials.refresh(Request())
            results['account_access'] = probe_gcs(credentials.token)
        except Exception:
            results['account_access'] = {'status': 'authentication_failed', 'note': 'Credentials or token refresh failed; no secret values are logged.'}
    for model in ['google_weathernext2_ensemble', 'google_weathernext3_ensemble']:
        params = urllib.parse.urlencode({'latitude': 17.45, 'longitude': 78.30, 'hourly': 'temperature_2m,rain', 'forecast_hours': 2, 'timeformat': 'unixtime', 'models': model})
        status, data = read('https://ensemble-api.open-meteo.com/v1/ensemble?' + params)
        usable = status == 200 and isinstance(data, dict) and bool(data.get('hourly', {}).get('time'))
        results[model] = {'http': status, 'returned_hourly_data': usable, 'status': 'documented_model' if model.endswith('2_ensemble') and usable else 'candidate_only_not_proof_of_model_identity' if usable else 'not_available_in_this_probe'}
    endpoint = os.environ.get('GOOGLE_WEATHER_PROXY_URL', '').strip()
    results['google_weather_proxy'] = {'configured_actions_variable': bool(endpoint), 'status': 'not_configured'}
    if endpoint:
        parsed = urllib.parse.urlsplit(endpoint)
        if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.query or parsed.fragment:
            results['google_weather_proxy']['status'] = 'invalid_public_endpoint'
        else:
            status, data = read(endpoint + '?' + urllib.parse.urlencode({'lat': 17.45, 'lon': 78.30, 'hours': 1}), {'Origin': 'https://legedith.github.io'})
            results['google_weather_proxy'].update({'http': status, 'status': 'hourly_data_returned' if status == 200 and isinstance(data, dict) and bool(data.get('forecastHours')) else 'request_failed'})
    Path('test-results').mkdir(exist_ok=True)
    Path('test-results/provider-access.json').write_text(json.dumps(results, indent=2))
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
