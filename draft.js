'use strict';
const draftKey = 'textscene-draft-v1';
let draftReady = false, draftDatabase;
const unsavedImages = new Set();
function draftStatus(message) { $('#draftStatus').textContent = message; }
function openDraftDatabase() {
  if (!draftDatabase) draftDatabase = new Promise((resolve, reject) => {
    const request = indexedDB.open('textscene-images', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('images');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Image storage is blocked'));
  }).catch(error => { draftDatabase = null; throw error; });
  return draftDatabase;
}
async function imageTransaction(mode, action) {
  const database = await openDraftDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('images', mode);
    const request = action(transaction.objectStore('images'));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error('Image storage failed'));
  });
}
async function persistDraftImage(target, file) {
  draftStatus('사진을 자동 저장하는 중…');
  try {
    if (file === undefined) throw new Error('Missing original image');
    await imageTransaction('readwrite', store => file === null ? store.delete(target) : store.put(file, target));
    unsavedImages.delete(target);
  } catch {
    unsavedImages.add(target);
    draftStatus('사진 자동 저장에 실패했어요. 브라우저 저장 공간을 확인해 주세요.');
  }
}
function saveDraft() {
  if (!draftReady) return;
  const {image, outer, ...settings} = state;
  const {image: outerImage, ...outerSettings} = outer;
  const draft = {version:1, settings, outer:outerSettings, hasImage:!!image, hasOuterImage:!!outerImage,
    previewMode, gifSize:$('#gifSize').value};
  try {
    // Small settings are written synchronously so even an immediate refresh retains typing.
    localStorage.setItem(draftKey, JSON.stringify(draft));
    draftStatus(unsavedImages.size ? '문자와 설정은 저장됐지만 일부 사진은 저장되지 않았어요.' : '자동 저장됨 · 같은 브라우저에서 이어서 편집할 수 있어요.');
  } catch {
    draftStatus('자동 저장에 실패했어요. 브라우저의 저장 공간과 설정을 확인해 주세요.');
  }
}
function restoreDraftSettings(draft) {
  if (draft?.version !== 1 || !draft.settings || !draft.outer) throw new Error('Invalid saved draft');
  const saved = draft.settings, outer = draft.outer;
  const number = (value, fallback, min, max) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  const crop = (value, height) => ({zoom:number(value?.zoom,1,1,4),x:number(value?.x,0,-100000,100000),y:number(value?.y,0,-100000,100000),baseW:360,baseH:height});
  state.language = saved.language === 'en' ? 'en' : 'ko';
  state.time = normalizeClock(saved.time) || state.time;
  if (typeof saved.dateValue === 'string' && dateLabel(saved.dateValue)) state.dateValue = saved.dateValue;
  state.date = dateLabel(state.dateValue);
  state.showStatus = saved.showStatus !== false;
  for (const [key,min,max] of [['dim',0,80],['opacity',0,100],['blur',0,40],['interval',.7,2.5]]) state[key] = number(saved[key],state[key],min,max);
  if (Array.isArray(saved.messages) && saved.messages.length) state.messages = saved.messages.slice(0,4).map(message => ({
    sender:String(message?.sender ?? '').slice(0,60), body:String(message?.body ?? '').slice(0,500), receivedTime:String(message?.receivedTime ?? '').slice(0,40)
  }));
  state.crop = crop(saved.crop,780); state.fileName = typeof saved.fileName === 'string' ? saved.fileName : '';
  state.outer.crop = crop(outer.crop,360); state.outer.fileName = typeof outer.fileName === 'string' ? outer.fileName : '';
  state.outer.dim = number(outer.dim,0,0,80);
  state.outer.gradientEnabled = outer.gradientEnabled !== false;
  state.outer.gradientColor = /^#[0-9a-f]{6}$/i.test(outer.gradientColor) ? outer.gradientColor : '#000000';
  state.outer.gradientLength = number(outer.gradientLength,70,0,100);
  state.outer.gradientDirection = ['left','right','top','bottom'].includes(outer.gradientDirection) ? outer.gradientDirection : 'right';
  previewMode = draft.previewMode === 'screen' ? 'screen' : 'full';
  $('#gifSize').value = ['540','720','1080'].includes(draft.gifSize) ? draft.gifSize : '540';
}
async function restoreDraftImage(target) {
  const file = await imageTransaction('readonly', store => store.get(target));
  if (!(file instanceof Blob)) throw new Error('Saved image is missing');
  const image = new Image(), url = URL.createObjectURL(file);
  try {
    await new Promise((resolve,reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
    imageFiles.set(image,file);
    if (target === 'outer') state.outer.image = image; else state.image = image;
  } finally { URL.revokeObjectURL(url); }
}
function syncDraftControls() {
  $('#timeInput').value = state.time; $('#dateInput').value = state.dateValue; $('#statusToggle').checked = state.showStatus;
  for (const [id,value,unit] of [['dim',state.dim,'%'],['opacity',state.opacity,'%'],['blur',state.blur,'px'],['interval',state.interval,'초'],['outerDim',state.outer.dim,'%'],['gradientLength',state.outer.gradientLength,'%']]) {
    const input = $('#'+id+'Range'); input.value = value; rangeStyle(input); $('#'+id+'Output').textContent = value+unit;
  }
  $('#gradientToggle').checked = state.outer.gradientEnabled; $('#gradientColor').value = state.outer.gradientColor; $('#gradientDirection').value = state.outer.gradientDirection;
  document.querySelectorAll('[data-lang]').forEach(button => { const active = button.dataset.lang === state.language; button.classList.toggle('active',active); button.setAttribute('aria-pressed',String(active)); });
  $('#fileName').textContent = state.image ? state.fileName : '사진을 불러와 나만의 배경을 만들어 보세요';
  $('#outerFileName').textContent = state.outer.image ? state.outer.fileName : '휴대폰 바깥에 들어갈 사진을 선택해 주세요';
  $('#recropButton').disabled = !state.image; $('#outerRecropButton').disabled = !state.outer.image;
  renderEditors(); buildBackground(); outerBackground = null; setPreview(previewMode); drawPreview();
}
async function restoreDraft() {
  const panel = $('.control-panel'); panel.inert = true; panel.setAttribute('aria-busy','true');
  try {
    const saved = localStorage.getItem(draftKey);
    if (saved) {
      const draft = JSON.parse(saved); restoreDraftSettings(draft);
      const targets = [draft.hasImage && 'screen', draft.hasOuterImage && 'outer'].filter(Boolean);
      const results = await Promise.allSettled(targets.map(restoreDraftImage));
      results.forEach((result,index) => { if (result.status === 'rejected') unsavedImages.add(targets[index]); });
      syncDraftControls();
      draftStatus(unsavedImages.size ? '일부 사진을 불러오지 못했어요. 사진을 다시 선택해 주세요.' : '이전에 편집하던 내용을 불러왔어요.');
    } else draftStatus('편집 내용이 이 브라우저에 자동 저장됩니다.');
  } catch {
    draftStatus('저장된 내용을 불러오지 못했어요. 새로 편집하면 현재 내용으로 저장됩니다.');
  } finally { draftReady = true; panel.inert = false; panel.setAttribute('aria-busy','false'); }
}
$('#gifSize').onchange = saveDraft;
const draftRestored = restoreDraft();
