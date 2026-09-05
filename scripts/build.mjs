import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validatedProxyUrl } from '../assets/forecast.js';
const root = new URL('../', import.meta.url);
const dist = new URL('dist/',root);
await rm(dist,{recursive:true,force:true});
await mkdir(dist,{recursive:true});
await cp(new URL('index.html',root),new URL('index.html',dist));
await cp(new URL('assets/',root),new URL('assets/',dist),{recursive:true});
if (process.env.GOOGLE_WEATHER_PROXY_URL) {
  const proxy = validatedProxyUrl(process.env.GOOGLE_WEATHER_PROXY_URL);
  await writeFile(new URL('assets/config.js',dist),`// Public endpoint only. No API keys.\nexport const config = Object.freeze({googleWeatherProxyUrl:${JSON.stringify(proxy)}});\n`);
}
await writeFile(new URL('.nojekyll',dist),'');
const html=await readFile(new URL('index.html',dist),'utf8');
for (const file of ['assets/app.js','assets/styles.css']) if (!html.includes(file)) throw new Error(`Build is missing ${file}`);
console.log(`Built ${fileURLToPath(dist)}`);
