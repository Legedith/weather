"""Offline browser regression tests. Install playwright==1.57.0 and its Chromium.
Run after `npm run build`: python tests/browser_smoke.py.
Forecast fixtures are synthetic; these tests do not validate a live Google account.
"""
import asyncio
import json
import math
import os
import mimetypes
import re
import sys
from pathlib import Path
import time
from urllib.parse import urlparse, parse_qs
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'test-results'
OUT.mkdir(exist_ok=True)
START = int((time.time() + 19800) // 3600 * 3600 - 19800)


def ensemble(hours=24, missing=False):
    h = {'time': [START + i * 3600 for i in range(hours)], 'is_day': [int(6 <= (15+i) % 24 < 18) for i in range(hours)]}
    for member in range(4):
        suffix = '' if member == 0 else f'_member{member:02d}'
        h['temperature_2m'+suffix] = [None if missing else round(28 + 3*math.sin(i/5)+member/2, 1) for i in range(hours)]
        h['rain'+suffix] = [None if missing else (0.8 if 4 <= i % 24 <= 8 and member >= 1 else 0) for i in range(hours)]
        h['cloud_cover'+suffix] = [55 for _ in range(hours)]
    return {'hourly': h, 'timezone': 'Asia/Kolkata', 'utc_offset_seconds': 19800}


def google(hours=24):
    import datetime as dt
    iso = lambda t: dt.datetime.fromtimestamp(t, dt.timezone.utc).isoformat().replace('+00:00', 'Z')
    return {'timeZone': {'id': 'Asia/Kolkata'}, 'forecastHours': [
        {'interval': {'startTime': iso(START+i*3600), 'endTime': iso(START+(i+1)*3600)},
         'temperature': {'degrees': 30, 'unit': 'CELSIUS'},
         'feelsLikeTemperature': {'degrees': 32, 'unit': 'CELSIUS'},
         'precipitation': {'probability': {'percent': 25}, 'qpf': {'quantity': 0.2, 'unit': 'MILLIMETERS'}},
         'cloudCover': 40, 'isDaytime': True} for i in range(hours)]}


async def main():
    base = 'https://rainscope.example.test'
    errors, requests, checks = [], [], []
    inline = '--inline' in sys.argv
    mode = {'missing': False, 'google': False, 'google_fail': False, 'slow': False}
    async with async_playwright() as pw:
        executable = os.environ.get('CHROMIUM_PATH')
        if not executable and Path('/usr/bin/chromium').exists():
            executable = '/usr/bin/chromium'
        browser = await pw.chromium.launch(headless=True, executable_path=executable, args=['--no-sandbox'])
        context = await browser.new_context(viewport={'width':1440,'height':1080}, timezone_id='America/Los_Angeles')
        async def route(request_route):
            url=request_route.request.url
            parsed=urlparse(url)
            query=parse_qs(parsed.query)
            if parsed.path.endswith('/config.js') and mode['google']:
                await request_route.fulfill(body="export const config={googleWeatherProxyUrl:'https://weather.example.test/forecast'};", content_type='application/javascript')
            elif parsed.hostname=='ensemble-api.open-meteo.com':
                requests.append(url)
                hours=int(query['forecast_hours'][0])
                if mode['slow'] and hours==73:
                    await asyncio.sleep(0.4)
                await request_route.fulfill(json=ensemble(hours, mode['missing']), headers={'Access-Control-Allow-Origin':'*'})
            elif parsed.hostname=='weather.example.test':
                requests.append(url)
                if mode['google_fail']:
                    await request_route.fulfill(status=503, json={'error':'Unavailable'}, headers={'Access-Control-Allow-Origin':'*'})
                else:
                    await request_route.fulfill(json=google(int(query['hours'][0])), headers={'Access-Control-Allow-Origin':'*'})
            elif parsed.hostname=='photon.komoot.io':
                await request_route.fulfill(json={'features':[
                    {'geometry':{'coordinates':[73.8567,18.5204]},'properties':{'name':'Pune','state':'Maharashtra','countrycode':'IN'}},
                    {'geometry':{'coordinates':[73.86,18.52]},'properties':{'name':'<img src=x onerror=alert(1)>','countrycode':'IN'}}]}, headers={'Access-Control-Allow-Origin':'*'})
            elif parsed.hostname=='rainscope.example.test':
                path=(ROOT/'dist'/parsed.path.lstrip('/')).resolve() if parsed.path!='/' else ROOT/'dist/index.html'
                assert path.is_relative_to(ROOT/'dist')
                await request_route.fulfill(body=path.read_bytes(), content_type=mimetypes.guess_type(str(path))[0] or 'application/octet-stream')
            else:
                await request_route.abort()
        await context.route('**/*', route)
        page=None
        async def boot():
            nonlocal page
            persisted={}
            if page is not None:
                if inline:
                    persisted=await page.evaluate('window.__storage||{}')
                await page.close()
            page=await context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            if not inline:
                await page.goto(base)
                return
            # Restricted runners cannot navigate. Exercise the same DOM code in
            # memory; navigation, module loading and storage are NOT verified here.
            html=(ROOT/'dist/index.html').read_text()
            html=re.sub(r'<script[^>]*src="[^"]*"[^>]*></script>', '', html)
            html=re.sub(r'<link[^>]*href="./assets/styles.css"[^>]*>', '<style>'+(ROOT/'dist/assets/styles.css').read_text()+'</style>', html)
            await page.set_content(html)
            async def mock_fetch(_, url):
                parsed=urlparse(url);q=parse_qs(parsed.query)
                if parsed.hostname=='photon.komoot.io':
                    return {'status':200,'data':{'features':[{'geometry':{'coordinates':[73.8567,18.5204]},'properties':{'name':'Pune','state':'Maharashtra','countrycode':'IN'}},{'geometry':{'coordinates':[73.86,18.52]},'properties':{'name':'<img src=x onerror=alert(1)>','countrycode':'IN'}}]}}
                requests.append(url)
                if parsed.hostname=='weather.example.test':
                    return {'status':503 if mode['google_fail'] else 200,'data':google(int(q['hours'][0]))}
                hours=int(q['forecast_hours'][0])
                if mode['slow'] and hours==73: await asyncio.sleep(.4)
                return {'status':200,'data':ensemble(hours,mode['missing'])}
            await page.expose_binding('__mockFetch', mock_fetch)
            await page.evaluate("""saved=>{
              window.__storage=saved;
              Object.defineProperty(window,'localStorage',{value:{getItem:k=>window.__storage[k]??null,setItem:(k,v)=>{window.__storage[k]=String(v)},removeItem:k=>{delete window.__storage[k]}}});
              window.fetch=(url,options={})=>new Promise((resolve,reject)=>{
                if(options.signal?.aborted){reject(options.signal.reason);return;}
                options.signal?.addEventListener('abort',()=>reject(options.signal.reason),{once:true});
                window.__mockFetch(String(url)).then(r=>resolve({ok:r.status===200,status:r.status,json:async()=>r.data})).catch(reject);
              });
            }""",persisted)
            source='\n'.join((ROOT/f'dist/assets/{name}').read_text() for name in ['forecast.js','map.js','app.js'])
            source=re.sub(r'^import .*?;\n','',source,flags=re.M)
            source=re.sub(r'^export ', '', source,flags=re.M)
            cfg={'googleWeatherProxyUrl':'https://weather.example.test/forecast' if mode['google'] else ''}
            await page.add_script_tag(content='(()=>{const config='+json.dumps(cfg)+';'+source+'})();')
        async def ready():
            await page.locator('#forecastContent').wait_for(state='visible')
        def check(name, condition):
            assert condition, name
            checks.append(name)
        await boot()
        await ready()
        check('free provider and real member count', 'WeatherNext 2' in await page.locator('#activeSource').inner_text() and '4 members' in await page.locator('#currentDetail').inner_text())
        check('forecast timezone not browser timezone', 'Asia/Kolkata' in await page.locator('#locationMeta').inner_text())
        count=len(requests)
        await page.locator('[data-unit=f]').click()
        check('unit toggle converts locally', 'F' in await page.locator('#currentTemp').inner_text() and len(requests)==count)
        await page.locator('[data-unit=c]').click()
        await page.screenshot(path=str(OUT/'desktop.png'), full_page=True)
        check('desktop no horizontal overflow', await page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        await page.locator('[data-hours="168"]').click()
        await ready()
        second=page.locator('#days button').nth(1)
        await second.focus()
        await page.keyboard.press('Enter')
        check('day keyboard selection preserves focus', await second.get_attribute('aria-pressed')=='true' and await second.evaluate('(e)=>document.activeElement===e'))
        check('daily selection updates rows', await page.locator('#hourlyRows tr').count()==24)
        await page.locator('[data-metric=rain]').click()
        check('rain has its own percentage axis', '100%' in await page.locator('#chart').inner_text())
        await page.locator('#chartHour').focus()
        before=await page.locator('#chartReadout').inner_text()
        await page.keyboard.press('ArrowRight')
        check('keyboard chart scrubber works', before!=await page.locator('#chartReadout').inner_text())
        await page.locator('[data-hours="360"]').click()
        await ready()
        check('fifteen-day cards do not overflow page', await page.locator('#days button').count()>=15 and await page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        mode['slow']=True
        await page.locator('[data-hours="72"]').click()
        await page.locator('[data-hours="24"]').click()
        await ready()
        await page.wait_for_timeout(500)
        check('new request wins over stale request', await page.locator('[data-hours="24"]').get_attribute('aria-pressed')=='true' and '1 day' in await page.locator('#locationMeta').inner_text())
        mode['slow']=False
        await page.locator('#placeSearch').fill('Pune')
        await page.locator('#searchResults [role=option]').first.wait_for()
        check('untrusted search names rendered as text', await page.locator('#searchResults img').count()==0 and '<img' in await page.locator('#searchResults').inner_text())
        await page.keyboard.press('ArrowUp')
        check('ArrowUp initially selects last search option', await page.locator('#placeSearch').get_attribute('aria-activedescendant')=='place-option-1')
        await page.keyboard.press('ArrowDown')
        await page.keyboard.press('Enter')
        await ready()
        check('search selection fetches chosen coordinates', await page.locator('#placeName').inner_text()=='Pune' and '18.5204' in await page.locator('#locationMeta').inner_text())
        await page.locator('#savePlace').click()
        await boot()
        await ready()
        check('saved places and selected place survive reinitialization', await page.locator('#savedPlaces button').count()==1 and await page.locator('#placeName').inner_text()=='Pune')
        await page.evaluate("()=>{navigator.geolocation.getCurrentPosition=(ok, fail)=>fail({code:1});}")
        await page.locator('#locateMe').click()
        check('GPS denial gives an alternative', 'denied' in await page.locator('#toast').inner_text())
        await page.locator('#mapDetails summary').click()
        await page.wait_for_function("document.querySelector('#tiles').childElementCount > 0")
        await page.locator('#map').focus()
        await page.keyboard.press('ArrowRight')
        await page.keyboard.press('Enter')
        await ready()
        check('keyboard map can select a location', await page.locator('#placeName').inner_text()=='Pinned location')
        await page.locator('#mapDetails summary').click()
        mode['missing']=True
        await page.locator('#refresh').click()
        await page.locator('#error').wait_for(state='visible')
        check('all-null forecast errors without zero values', not await page.locator('#forecastContent').is_visible())
        mode['missing']=False
        await page.locator('#retry').click()
        await ready()
        await page.set_viewport_size({'width':390,'height':844})
        await page.screenshot(path=str(OUT/'mobile.png'), full_page=True)
        check('mobile 390px no horizontal overflow', await page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        await page.set_viewport_size({'width':360,'height':780})
        check('mobile 360px no horizontal overflow', await page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        mode['google']=True
        await boot()
        await ready()
        check('Google source is not falsely labelled ensemble', 'Google Weather API' in await page.locator('#activeSource').inner_text() and 'Feels like' in await page.locator('#currentDetail').inner_text())
        check('Google Maps attribution is visible', await page.locator('#googleAttribution').is_visible())
        await page.locator('#provider').select_option('google')
        await ready()
        check('explicit Google limits horizon to 240 hours', await page.locator('[data-hours="360"]').is_disabled() and await page.locator('#customHours').get_attribute('max')=='240')
        mode['google_fail']=True
        await page.locator('#refresh').click()
        await page.locator('#error').wait_for(state='visible')
        check('explicit Google failure is not silently relabelled', not await page.locator('#forecastContent').is_visible())
        await page.locator('#provider').select_option('auto')
        await ready()
        check('automatic fallback is clearly disclosed', 'WeatherNext 2' in await page.locator('#activeSource').inner_text() and 'instead' in (await page.locator('#notice').inner_text()).lower())
        check('no browser runtime errors', not errors)
        await browser.close()
    report={'mode':'in-memory DOM with simulated storage; navigation restricted' if inline else 'routed HTTP with native modules/storage','passed':len(checks),'checks':checks,'browser_errors':errors,'forecast_mode':'synthetic fixtures, not live authenticated Google data'}
    (OUT/'browser-results.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))


if __name__=='__main__':
    asyncio.run(main())
