'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceLine, Legend
} from 'recharts';

// ============================================================
// 型別定義
// ============================================================
interface StockInfo { name: string; industry: string; type: string; }
interface NameMap { [code: string]: StockInfo; }
interface Cross { type: 'golden' | 'death'; daysAgo: number; }
interface Analysis {
  close: number; ma5: number|null; ma20: number|null; ma60: number|null;
  k: number; d: number; rsi: number|null;
  cross: Cross|null; score: number;
  trend: 'bull'|'bear'|'neutral'; trendText: string; trendEmoji: string;
  zone: 'overbought'|'oversold'|'neutral'; zoneText: string; zoneHint: string;
  oneLine: string; reasons: string[];
  ma5Arr: (number|null)[]; ma20Arr: (number|null)[]; ma60Arr: (number|null)[];
  kArr: number[]; dArr: number[]; rsiArr: (number|null)[];
}
interface Action { tag: string; emoji: string; tone: string; strong: boolean; advice: string; }
interface KeyLevels { breakout: number; r1: number; r2: number; s1: number; s2: number; strongS: number; }
interface VolInfo { today: number; avg: number; ratio: number; }
interface EntryZone { level: 'good'|'aggressive'|'avoid'; name: string; tag: string; from: number|null; to: number|null; rationale: string; }
interface DayRow {
  date: string; fullDate: string; ts: number;
  price: number; chg: number; chgPct: number; volume: number;
  ma5: number|null; ma20: number|null; ma60: number|null;
  kVal: number; dVal: number; rsiVal: number|null;
}
interface NewsItem { id: number; title: string; source: string; link: string; time: string; tag: string; cls: string; score: number; }
interface ActiveStock {
  code: string; name: string; industry: string; market: string;
  close: number; chg: number; chgPct: number;
  an: Analysis; action: Action; L: KeyLevels; volInfo: VolInfo|null;
  historyData: DayRow[]; lastDate: string;
  news: NewsItem[]; newsScore: number;
  newsSentiment: { tag: string; emoji: string; cls: string };
}

// ============================================================
// 常數
// ============================================================
const FINMIND_BASE = 'https://api.finmindtrade.com/api/v4/data';
const NAME_CACHE_KEY = 'taiwan_stock_info_v2';
const PIN_KEY = 'taiwan_stock_pins_v1';
const SCREEN_CACHE_KEY = 'stock_screen_cache_v1';
const SCREEN_TTL_MS = 60 * 60 * 1000;

const SCREEN_LIST = [
  '2330','2317','2454','2308','2382','2891','2412','2881','2882','6505',
  '1303','1301','1216','3711','2884','2885','2890','2887','5880','3045',
  '4904','1101','2603','2609','2615','3034','2379','3008','0050','0056'
];

const TWSE_STOCKS = [
  { code:'2330', name:'台積電', sector:'半導體業' },
  { code:'2317', name:'鴻海', sector:'其他電子業' },
  { code:'2454', name:'聯發科', sector:'半導體業' },
  { code:'2308', name:'台達電', sector:'電子零組件業' },
  { code:'2382', name:'廣達', sector:'電腦及週邊設備業' },
  { code:'2412', name:'中華電', sector:'通信網路業' },
  { code:'1301', name:'台塑', sector:'塑膠工業' },
  { code:'3034', name:'聯詠', sector:'半導體業' },
  { code:'3711', name:'日月光投控', sector:'半導體業' },
  { code:'0050', name:'元大台灣50', sector:'ETF' },
  { code:'2891', name:'中信金', sector:'金融業' },
  { code:'2881', name:'富邦金', sector:'金融業' },
  { code:'2882', name:'國泰金', sector:'金融業' },
  { code:'6505', name:'台塑化', sector:'石油化工' },
  { code:'1303', name:'南亞', sector:'塑膠工業' },
  { code:'2884', name:'玉山金', sector:'金融業' },
  { code:'2379', name:'瑞昱', sector:'半導體業' },
  { code:'0056', name:'元大高股息', sector:'ETF' },
];

const NEWS_POS = ['大漲','上漲','漲停','漲幅','利多','強勢','突破','新高','創高','看好','加碼','獲利','成長','增加','業績','訂單','大單','升評','調升','大賺','亮眼','超預期','受惠','拉抬','轉強','轉好','旺季','飆','登頂','爆量','看俏'];
const NEWS_NEG = ['大跌','下跌','跌停','跌幅','利空','弱勢','跌破','新低','創低','看壞','減碼','虧損','衰退','減少','滑落','放緩','警訊','降評','調降','賣壓','失利','衝擊','低於','不如預期','受挫','拉回','轉弱','淡季','慘','重摔','跳水','看淡','疲軟'];

