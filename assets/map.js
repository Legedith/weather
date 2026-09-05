import { BOUNDS, insideBounds } from './forecast.js';
const TILE=256;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const project=(lat,lon,z)=>{const scale=TILE*2**z,s=Math.sin(lat*Math.PI/180);return {x:(lon+180)/360*scale,y:(.5-Math.log((1+s)/(1-s))/(4*Math.PI))*scale};};
const unproject=(x,y,z)=>{const scale=TILE*2**z;return {lon:x/scale*360-180,lat:180/Math.PI*Math.atan(Math.sinh(Math.PI-2*Math.PI*y/scale))};};
/** Small, lazily created location picker. No third-party JavaScript dependency. */
export function createMap(element, initial, onSelect, onError) {
  const tiles=element.querySelector('#tiles'),marker=element.querySelector('#marker'),fallback=element.querySelector('#mapFallback');
  let center={...initial},pin={...initial},zoom=8,drag=null,pinch=null,generation=0;
  const pointers=new Map();
  const bounds=c=>({lat:clamp(c.lat,BOUNDS.minLat,BOUNDS.maxLat),lon:clamp(c.lon,BOUNDS.minLon,BOUNDS.maxLon)});
  const topLeft=()=>{const p=project(center.lat,center.lon,zoom);return {x:p.x-element.clientWidth/2,y:p.y-element.clientHeight/2};};
  const at=(x,y)=>{const rect=element.getBoundingClientRect(),tl=topLeft();return unproject(tl.x+x-rect.left,tl.y+y-rect.top,zoom);};
  function render() {
    const w=element.clientWidth,h=element.clientHeight;if(!w||!h)return;
    center=bounds(center);const tl=topLeft(),n=2**zoom,gen=++generation;
    const fragment=document.createDocumentFragment();let loaded=0,failed=0;
    for(let y=Math.max(0,Math.floor(tl.y/TILE));y<=Math.min(n-1,Math.floor((tl.y+h)/TILE));y++)for(let x=Math.floor(tl.x/TILE);x<=Math.floor((tl.x+w)/TILE);x++){
      const img=new Image();img.className='tile';img.alt='';img.decoding='async';img.draggable=false;
      img.style.left=`${x*TILE-tl.x}px`;img.style.top=`${y*TILE-tl.y}px`;
      img.onload=()=>{if(gen===generation){loaded++;fallback.hidden=true;}};
      img.onerror=()=>{if(gen===generation&&++failed>=3&&!loaded)fallback.hidden=false;};
      img.src=`https://tile.openstreetmap.org/${zoom}/${((x%n)+n)%n}/${y}.png`;fragment.append(img);
    }
    tiles.replaceChildren(fragment);const p=project(pin.lat,pin.lon,zoom);marker.style.left=`${p.x-tl.x}px`;marker.style.top=`${p.y-tl.y}px`;
  }
  function select(p) {
    if(!insideBounds(p.lat,p.lon)){onError('Choose a point within the India region.');return;}
    pin=p;render();onSelect({...p});
  }
  function zoomAt(z,x,y) {
    z=clamp(Math.round(z),4,18);if(z===zoom)return;
    const rect=element.getBoundingClientRect(),anchor=at(x,y),p=project(anchor.lat,anchor.lon,z);
    zoom=z;center=bounds(unproject(p.x-(x-rect.left-element.clientWidth/2),p.y-(y-rect.top-element.clientHeight/2),zoom));render();
  }
  function zoomBy(delta){const r=element.getBoundingClientRect();zoomAt(zoom+delta,r.left+r.width/2,r.top+r.height/2);}
  const isUi=e=>e.target.closest('button,a,.map-attribution');
  element.querySelector('#zoomIn').onclick=()=>zoomBy(1);element.querySelector('#zoomOut').onclick=()=>zoomBy(-1);
  element.addEventListener('pointerdown',e=>{
    if(isUi(e)||(e.pointerType==='mouse'&&e.button!==0))return;
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});element.setPointerCapture(e.pointerId);
    if(pointers.size===1)drag={id:e.pointerId,x:e.clientX,y:e.clientY,center:{...center},moved:false};
    else {const [a,b]=[...pointers.values()];pinch={distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),zoom};drag=null;tiles.style.transform='';marker.style.translate='';}
    element.classList.add('dragging');
  });
  element.addEventListener('pointermove',e=>{
    if(!pointers.has(e.pointerId))return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pinch&&pointers.size>=2){const [a,b]=[...pointers.values()];zoomAt(pinch.zoom+Math.log2(Math.max(1,Math.hypot(a.x-b.x,a.y-b.y))/pinch.distance),(a.x+b.x)/2,(a.y+b.y)/2);return;}
    if(!drag||drag.id!==e.pointerId)return;
    const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    drag.moved ||= Math.hypot(dx,dy)>5;
    if(drag.moved){tiles.style.transform=`translate(${dx}px,${dy}px)`;marker.style.translate=`${dx}px ${dy}px`;}
  });
  function end(e) {
    if(!pointers.has(e.pointerId))return;
    const wasPinching=!!pinch;pointers.delete(e.pointerId);
    if(wasPinching){drag=null;if(!pointers.size)pinch=null;}
    else if(drag?.id===e.pointerId){
      const previous=drag;drag=null;
      if(e.type!=='pointercancel'){
        if(!previous.moved)select(at(e.clientX,e.clientY));
        else {const cp=project(previous.center.lat,previous.center.lon,zoom);center=bounds(unproject(cp.x-(e.clientX-previous.x),cp.y-(e.clientY-previous.y),zoom));render();}
      }
    }
    tiles.style.transform='';marker.style.translate='';if(!pointers.size)element.classList.remove('dragging');
  }
  element.addEventListener('pointerup',end);element.addEventListener('pointercancel',end);
  element.addEventListener('wheel',e=>{if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();zoomAt(zoom+(e.deltaY<0?1:-1),e.clientX,e.clientY);},{passive:false});
  element.addEventListener('keydown',e=>{
    if(e.target!==element)return;
    const directions={ArrowLeft:[-80,0],ArrowRight:[80,0],ArrowUp:[0,-80],ArrowDown:[0,80]};
    if(directions[e.key]){e.preventDefault();const p=project(center.lat,center.lon,zoom),[x,y]=directions[e.key];center=bounds(unproject(p.x+x,p.y+y,zoom));render();}
    else if(e.key==='+'||e.key==='='){e.preventDefault();zoomBy(1);}
    else if(e.key==='-'){e.preventDefault();zoomBy(-1);}
    else if(e.key==='Enter'){e.preventDefault();select({...center});}
  });
  const observer=new ResizeObserver(render);observer.observe(element);render();
  return { setPin(p){pin={...p};center={...p};render();}, render, destroy(){observer.disconnect();} };
}
