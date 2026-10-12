const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => Array.from(root.querySelectorAll(s));
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const todayLocal = () => { const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
let state={items:[],lost:[],found:[],matches:[],stats:{lost:0,found:0,total:0,matchCount:0},weights:{category:30,location:30,description:25,date:15},minPercent:30};
let recoveredRecords=[];
let recoveredFoundItems=[];

async function api(url,options={},authRetried=false){const r=await fetch(url,options);let body={};try{body=await r.json();}catch{}if(r.status===401&&body.adminRequired&&!authRetried){const password=window.prompt("CampusFind administrator password is required for this action:");if(password===null||!password.trim())throw new Error("Administrator sign-in was cancelled.");const login=await fetch("/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password})});let loginBody={};try{loginBody=await login.json();}catch{}if(!login.ok)throw new Error(loginBody.error||"Administrator sign-in failed.");return api(url,options,true);}if(!r.ok)throw new Error(body.details?body.details.join(" "):(body.error||`Request failed (${r.status}).`));return body;}
function notify(text,type="success"){ $("#notice").innerHTML=`<div class="notice ${type}">${esc(text)}</div>`;$("#notice").scrollIntoView({behavior:"smooth",block:"nearest"}); }
function navigate(page){$$('.page-view').forEach(v=>v.classList.toggle("active",v.id===`page-${page}`));$$('.nav-link').forEach(b=>b.classList.toggle("active",b.dataset.page===page));if(page==="home")renderLatest();if(page==="items")renderAll();if(page==="matches")renderMatches();if(page==="recovered")loadRecoveredRecords().catch(error=>notify(`Couldn't load recovered-item history: ${error.message}`,"error"));window.scrollTo({top:0,behavior:"smooth"});}
$$('[data-page]').forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.page)));
function gallery(images,compact=false){if(!Array.isArray(images)||!images.length)return "";const shown=compact?images.slice(0,1):images.slice(0,3);return `<div class="image-gallery ${compact?"compact":""}">${shown.map((im,i)=>`<a class="image-thumb" href="${esc(im.url)}" target="_blank" rel="noopener"><img src="${esc(im.url)}" alt="Item photo ${i+1}" loading="lazy"></a>`).join("")}</div>`;}
function profileLine(item){const p=item.visual_profile;if(!p)return "";const values=[p.category_guess,...(p.colors||[]).slice(0,3),p.material,p.shape,...(p.distinctive_features||[]).slice(0,2)].filter(v=>typeof v==="string"&&v.trim()&&v.toLowerCase()!=="unknown").slice(0,6);return values.length?`<p class="ai-profile-line"><strong>Photo recognition:</strong> ${esc(values.join(" · "))}</p>`:"";}
function itemCard(item,compact=false){const kind=item.kind==="found"?"found":"lost",icon=kind==="found"?"✓":"⌕";let ai="";if(item.vision_status==="analyzed")ai='<span class="chip ai-chip">AI vision analyzed</span>';else if(item.vision_status==="needs_setup")ai='<span class="chip ai-pending-chip">AI setup needed</span>';else if(item.vision_status==="failed")ai='<span class="chip ai-pending-chip">Analysis unavailable</span>';const analyze=!compact&&item.images?.length&&item.vision_status!=="analyzed"?`<button class="text-button" data-analyze="${esc(item.id)}">Analyze photos →</button>`:"";return `<article class="item-card"><div class="item-icon ${kind}">${icon}</div><div class="item-content"><div class="card-heading"><h3 class="item-title">${esc(item.category)}</h3><span class="chip ${kind}">${kind.toUpperCase()}</span>${ai}</div><p class="item-desc">${esc(item.description)}</p>${profileLine(item)}<div class="item-meta"><span>⌖ ${esc(item.location)}</span><span>◷ ${esc(item.date)}</span><span>By ${esc(item.person)}</span></div>${compact?"":`<div class="item-meta contact-line"><a href="tel:${esc(item.mobile)}">☎ ${esc(item.mobile)}</a></div>`}${gallery(item.images,compact)}</div><div class="item-buttons">${compact?"":`<button class="text-button" data-match="${esc(item.id)}">View matches →</button>`}${analyze}<button class="text-button delete" data-delete="${esc(item.id)}">Remove</button></div></article>`;}
function emptyState(title,desc,target="lost",button="Create a report"){return `<div class="empty-state"><div class="empty-icon">⌕</div><h3>${esc(title)}</h3><p>${esc(desc)}</p><button class="btn btn-primary" data-navigate="${target}">${esc(button)} →</button></div>`;}
function bindRendered(){ $$('[data-navigate]').forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.navigate)));$$('[data-match]').forEach(b=>b.addEventListener("click",()=>{navigate("matches");renderMatches(b.dataset.match);}));$$('[data-analyze]').forEach(b=>b.addEventListener("click",async()=>{const original=b.textContent;b.disabled=true;b.textContent="Analyzing…";try{await api(`/api/items/${encodeURIComponent(b.dataset.analyze)}/analyze`,{method:"POST"});await loadState();notify("Photo recognition finished. Match scores are refreshed.");navigate("matches");renderMatches(b.dataset.analyze);}catch(e){notify(e.message,"error");await loadState();}finally{if(b.isConnected){b.disabled=false;b.textContent=original;}}}));$$('[data-delete]').forEach(b=>b.addEventListener("click",async()=>{if(!confirm("Remove this report and its photos?"))return;try{await api(`/api/items/${encodeURIComponent(b.dataset.delete)}`,{method:"DELETE"});await loadState();notify("Report removed.");}catch(e){notify(e.message,"error");}})); }
function renderStats(){ $("#lost-count").textContent=state.stats.lost;$("#found-count").textContent=state.stats.found;$("#match-count").textContent=state.stats.matchCount;$("#total-count").textContent=state.stats.total;$("#nav-match-count").textContent=state.stats.matchCount?`(${state.stats.matchCount})`:""; }
function renderLatest(){const latest=state.items.slice(0,4);$("#latest-list").innerHTML=latest.length?latest.map(i=>itemCard(i,true)).join(""):emptyState("Your campus board starts here","There are no reports yet. Report a lost or found item to begin.","lost","Report a lost item");bindRendered();}
function renderAll(){const f=new FormData($("#item-filters")),q=String(f.get("q")||"").trim().toLowerCase(),kind=String(f.get("kind")||"");const rows=state.items.filter(i=>(!kind||i.kind===kind)&&(!q||[i.category,i.location,i.description,i.person,i.mobile].some(v=>String(v||"").toLowerCase().includes(q))));$("#all-list").innerHTML=rows.length?rows.map(i=>itemCard(i)).join(""):emptyState("No reports match your search","Try another search term or change the item-type filter.");bindRendered();}
function verdict(score){return score>=75?{label:"STRONG MATCH",cls:""}:score>=50?{label:"POSSIBLE MATCH",cls:"possible"}:{label:"LOWER MATCH",cls:"possible"};}
function matchCard(m,index){const lost=m.lost,found=m.found,score=Math.max(0,Math.min(100,Number(m.percent))),v=verdict(score),weights=m.weights||state.weights;const parts=[["Category",m.scores.category,weights.category],["Location",m.scores.location,weights.location],["Description",m.scores.description,weights.description],["Date",m.scores.date,weights.date]];if(m.visual_used&&Number.isFinite(Number(m.scores.visual)))parts.push(["Photo similarity",m.scores.visual,weights.visual||25]);const method=m.visual_used?"Gemini compared visible object type, colors, materials, shape and distinctive features. Visual similarity contributes 25% of this score.":"This score uses category, location, description and date. Photo similarity is included when both reports have AI-analyzed photos.";function pair(item,type){return `<section class="pair-card"><h4><span class="chip ${type}">${type.toUpperCase()}</span> ${type==="lost"?"Lost report":"Found report"}</h4><p><strong>${esc(item.category)}</strong> · ${esc(item.location)}</p><p>${esc(item.description)}</p>${profileLine(item)}<p>${esc(item.person)} · <a href="tel:${esc(item.mobile)}">${esc(item.mobile)}</a></p>${gallery(item.images)}</section>`;}return `<article class="match-card"><div class="match-head"><div class="score-circle" style="--score:${score}%"><div class="score-value"><strong>${score.toFixed(1)}%</strong><small>SIMILARITY</small></div></div><div><div class="match-title"><h3>Potential match #${index+1}</h3><span class="verdict ${v.cls}">${v.label}</span>${m.visual_used?'<span class="chip ai-chip">AI visual match</span>':""}</div><p class="item-desc method-text">${method} Verify distinctive details before returning an item.</p><div class="item-meta">Lost ${esc(lost.date)} · Found ${esc(found.date)}</div></div></div><div class="pair-grid">${pair(lost,"lost")}${pair(found,"found")}</div><div class="score-breakdown">${parts.map(([label,val,weight])=>`<div class="score-part"><span>${label} · ${weight}%</span><strong>${(Number(val)*Number(weight)).toFixed(1)} / ${weight}</strong></div>`).join("")}</div></article>`;}
function renderMatches(focusId=null){let rows=state.matches;if(focusId)rows=rows.filter(m=>m.lost.id===focusId||m.found.id===focusId);$("#matches-list").innerHTML=rows.length?rows.map(matchCard).join(""):emptyState("No matches yet","Add at least one lost and one found report. Pairs scoring 30% or more appear here.");bindRendered();}
async function loadState(){state=await api("/api/items");renderStats();renderLatest();renderAll();renderMatches();}
async function loadRecoveredRecords(){const result=await api("/api/recovered-items");recoveredRecords=result.records||[];recoveredFoundItems=result.foundItems||[];renderRecoveredOptions();renderRecovered();}
function renderRecoveredOptions(){const select=$("#recovery-item-name");if(!select)return;const current=select.value;select.innerHTML='<option value="">Choose a found-item report</option>'+recoveredFoundItems.map(item=>`<option value="${esc(item.id)}" ${item.alreadyRecovered?"disabled":""}>${esc(item.category)} · ${esc(item.location)} · ${esc(item.date)}${item.alreadyRecovered?" — already recorded as recovered":""}</option>`).join("");if(!recoveredFoundItems.length)select.innerHTML='<option value="">No found-item reports available yet</option>';else if(current&&recoveredFoundItems.some(item=>String(item.id)===String(current)&&!item.alreadyRecovered))select.value=current;}
function canvasBlob(canvas,quality){return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error("Could not compress this photo.")),"image/jpeg",quality));}
async function compressImage(file,options={}){if(!file||!String(file.type).startsWith("image/"))throw new Error("Please choose an image file.");const maxDimension=Number(options.maxDimension)||1400,maxBytes=Number(options.maxBytes)||650*1024;const dataUrl=await new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=()=>reject(new Error("Couldn't read that photo."));r.onload=()=>resolve(String(r.result));r.readAsDataURL(file);});const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error("This photo could not be opened. Try JPG or PNG."));img.src=dataUrl;});let w=image.naturalWidth,h=image.naturalHeight;if(!w||!h)throw new Error("This photo has invalid dimensions.");const scale=Math.min(1,maxDimension/Math.max(w,h));w=Math.max(1,Math.round(w*scale));h=Math.max(1,Math.round(h*scale));const canvas=document.createElement("canvas"),ctx=canvas.getContext("2d");if(!ctx)throw new Error("Image compression isn't supported by this browser.");for(let i=0;i<10;i++){canvas.width=w;canvas.height=h;ctx.fillStyle="#ffffff";ctx.fillRect(0,0,w,h);ctx.drawImage(image,0,0,w,h);const quality=Math.max(.4,.84-i*.06),blob=await canvasBlob(canvas,quality);if(blob.size<=maxBytes)return {blob,dataUrl:canvas.toDataURL("image/jpeg",quality),name:(file.name||"item-photo").replace(/\.[^.]+$/,"")+".jpg"};if(i%2===1){w=Math.max(1,Math.round(w*.82));h=Math.max(1,Math.round(h*.82));}}throw new Error("That photo is too large to compress. Choose a smaller photo.");}
function renderPreviews(form){const photos=form._photos||[],target=$("[data-image-previews]",form);$("[data-image-count]",form).textContent=photos.length;target.innerHTML=photos.map((p,i)=>`<div class="image-preview-card"><img src="${esc(p.dataUrl)}" alt="Selected item photo ${i+1}"><button type="button" class="image-remove" data-remove-photo="${i}" aria-label="Remove photo ${i+1}">×</button><div class="image-preview-label">${esc(p.name)}</div></div>`).join("");$$('[data-remove-photo]',target).forEach(b=>b.addEventListener("click",()=>{photos.splice(Number(b.dataset.removePhoto),1);renderPreviews(form);}));const picker=$(".image-input",form),drop=$(".upload-dropzone",form),isFound=form.dataset.kind==="found";picker.disabled=photos.length>=3;drop.classList.toggle("at-limit",photos.length>=3);drop.querySelector("strong").textContent=photos.length>=3?"3 photos selected":photos.length?"Add more photos":isFound?"Choose item photos":"Choose photos";drop.querySelector("small").textContent=photos.length>=3?"Remove a photo before adding another":isFound?"1–3 photos required · JPG, PNG, WebP":"Optional · up to 3 photos · JPG, PNG, WebP";}
$$('.item-form').forEach(form=>{form._photos=[];const date=$("input[name=date]",form),picker=$(".image-input",form);date.max=todayLocal();date.value=todayLocal();renderPreviews(form);picker.addEventListener("change",async()=>{const files=Array.from(picker.files||[]);picker.value="";const slots=Math.max(0,3-form._photos.length);if(files.length>slots)notify(`Only ${slots} additional photo(s) can be added. Maximum is 3.`,"error");for(const file of files.slice(0,slots)){try{form._photos.push(await compressImage(file));renderPreviews(form);}catch(e){notify(e.message,"error");}}});form.addEventListener("submit",async event=>{event.preventDefault();if(form.dataset.kind==="found"&&!form._photos.length){notify("A found-item report requires at least one photo.","error");picker.focus();return;}const button=$("button[type=submit]",form),payload=new FormData(form);payload.delete("photos");for(const p of form._photos)payload.append("photos",p.blob,p.name);button.disabled=true;const original=button.textContent;button.textContent=form._photos.length?"Saving and analyzing photos…":"Saving report…";try{const result=await api("/api/items",{method:"POST",body:payload});form.reset();form._photos=[];date.max=todayLocal();date.value=todayLocal();renderPreviews(form);await loadState();let msg=`${form.dataset.kind==="lost"?"Lost":"Found"} report saved.`;if(result.vision_status==="analyzed")msg+=" Gemini recognized the uploaded photo features.";else if(result.vision_status==="needs_setup")msg+=" Configure GEMINI_API_KEY in Vercel Environment Variables (cloud) or .env (local) to enable AI image recognition; basic matching still works.";else if(result.vision_status==="failed")msg+=" Image recognition was unavailable; retry it from All Items.";else msg+=" Add photos later to use visual matching.";if(!result.matches.length)msg+=" No pair currently reaches the 30% match threshold.";notify(msg,["needs_setup","failed"].includes(result.vision_status)?"error":"success");navigate("matches");renderMatches(result.item.id);}catch(e){notify(e.message,"error");}finally{button.disabled=false;button.textContent=original;}});});
$("#item-filters").addEventListener("submit",e=>{e.preventDefault();renderAll();});$("#reset-filters").addEventListener("click",()=>{$("#item-filters").reset();renderAll();});$("#home-demo").addEventListener("click",()=>notify("To test matching, create one lost report and one found report with similar category, location and description."));
$("#clear-all").addEventListener("click",async()=>{if(!confirm("Permanently clear all local reports and stored photos?"))return;if(!confirm("Confirm again: remove all reports?"))return;try{const r=await api("/api/items/clear",{method:"DELETE"});await loadState();notify(`Cleared ${r.deleted} report(s).`);}catch(e){notify(e.message,"error");}});
(async()=>{try{await loadState();}catch(e){notify(`Couldn't load the item board: ${e.message}`,"error");}})();

