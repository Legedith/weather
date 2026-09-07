    // Included inside the original map/search/horizon closure by the build.
    // Keep the original DOM and theme; use the tested provider adapters underneath.
    const $ = id => document.getElementById(id);
    const put = (id, value) => { $(id).textContent = value; };
    let view = null, forecastAbort = null, forecastVersion = 0, selectionVersion = 0;
    let searchVersion = 0, searchOptions = [], activeOption = -1, chartIndex = 0;
    let proxyUrl = '', configurationNotice = '';
    try { proxyUrl = validatedProxyUrl(config.googleWeatherProxyUrl); }
    catch { configurationNotice = 'Google proxy configuration is invalid. Using the free ensemble.'; }
    const degree = (v, unit = true) => v === null ? '—' : `${Math.round(v)}°${unit ? 'C' : ''}`;
    const percentage = v => v === null ? '—' : `${Math.round(v)}%`;
    const rainAmount = v => v === null ? '—' : `${v < 10 ? v.toFixed(1) : Math.round(v)} mm`;
    const timeLabel = (time, date = false) => new Intl.DateTimeFormat('en-IN', {timeZone:view?.timezone || 'Asia/Kolkata',hour:'numeric',minute:'2-digit',...(date ? {weekday:'short',day:'numeric',month:'short'} : {})}).format(new Date(time));
    const dayLabel = time => new Intl.DateTimeFormat('en-IN', {timeZone:view?.timezone || 'Asia/Kolkata',weekday:'short',day:'numeric',month:'short'}).format(new Date(time));

    function setLoading(on) {
      forecastBtn.disabled = on;
      forecastBtn.classList.toggle('loading', on);
      forecastBtn.querySelector('.btn-text').textContent = on ? 'Loading forecast…' : 'Show forecast';
      loadingOverlay.classList.toggle('visible', on);
      $('forecastPanel').setAttribute('aria-busy', String(on));
    }
    function invalidateForecast() {
      forecastAbort?.abort(); forecastVersion++; selectionVersion++;
      latestPoints = []; latestChartLayout = null; view = null;
      forecastContent.classList.remove('visible'); emptyState.style.display = '';
      chartTooltip.style.display = 'none'; setLoading(false);
    }
    const originalSetPin = setPin;
    setPin = function(lat, lon, options = {}) {
      if (insideIndia(lat, lon)) { invalidateForecast(); stopSearch(); }
      return originalSetPin(lat, lon, options);
    };
    const originalSetUnit = setUnit;
    setUnit = function(next) {
      invalidateForecast(); originalSetUnit(next);
      hoursBtn.setAttribute('aria-pressed', String(unit === 'hours'));
      daysBtn.setAttribute('aria-pressed', String(unit === 'days'));
    };
    [latInput, lonInput, horizonN].forEach(el => el.addEventListener('input', invalidateForecast));

    async function runForecast() {
      clearError();
      const lat = Number(latInput.value), lon = Number(lonInput.value);
      if (!insideIndia(lat, lon)) { showError('Choose valid India-region coordinates first.'); return; }
      invalidateForecast();
      const n = sanitizeHorizon(), hours = unit === 'hours' ? n : n * 24;
      const selected = {lat, lon, hours, name:selectedPlaceName || 'Selected location'};
      pin = {lat, lon}; saveState();
      const version = ++forecastVersion, abort = new AbortController(); forecastAbort = abort;
      setLoading(true);
      try {
        const result = await loadForecast({lat,lon,hours,provider:'auto',proxyUrl}, {signal:abort.signal});
        if (abort.signal.aborted || version !== forecastVersion) return;
        view = {...result, fetchedAt:Date.now(), selected}; latestPoints = result.points;
        emptyState.style.display = 'none'; forecastContent.classList.add('visible');
        renderForecast();
      } catch (error) {
        if (!abort.signal.aborted && version === forecastVersion) showError(`Could not load the forecast. ${navigator.onLine === false ? 'You appear to be offline. Reconnect and try again.' : error.message || 'Check your connection and retry.'}`);
      } finally { if (version === forecastVersion) setLoading(false); }
    }
    forecastBtn.onclick = runForecast;

    function renderForecast() {
      const {points,source,selected} = view, first = points[0], summary = summarize(points);
      const continuous = points.every((p,i) => i === 0 || p.time - points[i-1].time === HOUR);
      const complete = points.length === selected.hours && continuous;
      const total = complete ? summary.total : null, peak = summary.peak;
      put('forecastTitle', selected.name);
      put('forecastSub', `${selected.lat.toFixed(4)}°N, ${selected.lon.toFixed(4)}°E · Next ${selected.hours} hours`);
      document.querySelector('.forecast-top .eyebrow').textContent = `${source.name} forecast`;
      put('updatedAt', `Fetched ${timeLabel(view.fetchedAt)}`);
      $('updatedAt').title = 'Time retrieved, not model initialization time.';
      put('timezoneText', view.timezone);
      const notes = [configurationNotice, view.notice];
      if (view.partial || !continuous) notes.push('Some hours or values are missing. Unknown values are —, not zero; full-range totals require complete data.');
      put('sourceNotice', notes.filter(Boolean).join(' ')); $('sourceNotice').hidden = !notes.some(Boolean);
      let outlook = 'Rain data incomplete', detail = 'Missing hours prevent a complete rain outlook.';
      if (total !== null && points.every(p=>p.probability !== null) && peak) {
        if (total < .5 && peak.probability < 30) { outlook = 'Mostly dry'; detail = `Peak hourly ${source.ensemble ? 'signal' : 'chance'} ${percentage(peak.probability)} · ${rainAmount(total)} expected`; }
        else { outlook = total >= 25 || peak.probability >= 80 ? 'Rain looks likely' : 'Rain is possible'; detail = `Strongest hourly ${source.ensemble ? 'signal' : 'chance'} ${timeLabel(peak.time,true)} · ${percentage(peak.probability)}`; }
      }
      put('rainOutlook', outlook); put('rainMeta', detail);
      put('nextTemp', degree(first.temp));
      put('tempMeta', first.low !== null && first.high !== null ? `Model range ${degree(first.low,false)}–${degree(first.high)} · not a guarantee` : first.feelsLike !== null ? `Feels like ${degree(first.feelsLike)}` : 'Forecast, not a live observation');
      put('totalRain', rainAmount(total));
      put('totalRainMeta', total === null ? 'Incomplete amount data' : source.ensemble ? 'Ensemble mean over the selected hours' : 'Total precipitation · rain / snow');
      put('tempRange', summary.low === null ? '—' : `${degree(summary.low,false)}–${degree(summary.high,false)}`);
      const spread = average(points.map(p => p.low !== null && p.high !== null ? p.high-p.low : null));
      put('rangeMeta', spread === null ? 'No ensemble uncertainty band supplied' : `Typical model spread ±${(spread/2).toFixed(1)}°C`);
      document.querySelector('.hero:nth-child(2) .label').textContent = first.time > view.fetchedAt ? 'Next forecast hour' : 'This hour’s forecast';
      document.querySelector('.hero:nth-child(3) .label').textContent = source.ensemble ? 'Expected rain' : 'Rain / snow';
      const pill = document.querySelector('.model-pill'), pulse = document.createElement('span'); pulse.className = 'pulse';
      const members = Math.max(...points.map(p=>p.members));
      pill.replaceChildren(pulse, document.createTextNode(source.ensemble ? `${members} temperature members returned · ${source.name}` : 'Google Weather API · blended forecast'));
      document.querySelector('.brand p').textContent = `Future rain & temperature, powered by ${source.name}${source.ensemble ? ' via Open-Meteo' : ''}`;
      document.querySelector('.legend span:nth-child(2)').hidden = !points.some(p=>p.low !== null && p.high !== null);
      document.querySelector('.legend span:last-child').innerHTML = `<i class="dot rain"></i>${source.ensemble ? 'Rain signal' : 'Precip. chance'}`;
      document.querySelector('.timeline-head div:nth-child(3)').textContent = source.ensemble ? 'Rain signal' : 'Precip. chance';
      document.querySelector('.timeline-head div:nth-child(4)').textContent = source.precipitation;
      document.querySelector('.chart-foot span:first-child').textContent = `Blue: hourly ${source.ensemble ? 'rain signal' : 'precipitation chance'}, right axis · missing values leave gaps · arrow keys explore hours`;
      const footer = forecastContent.querySelector('footer');
      footer.firstElementChild.textContent = source.detail + ' ' + (source.ensemble ? 'Rain signal = share of available members with ≥ 0.1 mm for the hour, not a calibrated probability. A daily percentage is its peak hour, not its chance of any rain that day.' : 'Percentages are Google’s hourly precipitation probabilities. No raw model version or ensemble members are supplied.');
      footer.lastElementChild.innerHTML = source.ensemble ? 'Forecast: <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a> / Google DeepMind · CC BY 4.0 · Map: OpenStreetMap contributors' : '<span class="google-attribution" translate="no">Google Maps</span> · Weather forecast data · Map picker: OpenStreetMap contributors';
      applyWeatherTheme(points); renderDays(points);
      requestAnimationFrame(()=> { if(view) drawChart(latestPoints); });
    }
    function applyWeatherTheme(points) {
      const sample = points.filter(p=>p.time < points[0].time+24*HOUR);
      const temp = average(sample.map(p=>p.temp)), cloud = average(sample.map(p=>p.cloud));
      const rain = average(sample.map(p=>p.probability));
      const peak = Math.max(...sample.map(p=>p.probability).filter(v=>v!==null));
      const wetShare = sample.filter(p=>(p.probability!==null && p.probability>=45) || (p.rain!==null && p.rain>=.2)).length/sample.length;
      const dayValues = sample.slice(0,4).filter(p=>p.isDay!==null);
      const dayShare = dayValues.length ? dayValues.filter(p=>p.isDay).length/dayValues.length : null;
      const theme = peak>=60 || (rain!==null && rain>=32 && wetShare>=.25) ? 'rainy' : temp!==null && temp<=19 ? 'chilly' : dayShare!==null && dayShare<.38 ? 'night' : cloud!==null && cloud>=68 ? 'cloudy' : 'sunny';
      document.body.dataset.weatherTheme=theme;
      weatherMood.textContent=`AUTO THEME · ${theme.toUpperCase()}`;
      themeMeta?.setAttribute('content', {sunny:'#ff7a00',cloudy:'#6075a8',rainy:'#3155ff',night:'#5147c8',chilly:'#277fa8'}[theme]);
    }
    function renderDays(points) {
      const days = groupDays(points,view.timezone), grid = $('daysGrid'); grid.replaceChildren();
      const heading = grid.previousElementSibling.querySelector('p'); heading.textContent = 'Select a day · percentage is the peak hour';
      grid.dataset.selectedDate = days[0].date;
      days.forEach((day,index)=> {
        const dayName = new Intl.DateTimeFormat('en-IN',{timeZone:view.timezone,weekday:'short'}).format(new Date(day.hours[0].time));
        const dateName = new Intl.DateTimeFormat('en-IN',{timeZone:view.timezone,day:'numeric',month:'short'}).format(new Date(day.hours[0].time));
        const chance = day.peak?.probability ?? null;
        const button = document.createElement('button'); button.type='button'; button.className='day-card'+(index===0?' selected':''); button.dataset.date=day.date;
        button.setAttribute('aria-pressed',String(index===0));
        button.setAttribute('aria-label',`${dayName} ${dateName}. High ${degree(day.high)}, low ${degree(day.low)}. Peak hourly ${percentage(chance)}.${day.partial?' Partial day.':''}`);
        button.innerHTML=`<div class="day-head"><div><div class="day-name">${dayName}</div><div class="day-date">${dateName}${day.partial?' · partial':''}</div></div><div class="rain-badge">${percentage(chance)} peak</div></div><div class="day-temp">${degree(day.high,false)} <small>/ ${degree(day.low)}</small></div><div class="day-rain">${rainAmount(day.total)} expected</div><div class="rain-track"><span style="width:${chance===null?0:clamp(chance,0,100)}%"></span></div>`;
        button.onclick=()=> {
          grid.dataset.selectedDate=day.date;
          grid.querySelectorAll('.day-card').forEach(b=>{b.classList.toggle('selected',b===button);b.setAttribute('aria-pressed',String(b===button));});
          renderTimeline(day.hours);
        };
        grid.append(button);
      });
      renderTimeline(days[0].hours);
    }
    function renderTimeline(points) {
      const body=$('timelineBody'), fragment=document.createDocumentFragment();
      body.closest('.timeline-card').previousElementSibling.querySelector('p').textContent=dayLabel(points[0].time);
      points.forEach(p=>{
        const row=document.createElement('div');row.className='timeline-row';row.setAttribute('role','row');
        row.innerHTML=`<div role="cell"><div class="time-main">${timeLabel(p.time)}</div><div class="time-sub">${dayLabel(p.time)}</div></div><div role="cell" class="temp-cell">${degree(p.temp)}</div><div role="cell" class="rain-cell"><span class="rain-symbol" aria-hidden="true" style="opacity:${p.probability===null?.25:.25+.75*p.probability/100}"></span>${percentage(p.probability)}</div><div role="cell" class="amount-cell">${rainAmount(p.rain)}</div>`;
        fragment.append(row);
      });
      body.replaceChildren(fragment);body.scrollTop=0;
    }

    // Same orange temperature line, blue rain area and uncertainty band as before.
    // Separate scales and gaps preserve the meaning of the returned values.
    function drawChart(points) {
      if(!points.length)return;
      const rect=canvas.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2),W=rect.width,H=rect.height;
      if(!W||!H)return;
      canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);
      const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);
      const pad={l:38,r:38,t:22,b:30},plotW=W-pad.l-pad.r,plotH=H-pad.t-pad.b;
      const values=points.flatMap(p=>[p.temp,p.low,p.high]).filter(v=>v!==null);
      let min=values.length?Math.min(...values):0,max=values.length?Math.max(...values):10;
      if(max-min<5){min-=2;max+=2;}min=Math.floor(min-1);max=Math.ceil(max+1);
      const start=points[0].time,end=points.at(-1).time;
      const x=i=>pad.l+(end===start?.5:(points[i].time-start)/(end-start))*plotW;
      const yT=v=>pad.t+(max-v)/(max-min)*plotH,yR=v=>pad.t+(100-v)/100*plotH;
      ctx.lineWidth=1;ctx.strokeStyle='rgba(21,21,27,.18)';ctx.fillStyle='#494756';ctx.font='bold 10px Courier New,monospace';
      for(let j=0;j<=4;j++){
        const y=pad.t+j*plotH/4;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(W-pad.r,y);ctx.stroke();
        ctx.textAlign='left';ctx.fillText(`${Math.round(max-j*(max-min)/4)}°`,4,y+3);
        ctx.textAlign='right';ctx.fillStyle='#153ccf';ctx.fillText(`${100-j*25}%`,W-2,y+3);ctx.fillStyle='#494756';
      }
      function runs(fields){
        const result=[];let segment=[];
        points.forEach((p,i)=>{if(fields.some(f=>p[f]===null)){if(segment.length)result.push(segment);segment=[];return;}if(segment.length&&p.time-points[segment.at(-1)].time!==HOUR){result.push(segment);segment=[];}segment.push(i);});
        if(segment.length)result.push(segment);return result;
      }
      for(const segment of runs(['probability'])){
        ctx.beginPath();ctx.moveTo(x(segment[0]),yR(0));segment.forEach(i=>ctx.lineTo(x(i),yR(points[i].probability)));ctx.lineTo(x(segment.at(-1)),yR(0));ctx.closePath();
        const gradient=ctx.createLinearGradient(0,pad.t,0,pad.t+plotH);gradient.addColorStop(0,'rgba(49,85,255,.52)');gradient.addColorStop(.55,'rgba(49,85,255,.25)');gradient.addColorStop(1,'rgba(24,217,230,.10)');ctx.fillStyle=gradient;ctx.fill();
        ctx.beginPath();segment.forEach((i,j)=>j?ctx.lineTo(x(i),yR(points[i].probability)):ctx.moveTo(x(i),yR(points[i].probability)));ctx.strokeStyle='rgba(49,85,255,.95)';ctx.lineWidth=2;ctx.stroke();
        if(segment.length===1){ctx.beginPath();ctx.arc(x(segment[0]),yR(points[segment[0]].probability),2.5,0,Math.PI*2);ctx.fillStyle='#3155ff';ctx.fill();}
      }
      for(const segment of runs(['low','high'])){
        if(segment.length<2)continue;ctx.beginPath();segment.forEach((i,j)=>j?ctx.lineTo(x(i),yT(points[i].high)):ctx.moveTo(x(i),yT(points[i].high)));segment.slice().reverse().forEach(i=>ctx.lineTo(x(i),yT(points[i].low)));ctx.closePath();ctx.fillStyle='rgba(255,176,0,.18)';ctx.fill();
      }
      for(const segment of runs(['temp'])){
        ctx.beginPath();segment.forEach((i,j)=>j?ctx.lineTo(x(i),yT(points[i].temp)):ctx.moveTo(x(i),yT(points[i].temp)));ctx.strokeStyle='#cc7200';ctx.lineWidth=2.6;ctx.lineJoin='miter';ctx.lineCap='square';ctx.stroke();
        if(points.length<=72||segment.length===1)segment.forEach(i=>{ctx.beginPath();ctx.arc(x(i),yT(points[i].temp),2.1,0,Math.PI*2);ctx.fillStyle='#ffb000';ctx.fill();});
      }
      const peaks=points.map((p,i)=>({i,value:p.probability})).filter(p=>p.value!==null&&p.value>=12).sort((a,b)=>b.value-a.value),labelled=[];
      for(const p of peaks){
        if(labelled.length >= (W<520?3:5))break;if(labelled.some(i=>Math.abs(x(i)-x(p.i))<70))continue;labelled.push(p.i);
        const label=percentage(p.value);ctx.font='bold 9px Courier New,monospace';const width=ctx.measureText(label).width+8,xx=clamp(x(p.i)-width/2,pad.l,W-pad.r-width),yy=clamp(yR(p.value)-23,pad.t+2,pad.t+plotH-18);
        ctx.fillStyle='rgba(255,253,247,.94)';ctx.fillRect(xx,yy,width,16);ctx.strokeStyle='#3155ff';ctx.lineWidth=1.5;ctx.strokeRect(xx,yy,width,16);ctx.fillStyle='#1532c6';ctx.textAlign='center';ctx.fillText(label,xx+width/2,yy+11);
      }
      const labels=Math.min(W<450?3:5,points.length);ctx.fillStyle='#494756';ctx.font='bold 9.5px Courier New,monospace';
      for(let j=0;j<labels;j++){const i=Math.round(j*(points.length-1)/Math.max(1,labels-1));ctx.textAlign=j===0?'left':j===labels-1?'right':'center';ctx.fillText(points.length>72?dayLabel(points[i].time):timeLabel(points[i].time),x(i),H-8);}
      latestChartLayout={points,x,yT,pad,plotW,plotH,W,H};
    }
    function showChartPoint(index,mx,my,announce=false){
      if(!view||!latestChartLayout)return;
      chartIndex=clamp(index,0,latestPoints.length-1);const p=latestPoints[chartIndex];
      const range=p.low===null||p.high===null?'—':`${degree(p.low,false)}–${degree(p.high)}`;
      const label=view.source.ensemble?'Rain signal':'Precipitation chance';
      chartTooltip.innerHTML=`<strong>${timeLabel(p.time,true)}</strong><div class="trow"><span>Temperature</span><span>${degree(p.temp)}</span></div><div class="trow"><span>Model range</span><span>${range}</span></div><div class="trow"><span>${label}</span><span>${percentage(p.probability)}</span></div><div class="trow"><span>${view.source.precipitation}</span><span>${rainAmount(p.rain)}</span></div>`;
      chartTooltip.style.display='block';const rect=chartWrap.getBoundingClientRect();
      chartTooltip.style.left=clamp(mx+12,4,Math.max(4,rect.width-chartTooltip.offsetWidth-4))+'px';chartTooltip.style.top=clamp(my-chartTooltip.offsetHeight-12,4,Math.max(4,rect.height-chartTooltip.offsetHeight-4))+'px';
      if(announce)put('chartA11y',`${timeLabel(p.time,true)}. ${degree(p.temp)}. ${label} ${percentage(p.probability)}. ${rainAmount(p.rain)}.`);
    }
    function pointFromPointer(e){
      if(!latestChartLayout)return;const r=chartWrap.getBoundingClientRect(),mx=e.clientX-r.left,{pad,plotW}=latestChartLayout;
      if(mx<pad.l||mx>pad.l+plotW){chartTooltip.style.display='none';return;}
      const time=latestPoints[0].time+clamp((mx-pad.l)/plotW,0,1)*(latestPoints.at(-1).time-latestPoints[0].time);
      const index=latestPoints.reduce((best,p,i)=>Math.abs(p.time-time)<Math.abs(latestPoints[best].time-time)?i:best,0);showChartPoint(index,mx,e.clientY-r.top);
    }
    chartWrap.addEventListener('mousemove',pointFromPointer);
    chartWrap.addEventListener('pointerdown',pointFromPointer);
    chartWrap.addEventListener('mouseleave',()=>{chartTooltip.style.display='none';});
    canvas.addEventListener('keydown',e=>{if(!latestChartLayout||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const index=e.key==='Home'?0:e.key==='End'?latestPoints.length-1:chartIndex+(e.key==='ArrowRight'?1:-1);showChartPoint(index,latestChartLayout.x(clamp(index,0,latestPoints.length-1)),latestChartLayout.H/2,true);});
    window.addEventListener('resize',()=>{if(latestPoints.length)requestAnimationFrame(()=>drawChart(latestPoints));});

    // Keep the original search appearance; fix cancellation and keyboard selection.
    function stopSearch(){clearTimeout(searchTimer);searchAbort?.abort();searchVersion++;searchOptions=[];activeOption=-1;searchResults.classList.remove('open');placeSearch.setAttribute('aria-expanded','false');placeSearch.removeAttribute('aria-activedescendant');}
    renderSearchResults = function(results){
      searchOptions=results;activeOption=-1;searchResults.replaceChildren();
      if(!results.length){const message=document.createElement('div');message.textContent='No matching area found. Try a city, the map, or coordinates.';message.style.padding='11px';searchResults.append(message);}
      results.forEach((result,i)=>{
        const b=document.createElement('button');b.type='button';b.className='search-result';b.id=`search-option-${i}`;b.tabIndex=-1;b.setAttribute('role','option');b.setAttribute('aria-selected','false');
        b.innerHTML=`<strong>${escapeHTML(result.name)}</strong><span>${escapeHTML(result.admin||'India')}</span><em class="result-type">${escapeHTML(result.type||'place')}</em>`;
        b.onpointerdown=e=>e.preventDefault();b.onclick=()=>{selectedPlaceName=result.name+(result.admin?`, ${result.admin.split(',')[0]}`:'');setPin(result.latitude,result.longitude,{keepName:true});zoom=Math.max(14,Math.min(MAX_ZOOM,zoom));renderMap();saveState();placeSearch.value=result.name;clearSearch.classList.add('visible');showToast(`Pinned ${result.name}`);};
        searchResults.append(b);
      });
      searchResults.classList.add('open');placeSearch.setAttribute('aria-expanded',String(results.length>0));
    };
    searchPlaces = async function(q){
      searchAbort?.abort();const abort=new AbortController();searchAbort=abort;const version=++searchVersion;
      try{let results=[];try{results=await photonSearch(q,abort.signal);}catch(error){if(abort.signal.aborted)throw error;}if(!results.length)results=await openMeteoSearch(q,abort.signal);if(!abort.signal.aborted&&version===searchVersion)renderSearchResults(results);}
      catch{if(!abort.signal.aborted&&version===searchVersion){searchResults.textContent='Search is unavailable. Use the map or coordinates.';searchResults.classList.add('open');}}
    };
    placeSearch.addEventListener('input',stopSearch,true);
    clearSearch.addEventListener('click',stopSearch,true);
    document.addEventListener('click',e=>{if(!e.target.closest('.searchbox'))stopSearch();});
    placeSearch.addEventListener('keydown',e=>{
      if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();stopSearch();return;}
      if(['ArrowDown','ArrowUp'].includes(e.key)&&searchOptions.length){e.preventDefault();e.stopImmediatePropagation();activeOption=activeOption<0?(e.key==='ArrowDown'?0:searchOptions.length-1):(activeOption+(e.key==='ArrowDown'?1:-1)+searchOptions.length)%searchOptions.length;searchResults.querySelectorAll('[role=option]').forEach((b,i)=>b.setAttribute('aria-selected',String(i===activeOption)));const active=$(`search-option-${activeOption}`);placeSearch.setAttribute('aria-activedescendant',active.id);active.scrollIntoView({block:'nearest'});}
      else if(e.key==='Enter'&&activeOption>=0){e.preventDefault();e.stopImmediatePropagation();$(`search-option-${activeOption}`).click();}
    },true);
    locateCurrentPosition = function(){
      clearError();if(!navigator.geolocation){showError('GPS is unavailable. Search or use the map.');return;}
      const revision=selectionVersion;setLocatingState(true);
      navigator.geolocation.getCurrentPosition(pos=>{setLocatingState(false);if(revision!==selectionVersion)return;if(!insideIndia(pos.coords.latitude,pos.coords.longitude)){showError('Your position is outside the supported India region. Search or use the map.');return;}selectedPlaceName='Current location';setPin(pos.coords.latitude,pos.coords.longitude,{keepName:true});zoom=Math.max(15,zoom);renderMap();saveState();placeSearch.value='Current location';showToast('Found your location');},error=>{setLocatingState(false);if(revision===selectionVersion)showError(geolocationMessage(error));},{enableHighAccuracy:false,timeout:15000,maximumAge:300000});
    };
    map.addEventListener('keydown',e=>{
      if(e.target!==map)return;const direction={ArrowLeft:[-80,0],ArrowRight:[80,0],ArrowUp:[0,-80],ArrowDown:[0,80]}[e.key];
      if(direction){e.preventDefault();const p=project(mapCenter.lat,mapCenter.lon,zoom);mapCenter=clampCenter(unproject(p.x+direction[0],p.y+direction[1],zoom));renderMap();}
      else if(['+','=','-'].includes(e.key)){e.preventDefault();zoomAtCenter(e.key==='-'?-1:1);}
      else if(e.key==='Enter'){e.preventDefault();setPin(mapCenter.lat,mapCenter.lon);}
    });
    const table=document.querySelector('.timeline-card');table.setAttribute('role','table');table.setAttribute('aria-label','Hourly forecast in the selected location’s timezone');
    document.querySelector('.timeline-head').setAttribute('role','row');document.querySelectorAll('.timeline-head>div').forEach(el=>el.setAttribute('role','columnheader'));$('timelineBody').setAttribute('role','rowgroup');

    // Migrate the selected place once; leave saved favourites intact in storage.
    if(!storageGet('rainscope-retro-restored')){
      const previous=loadJSON('rainscope-v2',{});
      if(insideIndia(previous?.place?.lat,previous?.place?.lon)){pin={lat:previous.place.lat,lon:previous.place.lon};mapCenter={...pin};selectedPlaceName=String(previous.place.name||'Selected location').slice(0,120);const hours=Number(previous.hours);if(Number.isInteger(hours)&&hours>=1&&hours<=360){unit=hours<=24?'hours':'days';horizonN.value=hours<=24?hours:Math.ceil(hours/24);}}
      storageSet('rainscope-retro-restored','1');
    }
    function restoreSharedPin(){const p=new URLSearchParams(location.hash.slice(1)),lat=Number(p.get('lat')),lon=Number(p.get('lon'));if(!insideIndia(lat,lon))return;selectedPlaceName=(p.get('name')||'Shared place').slice(0,120);setPin(lat,lon,{keepName:true});const hours=Number(p.get('hours'));if(Number.isInteger(hours)&&hours>=1&&hours<=360){setUnit(hours<=24?'hours':'days');horizonN.value=hours<=24?hours:Math.ceil(hours/24);sanitizeHorizon();}}
    restoreSharedPin();window.addEventListener('hashchange',restoreSharedPin);
    latInput.value=pin.lat.toFixed(4);lonInput.value=pin.lon.toFixed(4);setUnit(unit);renderMap();
    $('emptyState').querySelector('.arrow').textContent='Tap the map or search for a place';
    setTimeout(renderMap,80);