// ============================================================
// 指標計算（完整移植）
// ============================================================
function sma(arr: number[], n: number): (number|null)[] {
  const out: (number|null)[] = new Array(arr.length).fill(null);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    if (i >= n) sum -= arr[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

function calcKD(highs: number[], lows: number[], closes: number[], n = 9): { k: number[], d: number[] } {
  const k = new Array(closes.length).fill(50);
  const d = new Array(closes.length).fill(50);
  for (let i = 0; i < closes.length; i++) {
    if (i < n - 1) continue;
    let hh = -Infinity, ll = Infinity;
    for (let j = i - n + 1; j <= i; j++) {
      if (highs[j] > hh) hh = highs[j];
      if (lows[j] < ll) ll = lows[j];
    }
    const rsv = hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100;
    k[i] = (k[i - 1] ?? 50) * 2 / 3 + rsv / 3;
    d[i] = (d[i - 1] ?? 50) * 2 / 3 + k[i] / 3;
  }
  return { k, d };
}

function calcRSI(closes: number[], n = 14): (number|null)[] {
  const out: (number|null)[] = new Array(closes.length).fill(null);
  if (closes.length <= n) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gain += diff; else loss -= diff;
  }
  let avgGain = gain / n, avgLoss = loss / n;
  out[n] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = n + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (n - 1) + g) / n;
    avgLoss = (avgLoss * (n - 1) + l) / n;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function detectCross(maShort: (number|null)[], maLong: (number|null)[], lookback = 3): Cross|null {
  const last = maShort.length - 1;
  for (let i = last; i >= last - lookback && i > 0; i--) {
    if (maShort[i] == null || maLong[i] == null || maShort[i-1] == null || maLong[i-1] == null) continue;
    if (maShort[i-1]! <= maLong[i-1]! && maShort[i]! > maLong[i]!) return { type: 'golden', daysAgo: last - i };
    if (maShort[i-1]! >= maLong[i-1]! && maShort[i]! < maLong[i]!) return { type: 'death', daysAgo: last - i };
  }
  return null;
}

function analyze(closes: number[], highs: number[], lows: number[]): Analysis {
  const ma5Arr = sma(closes, 5);
  const ma20Arr = sma(closes, 20);
  const ma60Arr = sma(closes, 60);
  const { k: kArr, d: dArr } = calcKD(highs, lows, closes);
  const rsiArr = calcRSI(closes);
  const last = closes.length - 1;

  const close = closes[last];
  const ma5v = ma5Arr[last], ma20v = ma20Arr[last], ma60v = ma60Arr[last];
  const kv = kArr[last], dv = dArr[last], rsiv = rsiArr[last];

  let score = 0;
  const reasons: string[] = [];
  if (ma20v != null) {
    if (close > ma20v) { score++; reasons.push('股價站上 20 日均線'); }
    else { score--; reasons.push('股價跌破 20 日均線'); }
  }
  if (ma5v != null && ma20v != null) {
    if (ma5v > ma20v) { score++; reasons.push('短均線在長均線之上'); }
    else { score--; reasons.push('短均線在長均線之下'); }
  }
  if (ma20v != null && ma60v != null) {
    if (ma20v > ma60v) score++; else score--;
  }
  if (kv != null && dv != null) {
    if (kv > dv) { score++; reasons.push('KD 指標 K 在 D 之上'); }
    else { score--; reasons.push('KD 指標 K 在 D 之下'); }
  }

  let zone: 'overbought'|'oversold'|'neutral' = 'neutral';
  let zoneText = '合理區', zoneHint = '';
  if (rsiv != null && rsiv > 70) { zone = 'overbought'; zoneText = '超買區'; zoneHint = 'RSI 偏高，技術面接近高檔，留意回檔風險'; score--; }
  else if (rsiv != null && rsiv < 30) { zone = 'oversold'; zoneText = '超賣區'; zoneHint = 'RSI 偏低，技術面接近低檔，可留意反彈機會'; score++; }
  else if (kv != null && kv > 80) { zone = 'overbought'; zoneText = '超買區'; zoneHint = 'KD 偏高，短線過熱'; score--; }
  else if (kv != null && kv < 20) { zone = 'oversold'; zoneText = '超賣區'; zoneHint = 'KD 偏低，短線超跌'; score++; }
  else { zoneHint = 'RSI 與 KD 皆在合理區間'; }

  const cross = detectCross(ma5Arr, ma20Arr);
  if (cross) {
    if (cross.type === 'golden') { score += 2; reasons.unshift(`${cross.daysAgo === 0 ? '今日' : cross.daysAgo + ' 日前'}出現黃金交叉`); }
    else { score -= 2; reasons.unshift(`${cross.daysAgo === 0 ? '今日' : cross.daysAgo + ' 日前'}出現死亡交叉`); }
  }

  let trend: 'bull'|'bear'|'neutral' = 'neutral', trendText = '盤整', trendEmoji = '🟡';
  if (score >= 3) { trend = 'bull'; trendText = '短期偏多'; trendEmoji = '🔴'; }
  else if (score <= -3) { trend = 'bear'; trendText = '短期偏空'; trendEmoji = '🟢'; }

  let oneLine = '';
  if (trend === 'bull' && zone === 'overbought') oneLine = '趨勢偏多但已過熱，現價追高需小心';
  else if (trend === 'bull' && zone === 'oversold') oneLine = '低檔偏多訊號出現，技術面可留意';
  else if (trend === 'bull') oneLine = '短期動能偏多，趨勢向上';
  else if (trend === 'bear' && zone === 'oversold') oneLine = '已在超賣區，但趨勢仍弱，建議觀察反彈訊號';
  else if (trend === 'bear' && zone === 'overbought') oneLine = '反彈但中期仍弱，留意賣壓';
  else if (trend === 'bear') oneLine = '短期動能偏空，趨勢向下';
  else if (zone === 'overbought') oneLine = '盤整偏高，注意短線拉回';
  else if (zone === 'oversold') oneLine = '盤整偏低，留意反彈機會';
  else oneLine = '多空不明，盤整等待方向';

  return {
    close, ma5: ma5v, ma20: ma20v, ma60: ma60v, k: kv, d: dv, rsi: rsiv,
    cross, score, trend, trendText, trendEmoji, zone, zoneText, zoneHint,
    oneLine, reasons, ma5Arr, ma20Arr, ma60Arr, kArr, dArr, rsiArr
  };
}

function getAction(a: Analysis): Action {
  const recentGolden = a.cross?.type === 'golden' && a.cross.daysAgo <= 5;
  const recentDeath  = a.cross?.type === 'death'  && a.cross.daysAgo <= 5;
  if (a.trend === 'bull' && a.zone === 'oversold') return { tag:'可考慮買進', emoji:'🟢', tone:'buy', strong:true, advice:'低檔出現偏多訊號，技術面是相對划算的進場點，但仍須評估自身資金狀況。' };
  if (a.trend === 'bull' && recentGolden) return { tag:'可考慮買進', emoji:'🟢', tone:'buy', strong:true, advice:'剛出現黃金交叉且趨勢偏多，動能由弱轉強，可分批佈局。' };
  if (a.trend === 'bull' && a.zone !== 'overbought') return { tag:'偏向買進', emoji:'🟢', tone:'buy', strong:false, advice:'趨勢向上、未過熱，可順勢操作，跌破 MA20 再評估。' };
  if (a.trend === 'bull' && a.zone === 'overbought') return { tag:'不宜追高', emoji:'🟠', tone:'caution', strong:false, advice:'趨勢偏多但已過熱，現價追高風險高；持有者可續抱、未進場者等回檔再說。' };
  if (a.trend === 'bear' && recentDeath) return { tag:'建議減碼 / 避開', emoji:'🔴', tone:'sell', strong:true, advice:'剛出現死亡交叉且趨勢偏空，動能由強轉弱，持股可考慮減碼。' };
  if (a.trend === 'bear' && a.zone === 'overbought') return { tag:'偏向賣出', emoji:'🔴', tone:'sell', strong:false, advice:'反彈遇壓 + 中期偏空，技術面有逢高出脫的訊號。' };
  if (a.trend === 'bear' && a.zone === 'oversold') return { tag:'觀望止跌', emoji:'🟡', tone:'hold', strong:false, advice:'已超賣但趨勢仍弱，等出現止跌（如紅 K + KD 翻揚）再考慮。' };
  if (a.trend === 'bear') return { tag:'不宜進場', emoji:'🔴', tone:'sell', strong:false, advice:'中期趨勢向下，避開為宜，等明確止跌訊號。' };
  if (a.zone === 'overbought') return { tag:'不宜追高', emoji:'🟠', tone:'caution', strong:false, advice:'盤整偏高，注意短線拉回。' };
  if (a.zone === 'oversold') return { tag:'可留意反彈', emoji:'🟡', tone:'hold', strong:false, advice:'盤整偏低，技術面有反彈機會，但無明確趨勢。' };
  return { tag:'中性觀望', emoji:'🟡', tone:'hold', strong:false, advice:'多空不明、訊號平淡，等候明確方向再行動。' };
}

function findKeyLevels(closes: number[], highs: number[], lows: number[]): KeyLevels {
  const N = closes.length, cur = closes[N - 1];
  const win = (arr: number[], n: number) => arr.slice(Math.max(0, N - n));
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const recent20H = Math.max(...win(highs, 20)), recent60H = Math.max(...win(highs, 60));
  const recent20L = Math.min(...win(lows, 20)), recent60L = Math.min(...win(lows, 60));
  const allTimeL  = Math.min(...lows);
  const r1 = recent20H > cur ? recent20H : r2(cur * 1.05);
  const rr2 = recent60H > r1 ? recent60H : r2(r1 * 1.06);
  const s1 = recent20L < cur ? recent20L : r2(cur * 0.95);
  const s2 = recent60L < s1 ? recent60L : r2(s1 * 0.94);
  const strongS = allTimeL < s2 ? allTimeL : r2(s2 * 0.92);
  return { breakout: r2(cur), r1: r2(r1), r2: r2(rr2), s1: r2(s1), s2: r2(s2), strongS: r2(strongS) };
}

function calcEntryZones(a: Analysis, L: KeyLevels): EntryZone[] {
  const cur = a.close, ma20 = a.ma20;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const zones: EntryZone[] = [];
  if (a.trend === 'bull') {
    const baseLow  = ma20 != null ? Math.min(L.s1, ma20) : L.s1;
    const baseHigh = ma20 != null ? Math.max(L.s1, ma20) : L.s1 * 1.03;
    zones.push({ level:'good', name:'保守進場區', tag:'✅ 首選', from:r2(baseLow), to:r2(baseHigh), rationale:`等回測${ma20 != null ? ' MA20 / 支撐1 ' : '支撐1 '}不破再進，勝率較高、停損點明確` });
    if (a.zone !== 'overbought') zones.push({ level:'aggressive', name:'順勢進場區', tag:'⚠️ 積極', from:r2(cur*0.98), to:r2(cur*1.01), rationale:'順勢追多，但需嚴守 S1 停損，不貪心' });
    if (cur < L.r2) zones.push({ level:'avoid', name:'不宜追高區', tag:'⛔ 避開', from:r2(Math.max(cur,L.r1)*1.05), to:r2(L.r2), rationale:'價位偏高、拉回機率大，等回測再說' });
  } else if (a.trend === 'bear') {
    zones.push({ level:'avoid', name:'建議觀望', tag:'⛔ 不宜', from:null, to:null, rationale:'趨勢偏空，建議等止跌訊號（紅 K + KD 翻揚 + 量縮）再評估' });
    if (a.zone === 'oversold') zones.push({ level:'aggressive', name:'超跌反彈試單區（高風險）', tag:'⚠️ 高風險', from:r2(L.strongS), to:r2(L.s1), rationale:'RSI/KD 已超賣，僅可小單試多，配合反轉訊號' });
  } else {
    zones.push({ level:'good', name:'逢低承接區', tag:'✅ 區間下緣', from:r2(L.s1), to:r2(L.s1*1.03), rationale:'盤整下緣分批承接，跌破即停損' });
    zones.push({ level:'avoid', name:'逢高減碼區', tag:'📤 區間上緣', from:r2(L.r1*0.97), to:r2(L.r1), rationale:'盤整上緣，可分批減碼或試空' });
  }
  return zones;
}

function calcVolRatio(volumes: number[]): VolInfo|null {
  const N = volumes.length;
  if (N < 6) return null;
  const today = volumes[N - 1] || 0;
  const avg = volumes.slice(N - 6, N - 1).reduce((a, b) => a + b, 0) / 5;
  if (!avg) return null;
  return { today, avg, ratio: (today / avg - 1) * 100 };
}

const fmt = (v: number|null|undefined, d = 2): string =>
  v == null || isNaN(v as number) ? '—' : Number(v).toFixed(d);

function relativeTime(pubDateStr: string): string {
  if (!pubDateStr) return '';
  const date = new Date(pubDateStr.includes('T') ? pubDateStr : pubDateStr.replace(' ', 'T') + 'Z');
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return '剛剛';
  if (diff < 3600) return Math.floor(diff / 60) + ' 分鐘前';
  if (diff < 86400) return Math.floor(diff / 3600) + ' 小時前';
  if (diff < 86400 * 7) return Math.floor(diff / 86400) + ' 天前';
  return date.toLocaleDateString('zh-TW');
}

// ============================================================
// API 函數
// ============================================================
async function loadNameMap(): Promise<NameMap> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const cached = JSON.parse(localStorage.getItem(NAME_CACHE_KEY) || 'null');
    if (cached?.date === today && cached?.map) return cached.map;
  } catch {}
  try {
    const res = await fetch(`${FINMIND_BASE}?dataset=TaiwanStockInfo`);
    const json = await res.json();
    const map: NameMap = {};
    if (json.data) {
      json.data.forEach((d: any) => {
        if (d.stock_id) map[d.stock_id] = { name: d.stock_name || d.stock_id, industry: d.industry_category || '', type: d.type || '' };
      });
    }
    try { localStorage.setItem(NAME_CACHE_KEY, JSON.stringify({ date: new Date().toISOString().slice(0, 10), map })); } catch {}
    return map;
  } catch { return {}; }
}