// Recovered-item records are stored separately from lost/found reports.
function recoveryPhotoGallery(record) {
  const photos = Array.isArray(record.idPhotos) ? record.idPhotos : [];
  return `<div class="recovery-photo-gallery">${photos.map((photo, index) => `<a class="recovery-photo-link" href="${esc(photo.url)}" target="_blank" rel="noopener"><img src="${esc(photo.url)}" alt="${esc(photo.label || `Student ID photo ${index + 1}`)}" loading="lazy"><span>${esc(photo.label || `ID photo ${index + 1}`)}</span></a>`).join("")}</div>`;
}
function recoveryRecordCard(record, index) {
  const date = esc(record.receivedAt || "Date not recorded");
  const itemDetails = record.itemDescription ? `<p>${esc(record.itemDescription)}</p>` : "";
  const notes = record.notes ? `<p class="recovery-notes"><strong>Handover notes:</strong> ${esc(record.notes)}</p>` : "";
  return `<article class="recovery-record"><div class="recovery-record-heading"><div class="recovery-record-title"><span class="recovery-index">RECOVERED ${String(index + 1).padStart(2, "0")}</span><h3>${esc(record.itemName)}</h3>${itemDetails}</div><div class="recovery-record-actions"><span class="chip">Received ${date}</span><button class="text-button delete" data-delete-recovery="${esc(record.id)}">Delete record</button></div></div><div class="recipient-grid"><div class="recipient-field"><span>Received by</span><strong>${esc(record.studentName)}</strong></div><div class="recipient-field"><span>Roll number</span><strong>${esc(record.rollNumber)}</strong></div><div class="recipient-field"><span>Course / programme</span><strong>${esc(record.course)}</strong></div></div>${notes}<div class="recovery-photo-heading"><strong>Saved ID-card photos</strong><span>Front and back</span></div>${recoveryPhotoGallery(record)}</article>`;
}
function renderRecovered() {
  const list = $("#recovered-list");
  if (!list) return;
  $("#recovered-count").textContent = recoveredRecords.length;
  list.innerHTML = recoveredRecords.length
    ? recoveredRecords.map(recoveryRecordCard).join("")
    : `<div class="empty-state"><div class="empty-icon">✓</div><h3>No recovered-item records yet</h3><p>When a recovered item is handed to a student, create a record above. This history will show handovers only, not lost/found reports.</p></div>`;
}

