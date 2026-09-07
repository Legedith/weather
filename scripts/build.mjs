import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validatedProxyUrl } from '../assets/forecast.js';
import { compileRetro } from './retro-build.mjs';
const root = new URL('../', import.meta.url), dist = new URL('dist/', root);
const names = (await readdir(new URL('site-parts/', root))).filter(n=>/^\d{2}\.part$/.test(n)).sort();
if (names.length !== 12) throw new Error('Expected the 12 archived original site parts.');
const original = (await Promise.all(names.map(n=>readFile(new URL(`site-parts/${n}`, root), 'utf8')))).join('');
const {html,app} = compileRetro(original, await readFile(new URL('assets/retro-runtime.js', root), 'utf8'));
await rm(dist, {recursive:true,force:true});
await mkdir(new URL('assets/', dist), {recursive:true});
await writeFile(new URL('index.html',dist),html);
await writeFile(new URL('assets/app.js',dist),app);
for (const name of ['forecast.js','config.js','retro-polish.css']) await cp(new URL(`assets/${name}`,root),new URL(`assets/${name}`,dist));
if (process.env.GOOGLE_WEATHER_PROXY_URL) {
  const proxy=validatedProxyUrl(process.env.GOOGLE_WEATHER_PROXY_URL);
  await writeFile(new URL('assets/config.js',dist),`// Public endpoint only. Never put API keys here.\nexport const config=Object.freeze({googleWeatherProxyUrl:${JSON.stringify(proxy)}});\n`);
}
await writeFile(new URL('.nojekyll',dist),'');
console.log(`Built original retro theme at ${fileURLToPath(dist)}`);
