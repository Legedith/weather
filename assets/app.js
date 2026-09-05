import { config } from './config.js';
import { DEFAULT_PLACE, BOUNDS, HOUR, coordinate, insideBounds, loadForecast, fetchJSON, groupDays, summarize, lowestRainWindow, dateKey, validatedProxyUrl } from './forecast.js';
import { createMap } from './map.js';
const $=id=>document.getElementById(id);
const text=(id,value)=>{$(id).textContent=value;};
const hide=(id,on=true)=>{$(id).hidden=on;};
const storage={get(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}},set(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{}}};
const cleanPlace=p=>p&&insideBounds(p.lat,p.lon)?{lat:p.lat,lon:p.lon,name:typeof p.name==='string'?p.name.slice(0,120):'Selected place'}:null;
const legacyPin=storage.get('rainscope-pin',null);
const legacy=legacyPin?cleanPlace({...legacyPin,name:(()=>{try{return localStorage.getItem('rainscope-place')||'Selected place';}catch{return 'Selected place';}})()}):null;
const saved=storage.get('rainscope-v2',{});
const state={place:cleanPlace(saved.place)||legacy||{...DEFAULT_PLACE},hours:Number.isInteger(saved.hours)&&saved.hours>=1&&saved.hours<=360?saved.hours:24,unit:saved.unit==='f'?'f':'c',provider:['auto','google','openmeteo'].includes(saved.provider)?saved.provider:'auto',favorites:Array.isArray(saved.favorites)?saved.favorites.map(cleanPlace).filter(Boolean).slice(0,5):[],forecast:null,day:null,metric:'temperature',request:0,revision:0};
let proxyUrl='',configurationError='';
try{proxyUrl=validatedProxyUrl(config.googleWeatherProxyUrl);}catch{configurationError='Google’s proxy configuration is invalid. The free forecast is still available.';}
if(!proxyUrl&&state.provider==='google')state.provider='auto';
let mapPicker=null,forecastAbort=null,searchAbort=null,searchTimer=null,searchVersion=0,searchItems=[],activeResult=-1,locationVersion=0;
const save=()=>storage.set('rainscope-v2',{place:state.place,hours:state.hours,unit:state.unit,provider:state.provider,favorites:state.favorites});
function toast(message){text('toast',message);hide('toast',false);clearTimeout(toast.timer);toast.timer=setTimeout(()=>hide('toast'),4200);}
function restoreLink(){
  const p=new URLSearchParams(location.hash.slice(1)),lat=coordinate(p.get('lat')),lon=coordinate(p.get('lon'));
  if(insideBounds(lat,lon)){state.place={lat,lon,name:(p.get('name')||'Shared place').slice(0,120)};const hours=coordinate(p.get('hours'));if(Number.isInteger(hours)&&hours>=1&&hours<=360)state.hours=hours;}
}
restoreLink();
const formatTime=(time,options={})=>new Intl.DateTimeFormat('en-IN',{timeZone:state.forecast?.timezone||'Asia/Kolkata',hour:'numeric',minute:'2-digit',...options}).format(new Date(time));
const formatDay=(time,options={})=>new Intl.DateTimeFormat('en-IN',{timeZone:state.forecast?.timezone||'Asia/Kolkata',weekday:'short',day:'numeric',month:'short',...options}).format(new Date(time));
const convert=v=>v===null?null:state.unit==='f'?v*9/5+32:v;
const temp=(v,unit=false)=>v===null?'—':`${Math.round(convert(v))}°${unit?state.unit.toUpperCase():''}`;
const percent=v=>v===null?'—':`${Math.round(v)}%`;
const amount=v=>v===null?'—':`${v<10?v.toFixed(1):Math.round(v)} mm`;
const duration=hours=>hours%24===0?`${hours/24} day${hours===24?'':'s'}`:`${hours} hour${hours===1?'':'s'}`;
const samePlace=(a,b)=>Math.abs(a.lat-b.lat)<.00005&&Math.abs(a.lon-b.lon)<.00005;
function updateControls(){
  text('placeName',state.place.name);$('latitude').value=state.place.lat.toFixed(4);$('longitude').value=state.place.lon.toFixed(4);
  $('customHours').value=state.hours;$('customHours').max=state.provider==='google'?240:360;
  document.querySelector('label[for=customHours]').textContent=`Hours (1–${$('customHours').max})`;
  document.querySelectorAll('[data-hours]').forEach(b=>{b.setAttribute('aria-pressed',String(Number(b.dataset.hours)===state.hours));b.disabled=state.provider==='google'&&Number(b.dataset.hours)>240;});
  document.querySelectorAll('[data-unit]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.unit===state.unit)));
  $('provider').value=state.provider;
  const favorite=state.favorites.some(p=>samePlace(p,state.place));$('savePlace').setAttribute('aria-pressed',String(favorite));text('savePlace',favorite?'Saved · remove':'Save place');
  const fragment=document.createDocumentFragment();
  state.favorites.forEach(place=>{const b=document.createElement('button');b.type='button';b.textContent=place.name;b.title=`Forecast for ${place.name}`;b.onclick=()=>choosePlace(place);fragment.append(b);});$('savedPlaces').replaceChildren(fragment);
}
function choosePlace(place){
  const clean=cleanPlace(place);if(!clean){toast('Choose a location inside the India region.');return;}
  state.place=clean;state.day=null;state.revision++;locationVersion++;cancelSearch();$('placeSearch').value='';text('searchStatus','');
  mapPicker?.setPin(clean);updateControls();save();runForecast();
}
function setHours(hours){
  const max=state.provider==='google'?240:360;
  if(!Number.isInteger(hours)||hours<1||hours>max){toast(`Choose between 1 and ${max} hours.`);return;}
  state.hours=hours;state.day=null;state.revision++;updateControls();save();runForecast();
}
async function runForecast(){
  forecastAbort?.abort();forecastAbort=new AbortController();const signal=forecastAbort.signal,request=++state.request;
  const snapshot={...state.place,hours:state.hours,provider:state.provider,proxyUrl};
  state.forecast=null;hide('forecastContent');hide('error');hide('notice');hide('loading',false);$('forecast').setAttribute('aria-busy','true');
  text('locationMeta',`${snapshot.lat.toFixed(4)}°N, ${snapshot.lon.toFixed(4)}°E · Loading ${duration(snapshot.hours)}…`);
  $('refresh').disabled=true;
  try{
    const result=await loadForecast(snapshot,{signal});if(signal.aborted||request!==state.request)return;
    state.forecast=result;state.forecast.fetchedAt=Date.now();const groups=groupDays(result.points,result.timezone);
    if(!state.day||!groups.some(d=>d.date===state.day))state.day=groups[0]?.date??null;
    hide('forecastContent',false);renderForecast();hide('loading');
  }catch(error){
    if(signal.aborted||request!==state.request)return;
    text('errorText',navigator.onLine===false?'You appear to be offline. Reconnect and try again. Search and forecasts need an internet connection.':error.message||'Please check your connection and try again.');
    hide('loading');hide('error',false);text('locationMeta',`${snapshot.lat.toFixed(4)}°N, ${snapshot.lon.toFixed(4)}°E · Forecast unavailable`);
  }finally{if(request===state.request){$('forecast').setAttribute('aria-busy','false');$('refresh').disabled=false;}}
}
function condition(point){
  if(point.description)return point.description;
  if(point.probability!==null&&point.probability>=60)return 'Rain looks likely';
  if(point.cloud!==null&&point.cloud>=70)return 'Mostly cloudy';
  if(point.cloud!==null&&point.cloud>=35)return 'Partly cloudy';
  if(point.cloud!==null)return point.isDay===false?'Mostly clear tonight':'Mostly clear';
  return 'Forecast temperature';
}
function renderForecast(){
  const f=state.forecast;if(!f)return;
  const first=f.points[0],summary=summarize(f.points),near=f.points.filter(p=>p.time<f.points[0].time+Math.min(24,state.hours)*HOUR),nearSummary=summarize(near);
  text('locationMeta',`${state.place.lat.toFixed(4)}°N, ${state.place.lon.toFixed(4)}°E · Next ${duration(state.hours)} · ${f.timezone}`);
  text('activeSource',f.source.name+(f.source.ensemble?' · ensemble':' · blended service'));
  text('fetchedAt',`Fetched ${formatTime(f.fetchedAt)}`);hide('googleAttribution',f.source.id!=='google');
  text('sourceDetail',f.source.detail);
  text('probabilityNote',f.source.ensemble?'Rain signal: share of available model members predicting at least 0.1 mm in an interpolated hour. This is not a calibrated probability; a day’s percentage is its peak hourly signal, not its chance of rain for the whole day.':'Rain / snow: total precipitation from Google. Percentages are Google’s hourly precipitation probabilities, not ensemble vote counts. No model uncertainty band is available.');
  $('dataCredit').href=f.source.id==='google'?'https://developers.google.com/maps/documentation/weather':'https://open-meteo.com/';text('dataCredit',f.source.id==='google'?'Weather data: Google Maps':'Weather data: Open-Meteo / Google DeepMind · CC BY 4.0');
  const notes=[configurationError,f.notice];if(f.partial)notes.push('Some requested hours or values are unavailable. Totals with missing amounts are shown as unknown.');
  text('notice',notes.filter(Boolean).join(' '));hide('notice',!notes.some(Boolean));
  $('currentTemp').replaceChildren(document.createTextNode(temp(first.temp)));const u=document.createElement('small');u.textContent=first.temp===null?'':state.unit.toUpperCase();$('currentTemp').append(u);
  text('condition',condition(first));text('currentTime',formatTime(first.time));
  document.querySelector('.current-top .eyebrow').textContent=first.time>f.fetchedAt?'NEXT AVAILABLE HOUR':'THIS HOUR’S FORECAST';
  const currentCard=document.querySelector('.current-card');currentCard.dataset.mood=first.probability!==null&&first.probability>=60?'rain':first.isDay===false?'night':first.cloud!==null&&first.cloud>=45?'cloud':'clear';
  text('currentDetail',first.low!==null&&first.high!==null?`Model range ${temp(first.low)} to ${temp(first.high)} · ${first.members} members`:first.feelsLike!==null?`Feels like ${temp(first.feelsLike,true)}`:'Temperature spread is not available.');
  const wet=near.find(p=>p.probability!==null&&p.probability>=50);
  const completeNear=near.length===Math.min(24,state.hours)&&near.every(p=>p.probability!==null);
  text('outlook',nearSummary.peak===null?'Rain outlook unavailable':!completeNear?'A partial rain outlook.':nearSummary.peak.probability<30?'A mostly dry outlook.':wet?'Keep an umbrella in mind.':'Some rain is possible.');
  text('outlookDetail',nearSummary.peak===null?'This source did not return rain probabilities for these hours.':`${wet?`The first stronger signal is around ${formatTime(wet.time,{weekday:'short'})}.`:`The peak hourly ${f.source.ensemble?'signal':'chance'} is ${percent(nearSummary.peak.probability)}.`} ${completeNear?'Check the hourly view before making plans.':'Some hours are missing, so this outlook is incomplete.'}`);
  document.querySelector('.plan-card>.eyebrow').textContent=`THE NEXT ${Math.min(24,state.hours)} HOURS`;
  document.querySelector('.window-detail .small').textContent=f.source.ensemble?'Lowest 3-hour rain signal':'Lowest 3-hour precipitation chance';
  const best=lowestRainWindow(near);
  text('windowTime',best?`${formatTime(best.start,{weekday:'short'})} – ${formatTime(best.end)}`:'Not enough complete hours');
  text('windowDetail',best?`${percent(best.signal)} average hourly ${f.source.ensemble?'signal':'chance'} · not a guarantee`:'A continuous 3-hour window is needed.');
  const total=f.points.length===state.hours?summary.total:null;
  text('rainTotalLabel',`${f.source.precipitation} · ${duration(state.hours)}`);text('rainTotal',amount(total));
  text('rainTotalDetail',total===null?'Incomplete amount data':'Forecast amount, not a guarantee');
  text('chanceLabel',f.source.ensemble?'Peak hourly rain signal':'Peak precipitation chance');text('peakChance',summary.peak?percent(summary.peak.probability):'—');text('peakTime',summary.peak?formatTime(summary.peak.time,{weekday:'short'}):'Not available');
  text('tempSpan',summary.low===null?'—':`${temp(summary.low)}–${temp(summary.high)}`);
  text('hourChanceHeading',f.source.ensemble?'Rain signal':'Precip. chance');text('hourRainHeading',f.source.precipitation);
  document.querySelector('[data-metric=rain]').textContent=f.source.ensemble?'Rain signal':'Precip. chance';
  renderDays();renderDetail();
}
function renderDays(){
  const f=state.forecast,fragment=document.createDocumentFragment(),today=dateKey(Date.now(),f.timezone);
  for(const day of groupDays(f.points,f.timezone)){
    const button=document.createElement('button');button.type='button';button.className='day';button.dataset.date=day.date;
    button.setAttribute('aria-pressed',String(day.date===state.day));
    button.setAttribute('aria-label',`${formatDay(day.hours[0].time)}. High ${temp(day.high,true)}, low ${temp(day.low,true)}. Peak hourly ${day.peak?percent(day.peak.probability):'unknown'} ${f.source.ensemble?'rain signal':'precipitation chance'}.${day.partial?' Partial day.':''}`);
    const name=document.createElement('span');name.className='day-name';name.textContent=day.date===today?'Today':formatDay(day.hours[0].time,{weekday:'long',day:undefined,month:undefined});
    const date=document.createElement('span');date.className='day-date';date.textContent=formatDay(day.hours[0].time,{weekday:undefined});
    const range=document.createElement('span');range.className='day-temp';range.append(document.createTextNode(temp(day.high)+' '));const low=document.createElement('small');low.textContent=temp(day.low);range.append(low);
    const rain=document.createElement('span');rain.className='day-rain';rain.textContent=`${day.peak?percent(day.peak.probability):'—'} peak hour`;
    const coverage=document.createElement('span');coverage.className='day-partial';coverage.textContent=day.partial?'Partial day':amount(day.total);
    button.append(name,date,range,rain,coverage);button.onclick=()=>{state.day=day.date;$('days').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));$('allHours').setAttribute('aria-pressed','false');renderDetail();};fragment.append(button);
  }
  $('days').replaceChildren(fragment);$('allHours').setAttribute('aria-pressed',String(state.day===null));
}
function detailPoints(){const f=state.forecast;return state.day?f.points.filter(p=>dateKey(p.time,f.timezone)===state.day):f.points;}
function renderDetail(){
  const points=detailPoints();text('chartDate',state.day?formatDay(points[0].time):`All ${points.length} returned hours`);
  const fragment=document.createDocumentFragment();
  for(const point of points){
    const row=document.createElement('tr'),time=document.createElement('td');time.textContent=formatTime(point.time);const sub=document.createElement('small');sub.textContent=formatDay(point.time);time.append(sub);row.append(time);
    for(const value of [temp(point.temp,true),percent(point.probability),amount(point.rain)]){const td=document.createElement('td');td.textContent=value;row.append(td);}fragment.append(row);
  }
  $('hourlyRows').replaceChildren(fragment);text('hourlyCaption',`Hourly forecast in ${state.forecast.timezone}. Rain amounts apply to the provider’s hourly interval.`);
  $('chartHour').max=Math.max(0,points.length-1);$('chartHour').value='0';renderChart(points);updateReadout();
}
function renderChart(points){
  const isTemp=state.metric==='temperature',W=Math.max(280,$('chart').clientWidth||window.innerWidth-64),H=232,pad={left:43,right:20,top:17,bottom:32};
  const yValues=points.flatMap(p=>isTemp?[convert(p.temp),convert(p.low),convert(p.high)]:[p.probability]).filter(v=>v!==null);
  let min=isTemp?Math.floor(Math.min(...yValues)-1):0,max=isTemp?Math.ceil(Math.max(...yValues)+1):100;
  if(!yValues.length){min=0;max=10;}if(max-min<4&&isTemp){min-=2;max+=2;}
  const start=points[0].time,end=points.at(-1).time,x=time=>pad.left+(points.length===1?.5:(time-start)/(end-start))*(W-pad.left-pad.right),y=value=>pad.top+(max-value)/(max-min)*(H-pad.top-pad.bottom);
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('role','img');svg.setAttribute('aria-label',`${isTemp?'Temperature':'Hourly precipitation signal'} chart. Use the slider or the hourly table for exact values. Gaps mean missing data.`);
  const add=(tag,attrs,textValue)=>{const element=document.createElementNS(svg.namespaceURI,tag);for(const [key,value]of Object.entries(attrs))element.setAttribute(key,String(value));if(textValue!==undefined)element.textContent=textValue;svg.append(element);return element;};
  for(let i=0;i<=4;i++){const v=min+(max-min)*i/4,yy=y(v);add('line',{x1:pad.left,y1:yy,x2:W-pad.right,y2:yy,stroke:'#e8edf0','stroke-width':1});add('text',{x:pad.left-9,y:yy+4,fill:'#64717e','font-size':11,'text-anchor':'end'},`${Math.round(v)}${isTemp?'°':'%'}`);}
  const segments=(get)=>{const out=[];let run=[];for(const p of points){const values=get(p);if(values.some(v=>v===null)){if(run.length)out.push(run);run=[];continue;}if(run.length&&p.time-run.at(-1).time>HOUR){out.push(run);run=[];}run.push({...p,values});}if(run.length)out.push(run);return out;};
  if(isTemp&&state.forecast.source.ensemble){for(const run of segments(p=>[convert(p.low),convert(p.high)])){if(run.length<2)continue;const path=run.map((p,i)=>`${i?'L':'M'}${x(p.time)},${y(p.values[0])}`).join(' ')+run.slice().reverse().map(p=>` L${x(p.time)},${y(p.values[1])}`).join(' ')+' Z';add('path',{d:path,fill:'#dce8df',opacity:.8});}}
  for(const run of segments(p=>[isTemp?convert(p.temp):p.probability])){
    if(run.length===1){add('circle',{cx:x(run[0].time),cy:y(run[0].values[0]),r:3,fill:isTemp?'#587e66':'#3976b5'});continue;}
    const path=run.map((p,i)=>`${i?'L':'M'}${x(p.time)},${y(p.values[0])}`).join(' ');
    if(!isTemp)add('path',{d:path+` L${x(run.at(-1).time)},${y(0)} L${x(run[0].time)},${y(0)} Z`,fill:'#e7f0f8'});
    add('path',{d:path,fill:'none',stroke:isTemp?'#537861':'#3976b5','stroke-width':2.5,'stroke-linejoin':'round'});
  }
  const indices=[...new Set(W<450?[0,points.length-1]:[0,Math.round((points.length-1)/3),Math.round((points.length-1)*2/3),points.length-1])];
  for(const i of indices)add('text',{x:x(points[i].time),y:H-8,fill:'#64717e','font-size':11,'text-anchor':i===0?'start':i===points.length-1?'end':'middle'},state.day?formatTime(points[i].time):formatTime(points[i].time,{weekday:'short'}));
  add('line',{id:'chartCursor',x1:x(points[0].time),x2:x(points[0].time),y1:pad.top,y2:H-pad.bottom,stroke:'#8a9b93','stroke-width':1,'stroke-dasharray':'3 4'});
  $('chart').replaceChildren(svg);$('chart').onpointermove=e=>{if(e.pointerType==='touch')return;const r=svg.getBoundingClientRect(),frac=Math.max(0,Math.min(1,((e.clientX-r.left)/r.width*W-pad.left)/(W-pad.left-pad.right)));const target=start+(end-start)*frac;const i=points.reduce((best,p,j)=>Math.abs(p.time-target)<Math.abs(points[best].time-target)?j:best,0);$('chartHour').value=i;updateReadout(false);};
  $('chart').onpointerleave=()=>{};
  text('chartLegend',isTemp?(state.forecast.source.ensemble?'Line: median temperature. Shading: middle 80% of available model members, not a guaranteed range.':'Line: Google’s temperature forecast. No ensemble spread is supplied.'):'The vertical scale is 0–100%. No smoothing is applied to the hourly values.');
  $('chart').dataset.start=start;$('chart').dataset.end=end;
}
function updateReadout(announce=true){
  if(!state.forecast)return;const points=detailPoints(),index=Math.max(0,Math.min(points.length-1,Number($('chartHour').value))),p=points[index];
  const message=`${formatTime(p.time,{weekday:'short'})} · ${temp(p.temp,true)} · ${percent(p.probability)} ${state.forecast.source.ensemble?'rain signal':'precipitation chance'} · ${amount(p.rain)}`;
  // Pointer movement is deliberately not a stream of screen-reader announcements.
  $('chartReadout').setAttribute('aria-live',announce?'polite':'off');text('chartReadout',message);$('chartHour').setAttribute('aria-valuetext',message);
  const width=$('chart').querySelector('svg')?.viewBox.baseVal.width||800;
  const x=43+(points.length===1?.5:(p.time-points[0].time)/(points.at(-1).time-points[0].time))*(width-63),cursor=$('chartCursor');if(cursor){cursor.setAttribute('x1',x);cursor.setAttribute('x2',x);}
}
function closeSearch(){searchItems=[];activeResult=-1;hide('searchResults');$('placeSearch').setAttribute('aria-expanded','false');$('placeSearch').removeAttribute('aria-activedescendant');}
function cancelSearch(){clearTimeout(searchTimer);searchAbort?.abort();searchVersion++;closeSearch();}
function showSearchResults(items){
  searchItems=items;activeResult=-1;const fragment=document.createDocumentFragment();
  items.forEach((place,index)=>{const b=document.createElement('div');b.className='search-result';b.id=`place-option-${index}`;b.setAttribute('role','option');b.setAttribute('aria-selected','false');b.textContent=place.name;const sub=document.createElement('span');sub.textContent=place.detail;b.append(sub);b.onpointerdown=e=>e.preventDefault();b.onclick=()=>{cancelSearch();choosePlace(place);};fragment.append(b);});
  $('searchResults').replaceChildren(fragment);hide('searchResults',!items.length);$('placeSearch').setAttribute('aria-expanded',String(items.length>0));text('searchStatus',items.length?`${items.length} places found. Use arrow keys and Enter to select.`:'No matching places. Try a city or use the map.');
}
async function searchPlaces(query){
  searchAbort?.abort();searchAbort=new AbortController();const signal=searchAbort.signal,version=++searchVersion;closeSearch();text('searchStatus','Searching…');
  try{
    let items=[];
    try{
      const url=new URL('https://photon.komoot.io/api/');url.search=new URLSearchParams({q:query,limit:'7',lang:'en',bbox:`${BOUNDS.minLon},${BOUNDS.minLat},${BOUNDS.maxLon},${BOUNDS.maxLat}`,lat:String(state.place.lat),lon:String(state.place.lon)}).toString();
      const data=await fetchJSON(url,{signal,timeoutMs:7000});
      items=(data.features||[]).map(f=>{const p=f.properties||{},[lon,lat]=f.geometry?.coordinates||[];return {lat,lon,name:p.name||p.city||p.street||'Selected place',detail:[p.district,p.city,p.state,p.country].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(', '),country:p.countrycode};}).filter(p=>insideBounds(p.lat,p.lon)&&(!p.country||p.country.toUpperCase()==='IN'));
    }catch(error){if(signal.aborted)throw error;}
    if(!items.length){
      const url=new URL('https://geocoding-api.open-meteo.com/v1/search');url.search=new URLSearchParams({name:query,count:'7',language:'en',format:'json',countryCode:'IN'}).toString();const data=await fetchJSON(url,{signal,timeoutMs:7000});
      items=(data.results||[]).filter(p=>insideBounds(p.latitude,p.longitude)&&(!p.country_code||p.country_code==='IN')).map(p=>({lat:p.latitude,lon:p.longitude,name:p.name,detail:[p.admin1,p.country].filter(Boolean).join(', ')}));
    }
    if(signal.aborted||version!==searchVersion)return;showSearchResults(items.slice(0,7));
  }catch{if(!signal.aborted&&version===searchVersion)text('searchStatus','Search is unavailable. Use your location, map, or coordinates.');}
}
$('placeSearch').addEventListener('input',()=>{cancelSearch();const q=$('placeSearch').value.trim();text('searchStatus','');if(q.length>=2)searchTimer=setTimeout(()=>searchPlaces(q),300);});
$('searchForm').onsubmit=e=>{e.preventDefault();clearTimeout(searchTimer);const q=$('placeSearch').value.trim();if(activeResult>=0&&searchItems[activeResult]){const selected=searchItems[activeResult];cancelSearch();choosePlace(selected);}else if(q.length>=2)searchPlaces(q);};
$('placeSearch').addEventListener('keydown',e=>{
  if(e.key==='Escape'){cancelSearch();text('searchStatus','');return;}
  if((e.key==='ArrowDown'||e.key==='ArrowUp')&&searchItems.length){e.preventDefault();activeResult=activeResult<0?(e.key==='ArrowDown'?0:searchItems.length-1):(activeResult+(e.key==='ArrowDown'?1:-1)+searchItems.length)%searchItems.length;document.querySelectorAll('.search-result').forEach((el,i)=>el.setAttribute('aria-selected',String(i===activeResult)));const active=$(`place-option-${activeResult}`);$('placeSearch').setAttribute('aria-activedescendant',active.id);active.scrollIntoView({block:'nearest'});}
});
document.addEventListener('click',e=>{if(!e.target.closest('#searchForm')){cancelSearch();text('searchStatus','');}});
$('locateMe').onclick=()=>{
  if(!navigator.geolocation){toast('Location is unavailable. Search for a place instead.');return;}
  const request=++locationVersion,revision=state.revision;$('locateMe').disabled=true;$('locateMe').textContent='Finding your location…';
  navigator.geolocation.getCurrentPosition(pos=>{
    $('locateMe').disabled=false;$('locateMe').textContent='Use my location';if(request!==locationVersion||revision!==state.revision)return;
    if(!insideBounds(pos.coords.latitude,pos.coords.longitude)){toast('Your position is outside the supported India region. Search for a place instead.');return;}
    choosePlace({lat:pos.coords.latitude,lon:pos.coords.longitude,name:'Your location'});
  },error=>{$('locateMe').disabled=false;$('locateMe').textContent='Use my location';if(request!==locationVersion)return;toast(error.code===1?'Location permission was denied. Search for a place or enable location in your browser settings.':error.code===3?'Location timed out. Try again or search for a place.':'Could not find your location. Search or use the map.');},{enableHighAccuracy:false,timeout:15000,maximumAge:300000});
};
$('coordinateForm').onsubmit=e=>{e.preventDefault();const lat=coordinate($('latitude').value),lon=coordinate($('longitude').value);if(!insideBounds(lat,lon)){toast('Enter valid coordinates: 6.2–37.7°N, 68–97.6°E.');return;}choosePlace({lat,lon,name:'Selected location'});};
$('mapDetails').addEventListener('toggle',()=>{if(!$('mapDetails').open)return;if(!mapPicker)mapPicker=createMap($('map'),state.place,p=>choosePlace({...p,name:'Pinned location'}),toast);else mapPicker.render();});
$('provider').onchange=()=>{state.provider=$('provider').value;if(state.provider==='google'&&state.hours>240)state.hours=240;state.revision++;state.day=null;updateControls();save();runForecast();};
const googleOption=$('provider').querySelector('[value=google]');googleOption.disabled=!proxyUrl;googleOption.textContent=proxyUrl?'Google Weather · up to 10 days':'Google Weather · not connected';
text('connectionStatus',proxyUrl?'Google proxy configured. Automatic uses Google first, with a clearly labelled free fallback.':'No Google proxy is configured. Forecasts use the free WeatherNext 2 ensemble.');
$('refresh').onclick=$('retry').onclick=()=>runForecast();$('useFree').onclick=()=>{state.provider='openmeteo';updateControls();save();runForecast();};
document.querySelectorAll('[data-hours]').forEach(b=>b.onclick=()=>setHours(Number(b.dataset.hours)));
$('rangeForm').onsubmit=e=>{e.preventDefault();setHours(Number($('customHours').value));document.querySelector('.custom-range').open=false;};
document.querySelectorAll('[data-unit]').forEach(b=>b.onclick=()=>{state.unit=b.dataset.unit;updateControls();save();if(state.forecast)renderForecast();});
document.querySelectorAll('[data-metric]').forEach(b=>b.onclick=()=>{state.metric=b.dataset.metric;document.querySelectorAll('[data-metric]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));if(state.forecast){renderChart(detailPoints());updateReadout();}});
$('allHours').onclick=()=>{state.day=null;renderDays();renderDetail();};$('chartHour').oninput=()=>updateReadout();
$('savePlace').onclick=()=>{const i=state.favorites.findIndex(p=>samePlace(p,state.place));if(i>=0)state.favorites.splice(i,1);else{if(state.favorites.length>=5){toast('Five places are saved. Open a saved place and press “Saved · remove” to make room.');return;}state.favorites.push({...state.place});}save();updateControls();};
$('sharePlace').onclick=async()=>{
  const url=new URL(location.href);url.hash=new URLSearchParams({lat:state.place.lat.toFixed(5),lon:state.place.lon.toFixed(5),name:state.place.name,hours:String(state.hours)}).toString();
  try{await navigator.clipboard.writeText(url.toString());toast('Link copied. It includes this pin’s coordinates.');}catch{location.hash=url.hash;toast('The link is in your address bar. Copy it to share this pin.');}
};
$('clearSaved').onclick=()=>{for(const key of ['rainscope-v2','rainscope-pin','rainscope-place','rainscope-zoom','rainscope-unit','rainscope-n']){try{localStorage.removeItem(key);}catch{}}state.favorites=[];state.unit='c';state.hours=24;state.provider='auto';state.place={...DEFAULT_PLACE};state.day=null;state.revision++;locationVersion++;mapPicker?.setPin(state.place);history.replaceState(null,'',location.pathname+location.search);updateControls();toast('Saved places and preferences cleared.');runForecast();};
window.addEventListener('hashchange',()=>{restoreLink();state.revision++;state.day=null;mapPicker?.setPin(state.place);updateControls();save();runForecast();});
window.addEventListener('online',()=>toast('You’re back online. Press Refresh for a new forecast.'));
updateControls();runForecast();

let chartWidth=0;
if('ResizeObserver' in window)new ResizeObserver(entries=>{const width=entries[0].contentRect.width;if(width>0&&width!==chartWidth){chartWidth=width;if(state.forecast){renderChart(detailPoints());updateReadout(false);}}}).observe($('chart'));