const recoveryForm = $("#recovery-form");
if (recoveryForm) {
  recoveryForm._idPhotos = { front: null, back: null };
  const recoveryDate = $("#recovery-date");
  const analyzeButton = $("#analyze-id-button");
  const analysisStatus = $("#id-analysis-status");
  const aiChip = $("#id-ai-chip");
  recoveryDate.max = todayLocal();
  recoveryDate.value = todayLocal();

  function setAnalysisStatus(text, tone = "") {
    analysisStatus.textContent = text;
    analysisStatus.classList.toggle("status-error", tone === "error");
    analysisStatus.classList.toggle("status-success", tone === "success");
  }
  function resetExtractedStudentFields() {
    $("#student-name").value = "";
    $("#student-roll").value = "";
    $("#student-course").value = "";
    aiChip.textContent = "REVIEW REQUIRED";
    aiChip.classList.remove("ai-chip");
    setAnalysisStatus("Upload both photos, then select ‘Read ID with Gemini’. Review the extracted values before saving.");
  }
  function renderIdPhoto(side) {
    const photo = recoveryForm._idPhotos[side];
    const preview = $(`#id-${side}-preview`);
    const label = $(`#id-${side}-label`);
    if (photo) {
      preview.innerHTML = `<img src="${esc(photo.dataUrl)}" alt="Preview of student ID ${side}"><button type="button" class="image-remove" data-clear-id-photo="${side}" aria-label="Remove ${side} ID photo">×</button><span>${esc(photo.name)}</span>`;
      label.textContent = side === "front" ? "Replace front photo" : "Replace back photo";
    } else {
      preview.innerHTML = `<span>No ${side} photo selected</span>`;
      label.textContent = side === "front" ? "Choose front photo" : "Choose back photo";
    }
    analyzeButton.disabled = !(recoveryForm._idPhotos.front && recoveryForm._idPhotos.back);
    $$('[data-clear-id-photo]', preview).forEach(button => button.addEventListener("click", () => {
      recoveryForm._idPhotos[side] = null;
      renderIdPhoto(side);
      resetExtractedStudentFields();
    }));
  }

  for (const side of ["front", "back"]) {
    $(`#id-${side}-picker`).addEventListener("change", async event => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      try {
        const compressed = await compressImage(file, { maxDimension: 1800, maxBytes: 1500 * 1024 });
        recoveryForm._idPhotos[side] = compressed;
        renderIdPhoto(side);
        resetExtractedStudentFields();
        if (recoveryForm._idPhotos.front && recoveryForm._idPhotos.back) {
          setAnalysisStatus("Both ID photos are ready. Select ‘Read ID with Gemini’ to extract the name, roll number and course.");
        }
      } catch (error) {
        notify(error.message, "error");
      }
    });
  }

  analyzeButton.addEventListener("click", async () => {
    const front = recoveryForm._idPhotos.front;
    const back = recoveryForm._idPhotos.back;
    if (!front || !back) return;
    analyzeButton.disabled = true;
    const oldText = analyzeButton.textContent;
    analyzeButton.textContent = "Reading ID cards…";
    setAnalysisStatus("Sending the two ID-card photos to Gemini for the three requested fields…");
    try {
      const payload = new FormData();
      payload.append("idPhotos", front.blob, front.name);
      payload.append("idPhotos", back.blob, back.name);
      const result = await api("/api/recovered-items/analyze-id", { method: "POST", body: payload });
      const student = result.student || {};
      $("#student-name").value = student.student_name || "";
      $("#student-roll").value = student.roll_number || "";
      $("#student-course").value = student.course || "";
      aiChip.textContent = "GEMINI READ · REVIEW";
      aiChip.classList.add("ai-chip");
      const confidence = Number.isFinite(Number(student.confidence)) ? ` Approx. confidence: ${Math.round(Number(student.confidence) * 100)}%.` : "";
      const note = student.legibility_notes ? ` ${student.legibility_notes}` : "";
      setAnalysisStatus(`Extraction finished. Verify every field against the card before saving.${confidence}${note}`, "success");
      $("#student-name").focus();
    } catch (error) {
      setAnalysisStatus(`${error.message} You can enter or correct the three required fields manually and still save the handover record.`, "error");
      aiChip.textContent = "MANUAL REVIEW";
      aiChip.classList.remove("ai-chip");
    } finally {
      analyzeButton.disabled = !(recoveryForm._idPhotos.front && recoveryForm._idPhotos.back);
      analyzeButton.textContent = oldText;
    }
  });

  recoveryForm.addEventListener("submit", async event => {
    event.preventDefault();
    const front = recoveryForm._idPhotos.front;
    const back = recoveryForm._idPhotos.back;
    if (!front || !back) {
      notify("Upload both the front and back of the student ID card.", "error");
      return;
    }
    const submitButton = $("#save-recovery");
    const originalText = submitButton.textContent;
    const payload = new FormData(recoveryForm);
    payload.append("idPhotos", front.blob, front.name);
    payload.append("idPhotos", back.blob, back.name);
    submitButton.disabled = true;
    submitButton.textContent = "Saving recovery record…";
    try {
      const result = await api("/api/recovered-items", { method: "POST", body: payload });
      recoveryForm.reset();
      recoveryForm._idPhotos = { front: null, back: null };
      recoveryDate.max = todayLocal();
      recoveryDate.value = todayLocal();
      renderIdPhoto("front");
      renderIdPhoto("back");
      resetExtractedStudentFields();
      await loadRecoveredRecords();
      notify(`Recovery record saved for ${result.record.studentName}. The record and both ID photos are now in Recovered Items history.`);
      navigate("recovered");
    } catch (error) {
      notify(error.message, "error");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = originalText;
    }
  });

  $("#recovered-list").addEventListener("click", async event => {
    const button = event.target.closest("[data-delete-recovery]");
    if (!button) return;
    if (!confirm("Permanently delete this recovered-item record and its two saved ID photos?")) return;
    button.disabled = true;
    try {
      await api(`/api/recovered-items/${encodeURIComponent(button.dataset.deleteRecovery)}`, { method: "DELETE" });
      await loadRecoveredRecords();
      notify("Recovered-item record and its ID photos deleted.");
    } catch (error) {
      notify(error.message, "error");
      button.disabled = false;
    }
  });
  renderIdPhoto("front");
  renderIdPhoto("back");
}


