import extras from './extra-messages.js';
import keys from './source-keys.js';
import en from './locales/en.js';
import es from './locales/es.js';
import ptBR from './locales/pt-BR.js';
import zhHans from './locales/zh-Hans.js';
import fr from './locales/fr.js';
import de from './locales/de.js';
import ko from './locales/ko.js';
import ru from './locales/ru.js';
import it from './locales/it.js';
import zhHant from './locales/zh-Hant.js';
import id from './locales/id.js';
import tr from './locales/tr.js';
import vi from './locales/vi.js';
import th from './locales/th.js';

export const LANGUAGE_STORAGE_KEY = 'hanabin.language.v1';
export const SUPPORTED_LANGUAGES = Object.freeze([
  ['ja','日本語','ja-JP'],['en','English','en-US'],['es','Español','es-ES'],
  ['pt-BR','Português (Brasil)','pt-BR'],['zh-Hans','简体中文','zh-CN'],
  ['fr','Français','fr-FR'],['de','Deutsch','de-DE'],['ko','한국어','ko-KR'],
  ['ru','Русский','ru-RU'],['it','Italiano','it-IT'],['zh-Hant','繁體中文','zh-TW'],
  ['id','Bahasa Indonesia','id-ID'],['tr','Türkçe','tr-TR'],['vi','Tiếng Việt','vi-VN'],['th','ไทย','th-TH'],
].map(([id,name,locale])=>Object.freeze({id,name,locale})));
export const CATALOGS = Object.freeze(Object.fromEntries(Object.entries({ja:keys,en,es,'pt-BR':ptBR,'zh-Hans':zhHans,fr,de,ko,ru,it,'zh-Hant':zhHant,id,tr,vi,th}).map(([id,values])=>[id,Object.freeze(Object.fromEntries(keys.map((key,index)=>[key,values[index]])))])));
const supported = value => SUPPORTED_LANGUAGES.some(item=>item.id===value);
export function languageFromLocale(value) {
  if(typeof value!=='string')return null;
  const parts=value.toLowerCase().replaceAll('_','-').split('-');
  if(parts[0]==='zh')return parts.includes('hant')||(!parts.includes('hans')&&parts.some(x=>['tw','hk','mo'].includes(x)))?'zh-Hant':'zh-Hans';
  if(parts[0]==='pt')return 'pt-BR';
  return supported(parts[0])?parts[0]:null;
}
function safeStorage(){try{return globalThis.localStorage;}catch{return null;}}
export function resolveLanguage({storage=safeStorage(),navigatorObject=globalThis.navigator}={}) {
  try {const saved=storage?.getItem(LANGUAGE_STORAGE_KEY);if(supported(saved))return saved;}catch{}
  for(const locale of [...(navigatorObject?.languages||[]),navigatorObject?.language]) {const found=languageFromLocale(locale);if(found)return found;}
  return 'en';
}
// Pure core tests without a browser retain the original Japanese presentation.
let language = typeof window==='undefined'?'ja':resolveLanguage();
export const getLanguage = () => language;
export const getLocale = () => SUPPORTED_LANGUAGES.find(item=>item.id===language)?.locale || 'en-US';
export function setLanguage(next,{storage=safeStorage()}={}) {
  if(!supported(next))return false;
  language=next;try{storage?.setItem(LANGUAGE_STORAGE_KEY,next);}catch{}
  return true;
}
export function translate(source,parameters=[],targetLanguage=language) {
  const additional = Object.hasOwn(extras, targetLanguage) ? extras[targetLanguage] : {};
  const catalog = Object.hasOwn(CATALOGS, targetLanguage) ? CATALOGS[targetLanguage] : {};
  const message = Object.hasOwn(additional, source) ? additional[source]
    : Object.hasOwn(catalog, source) ? catalog[source] : source;
  return message.replace(/\{(\d+)\}/gu,(placeholder,index)=>Object.hasOwn(parameters,index)?String(parameters[index]):placeholder);
}
export const t = (source,parameters=[]) => translate(source,parameters);
export function applyTranslations(root=globalThis.document) {
  if(!root?.querySelectorAll)return;
  for(const element of root.querySelectorAll('[data-i18n]'))element.textContent=t(element.dataset.i18n);
  for(const element of root.querySelectorAll('[data-i18n-attrs]')) {
    const sources=JSON.parse(element.dataset.i18nAttrs);
    for(const [attribute,source] of Object.entries(sources))element.setAttribute(attribute,t(source));
  }
  if(root.documentElement)root.documentElement.lang=language;
}
export function initLanguageSettings(root=globalThis.document,onChange=()=>{}) {
  const select=root?.querySelector('#language-select');
  if(select) {
    const documentObject=root.ownerDocument||root;
    select.replaceChildren(...SUPPORTED_LANGUAGES.map(({id,name})=>{const option=documentObject.createElement('option');option.value=id;option.lang=id;option.textContent=name;return option;}));
    select.value=language;
    select.addEventListener('change',()=>{setLanguage(select.value);applyTranslations(root);onChange();});
  }
  applyTranslations(root);
}
