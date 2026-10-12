export const BASE_WEIGHTS = { category: 30, location: 30, description: 25, date: 15 };
export const VISUAL_WEIGHTS = { category: 22.5, location: 22.5, description: 18.75, date: 11.25, visual: 25 };
export const MIN_PERCENT = 30;

const ALIASES = {
  bottle: "bottle", flask: "bottle", "water bottle": "bottle", sipper: "bottle",
  phone: "phone", mobile: "phone", smartphone: "phone", cellphone: "phone",
  bag: "bag", backpack: "bag", bagpack: "bag", "school bag": "bag",
  wallet: "wallet", purse: "wallet", id: "id card", "id card": "id card", idcard: "id card", card: "id card",
  laptop: "laptop", "notebook computer": "laptop", earphones: "earphones", earphone: "earphones",
  headphones: "earphones", earbuds: "earphones", airpods: "earphones", keys: "keys", key: "keys",
  keychain: "keys", watch: "watch", wristwatch: "watch"
};
const STOP_WORDS = new Set(["a","an","the","is","of","with","and","in","on","at","my","has","have","it","its","to","found","lost","item","object","unknown","ek","hai","ka","ki"]);
const clean = value => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const known = value => { const v = clean(value); return v && !["unknown","n/a","none"].includes(v) ? v : ""; };
const words = value => clean(value).match(/[a-z0-9]+/g) ?? [];

function editSimilarity(a,b) {
  a=clean(a); b=clean(b); if(!a||!b)return 0; if(a===b)return 1;
  const row=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++) { let diagonal=row[0]; row[0]=i; for(let j=1;j<=b.length;j++){const old=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,diagonal+(a[i-1]===b[j-1]?0:1));diagonal=old;} }
  return 1-row[b.length]/Math.max(a.length,b.length);
}
function jaccard(a,b) {
  const left=new Set((Array.isArray(a)?a:[a]).filter(Boolean).flatMap(words).filter(w=>!STOP_WORDS.has(w)));
  const right=new Set((Array.isArray(b)?b:[b]).filter(Boolean).flatMap(words).filter(w=>!STOP_WORDS.has(w)));
  if(!left.size||!right.size)return null; let overlap=0; for(const word of left)if(right.has(word))overlap++;
  return overlap/new Set([...left,...right]).size;
}
function profileOf(item) {
  const p=item?.visual_profile;
  if(!p||typeof p!=="object"||Array.isArray(p))return null;
  const vals=[p.category_guess,p.object,p.visual_description,p.material,p.shape,p.brand_or_logo,...(p.colors||[]),...(p.tags||[]),...(p.distinctive_features||[])];
  return vals.some(known)?p:null;
}
export function categoryScore(lost,found) {
  const a=ALIASES[clean(lost.category)]??clean(lost.category), b=ALIASES[clean(found.category)]??clean(found.category);
  let score=a===b?1:(editSimilarity(a,b)>.8?editSimilarity(a,b):0);
  const pa=profileOf(lost),pb=profileOf(found), va=known(pa?.category_guess||pa?.object),vb=known(pb?.category_guess||pb?.object);
  if(va&&vb)score=Math.max(score,editSimilarity(va,vb)*.95);
  return score;
}
export function locationScore(lost,found) { const a=clean(lost.location),b=clean(found.location); if(!a||!b)return 0;if(a===b)return 1;if(a.includes(b)||b.includes(a))return .8;return editSimilarity(a,b)*.6; }
export function descriptionScore(lost,found) {
  const a=new Set(words(lost.description).filter(w=>!STOP_WORDS.has(w))),b=new Set(words(found.description).filter(w=>!STOP_WORDS.has(w)));
  let base=0;if(a.size&&b.size){let overlap=0;for(const w of a)if(b.has(w))overlap++;base=overlap/new Set([...a,...b]).size;}
  const pa=profileOf(lost),pb=profileOf(found);if(!pa||!pb)return base;
  const ta=[pa.visual_description,pa.brand_or_logo,pa.material,pa.shape,...(pa.distinctive_features||[]),...(pa.text_detected||[])].map(known).filter(Boolean).join(" ");
  const tb=[pb.visual_description,pb.brand_or_logo,pb.material,pb.shape,...(pb.distinctive_features||[]),...(pb.text_detected||[])].map(known).filter(Boolean).join(" ");
  return ta&&tb?Math.max(base,.75*base+.25*editSimilarity(ta,tb)):base;
}
export function dateScore(lost,found) {
  const a=Date.parse(String(lost.date||"").slice(0,10)+"T00:00:00Z"),b=Date.parse(String(found.date||"").slice(0,10)+"T00:00:00Z");
  if(!Number.isFinite(a)||!Number.isFinite(b))return 0;const gap=Math.abs(Math.round((b-a)/86400000));return gap>7?0:Math.max(0,1-gap/7);
}
export function visualScore(lost,found) {
  const a=profileOf(lost),b=profileOf(found);if(!a||!b)return null;
  const ao=known(a.category_guess||a.object),bo=known(b.category_guess||b.object);const object=ao&&bo?Math.max(editSimilarity(ao,bo),jaccard(ao,bo)||0):null;
  const colors=jaccard(a.colors||[],b.colors||[]);
  const tagsA=[...(a.tags||[]),...(a.distinctive_features||[]),a.material,a.shape].map(known).filter(Boolean);
  const tagsB=[...(b.tags||[]),...(b.distinctive_features||[]),b.material,b.shape].map(known).filter(Boolean);const tags=jaccard(tagsA,tagsB);
  const ba=known(a.brand_or_logo),bb=known(b.brand_or_logo),brand=ba&&bb?editSimilarity(ba,bb):null;
  const parts=[[object,.3],[colors,.2],[tags,.4],[brand,.1]].filter(([v])=>v!==null);if(!parts.length)return null;
  const denom=parts.reduce((s,p)=>s+p[1],0);return parts.reduce((s,[v,w])=>s+v*w,0)/denom;
}
export function calculateMatch(lost,found) {
  const visual=visualScore(lost,found);const scores={category:categoryScore(lost,found),location:locationScore(lost,found),description:descriptionScore(lost,found),date:dateScore(lost,found)};
  if(visual!==null){scores.visual=visual;const base=Object.keys(BASE_WEIGHTS).reduce((s,k)=>s+scores[k]*BASE_WEIGHTS[k]*.75,0);return {percent:Number((base+visual*25).toFixed(1)),scores,weights:{...VISUAL_WEIGHTS},visual_used:true};}
  return {percent:Number(Object.keys(BASE_WEIGHTS).reduce((s,k)=>s+scores[k]*BASE_WEIGHTS[k],0).toFixed(1)),scores,weights:{...BASE_WEIGHTS},visual_used:false};
}
export function findMatches(lostItems,foundItems){const out=[];for(const lost of lostItems)for(const found of foundItems){const r=calculateMatch(lost,found);if(r.percent>=MIN_PERCENT)out.push({...r,lost,found});}return out.sort((a,b)=>b.percent-a.percent);}
