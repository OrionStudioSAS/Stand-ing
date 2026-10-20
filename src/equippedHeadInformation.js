import { flagCountryCodes } from './config/flagCountryCodes.js';
import { signatureHeadStandCode } from './signatureHeadInformation.js';
const countryKey = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const countryAliases = {USA:'US',USAMERICA:'US',UNITEDSTATESOFAMERICA:'US',ETATSUNISDAMERIQUE:'US',UK:'GB',GBR:'GB',GREATBRITAIN:'GB',ANGLETERRE:'GB',FRA:'FR',FRANCAISE:'FR',FRANCAIS:'FR',DEU:'DE',GER:'DE',BEL:'BE',CHE:'CH',SUI:'CH',ESP:'ES',ITA:'IT',CAN:'CA',CHN:'CN',JPN:'JP',KOR:'KR',ARE:'AE',UAE:'AE'};
let countryNames;
export function equippedHeadCountryCode(value = '') {
  if (!countryNames) {
    countryNames = new Map(flagCountryCodes.map(code=>[code,code]));
    for (const locale of ['fr','en']) {
      const names = new Intl.DisplayNames([locale],{type:'region'});
      for (const code of flagCountryCodes) countryNames.set(countryKey(names.of(code)),code);
    }
    for (const [name,code] of Object.entries(countryAliases)) countryNames.set(name,code);
  }
  return countryNames.get(countryKey(value)) || 'FR';
}
function mondayCountryValue(column = {}) {
  if (String(column.text || '').trim()) return column.text;
  let value = column.value;
  if (typeof value === 'string') { try { value=JSON.parse(value); } catch { return value; } }
  return typeof value === 'string' ? value : value?.countryCode || value?.countryName || value?.country_name || value?.country_code || '';
}
export function sceneHeadCountry(scene = {}) {
  const payload = scene.source_payload || {};
  const columns = payload.column_values || payload.item?.column_values || [];
  const column = (Array.isArray(columns) ? columns : []).find(column=>countryKey(column.column?.title || column.title || column.id)==='PAYS');
  // An empty PAYS explicitly means France, regardless of language or contact defaults.
  return equippedHeadCountryCode(column ? mondayCountryValue(column) : payload.pays || '');
}
const flags = new Map();
export function loadEquippedHeadFlag(country = 'FR') {
  const code=equippedHeadCountryCode(country);
  if (typeof Image==='undefined') return Promise.resolve(null);
  if (!flags.has(code)) {
    const entry={image:null,promise:null};
    entry.promise=new Promise((resolve,reject)=>{
      const image=new Image();
      image.onload=()=>{entry.image=image;resolve(image);};
      image.onerror=()=>{flags.delete(code);reject(new Error(`Drapeau ${code} indisponible.`));};
      image.src=`/flags/${code.toLowerCase()}.svg`;
    });
    flags.set(code,entry);
  }
  return flags.get(code).promise;
}
export function equippedHeadMaterialFace(materialName = '') {
  if (/^_?1(?:\.\d+)?$/i.test(materialName)) return 'front';
  if (/^_?2(?:\.\d+)?$/i.test(materialName)) return 'back';
  return null;
}
function fit(ctx,text,x,y,maxWidth,baseSize,weight) {
  let size=baseSize;
  do {ctx.font=`${weight} ${size}px Oswald, sans-serif`;if(ctx.measureText(text).width<=maxWidth)break;size-=1;}while(size>1);
  ctx.fillText(text,x,y);
}
export function drawEquippedHeadInformation(ctx, visualContext = {}, face = 'front') {
  const company=String(visualContext.company || 'NOM EXPOSANT').trim().toUpperCase();
  const stand=signatureHeadStandCode(visualContext);
  const country=equippedHeadCountryCode(visualContext.country);
  const reverse=face==='back';
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,656,407);
  const flagX=reverse?568:22,flag=flags.get(country)?.image;
  if(flag)ctx.drawImage(flag,flagX,23,66,44);
  else if(country==='FR') {
    for(const [index,color] of ['#002395','#ffffff','#ed2939'].entries()){ctx.fillStyle=color;ctx.fillRect(flagX+index*22,23,22,44);}
  }
  ctx.fillStyle='#050505';ctx.textBaseline='top';ctx.textAlign='left';
  fit(ctx,company,156,17,350,57,400);
  fit(ctx,stand,reverse?22:544,17,90,57,700);
  return {company,stand,country,face,flagX};
}
