"""Native-module browser regressions for the restored original retro page.
Forecasts are synthetic; provider live-access probes are a separate workflow.
Run after npm run build. Requires playwright==1.57.0 and Chromium.
"""
import asyncio
import datetime as dt
import json
import math
import mimetypes
import os
from pathlib import Path
import time
from urllib.parse import urlparse, parse_qs
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'test-results'
OUT.mkdir(exist_ok=True)
START = int((time.time() + 19800) // 3600 * 3600 - 19800)


def ensemble(hours, mode):
    h = {'time': [START+i*3600 for i in range(hours)], 'is_day': [0 if mode.get('mood') == 'night' else 1] * hours}
    for member in range(4):
        suffix = '' if member == 0 else f'_member{member:02d}'
        base = 15 if mode.get('mood') == 'chilly' else 28
        h['temperature_2m'+suffix] = [None if mode.get('all_null') or (mode.get('missing_temp') and i == 0) else round(base+math.sin(i/5)+member/2,1) for i in range(hours)]
        h['rain'+suffix] = [None if mode.get('all_null') or (mode.get('missing_rain') and i == 1) else (.8 if member > 0 and (mode.get('mood') == 'rainy' or (not mode.get('mood') and 4 <= i%24 <= 8)) else 0) for i in range(hours)]
        h['cloud_cover'+suffix] = [80 if mode.get('mood') == 'cloudy' else 25] * hours
    return {'hourly': h, 'timezone': 'Asia/Kolkata', 'utc_offset_seconds': 19800}


def google(hours):
    iso = lambda t: dt.datetime.fromtimestamp(t,dt.timezone.utc).isoformat().replace('+00:00','Z')
    return {'timeZone': {'id':'Asia/Kolkata'}, 'forecastHours': [
        {'interval': {'startTime':iso(START+i*3600),'endTime':iso(START+(i+1)*3600)},
         'temperature': {'degrees':30,'unit':'CELSIUS'}, 'feelsLikeTemperature': {'degrees':32,'unit':'CELSIUS'},
         'precipitation': {'probability': {'percent':25},'qpf': {'quantity':.2,'unit':'MILLIMETERS'}},
         'cloudCover':40, 'isDaytime':True} for i in range(hours)]}


async def main():
    checks, failures, errors, requests = [], [], [], []
    mode = {}
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True, executable_path=os.environ.get('CHROMIUM_PATH'), args=['--no-sandbox'])
        context = await browser.new_context(viewport={'width':1440,'height':1080}, timezone_id='America/Los_Angeles')
        async def route(r):
            url=r.request.url; parsed=urlparse(url); query=parse_qs(parsed.query)
            if parsed.path.endswith('/config.js') and mode.get('google'):
                await r.fulfill(body="export const config={googleWeatherProxyUrl:'https://weather.example.test/forecast'};",content_type='application/javascript')
            elif parsed.hostname=='ensemble-api.open-meteo.com':
                requests.append(url); hours=int(query['forecast_hours'][0])
                data=ensemble(hours,mode.copy())
                if mode.get('slow') and hours==73: await asyncio.sleep(.5)
                await r.fulfill(json=data,headers={'Access-Control-Allow-Origin':'*'})
            elif parsed.hostname=='weather.example.test':
                requests.append(url)
                await r.fulfill(status=503 if mode.get('google_fail') else 200,json={'error':'Unavailable'} if mode.get('google_fail') else google(int(query['hours'][0])),headers={'Access-Control-Allow-Origin':'*'})
            elif parsed.hostname=='photon.komoot.io':
                if query.get('q')==['Slow']: await asyncio.sleep(.5)
                await r.fulfill(json={'features':[
                    {'geometry':{'coordinates':[73.8567,18.5204]},'properties':{'name':'Pune','state':'Maharashtra','countrycode':'IN'}},
                    {'geometry':{'coordinates':[73.86,18.52]},'properties':{'name':'<img src=x onerror=alert(1)>','countrycode':'IN'}}]},headers={'Access-Control-Allow-Origin':'*'})
            elif parsed.hostname=='rainscope.example.test':
                path=(ROOT/'dist'/parsed.path.lstrip('/')).resolve() if parsed.path!='/' else ROOT/'dist/index.html'
                assert path.is_relative_to(ROOT/'dist')
                await r.fulfill(body=path.read_bytes(),content_type='application/javascript' if path.suffix=='.js' else mimetypes.guess_type(str(path))[0] or 'application/octet-stream')
            else:
                await r.abort()
        await context.route('**/*',route)
        page=await context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
        async def text(selector):
            # The original retro CSS uppercases some labels. Test their data text
            # separately from that presentation, which has its own style check.
            return (await page.locator(selector).text_content() or '').strip()
        async def boot():
            await page.goto('https://rainscope.example.test/')
            await page.wait_for_function("document.getElementById('forecastBtn').onclick !== null")
        async def forecast():
            await page.locator('#forecastBtn').click()
            await page.locator('#forecastContent.visible').wait_for()
            await page.wait_for_function("document.getElementById('forecastPanel').getAttribute('aria-busy') === 'false'")
            assert not await page.locator('#locationError').is_visible(), await text('#locationError')
        def check(name, condition):
            (checks if condition else failures).append(name)
        try:
            await boot()
            check('original manual forecast flow, not a redesigned auto dashboard', await page.locator('#emptyState').is_visible() and not requests)
            check('original monospace typography', 'Courier' in await page.evaluate('getComputedStyle(document.body).fontFamily'))
            check('original terminal window chrome and marquee', await page.locator('.retro-marquee').count()==1 and 'FORECAST_VIEWER.HTML' in await page.locator('#forecastPanel').evaluate("e=>getComputedStyle(e,'::before').content"))
            check('original heavy panel borders', await page.locator('.left-panel').evaluate("e=>parseFloat(getComputedStyle(e).borderTopWidth)>=3"))
            await forecast()
            check('real returned member count and correct model label', '4 temperature members' in await text('.model-pill') and 'WeatherNext 2' in await text('.forecast-top .eyebrow'))
            check('original uppercase label presentation', await page.locator('.forecast-top .eyebrow').evaluate("e=>getComputedStyle(e).textTransform")=='uppercase')
            check('forecast request includes the closing precipitation timestamp', 'forecast_hours=25' in requests[-1])
            expected=dt.datetime.fromtimestamp(START,dt.timezone(dt.timedelta(hours=5,minutes=30))).strftime('%I').lstrip('0')
            check('India timezone independent of browser timezone', await text('#timezoneText')=='Asia/Kolkata' and (await page.locator('.time-main').first.text_content()).startswith(expected+':'))
            await page.locator('#forecastChart').focus();await page.keyboard.press('ArrowRight')
            check('keyboard chart exposes exact hour values', bool(await text('#chartA11y')) and await page.locator('#chartTooltip').is_visible())
            await page.locator('#forecastBtn').focus()
            await page.screenshot(path=str(OUT/'retro-desktop.png'),full_page=True)
            check('desktop has no horizontal overflow', await page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            zoom=await text('#mapZoomReadout')
            await page.locator('#map').dispatch_event('wheel',{'deltaY':100,'ctrlKey':False})
            check('ordinary scrolling does not unexpectedly zoom the map', zoom==await text('#mapZoomReadout'))
            await page.locator('#map').focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter')
            check('keyboard map selection invalidates old forecast', not await page.locator('#forecastContent').is_visible())
            lat=await page.locator('#latInput').input_value()
            await page.locator('#map').dispatch_event('pointerdown',{'pointerId':8,'pointerType':'touch','clientX':200,'clientY':300})
            await page.locator('#map').dispatch_event('pointercancel',{'pointerId':8,'pointerType':'touch','clientX':240,'clientY':330})
            check('cancelled map gesture never selects a different pin', lat==await page.locator('#latInput').input_value())
            await page.locator('#daysBtn').click();await page.locator('#horizonN').fill('3');await forecast()
            second=page.locator('.day-card').nth(1);await second.focus();await page.keyboard.press('Enter')
            check('daily keyboard selection preserves focus', await second.get_attribute('aria-pressed')=='true' and await second.evaluate('(e)=>document.activeElement===e'))
            check('daily selection shows the chosen 24 hours', await page.locator('.timeline-row').count()==24)
            await page.locator('#placeSearch').fill('Pune');await page.locator('#searchResults [role=option]').first.wait_for()
            check('untrusted search names are escaped', await page.locator('#searchResults img').count()==0 and '<img' in await text('#searchResults'))
            await page.keyboard.press('ArrowUp')
            check('search ArrowUp initially selects last option', await page.locator('#placeSearch').get_attribute('aria-activedescendant')=='search-option-1')
            await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter')
            check('search selection retains manual forecast flow', '18.5204'==await page.locator('#latInput').input_value() and not await page.locator('#forecastContent').is_visible())
            await forecast()
            check('forecast belongs to selected search result', 'Pune' in await text('#forecastTitle'))
            await boot();await forecast()
            check('selected place persists in native browser storage', 'Pune' in await text('#forecastTitle'))
            await page.locator('#placeSearch').fill('Slow');await page.wait_for_timeout(330);await page.locator('#placeSearch').fill('');await page.wait_for_timeout(650)
            check('cleared search cannot be reopened by a stale response', not await page.locator('#searchResults').is_visible())
            await page.evaluate("navigator.geolocation.getCurrentPosition=(ok,fail)=>fail({code:1})")
            await page.locator('#locateMe').click()
            check('GPS denial offers an actionable error', 'denied' in await text('#locationError'))
            await page.evaluate("navigator.geolocation.getCurrentPosition=(ok)=>{window.pendingGPS=ok}")
            await page.locator('#locateMe').click();await page.locator('#latInput').fill('17.5')
            await page.evaluate("window.pendingGPS({coords:{latitude:28.6,longitude:77.2,accuracy:10}})")
            check('late GPS cannot overwrite a newer manual selection', await page.locator('#latInput').input_value()=='17.5')
            mode['slow']=True
            await page.locator('#daysBtn').click();await page.locator('#horizonN').fill('3');await page.locator('#forecastBtn').click()
            await page.locator('#hoursBtn').click();await page.locator('#horizonN').fill('1');await forecast();await page.wait_for_timeout(650)
            check('a cancelled forecast cannot overwrite the new range', 'Next 1 hour' in await text('#forecastSub'))
            mode['slow']=False
            await page.locator('#horizonN').fill('24')
            mode['all_null']=True;await page.locator('#forecastBtn').click();await page.locator('#locationError.visible').wait_for()
            check('all-null data fails visibly without false dry or zero forecast', not await page.locator('#forecastContent').is_visible())
            mode['all_null']=False;await forecast()
            mode['missing_rain']=True;await forecast()
            check('missing rain suppresses the total and shows a notice', await text('#totalRain')=='—' and await page.locator('#sourceNotice').is_visible())
            mode['missing_rain']=False;mode['missing_temp']=True;await forecast()
            check('missing temperature is unknown rather than zero Celsius', await text('#nextTemp')=='—' and '0°C' not in await page.locator('.timeline-row').first.text_content())
            mode['missing_temp']=False
            for mood in ['sunny','rainy','cloudy','night','chilly']:
                mode['mood']=mood;await forecast()
                check('original automatic '+mood+' theme', await page.locator('body').get_attribute('data-weather-theme')==mood)
            mode.pop('mood')
            await page.locator('#daysBtn').click();await page.locator('#horizonN').fill('15');await forecast()
            check('fifteen-day forecast still works', await page.locator('.day-card').count()>=15 and 'forecast_hours=361' in requests[-1])
            for width in [390,360,768,1024]:
                await page.set_viewport_size({'width':width,'height':844});await page.wait_for_timeout(100)
                check(f'{width}px viewport has no horizontal page overflow', await page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
                if width==390: await page.screenshot(path=str(OUT/'retro-mobile.png'),full_page=True)
            await page.set_viewport_size({'width':1440,'height':1080})
            await page.locator('#hoursBtn').click();await page.locator('#horizonN').fill('24')
            mode['google']=True;await boot();await page.locator('#hoursBtn').click();await page.locator('#horizonN').fill('24');await forecast()
            check('Google is accurately labelled as a blended service', 'Google Weather API' in await text('.forecast-top .eyebrow') and 'blended' in await text('.model-pill'))
            check('Google Maps attribution is visible and no uncertainty is invented', await page.locator('.google-attribution').is_visible() and not await page.locator('.legend span:nth-child(2)').is_visible())
            mode['google_fail']=True;await forecast()
            check('whole-source fallback is disclosed', 'WeatherNext 2' in await text('.forecast-top .eyebrow') and 'instead' in await text('#sourceNotice'))
            mode['google_fail']=False
            await page.locator('#daysBtn').click();await page.locator('#horizonN').fill('15');await forecast()
            check('long range keeps the free ensemble rather than overstating Google coverage', 'ensemble-api.open-meteo.com' in requests[-1] and '10 days' in await text('#sourceNotice'))
            await page.emulate_media(reduced_motion='reduce')
            check('reduced-motion preference stops marquee animation', await page.locator('.retro-marquee-track').evaluate("e=>getComputedStyle(e).animationName")=='none')
            check('no browser JavaScript runtime errors', not errors)
            assert not failures, failures
        finally:
            await page.screenshot(path=str(OUT/'last-state.png'),full_page=True)
            report={'passed':len(checks),'failed':failures,'checks':checks,'browser_errors':errors,'mode':'routed HTTP, native modules and storage, synthetic weather fixtures', 'diagnostic_labels':{s:await text(s) for s in ['.model-pill','.forecast-top .eyebrow','#locationError','#forecastSub']}}
            (OUT/'browser-results.json').write_text(json.dumps(report,indent=2))
            print(json.dumps(report,indent=2))
            await browser.close()


if __name__=='__main__':
    asyncio.run(main())
