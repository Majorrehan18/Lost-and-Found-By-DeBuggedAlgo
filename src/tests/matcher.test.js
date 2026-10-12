import test from "node:test";
import assert from "node:assert/strict";
import { calculateMatch, findMatches, visualScore } from "../lib/matcher.js";
const lost={id:"lost",kind:"lost",category:"Bottle",location:"Library",date:"2026-10-12",description:"black steel water bottle with a silver cap"};
const found={id:"found",kind:"found",category:"Flask",location:"Library",date:"2026-10-12",description:"black bottle with silver cap found at the library"};
test("Bottle and Flask are aliases",()=>assert.equal(calculateMatch(lost,found).scores.category,1));
test("similar reports receive a high baseline score",()=>assert.ok(calculateMatch(lost,found).percent>=75));
test("match list is sorted and filters out low scores",()=>{const other={...found,id:"other",category:"Wallet",location:"Parking",description:"brown leather wallet"};const result=findMatches([lost],[other,found]);assert.equal(result[0].found.id,"found");assert.ok(result.every(x=>x.percent>=30));});
test("visual score is used only when both reports have profiles",()=>{assert.equal(visualScore(lost,found),null);const profile={category_guess:"water bottle",object:"bottle",colors:["black","silver"],material:"steel",shape:"cylindrical",brand_or_logo:"unknown",distinctive_features:["silver screw cap"],tags:["drinkware"]};const a={...lost,visual_profile:profile},b={...found,visual_profile:{...profile}};assert.ok(visualScore(a,b)>.7);assert.equal(calculateMatch(a,b).visual_used,true);});
