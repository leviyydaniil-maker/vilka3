
const K = {
  enabled: 'rzEnabled',
  enableRating: 'rzEnableRating',
  ratingMin: 'rzRatingMin',
  ratingMax: 'rzRatingMax',
  enableReviews: 'rzEnableReviews',
  reviewsMin: 'rzReviewsMin',
  reviewsMax: 'rzReviewsMax',
  hideNoReviews: 'rzHideNoReviews',
  enablePrice: 'rzEnablePrice',
  priceMin: 'rzPriceMin',
  priceMax: 'rzPriceMax',
  enableTopOnly: 'rzEnableTopOnly',
};
function toNumOrNull(v){ if(v===''||v==null) return null; const n=Number(v); return Number.isNaN(n)?null:n; }

function setDisabled(groupId, enabled){
  const group = document.getElementById(groupId);
  if (!group) return;
  const inputs = group.querySelectorAll('input[type="number"]');
  inputs.forEach(i => i.disabled = !enabled);
  group.classList.toggle('group-disabled', !enabled);
}

async function load(){
  const defaults = {
    [K.enabled]: true,
    [K.enableRating]: false, [K.ratingMin]: null, [K.ratingMax]: null,
    [K.enableReviews]: false, [K.reviewsMin]: null, [K.reviewsMax]: null,
    [K.hideNoReviews]: false,
    [K.enablePrice]: false, [K.priceMin]: null, [K.priceMax]: null,
    [K.enableTopOnly]: false,
  };
  const res = await chrome.storage.sync.get(defaults);
  // main switch
  document.getElementById('enabled').checked = !!res[K.enabled];

  // toggles
  const tr = !!res[K.enableRating]; document.getElementById('enableRating').checked = tr;
  const rr = !!res[K.enableReviews]; document.getElementById('enableReviews').checked = rr;
  const pr = !!res[K.enablePrice];  document.getElementById('enablePrice').checked  = pr;
  const top = !!res[K.enableTopOnly];document.getElementById('enableTopOnly').checked = top;
  document.getElementById('hideNoReviews').checked = !!res[K.hideNoReviews];

  // values
  document.getElementById('ratingMin').value  = res[K.ratingMin]  ?? '';
  document.getElementById('ratingMax').value  = res[K.ratingMax]  ?? '';
  document.getElementById('reviewsMin').value = res[K.reviewsMin] ?? '';
  document.getElementById('reviewsMax').value = res[K.reviewsMax] ?? '';
  document.getElementById('priceMin').value   = res[K.priceMin]   ?? '';
  document.getElementById('priceMax').value   = res[K.priceMax]   ?? '';

  // disable inputs if toggles off
  setDisabled('ratingGroup', tr);
  setDisabled('reviewsGroup', rr);
  setDisabled('priceGroup', pr);
}
async function save(){
  const payload = {
    enabled: document.getElementById('enabled').checked,
    enableTopOnly: document.getElementById('enableTopOnly').checked,
    enableRating: document.getElementById('enableRating').checked,
    ratingMin: toNumOrNull(document.getElementById('ratingMin').value),
    ratingMax: toNumOrNull(document.getElementById('ratingMax').value),
    enableReviews: document.getElementById('enableReviews').checked,
    reviewsMin: toNumOrNull(document.getElementById('reviewsMin').value),
    reviewsMax: toNumOrNull(document.getElementById('reviewsMax').value),
    hideNoReviews: document.getElementById('hideNoReviews').checked,
    enablePrice: document.getElementById('enablePrice').checked,
    priceMin: toNumOrNull(document.getElementById('priceMin').value),
    priceMax: toNumOrNull(document.getElementById('priceMax').value),
  };
  if (payload.ratingMin!==null && payload.ratingMax!==null && payload.ratingMin>payload.ratingMax) [payload.ratingMin,payload.ratingMax] = [payload.ratingMax,payload.ratingMin];
  if (payload.reviewsMin!==null && payload.reviewsMax!==null && payload.reviewsMin>payload.reviewsMax) [payload.reviewsMin,payload.reviewsMax] = [payload.reviewsMax,payload.reviewsMin];
  if (payload.priceMin!==null && payload.priceMax!==null && payload.priceMin>payload.priceMax) [payload.priceMin,payload.priceMax] = [payload.priceMax,payload.priceMin];

  const obj={}; for (const [k,v] of Object.entries(payload)) obj[K[k]] = v;
  await chrome.storage.sync.set(obj);
  const [tab] = await chrome.tabs.query({ active:true, currentWindow:true });
  if (tab?.id) { try { await chrome.tabs.sendMessage(tab.id, { type:'RZ_UPDATE_SETTINGS', payload }); } catch(e){} }
}

// Wire toggles to enable/disable their inputs instantly (no save yet)
function wireToggle(toggleId, groupId){
  const t = document.getElementById(toggleId);
  t.addEventListener('change', () => setDisabled(groupId, t.checked));
}
wireToggle('enableRating','ratingGroup');
wireToggle('enableReviews','reviewsGroup');
wireToggle('enablePrice','priceGroup');

document.getElementById('save').addEventListener('click', save);
document.getElementById('reset').addEventListener('click', async () => {
  document.getElementById('enabled').checked = true;
  ['enableTopOnly','enableRating','enableReviews','enablePrice','hideNoReviews'].forEach(id => document.getElementById(id).checked = false);
  ['ratingMin','ratingMax','reviewsMin','reviewsMax','priceMin','priceMax'].forEach(id => document.getElementById(id).value = '');
  setDisabled('ratingGroup', false);
  setDisabled('reviewsGroup', false);
  setDisabled('priceGroup', false);
  await save();
});

load();
