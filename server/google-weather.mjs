/** Optional Node 22+ Google Weather proxy. Keep the API key on the server. */
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { coordinate, insideBounds, fetchJSON } from '../assets/forecast.js';

export async function getGoogleForecast({ lat, lon, hours, apiKey, signal, fetchImpl=globalThis.fetch, onUpstream=()=>{} }) {
  let token='',timeZone=null;const rows=[],tokens=new Set();
  // Google defaults to 24 entries per page. Never assume one response is the whole forecast.
  for(let page=0;page<10;page++){
    onUpstream();
    const url=new URL('https://weather.googleapis.com/v1/forecast/hours:lookup');
    url.search=new URLSearchParams({key:apiKey,'location.latitude':String(lat),'location.longitude':String(lon),hours:String(hours),pageSize:'24',unitsSystem:'METRIC',languageCode:'en',...(token?{pageToken:token}:{})}).toString();
    const data=await fetchJSON(url,{signal,fetchImpl,timeoutMs:10000});
    if(!Array.isArray(data.forecastHours))throw new Error('Invalid Google forecast response.');
    if(timeZone&&data.timeZone?.id&&timeZone.id!==data.timeZone.id)throw new Error('Inconsistent forecast time zones.');
    timeZone ||= data.timeZone;
    rows.push(...data.forecastHours);
    const unique=[...new Map(rows.map(h=>[h.interval?.startTime,h])).values()];
    if(unique.length>=hours||!data.nextPageToken){
      if(!unique.length)throw new Error('Empty Google forecast response.');
      return {forecastHours:unique.sort((a,b)=>Date.parse(a.interval?.startTime)-Date.parse(b.interval?.startTime)).slice(0,hours),timeZone};
    }
    if(!data.forecastHours.length||typeof data.nextPageToken!=='string'||tokens.has(data.nextPageToken))throw new Error('Invalid forecast pagination.');
    token=data.nextPageToken;tokens.add(token);
  }
  throw new Error('Forecast pagination exceeded its limit.');
}

export function createWeatherServer({apiKey='',allowedOrigins=[],fetchImpl=globalThis.fetch,maxRequestsPerMinute=20,maxUpstreamPerDay=500,maxConcurrent=3,now=()=>Date.now()}={}) {
  const origins=new Set(allowedOrigins);let minute=-1,requests=0,day=-1,upstream=0,inflight=0;
  function budget(){const currentDay=Math.floor(now()/86400000);if(currentDay!==day){day=currentDay;upstream=0;}if(upstream>=maxUpstreamPerDay)throw new Error('Upstream budget reached.');upstream++;}
  return http.createServer(async(req,res)=>{
    const origin=req.headers.origin;
    const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'};
    const send=(status,payload)=>{if(!res.destroyed&&!res.writableEnded){res.writeHead(status,headers);res.end(JSON.stringify(payload));}};
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/healthz'&&req.method==='GET'){send(200,{status:'ok'});return;}
    // Origin allowlisting reduces unintended browser use; it is NOT authentication.
    // Keep provider quotas/budgets and a production gateway or edge rate limiter enabled.
    if(!origin||!origins.has(origin)){send(403,{error:'Origin is not allowed.'});return;}
    headers['Access-Control-Allow-Origin']=origin;
    if(req.method==='OPTIONS'){
      headers['Access-Control-Allow-Methods']='GET, OPTIONS';headers['Access-Control-Allow-Headers']='Accept';headers['Access-Control-Max-Age']='600';send(204,{});return;
    }
    if(url.pathname!=='/forecast'){send(404,{error:'Not found.'});return;}
    if(req.method!=='GET'){headers.Allow='GET, OPTIONS';send(405,{error:'Use GET.'});return;}
    if([...url.searchParams.keys()].some(k=>!['lat','lon','hours'].includes(k))||['lat','lon','hours'].some(k=>url.searchParams.getAll(k).length!==1)){send(400,{error:'Provide lat, lon and hours exactly once.'});return;}
    const lat=coordinate(url.searchParams.get('lat')),lon=coordinate(url.searchParams.get('lon')),hours=coordinate(url.searchParams.get('hours'));
    if(!insideBounds(lat,lon)||!Number.isInteger(hours)||hours<1||hours>240){send(400,{error:'Valid India-region coordinates and 1–240 hours are required.'});return;}
    if(!apiKey){send(503,{error:'Google Weather is not configured.'});return;}
    const currentMinute=Math.floor(now()/60000);if(currentMinute!==minute){minute=currentMinute;requests=0;}
    if(requests>=maxRequestsPerMinute||inflight>=maxConcurrent){headers['Retry-After']='60';send(429,{error:'Forecast request limit reached. Try again shortly.'});return;}
    requests++;inflight++;
    const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),30000);
    const disconnected=()=>{if(!res.writableEnded)abort.abort();};res.on('close',disconnected);
    try{
      const data=await getGoogleForecast({lat,lon,hours,apiKey,signal:abort.signal,fetchImpl,onUpstream:budget});
      send(200,data);
    }catch{
      // Do not echo upstream URLs, API keys, response bodies, or billing details to clients/logs.
      send(502,{error:'Google Weather is temporarily unavailable. Use the free forecast or retry.'});
    }finally{clearTimeout(timer);res.off('close',disconnected);inflight--;}
  });
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const apiKey=process.env.GOOGLE_WEATHER_API_KEY;
  const origins=(process.env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean);
  if(!apiKey||!origins.length){console.error('Set GOOGLE_WEATHER_API_KEY and ALLOWED_ORIGINS before starting the proxy.');process.exit(1);}
  for(const origin of origins){const u=new URL(origin);if(u.origin!==origin||!['https:','http:'].includes(u.protocol))throw new Error('ALLOWED_ORIGINS must contain exact origins without paths or trailing slashes.');}
  const daily=Number(process.env.MAX_UPSTREAM_REQUESTS_PER_DAY||500);
  if(!Number.isInteger(daily)||daily<1)throw new Error('MAX_UPSTREAM_REQUESTS_PER_DAY must be a positive integer.');
  const port=Number(process.env.PORT||8080);
  const server=createWeatherServer({apiKey,allowedOrigins:origins,maxUpstreamPerDay:daily});
  server.requestTimeout=35000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
  server.listen(port,'0.0.0.0',()=>console.log(`Weather proxy listening on port ${port}.`));
}