async function fetchPriceData(code: string) {
  const start = new Date();
  start.setMonth(start.getMonth() - 9);
  const startStr = start.toISOString().slice(0, 10);
  const res = await fetch(`${FINMIND_BASE}?dataset=TaiwanStockPrice&data_id=${encodeURIComponent(code)}&start_date=${startStr}`);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  if (json.status !== 200) throw new Error(json.msg || 'API 回傳錯誤');
  if (!json.data?.length) throw new Error('找不到此股票代號的歷史資料，請確認代號正確');
  return json.data;
}

async function fetchNews(query: string, count = 10): Promise<any[]> {
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;
  const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}&count=${count}`;
  const res = await fetch(apiUrl);
  if (!res.ok) return [];
  const json = await res.json();
  return json.items || [];
}

// ============================================================
// localStorage 釘選
// ============================================================
const getPins = (): string[] => { try { return JSON.parse(localStorage.getItem(PIN_KEY) || '[]') || []; } catch { return []; } };
const setPins = (arr: string[]) => localStorage.setItem(PIN_KEY, JSON.stringify(arr));

// ============================================================
// 交易計畫面板（原版 Panel 1~9 完整復刻）
// ============================================================
function TradingPlan({ code, name, market, industry, an, closes, highs, lows, volumes, lastDate, prevClose }: {
  code: string; name: string; market: string; industry: string;
  an: Analysis; closes: number[]; highs: number[]; lows: number[];
  volumes: number[]; lastDate: string; prevClose: number;
}) {
  const L = findKeyLevels(closes, highs, lows);
  const v = calcVolRatio(volumes);
  const price = an.close;
  const chg = price - prevClose;
  const chgPct = prevClose ? (chg / prevClose) * 100 : 0;
  const action = getAction(an);

  const trendBadgeCls = an.trend === 'bull' ? 'text-rose-400' : an.trend === 'bear' ? 'text-emerald-400' : 'text-amber-400';
  const chgCls = chg > 0 ? 'text-rose-400' : chg < 0 ? 'text-emerald-400' : 'text-slate-400';
  const chgSign = chg > 0 ? '▲' : chg < 0 ? '▼' : '–';
  const volRatioStr = v ? (v.ratio >= 0 ? '+' : '') + v.ratio.toFixed(0) + '%' : '—';
  const volRatioCls = v && v.ratio > 0 ? 'text-rose-400' : 'text-emerald-400';
  const entryZones = calcEntryZones(an, L);

  const trendBullets: string[] = [];
  if (an.trend === 'bull') trendBullets.push('短期均線多頭排列，趨勢偏多');
  else if (an.trend === 'bear') trendBullets.push('短期均線空頭排列，趨勢偏空');
  else trendBullets.push('多空訊號交織，目前處於盤整');
  if (an.cross?.type === 'golden') trendBullets.push(`${an.cross.daysAgo === 0 ? '今日' : an.cross.daysAgo + ' 日前'}出現黃金交叉`);
  else if (an.cross?.type === 'death') trendBullets.push(`${an.cross.daysAgo === 0 ? '今日' : an.cross.daysAgo + ' 日前'}出現死亡交叉`);
  if (an.rsi != null) {
    if (an.rsi > 70) trendBullets.push(`RSI ${an.rsi.toFixed(0)}，進入超買區，留意拉回風險`);
    else if (an.rsi < 30) trendBullets.push(`RSI ${an.rsi.toFixed(0)}，進入超賣區，留意反彈機會`);
    else trendBullets.push(`RSI ${an.rsi.toFixed(0)}，處於合理區間`);
  }
  if (v) {
    if (v.ratio > 30) trendBullets.push('成交量明顯放大，買賣盤積極');
    else if (v.ratio < -30) trendBullets.push('成交量大幅萎縮，觀望氣氛濃');
  }

  const watchPoints = [
    v ? `量能是否持續${v.ratio > 0 ? '放大' : '回升'}（量比 ${volRatioStr}）` : '量能變化',
    `股價是否站穩 ${fmt(L.r1)} 並挑戰 ${fmt(L.r2)}`,
    industry ? `${industry}族群消息面與報價變化` : '產業動向與消息面',
    'KD 與 RSI 是否進一步背離或轉折',
  ];

  const noteHints: string[] = [];
  if (industry) noteHints.push(`${name} 屬「${industry}」族群，受該產業景氣影響大`);
  if (an.trend === 'bull' && an.zone === 'overbought') noteHints.push('短線強勢但位階偏高，追高需控管風險');
  else if (an.trend === 'bear' && an.zone === 'oversold') noteHints.push('已過度超賣，可留意止跌反彈訊號');
  else noteHints.push(action.advice);
  noteHints.push('交易計畫為主，紀律執行為勝負關鍵');

  const Panel = ({ num, title, children, accent = 'amber', span2 = false }: { num: string; title: string; children: React.ReactNode; accent?: string; span2?: boolean }) => (
    <div className={`bg-slate-800/60 border border-slate-700/50 rounded-xl p-3 sm:p-4 ${span2 ? 'sm:col-span-2' : ''}`}>
      <h4 className={`text-${accent}-400 font-black text-sm mb-2 flex items-center gap-1.5`}>
        <span className={`bg-${accent}-400/20 text-${accent}-300 rounded px-1.5 py-0.5 text-xs`}>{num}</span>
        {title}
      </h4>
      <div className="text-xs sm:text-sm text-slate-200 space-y-1.5">{children}</div>
    </div>
  );

  const UL = ({ items }: { items: string[] }) => (
    <ul className="space-y-1">
      {items.map((t, i) => <li key={i} className="flex items-start gap-1.5"><span className="text-cyan-400 mt-0.5">•</span><span>{t}</span></li>)}
    </ul>
  );

  const Checks = ({ items }: { items: string[] }) => (
    <ul className="space-y-1">
      {items.map((t, i) => <li key={i} className="flex items-start gap-1.5"><span className="text-emerald-400">☑</span><span>{t}</span></li>)}
    </ul>
  );

  const LvRow = ({ label, val, cls }: { label: string; val: number; cls: string }) => (
    <div className="flex items-center gap-2">
      <span className="text-slate-400 w-20">{label}</span>
      <span className="flex-1 border-b border-dashed border-slate-600"></span>
      <span className={`${cls} font-black`}>{fmt(val)}</span>
    </div>
  );

  return (
    <div className="bg-slate-900 text-slate-100 rounded-2xl shadow-xl overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border-b border-slate-700 p-4 sm:p-5">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-3xl font-black text-cyan-300">{code}</span>
              <span className="text-2xl font-black">{name}</span>
              <span className="text-base text-slate-400">交易計畫</span>
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {market && <span className="px-1.5 py-0.5 bg-slate-700 rounded">{market}</span>}
              {industry && <span className="ml-1.5">{industry}</span>}
            </div>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-x-4 gap-y-1 text-xs">
            <div><div className="text-slate-500">更新日期</div><div className="font-bold">{lastDate || '—'}</div></div>
            <div><div className="text-slate-500">目前股價</div><div className="font-black text-base text-rose-400">{fmt(price)}</div></div>
            <div><div className="text-slate-500">漲跌</div><div className={`font-black ${chgCls}`}>{chgSign} {Math.abs(chg).toFixed(2)} <span className="text-[10px]">({Math.abs(chgPct).toFixed(2)}%)</span></div></div>
            <div><div className="text-slate-500">趨勢方向</div><div className={`font-black ${trendBadgeCls}`}>{an.trendText}</div></div>
            <div><div className="text-slate-500">量比 (5日)</div><div className={`font-black ${volRatioCls}`}>{volRatioStr}</div></div>
          </div>
        </div>
      </div>

      {/* Panels Grid */}
      <div className="p-3 sm:p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Panel num="1" title="趨勢判斷"><UL items={trendBullets} /></Panel>

        <Panel num="2" title="關鍵價位">
          <div className="space-y-1.5 text-xs">
            <LvRow label="突破上關價" val={L.breakout} cls="text-rose-400" />
            <LvRow label="壓力 1"     val={L.r1}       cls="text-rose-400" />
            <LvRow label="壓力 2"     val={L.r2}       cls="text-rose-400" />
            <LvRow label="支撐 1"     val={L.s1}       cls="text-emerald-400" />
            <LvRow label="支撐 2"     val={L.s2}       cls="text-emerald-400" />
            <LvRow label="強力支撐"   val={L.strongS}  cls="text-emerald-400" />
          </div>
        </Panel>

        <Panel num="3" title="進場合理價格" accent="cyan">
          <div className="space-y-2">
            {entryZones.map((z, i) => {
              const borderCls = z.level === 'good' ? 'bg-emerald-900/40 border-emerald-600/60'
                : z.level === 'aggressive' ? 'bg-amber-900/40 border-amber-600/60'
                : 'bg-rose-900/40 border-rose-600/60';
              const tagCls = z.level === 'good' ? 'bg-emerald-500 text-white'
                : z.level === 'aggressive' ? 'bg-amber-500 text-white'
                : 'bg-rose-500 text-white';
              return (
                <div key={i} className={`border ${borderCls} rounded-lg p-2.5`}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-bold text-xs">{z.name}</span>
                    <span className={`${tagCls} px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap`}>{z.tag}</span>
                  </div>
                  {z.from != null ? (
                    <div className="font-mono font-black text-base mt-1 text-slate-100">{fmt(z.from)} ~ {fmt(z.to)}</div>
                  ) : (
                    <div className="text-xs italic text-slate-400 mt-1">暫不建議任何價位</div>
                  )}
                  <p className="text-[11px] text-slate-300 mt-1 leading-snug">{z.rationale}</p>
                </div>
              );
            })}
          </div>
        </Panel>

        {/* Panel 4: 交易策略 */}
        <Panel num="4" title="交易策略">
          <div className="space-y-3">
            <div className="bg-rose-900/30 border-l-2 border-rose-400 pl-3 py-2">
              <div className="text-rose-400 font-bold mb-1">多頭策略</div>
              <div className="text-xs space-y-0.5">
                <div>條件：站穩 <b>{fmt(L.r1)}</b> 以上</div>
                <div>進場：回測 <b>{fmt(L.s1)}~{fmt(L.r1)}</b></div>
                <div>目標：<b>{fmt(L.r2)}</b> / <b>{(L.r2 * 1.05).toFixed(2)}</b></div>
                <div>停損：跌破 <b>{fmt(L.s1)}</b></div>
              </div>
            </div>
            <div className="bg-emerald-900/30 border-l-2 border-emerald-400 pl-3 py-2">
              <div className="text-emerald-400 font-bold mb-1">空頭策略</div>
              <div className="text-xs space-y-0.5">
                <div>條件：跌破 <b>{fmt(L.s1)}</b></div>
                <div>進場：反彈 <b>{fmt(L.s1)}</b> 以下</div>
                <div>目標：<b>{fmt(L.s2)}</b> / <b>{fmt(L.strongS)}</b></div>
                <div>停損：站回 <b>{fmt(L.r1)}</b> 以上</div>
              </div>
            </div>
          </div>
        </Panel>

        {/* Panel 5: 風險管理 */}
        <Panel num="5" title="風險管理" accent="cyan">
          <Checks items={['單筆風險：不超過總資金 2%','停損嚴格執行，不擴單、不加碼','盈虧比建議 ≥ 1:2','避免重大消息發布前後重倉操作']} />
        </Panel>

        {/* Panel 6: 進場計畫表（span 2） */}
        <Panel num="6" title="進場計畫（範例）" accent="cyan" span2>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] sm:text-xs">
              <thead className="text-slate-400 border-b border-slate-700">
                <tr>
                  <th className="text-left py-1">情境</th>
                  <th className="text-center">進場條件</th>
                  <th className="text-center">價位</th>
                  <th className="text-center">停損</th>
                  <th className="text-center">目標1</th>
                  <th className="text-center">目標2</th>
                  <th className="text-center">盈虧比</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-slate-700/40">
                  <td className="py-1.5 text-rose-400 font-bold">多頭</td>
                  <td className="text-center">站穩{fmt(L.r1)}以上回測</td>
                  <td className="text-center font-mono">{fmt(L.s1)}~{fmt(L.r1)}</td>
                  <td className="text-center font-mono text-emerald-400">{fmt(L.s1)}</td>
                  <td className="text-center font-mono">{fmt(L.r2)}</td>
                  <td className="text-center font-mono">{(L.r2 * 1.05).toFixed(2)}</td>
                  <td className="text-center font-bold">≥ 1:2</td>
                </tr>
                <tr>
                  <td className="py-1.5 text-emerald-400 font-bold">空頭</td>
                  <td className="text-center">跌破{fmt(L.s1)}反彈不過</td>
                  <td className="text-center font-mono">{(L.s1 * 0.97).toFixed(2)}~{fmt(L.s1)}</td>
                  <td className="text-center font-mono text-rose-400">{fmt(L.r1)}</td>
                  <td className="text-center font-mono">{fmt(L.s2)}</td>
                  <td className="text-center font-mono">{fmt(L.strongS)}</td>
                  <td className="text-center font-bold">≥ 1:2</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-slate-500 mt-2">※ 價位為參考，依盤中走勢彈性調整</p>
        </Panel>

        {/* Panel 7: 執行紀律 */}
        <Panel num="7" title="執行紀律" accent="emerald">
          <Checks items={['進場前確認條件達成','嚴格執行停損停利','不預設立場，順勢操作','每日檢討，優化交易計畫','不因情緒影響紀律']} />
        </Panel>

        {/* Panel 8: 觀察重點 */}
        <Panel num="8" title="觀察重點" accent="emerald">
          <Checks items={watchPoints} />
        </Panel>

        {/* Panel 9: 備註 */}
        <Panel num="9" title="備註" accent="slate">
          <UL items={noteHints} />
        </Panel>
      </div>

      {/* Core Principles Footer */}
      <div className="mx-3 mb-3 sm:mx-5 sm:mb-5 py-2.5 px-4 bg-gradient-to-r from-amber-900/40 to-yellow-700/30 border border-amber-700/50 rounded-xl text-center">
        <span className="text-amber-300 font-black text-sm">🎯 核心原則：</span>
        <span className="text-amber-100 font-bold text-sm">順勢操作 · 嚴設停損 · 控管風險 · 紀律執行</span>
      </div>
    </div>
  );
}

// ============================================================
// 主元件
// ============================================================
export default function Home() {
  const [searchCode, setSearchCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeStock, setActiveStock] = useState<ActiveStock|null>(null);
  const [pinnedCodes, setPinnedCodes] = useState<string[]>([]);
  const [scanList, setScanList] = useState<any[]>([]);
  const [scanTime, setScanTime] = useState('');
  const [lastSearchTime, setLastSearchTime] = useState('');
  const [selectedDate, setSelectedDate] = useState<string|null>(null);
  const [tableRange, setTableRange] = useState('30');
  const [nameMap, setNameMap] = useState<NameMap>({});
  const [suggestions, setSuggestions] = useState(TWSE_STOCKS.slice(0, 5));
  const [isFocused, setIsFocused] = useState(false);
  const [rawData, setRawData] = useState<{ closes: number[]; highs: number[]; lows: number[]; volumes: number[]; timestamps: number[] }|null>(null);
  const [livePrice, setLivePrice] = useState<{ price: number; chg: number; pct: number; isTrading: boolean; time: string }|null>(null);
  const [newsLoading, setNewsLoading] = useState(false);
  const liveTimerRef = useRef<NodeJS.Timeout|null>(null);

  // 載入儲存資料
  useEffect(() => {
    setPinnedCodes(getPins());
    loadNameMap().then(m => setNameMap(m));
    runScan();
    // 讀取 URL 參數
    const params = new URLSearchParams(window.location.search);
    const initStock = params.get('stock');
    if (initStock) { setSearchCode(initStock); handleSearch(initStock); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 搜尋建議
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchCode(val);
    const allStocks = Object.entries(nameMap).map(([code, info]) => ({ code, name: info.name, sector: info.industry }));
    const pool = allStocks.length ? allStocks : TWSE_STOCKS.map(s => ({ code: s.code, name: s.name, sector: s.sector }));
    if (!val.trim()) { setSuggestions(TWSE_STOCKS.slice(0, 5)); return; }
    const q = val.trim().toUpperCase();
    const results = pool.filter(s => s.code.includes(q) || s.name.includes(val.trim())).slice(0, 10);
    setSuggestions(results.length ? results : TWSE_STOCKS.slice(0, 5));
  };

  // 即時報價
  const fetchLiveQuote = useCallback(async (code: string) => {
    try {
      const res = await fetch(`/api/quote?code=${encodeURIComponent(code)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data?.price != null) setLivePrice({ price: data.price, chg: data.change ?? 0, pct: data.change_pct ?? 0, isTrading: data.is_trading ?? false, time: data.time || '' });
    } catch {}
  }, []);

  const startLiveUpdates = useCallback((code: string) => {
    if (liveTimerRef.current) clearInterval(liveTimerRef.current);
    fetchLiveQuote(code);
    liveTimerRef.current = setInterval(() => fetchLiveQuote(code), 30000);
  }, [fetchLiveQuote]);

  // 主查詢
  const handleSearch = async (codeTarget?: string) => {
    const code = (codeTarget || searchCode).trim().toUpperCase();
    if (!code) return;
    if (liveTimerRef.current) clearInterval(liveTimerRef.current);
    setLoading(true);
    setSelectedDate(null);
    setIsFocused(false);
    setLivePrice(null);
    setActiveStock(null);
    setRawData(null);
    setSearchCode(code);

    // 更新 URL
    const newUrl = window.location.pathname + '?stock=' + code;
    window.history.replaceState(null, '', newUrl);

    try {
      const rows = await fetchPriceData(code);
      const valid = rows.filter((r: any) => r.close != null && r.max != null && r.min != null && r.open != null);
      if (valid.length < 30) throw new Error('資料不足，需至少 30 個交易日');

      const cTs  = valid.map((r: any) => Math.floor(new Date(r.date + 'T00:00:00+08:00').getTime() / 1000));
      const cH   = valid.map((r: any) => r.max);
      const cL   = valid.map((r: any) => r.min);
      const cC   = valid.map((r: any) => r.close);
      const cV   = valid.map((r: any) => r.Trading_Volume);

      setRawData({ closes: cC, highs: cH, lows: cL, volumes: cV, timestamps: cTs });

      const an     = analyze(cC, cH, cL);
      const action = getAction(an);
      const L      = findKeyLevels(cC, cH, cL);
      const volInfo = calcVolRatio(cV);
      const last   = valid[valid.length - 1];
      const prev   = valid[valid.length - 2] || last;
      const chg    = last.close - prev.close;
      const chgPct = prev.close ? (chg / prev.close) * 100 : 0;
      const info   = nameMap[code] || { name: code, industry: '', type: '' };
      const name   = info.name || code;
      const market = info.type === 'twse' ? '上市' : info.type === 'tpex' ? '上櫃' : '';

      // historyData
      const historyData: DayRow[] = valid.map((d: any, i: number) => {
        const dp = i > 0 ? valid[i - 1] : d;
        const dc = d.close - dp.close;
        const dpct = dp.close ? (dc / dp.close) * 100 : 0;
        return {
          date: d.date.substring(5).replace('-', '/'),
          fullDate: d.date,
          ts: cTs[i],
          price: d.close, chg: dc, chgPct: dpct, volume: d.Trading_Volume,
          ma5: an.ma5Arr[i] != null ? Number((an.ma5Arr[i] as number).toFixed(2)) : null,
          ma20: an.ma20Arr[i] != null ? Number((an.ma20Arr[i] as number).toFixed(2)) : null,
          ma60: an.ma60Arr[i] != null ? Number((an.ma60Arr[i] as number).toFixed(2)) : null,
          kVal: an.kArr[i], dVal: an.dArr[i], rsiVal: an.rsiArr[i],
        };
      });

      // 新聞
      setNewsLoading(true);
      const newsQuery = name !== code ? name : code;
      let newsList: NewsItem[] = [];
      let newsScore = 0;
      try {
        const items = await fetchNews(newsQuery, 10);
        items.forEach((item: any, idx: number) => {
          const title = item.title || '';
          let p = 0, n = 0;
          NEWS_POS.forEach(w => { if (title.includes(w)) p++; });
          NEWS_NEG.forEach(w => { if (title.includes(w)) n++; });
          const s = p - n;
          newsScore += s;
          const rawTitle = title.split(' - ')[0];
          const source = title.split(' - ')[1] || 'Google 新聞';
          newsList.push({
            id: idx, title: rawTitle, source, link: item.link, time: relativeTime(item.pubDate),
            tag: s > 0 ? '利多' : s < 0 ? '利空' : '中性',
            cls: s > 0 ? 'bg-red-100 text-red-700' : s < 0 ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500',
            score: s,
          });
        });
      } catch {}
      setNewsLoading(false);

      const newsSentiment = newsScore > 1
        ? { tag:'偏多', emoji:'🔴', cls:'bg-rose-50 border-rose-200 text-rose-700' }
        : newsScore < -1
        ? { tag:'偏空', emoji:'🟢', cls:'bg-emerald-50 border-emerald-200 text-emerald-700' }
        : { tag:'中性 / 訊號不明', emoji:'🟡', cls:'bg-amber-50 border-amber-200 text-amber-700' };

      setActiveStock({ code, name, industry: info.industry, market, close: last.close, chg, chgPct, an, action, L, volInfo, historyData, lastDate: last.date, news: newsList, newsScore, newsSentiment });
      setLastSearchTime(new Date().toLocaleTimeString('zh-TW', { hour12: false }));
      startLiveUpdates(code);
    } catch (e: any) {
      alert('查詢失敗：' + (e.message || '請稍後再試'));
    }
    setLoading(false);
  };

  // 釘選
  const togglePin = (code: string) => {
    const current = getPins();
    const updated = current.includes(code) ? current.filter(c => c !== code) : [...current, code];
    setPins(updated);
    setPinnedCodes(updated);
  };

  // 掃描
  const runScan = async () => {
    setScanTime(new Date().toLocaleTimeString('zh-TW', { hour12: false }));
    try {
      const cached = JSON.parse(localStorage.getItem(SCREEN_CACHE_KEY) || 'null');
      if (cached && Date.now() - cached.ts < SCREEN_TTL_MS) { setScanList(cached.results.filter((r: any) => r.action.tone === 'buy').sort((a: any, b: any) => b.an.score - a.an.score)); return; }
    } catch {}

    const nm = await loadNameMap();
    const start = new Date(); start.setMonth(start.getMonth() - 5);
    const startStr = start.toISOString().slice(0, 10);
    const results: any[] = [];

    for (let i = 0; i < SCREEN_LIST.length; i += 6) {
      const batch = SCREEN_LIST.slice(i, i + 6);
      const batchOut = await Promise.all(batch.map(async code => {
        try {
          const res = await fetch(`${FINMIND_BASE}?dataset=TaiwanStockPrice&data_id=${code}&start_date=${startStr}`);
          const json = await res.json();
          if (!json.data || json.data.length < 60) return null;
          const valid = json.data.filter((r: any) => r.close != null && r.max != null && r.min != null);
          if (valid.length < 60) return null;
          const cC = valid.map((r: any) => r.close);
          const cH = valid.map((r: any) => r.max);
          const cL = valid.map((r: any) => r.min);
          const an = analyze(cC, cH, cL);
          const action = getAction(an);
          const last = valid[valid.length - 1], prev = valid[valid.length - 2] || last;
          const chgPct = prev.close ? ((last.close - prev.close) / prev.close) * 100 : 0;
          return { code, name: nm[code]?.name || code, close: last.close, chgPct, an, action };
        } catch { return null; }
      }));
      results.push(...batchOut.filter(Boolean));
    }

    try { localStorage.setItem(SCREEN_CACHE_KEY, JSON.stringify({ ts: Date.now(), results })); } catch {}
    setScanList(results.filter(r => r.action.tone === 'buy').sort((a, b) => b.an.score - a.an.score));
  };

  // 分享
  const handleShare = async () => {
    if (!activeStock) return;
    const url = window.location.origin + window.location.pathname + '?stock=' + activeStock.code;
    try {
      await navigator.clipboard.writeText(url);
      alert('連結已複製！');
    } catch {
      prompt('複製這個連結分享給朋友：', url);
    }
  };

  const displayPrice = livePrice?.price ?? activeStock?.close;
  const displayChg   = livePrice?.chg   ?? activeStock?.chg ?? 0;
  const displayPct   = livePrice?.pct   ?? activeStock?.chgPct ?? 0;

  // 表格資料
  const tableData = activeStock ? (() => {
    const total = activeStock.historyData.length;
    const n = tableRange === 'all' ? total : parseInt(tableRange);
    return [...activeStock.historyData].reverse().slice(0, n);
  })() : [];

  // Recharts 圖表資料
  const chartData = activeStock?.historyData ?? [];

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 text-slate-800 font-sans pb-16">
      <div className="max-w-5xl mx-auto px-4 py-6 sm:py-10">

        {/* Header */}
        <header className="mb-6 sm:mb-8">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl sm:text-3xl font-black text-slate-800">📈 台股懶人分析</h1>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-full border border-blue-100 shadow-sm">
                  <span
                    role="img"
                    aria-label="王胤愃"
                    style={{
                      width: '24px',
                      height: '24px',
                      minWidth: '24px',
                      flex: '0 0 24px',
                      display: 'inline-block',
                      borderRadius: '9999px',
                      backgroundImage: "url('/author.jpg')",
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      backgroundRepeat: 'no-repeat',
                      overflow: 'hidden',
                      boxSizing: 'border-box',
                    }}
                  />
                  <span className="text-xs font-bold text-slate-700">作者：王胤愃</span>
                  <span className="text-slate-300">·</span>
                  <span className="text-xs font-bold text-pink-600">@beckwang</span>
                </div>
              </div>
              <p className="text-sm text-slate-500 mt-2">輸入代號 → 一眼看懂技術面 → 釘選 / 分享給朋友</p>
            </div>
            <div className="text-xs text-slate-400">{lastSearchTime ? `最後查詢 ${lastSearchTime}` : '尚未查詢'}</div>
          </div>
        </header>

        {/* Search */}
        <section className="bg-white rounded-2xl shadow-sm p-4 sm:p-5 mb-5">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                placeholder="輸入代號或名稱（例如 2330、台積電、聯發科）"
                value={searchCode}
                onChange={handleInputChange}
                onFocus={() => { setIsFocused(true); if (!searchCode) setSuggestions(TWSE_STOCKS.slice(0, 5)); }}
                onBlur={() => setTimeout(() => setIsFocused(false), 200)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none text-base transition-shadow"
              />
              {isFocused && suggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl shadow-xl border border-slate-200 max-h-80 overflow-y-auto z-50">
                  {suggestions.map((s, i) => (
                    <div key={s.code} onClick={() => { setSearchCode(s.code); handleSearch(s.code); }}
                      className={`flex justify-between items-center p-3 hover:bg-blue-50 cursor-pointer border-b border-slate-50 last:border-0 ${i === 0 ? 'bg-blue-50/50' : ''}`}>
                      <div>
                        <span className="font-bold text-slate-800 text-sm">{s.name}</span>
                        {'sector' in s && <span className="text-[10px] text-slate-400 ml-1">{(s as any).sector}</span>}
                      </div>
                      <span className="bg-yellow-200 text-slate-900 px-1.5 rounded text-xs font-mono">{s.code}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => handleSearch()} disabled={loading}
              className="px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded-xl transition shadow-sm disabled:bg-blue-300">
              {loading ? '查詢中…' : '查詢'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2 mt-3 text-xs items-center">
            <span className="text-slate-500">熱門：</span>
            {[['2330','台積電'],['2317','鴻海'],['0050','元大台灣50'],['2454','聯發科'],['2412','中華電']].map(([code, name]) => (
              <button key={code} onClick={() => { setSearchCode(code); handleSearch(code); }} className="text-blue-600 hover:underline font-medium">{code} {name}</button>
            ))}
          </div>
        </section>

        {/* 本日適合進場 */}
        {!activeStock && (
          <section className="mb-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-slate-600">✨ 本日適合進場（熱門 30 檔掃描）</h2>
              <button onClick={() => { localStorage.removeItem(SCREEN_CACHE_KEY); setScanList([]); runScan(); }} className="text-xs text-blue-500 hover:underline">🔄 重新掃描</button>
            </div>
            <div className="bg-white rounded-2xl shadow-sm p-4">
              {scanList.length === 0 ? (
                <div className="text-sm text-slate-500 text-center py-3">
                  <span className="inline-block w-5 h-5 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin align-middle mr-2"></span>
                  正在掃描熱門股…
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 mb-2">
                    {scanList.slice(0, 12).map(r => (
                      <button key={r.code} onClick={() => handleSearch(r.code)}
                        className="text-left bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl p-3 transition">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div className="font-black text-slate-800 text-sm truncate">{r.name}</div>
                          {r.action.strong && <span className="text-xs font-bold text-yellow-600">★</span>}
                        </div>
                        <div className="font-mono text-xs text-slate-500 mb-1.5">{r.code}</div>
                        <div className="flex items-baseline gap-2 mb-1.5">
                          <span className="font-black text-slate-800">{r.close.toFixed(2)}</span>
                          <span className={`text-xs font-bold ${r.chgPct >= 0 ? 'text-red-600' : 'text-green-600'}`}>{r.chgPct >= 0 ? '▲' : '▼'} {Math.abs(r.chgPct).toFixed(2)}%</span>
                        </div>
                        <div className="text-xs font-bold text-rose-600">{r.action.emoji} {r.action.tag}</div>
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-slate-400 text-center">共找到 {scanList.length} 檔・掃描時間 {scanTime}・點擊查看完整分析</p>
                </>
              )}
            </div>
          </section>
        )}

        {/* 釘選清單 */}
        {pinnedCodes.length > 0 && (
          <section className="mb-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-slate-600">📌 我釘選的股票</h2>
              <button onClick={() => { setPins([]); setPinnedCodes([]); }} className="text-xs text-slate-400 hover:text-red-500">清空</button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {pinnedCodes.map(code => (
                <button key={code} onClick={() => handleSearch(code)}
                  className="bg-white rounded-xl p-3 shadow-sm text-left hover:-translate-y-0.5 hover:shadow-md transition-all">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-bold text-slate-700">{code}</span>
                    <span className="text-xs text-slate-300">點擊查詢</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-1">{nameMap[code]?.name || '—'}</div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Empty State */}
        {!activeStock && !loading && (
          <section className="bg-white rounded-2xl shadow-sm p-8 text-center text-slate-500">
            <div className="text-5xl mb-3">🔍</div>
            <p className="text-sm">輸入台股代號，立即看到技術面懶人分析</p>
            <p className="text-xs text-slate-400 mt-2">支援上市（.TW）與上櫃（.TWO）</p>
          </section>
        )}

        {/* Loading State */}
        {loading && (
          <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
            <div className="w-6 h-6 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin mx-auto"></div>
            <p className="text-sm text-slate-500 mt-3">正在抓取 {searchCode} 的資料…</p>
          </div>
        )}

        {/* 主要結果 */}
        {activeStock && !loading && (
          <div className="space-y-4">
            {/* 1. 主報價卡片 */}
            <div className={`rounded-2xl shadow-md p-5 sm:p-6 ${activeStock.an.trend === 'bull' ? 'bg-gradient-to-br from-red-100 to-red-200' : activeStock.an.trend === 'bear' ? 'bg-gradient-to-br from-green-100 to-green-200' : 'bg-gradient-to-br from-slate-100 to-slate-200'}`}>
              <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-2xl font-black text-slate-800">{activeStock.name}</h2>
                    <span className="text-slate-500 text-sm font-mono">{activeStock.code}</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${activeStock.an.zone === 'overbought' ? 'bg-red-100 text-red-700' : activeStock.an.zone === 'oversold' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                      {activeStock.an.zoneText}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-3 mt-1 flex-wrap">
                    <span className={`text-3xl font-black ${displayChg >= 0 ? 'text-red-600' : 'text-green-700'}`}>{fmt(displayPrice)}</span>
                    <span className={`text-base font-bold ${displayChg >= 0 ? 'text-red-600' : 'text-green-700'}`}>
                      {displayChg >= 0 ? '▲' : '▼'} {Math.abs(displayChg).toFixed(2)} ({Math.abs(displayPct).toFixed(2)}%)
                    </span>
                    {livePrice && (
                      <span className="text-xs text-slate-500 ml-1 flex items-center gap-1">
                        <span className={`inline-block w-2 h-2 ${livePrice.isTrading ? 'bg-red-500 animate-pulse' : 'bg-slate-400'} rounded-full`}></span>
                        📡 {livePrice.isTrading ? '即時' : '盤後'} {livePrice.time}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => togglePin(activeStock.code)}
                    className="px-3 py-2 bg-white/70 hover:bg-white rounded-lg text-sm font-bold border border-white transition shadow-sm">
                    {pinnedCodes.includes(activeStock.code) ? '⭐ 已釘選' : '☆ 釘選'}
                  </button>
                  <button onClick={handleShare}
                    className="px-3 py-2 bg-white/70 hover:bg-white rounded-lg text-sm font-bold border border-white transition shadow-sm">
                    🔗 複製連結
                  </button>
                </div>
              </div>

              {/* 一句話結論 */}
              <div className="bg-white/70 rounded-xl p-4 mb-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-2xl">{activeStock.an.trendEmoji}</span>
                  <span className={`text-lg font-black ${activeStock.an.trend === 'bull' ? 'text-red-600' : activeStock.an.trend === 'bear' ? 'text-green-700' : 'text-slate-600'}`}>{activeStock.an.trendText}</span>
                </div>
                <p className="text-slate-700 font-medium">{activeStock.an.oneLine}</p>
                <p className="text-xs text-slate-500 mt-2">{activeStock.an.zoneHint}</p>
              </div>

              {/* 投資建議 */}
              <div className={`rounded-xl p-4 border-2 ${activeStock.action.tone === 'buy' ? 'bg-rose-50 border-rose-200' : activeStock.action.tone === 'sell' ? 'bg-emerald-50 border-emerald-200' : activeStock.action.tone === 'caution' ? 'bg-orange-50 border-orange-200' : 'bg-amber-50 border-amber-200'}`}>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="text-xs font-bold text-slate-500">📌 投資建議</span>
                  <span className={`${activeStock.action.tone === 'buy' ? 'bg-rose-500' : activeStock.action.tone === 'sell' ? 'bg-emerald-500' : activeStock.action.tone === 'caution' ? 'bg-orange-500' : 'bg-amber-500'} text-white text-sm font-black px-3 py-1 rounded-full`}>
                    {activeStock.action.emoji} {activeStock.action.tag}
                  </span>
                  {activeStock.action.strong && <span className="text-xs font-bold text-yellow-600 ml-1">★ 強烈訊號</span>}
                </div>
                <p className="text-sm text-slate-700">{activeStock.action.advice}</p>
              </div>
            </div>

            {/* 2. 完整交易計畫（Panel 1~9）*/}
            {rawData && (
              <TradingPlan
                code={activeStock.code}
                name={activeStock.name}
                market={activeStock.market}
                industry={activeStock.industry}
                an={activeStock.an}
                closes={rawData.closes}
                highs={rawData.highs}
                lows={rawData.lows}
                volumes={rawData.volumes}
                lastDate={activeStock.lastDate}
                prevClose={activeStock.close - activeStock.chg}
              />
            )}

            {/* 3. 消息面 */}
            <div className="bg-white rounded-2xl shadow-sm p-4 sm:p-5">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <h3 className="text-sm font-bold text-slate-600">📰 消息面 · 時事新聞</h3>
              </div>
              {newsLoading ? (
                <div className="text-sm text-slate-500 text-center py-6">
                  <span className="inline-block w-5 h-5 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin align-middle mr-2"></span>
                  抓取最新消息…
                </div>
              ) : activeStock.news.length > 0 ? (
                <>
                  <div className={`border rounded-xl p-3 mb-3 ${activeStock.newsSentiment.cls}`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xl">{activeStock.newsSentiment.emoji}</span>
                      <span className="font-black">近期消息面：{activeStock.newsSentiment.tag}</span>
                      <span className="text-xs opacity-75">（總分 {activeStock.newsScore >= 0 ? '+' : ''}{activeStock.newsScore}・依標題關鍵字粗略判斷）</span>
                    </div>
                  </div>
                  <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
                    {activeStock.news.map(item => (
                      <a key={item.id} href={item.link} target="_blank" rel="noopener noreferrer"
                        className="block p-3 hover:bg-slate-50 transition border-b border-slate-100 last:border-b-0">
                        <div className="flex items-start gap-2">
                          <span className={`px-2 py-0.5 ${item.cls} rounded text-[10px] font-bold whitespace-nowrap shrink-0 mt-0.5`}>{item.tag}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-slate-800 leading-snug">{item.title}</div>
                            <div className="text-xs text-slate-400 mt-1">
                              {item.source && <span className="font-bold text-slate-500">{item.source} · </span>}
                              <span>{item.time}</span>
                            </div>
                          </div>
                        </div>
                      </a>
                    ))}
                  </div>
                  <p className="text-xs text-slate-400 mt-2 text-center">來源：Google 新聞・點任一則開新分頁查看原文</p>
                </>
              ) : (
                <p className="text-sm text-slate-500 text-center py-4">查無相關新聞</p>
              )}
            </div>

            {/* 4. 圖表（Recharts） */}
            <div className="bg-white rounded-2xl shadow-sm p-4 sm:p-5">
              <h3 className="text-sm font-bold text-slate-600 mb-3">📊 近半年股價 + 均線</h3>
              <div className="w-full h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickMargin={10} minTickGap={30} />
                    <YAxis domain={['auto','auto']} orientation="right" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                    <RechartsTooltip contentStyle={{ borderRadius:'8px', border:'none', boxShadow:'0 4px 6px -1px rgb(0 0 0 / 0.1)', fontSize:'12px' }}
                      formatter={(val: any) => [Number(val).toFixed(2)]}/>
                    <Legend verticalAlign="bottom" height={36} iconType="plainline" wrapperStyle={{ fontSize:'11px' }} />
                    {selectedDate && <ReferenceLine x={selectedDate} stroke="#2563eb" strokeDasharray="5 3" strokeWidth={2} />}
                    <Line type="monotone" dataKey="price" name="收盤" stroke="#1e40af" strokeWidth={2} dot={false} activeDot={{ r:4 }} connectNulls />
                    <Line type="monotone" dataKey="ma5"   name="MA5"  stroke="#dc2626" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
                    <Line type="monotone" dataKey="ma20"  name="MA20" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
                    <Line type="monotone" dataKey="ma60"  name="MA60" stroke="#10b981" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 5. 每日數據表 */}
            <div className="bg-white rounded-2xl shadow-sm p-4 sm:p-5">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                <h3 className="text-sm font-bold text-slate-600">📋 每日數據表（點任一列在圖上標示）</h3>
                <div className="flex gap-1 text-xs">
                  {(['30','60','90','all'] as const).map(r => (
                    <button key={r} onClick={() => setTableRange(r)}
                      className={`px-3 py-1.5 rounded-lg font-bold transition-all ${tableRange === r ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                      {r === 'all' ? '全部' : `近 ${r} 天`}
                    </button>
                  ))}
                </div>
              </div>
              <div className="overflow-auto rounded-lg border border-slate-100 max-h-[460px]">
                <table className="w-full text-xs whitespace-nowrap">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-slate-600 shadow-sm">
                    <tr>
                      <th className="px-2.5 py-2 text-left font-bold">日期</th>
                      <th className="px-2.5 py-2 text-right font-bold">收盤</th>
                      <th className="px-2.5 py-2 text-right font-bold">漲跌</th>
                      <th className="px-2.5 py-2 text-right font-bold">%</th>
                      <th className="px-2.5 py-2 text-right font-bold">MA5</th>
                      <th className="px-2.5 py-2 text-right font-bold">MA20</th>
                      <th className="px-2.5 py-2 text-right font-bold">MA60</th>
                      <th className="px-2.5 py-2 text-right font-bold">K / D</th>
                      <th className="px-2.5 py-2 text-right font-bold">RSI</th>
                      <th className="px-2.5 py-2 text-center font-bold">訊號</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {tableData.map((day, idx) => {
                      const isLatest = idx === 0;
                      const isSelected = selectedDate === day.date;
                      const an = activeStock.an;
                      const i = activeStock.historyData.length - 1 - idx;

                      // 訊號
                      const badges: React.ReactNode[] = [];
                      if (i > 0 && an.ma5Arr[i] != null && an.ma20Arr[i] != null && an.ma5Arr[i-1] != null && an.ma20Arr[i-1] != null) {
                        if (an.ma5Arr[i-1]! <= an.ma20Arr[i-1]! && an.ma5Arr[i]! > an.ma20Arr[i]!)
                          badges.push(<span key="g" className="px-1.5 py-0.5 bg-red-500 text-white rounded text-[10px] font-bold">金叉</span>);
                        else if (an.ma5Arr[i-1]! >= an.ma20Arr[i-1]! && an.ma5Arr[i]! < an.ma20Arr[i]!)
                          badges.push(<span key="d" className="px-1.5 py-0.5 bg-green-600 text-white rounded text-[10px] font-bold">死叉</span>);
                      }
                      if (day.rsiVal != null && day.rsiVal > 70) badges.push(<span key="ob" className="px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded text-[10px] font-bold">超買</span>);
                      else if (day.rsiVal != null && day.rsiVal < 30) badges.push(<span key="os" className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-bold">超賣</span>);
                      if (day.kVal > 80 && (day.rsiVal == null || day.rsiVal <= 70)) badges.push(<span key="kh" className="px-1.5 py-0.5 bg-orange-50 text-orange-600 rounded text-[10px] font-bold">K高</span>);
                      else if (day.kVal < 20 && (day.rsiVal == null || day.rsiVal >= 30)) badges.push(<span key="kl" className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-[10px] font-bold">K低</span>);

                      return (
                        <tr key={day.date}
                          onClick={() => setSelectedDate(isSelected ? null : day.date)}
                          className={`cursor-pointer border-b border-slate-100 transition-colors
                            ${isLatest ? 'bg-yellow-50 font-bold' : 'hover:bg-blue-50'}
                            ${isSelected ? 'ring-2 ring-inset ring-blue-400 bg-blue-50' : ''}`}>
                          <td className="px-2.5 py-2 font-mono text-slate-700">
                            {day.date}
                            {isLatest && <span className="text-[10px] text-yellow-600 ml-1">(最新)</span>}
                          </td>
                          <td className="px-2.5 py-2 text-right font-bold text-slate-800">{day.price.toFixed(2)}</td>
                          <td className={`px-2.5 py-2 text-right ${day.chg > 0 ? 'text-red-600' : day.chg < 0 ? 'text-green-600' : 'text-slate-400'}`}>
                            {day.chg > 0 ? '▲' : day.chg < 0 ? '▼' : '–'} {Math.abs(day.chg).toFixed(2)}
                          </td>
                          <td className={`px-2.5 py-2 text-right ${day.chg > 0 ? 'text-red-600' : day.chg < 0 ? 'text-green-600' : 'text-slate-400'}`}>
                            {day.chg > 0 ? '▲' : day.chg < 0 ? '▼' : '–'} {Math.abs(day.chgPct).toFixed(2)}%
                          </td>
                          <td className="px-2.5 py-2 text-right text-slate-500">{day.ma5 != null ? day.ma5.toFixed(2) : <span className="text-slate-300">—</span>}</td>
                          <td className="px-2.5 py-2 text-right text-slate-500">{day.ma20 != null ? day.ma20.toFixed(2) : <span className="text-slate-300">—</span>}</td>
                          <td className="px-2.5 py-2 text-right text-slate-500">{day.ma60 != null ? day.ma60.toFixed(2) : <span className="text-slate-300">—</span>}</td>
                          <td className="px-2.5 py-2 text-right text-slate-500">{day.kVal.toFixed(0)} / {day.dVal.toFixed(0)}</td>
                          <td className="px-2.5 py-2 text-right text-slate-500">{day.rsiVal != null ? day.rsiVal.toFixed(0) : <span className="text-slate-300">—</span>}</td>
                          <td className="px-2.5 py-2 text-center"><div className="flex flex-wrap gap-1 justify-center">{badges}</div></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-400 mt-2">
                🔴 漲（台股慣例）／🟢 跌・<span className="font-bold">金叉</span>=黃金交叉・<span className="font-bold">死叉</span>=死亡交叉・點任一列圖表上方會標示日期
              </p>
            </div>

            {/* 6. 六格指標卡片 */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { label:'收盤價', value:fmt(activeStock.an.close), hint:null },
                { label:'MA5 (週線)', value:fmt(activeStock.an.ma5), hint: activeStock.an.ma5 != null ? (activeStock.an.close > activeStock.an.ma5 ? '股價在上 ↑' : '股價在下 ↓') : null },
                { label:'MA20 (月線)', value:fmt(activeStock.an.ma20), hint: activeStock.an.ma20 != null ? (activeStock.an.close > activeStock.an.ma20 ? '股價在上 ↑' : '股價在下 ↓') : null },
                { label:'MA60 (季線)', value:fmt(activeStock.an.ma60), hint: activeStock.an.ma60 != null ? (activeStock.an.close > activeStock.an.ma60 ? '股價在上 ↑' : '股價在下 ↓') : null },
                { label:'K / D', value:`${fmt(activeStock.an.k, 0)} / ${fmt(activeStock.an.d, 0)}`, hint: activeStock.an.k > activeStock.an.d ? 'K 在 D 之上 ↑' : 'K 在 D 之下 ↓' },
                { label:'RSI(14)', value:fmt(activeStock.an.rsi, 0), hint: activeStock.an.rsi != null ? (activeStock.an.rsi > 70 ? '偏高 ⚠️' : activeStock.an.rsi < 30 ? '偏低 ⚠️' : '合理') : null },
              ].map(card => (
                <div key={card.label} className="bg-white rounded-xl p-3 shadow-sm">
                  <div className="text-xs text-slate-500">{card.label}</div>
                  <div className="text-lg font-black text-slate-800 mt-0.5">{card.value}</div>
                  {card.hint && <div className="text-xs text-slate-400 mt-0.5">{card.hint}</div>}
                </div>
              ))}
            </div>

            {/* 7. 訊號摘要 */}
            <div className="bg-white rounded-2xl shadow-sm p-4 sm:p-5">
              <h3 className="text-sm font-bold text-slate-600 mb-3">📝 訊號摘要</h3>
              <ul className="space-y-1.5 text-sm text-slate-700">
                {activeStock.an.reasons.map((r, i) => (
                  <li key={i} className="flex items-start gap-2"><span className="text-blue-400">•</span><span>{r}</span></li>
                ))}
              </ul>
              <p className="text-xs text-slate-400 mt-3 pt-3 border-t border-slate-100">
                技術指標分數：{activeStock.an.score >= 0 ? '+' : ''}{activeStock.an.score}（≥3 偏多 / ≤-3 偏空 / 其他盤整）
              </p>
            </div>
          </div>
        )}

        {/* Disclaimer */}
        <footer className="mt-10 text-center text-xs text-slate-400 leading-relaxed pb-6">
          <p className="font-bold text-slate-500">⚠️ 免責聲明</p>
          <p className="mt-1">本網站僅依據歷史價格計算技術指標，<b>不構成投資建議</b>，亦無法保證未來走勢。</p>
          <p>投資有風險，請自行判斷並承擔結果。資料來源：FinMind（每日收盤）/ TWSE MIS（盤中即時）/ Google 新聞（消息面）。</p>
        </footer>

      </div>
    </main>
  );
}
