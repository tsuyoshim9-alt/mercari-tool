/* =====================
   State
   ===================== */
const state = {
  images: [],           // [{id, dataUrl, compressedDataUrl, file}]
  selectedTitleIdx: 0,
  analysisData: null,
  activeKeywords: new Set(),
};

let nextImageId = 0;
let sortableInstance = null;
let previewDebounceTimer = null;

/* =====================
   DOM References
   ===================== */
const dropZone        = document.getElementById('dropZone');
const fileInput       = document.getElementById('fileInput');
const imageGallery    = document.getElementById('imageGallery');
const imageCountEl    = document.getElementById('imageCount');
const gallerySection  = document.getElementById('section-gallery');
const analyzeBtn      = document.getElementById('analyzeBtn');
const analyzeHint     = document.getElementById('analyzeHint');
const analysisInfo    = document.getElementById('analysisInfo');
const resultsSection  = document.getElementById('resultsSection');
const loadingOverlay  = document.getElementById('loadingOverlay');
const uploadError     = document.getElementById('uploadError');
const descriptionArea = document.getElementById('descriptionArea');
const descCharCount   = document.getElementById('descCharCount');

/* =====================
   Image Compression
   ===================== */
const MAX_LONG_EDGE = 1024;
const JPEG_QUALITY  = 0.75;
const MAX_API_IMGS  = 8;

function compressImage(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > MAX_LONG_EDGE || height > MAX_LONG_EDGE) {
        if (width >= height) {
          height = Math.round(height * MAX_LONG_EDGE / width);
          width  = MAX_LONG_EDGE;
        } else {
          width  = Math.round(width * MAX_LONG_EDGE / height);
          height = MAX_LONG_EDGE;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      // canvas.toDataURL strips EXIF automatically
      resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
    };
    img.onerror = () => resolve(dataUrl); // fallback to original
    img.src = dataUrl;
  });
}

async function ensureCompressed(img) {
  if (!img.compressedDataUrl) {
    img.compressedDataUrl = await compressImage(img.dataUrl);
  }
  return img.compressedDataUrl;
}

// Select up to maxCount images: always keep index-0 (main), then evenly sample the rest
function selectImagesForAPI(images, maxCount = MAX_API_IMGS) {
  if (images.length <= maxCount) return [...images];
  const result = [images[0]];
  const rest   = images.slice(1);
  const needed = maxCount - 1;
  for (let i = 0; i < needed; i++) {
    const idx = (needed === 1) ? 0 : Math.round(i * (rest.length - 1) / (needed - 1));
    result.push(rest[Math.min(idx, rest.length - 1)]);
  }
  return result;
}

// Base64 → byte count
function base64ToBytes(dataUrl) {
  const b64 = dataUrl.split(',')[1] || '';
  const padding = (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
  return Math.floor(b64.length * 3 / 4) - padding;
}

/* =====================
   Analysis Preview Info
   ===================== */
async function updateAnalysisPreview() {
  if (state.images.length === 0) {
    analysisInfo.hidden = true;
    return;
  }

  analysisInfo.textContent = '画像を最適化中...';
  analysisInfo.hidden = false;

  clearTimeout(previewDebounceTimer);
  previewDebounceTimer = setTimeout(async () => {
    const selected = selectImagesForAPI(state.images, MAX_API_IMGS);

    // Compress selected images (cache result on each image object)
    await Promise.all(selected.map(ensureCompressed));

    let totalBytes = 0;
    selected.forEach(img => { totalBytes += base64ToBytes(img.compressedDataUrl); });
    const sizeMB   = (totalBytes / 1024 / 1024).toFixed(1);
    const skipped  = state.images.length - selected.length;
    const skipNote = skipped > 0 ? `（${skipped}枚は省略）` : '';

    analysisInfo.textContent = `AI送信予定: ${selected.length}枚${skipNote} ／ 推定サイズ: ${sizeMB}MB`;
    analysisInfo.hidden = false;
  }, 400);
}

/* =====================
   File Upload
   ===================== */
fileInput.addEventListener('change', (e) => {
  processFiles(Array.from(e.target.files));
  fileInput.value = '';
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', (e) => {
  if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  processFiles(Array.from(e.dataTransfer.files));
});

dropZone.addEventListener('click', (e) => {
  if (e.target.tagName !== 'LABEL' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') {
    fileInput.click();
  }
});

function processFiles(files) {
  hideUploadError();

  const imageFiles = files.filter(f => f.type.startsWith('image/'));
  const nonImages  = files.filter(f => !f.type.startsWith('image/'));

  if (nonImages.length > 0) {
    showUploadError(`画像ファイル以外はアップロードできません（${nonImages.map(f => f.name).join(', ')}）`);
    if (imageFiles.length === 0) return;
  }

  const remaining = 20 - state.images.length;
  if (imageFiles.length > remaining) {
    showUploadError(`最大20枚までアップロードできます。${remaining > 0 ? remaining + '枚のみ追加されました。' : 'これ以上追加できません。'}`);
    if (remaining <= 0) return;
    imageFiles.splice(remaining);
  }

  Promise.all(imageFiles.map(loadImageAsBase64)).then(results => {
    results.forEach(({ dataUrl, file }) => {
      state.images.push({ id: nextImageId++, dataUrl, compressedDataUrl: null, file });
    });
    renderGallery();
    updateAnalyzeBtn();
    updateAnalysisPreview();
  });
}

function loadImageAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = (e) => resolve({ dataUrl: e.target.result, file });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* =====================
   Gallery
   ===================== */
function renderGallery() {
  imageCountEl.textContent = state.images.length;

  if (state.images.length === 0) {
    gallerySection.hidden = true;
    return;
  }

  gallerySection.hidden = false;

  imageGallery.innerHTML = state.images.map((img, i) => `
    <div class="gallery-item" data-id="${img.id}">
      ${i === 0 ? '<div class="main-badge">メイン</div>' : ''}
      <img src="${img.dataUrl}" alt="商品画像${i + 1}" loading="lazy">
      <button class="remove-btn" onclick="removeImage(${img.id})" title="削除">✕</button>
      <div class="image-number">${i + 1}</div>
    </div>
  `).join('');

  if (sortableInstance) sortableInstance.destroy();

  sortableInstance = Sortable.create(imageGallery, {
    animation: 150,
    ghostClass: 'sortable-ghost',
    onEnd: (evt) => {
      const moved = state.images.splice(evt.oldIndex, 1)[0];
      state.images.splice(evt.newIndex, 0, moved);
      renderGallery();
      updateAnalysisPreview();
    },
  });
}

function removeImage(id) {
  state.images = state.images.filter(img => img.id !== id);
  renderGallery();
  updateAnalyzeBtn();
  updateAnalysisPreview();
}

/* =====================
   Analyze Button State
   ===================== */
function updateAnalyzeBtn() {
  const has = state.images.length > 0;
  analyzeBtn.disabled = !has;
  analyzeHint.textContent = has
    ? `${state.images.length}枚の写真を解析します`
    : '写真をアップロードすると解析できます';
}

/* =====================
   Analysis
   ===================== */
analyzeBtn.addEventListener('click', analyzeImages);

async function analyzeImages() {
  if (state.images.length === 0) {
    showUploadError('写真をアップロードしてください');
    return;
  }

  loadingOverlay.hidden = false;
  analyzeBtn.disabled = true;

  try {
    // 1. Select up to MAX_API_IMGS images
    const selected = selectImagesForAPI(state.images, MAX_API_IMGS);

    // 2. Compress all selected (uses cached result if already compressed)
    await Promise.all(selected.map(ensureCompressed));

    const compressedUrls = selected.map(img => img.compressedDataUrl);

    // 3. Send to API
    const response = await fetch('/.netlify/functions/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images: compressedUrls }),
    });

    // 4. Handle 413 explicitly before parsing JSON
    if (response.status === 413) {
      throw new Error('画像容量が大きすぎます。枚数を減らすか、別の写真でお試しください。');
    }

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || 'AI解析に失敗しました');
    }

    state.analysisData = result.data;
    displayResults(result.data);

  } catch (err) {
    const msg = (err.name === 'TypeError' && err.message.includes('fetch'))
      ? '通信エラーが発生しました。インターネット接続を確認してください。'
      : (err.message || 'AI解析に失敗しました。もう一度お試しください。');
    showUploadError(msg);
  } finally {
    loadingOverlay.hidden = true;
    analyzeBtn.disabled = state.images.length === 0;
  }
}

/* =====================
   Display Results
   ===================== */
function displayResults(data) {
  resultsSection.hidden = false;

  renderCategoryInfo(data);
  renderSizeForm(data.category || '');
  renderTitles(data.titles || []);
  renderKeywords(data.keywords || []);

  descriptionArea.value = data.description || '';
  updateCharCount();

  setTimeout(() => {
    document.getElementById('section-category').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 150);
}

/* =====================
   Category / Info Grid
   ===================== */
const FIELD_CONFIG = [
  { key: 'category',     label: 'カテゴリ',        type: 'text' },
  { key: 'brand',        label: 'ブランド',         type: 'text' },
  { key: 'item_name',    label: '商品名',           type: 'text' },
  { key: 'color',        label: 'カラー',           type: 'text' },
  { key: 'material',     label: '素材',             type: 'text' },
  { key: 'pattern',      label: '柄・デザイン',     type: 'text' },
  { key: 'condition',    label: '状態',             type: 'select' },
  { key: 'size_info',    label: 'タグサイズ',       type: 'text' },
  { key: 'model_number', label: '型番・品番',       type: 'text' },
  { key: 'hardware',     label: '金具・ロゴなど',   type: 'textarea' },
  { key: 'damage',       label: '傷・汚れ・使用感', type: 'textarea' },
];

const CONDITIONS = [
  '新品同様',
  '未使用に近い',
  '目立った傷や汚れなし',
  'やや傷や汚れあり',
  '傷や汚れあり',
];

function renderCategoryInfo(data) {
  const grid = document.getElementById('categoryGrid');

  grid.innerHTML = FIELD_CONFIG.map(f => {
    const val  = data[f.key] || '';
    const wide = f.type === 'textarea' ? ' info-field-wide' : '';

    let input;
    if (f.type === 'select') {
      const opts = CONDITIONS.map(c =>
        `<option value="${esc(c)}" ${val === c ? 'selected' : ''}>${esc(c)}</option>`
      ).join('');
      input = `<select class="field-input" id="field_${f.key}" onchange="patchField('${f.key}', this.value)">${opts}</select>`;
    } else if (f.type === 'textarea') {
      input = `<textarea class="field-input field-textarea" id="field_${f.key}" rows="2" onchange="patchField('${f.key}', this.value)">${esc(val)}</textarea>`;
    } else {
      input = `<input type="text" class="field-input" id="field_${f.key}" value="${esc(val)}" onchange="patchField('${f.key}', this.value)">`;
    }

    return `<div class="info-field${wide}">
              <label class="field-label" for="field_${f.key}">${esc(f.label)}</label>
              ${input}
            </div>`;
  }).join('');
}

function patchField(key, value) {
  if (state.analysisData) state.analysisData[key] = value;
}

/* =====================
   Size Form
   ===================== */
const SIZE_FIELDS = {
  'バッグ': [
    { id: 'height',   label: '縦 (cm)' },
    { id: 'width',    label: '横 (cm)' },
    { id: 'depth',    label: 'マチ (cm)' },
    { id: 'handle',   label: '持ち手の長さ (cm)' },
    { id: 'shoulder', label: 'ショルダーベルト長さ (cm)' },
  ],
  'スーツ': [
    { id: 'shoulder',  label: '肩幅 (cm)' },
    { id: 'chest',     label: '身幅 (cm)' },
    { id: 'length',    label: '着丈 (cm)' },
    { id: 'sleeve',    label: '袖丈 (cm)' },
    { id: 'waist',     label: 'ウエスト (cm)' },
    { id: 'pts_waist', label: 'パンツ ウエスト (cm)' },
    { id: 'inseam',    label: '股下 (cm)' },
  ],
  '上着': [
    { id: 'shoulder', label: '肩幅 (cm)' },
    { id: 'chest',    label: '身幅 (cm)' },
    { id: 'length',   label: '着丈 (cm)' },
    { id: 'sleeve',   label: '袖丈 (cm)' },
  ],
  'パンツ': [
    { id: 'waist',  label: 'ウエスト (cm)' },
    { id: 'rise',   label: '股上 (cm)' },
    { id: 'thigh',  label: '渡り幅 (cm)' },
    { id: 'inseam', label: '股下 (cm)' },
    { id: 'hem',    label: '裾幅 (cm)' },
  ],
  'その他': [
    { id: 'note', label: 'サイズメモ' },
  ],
};

function getSizeCategoryKey(category) {
  if (!category) return 'その他';
  if (/バッグ|ポーチ|財布|クラッチ/.test(category)) return 'バッグ';
  if (/スーツ|セットアップ/.test(category)) return 'スーツ';
  if (/上着|ジャケット|コート|ブルゾン|アウター|カーディガン|パーカー/.test(category)) return '上着';
  if (/パンツ|スラックス|ボトム|デニム/.test(category)) return 'パンツ';
  return 'その他';
}

function renderSizeForm(category) {
  const form = document.getElementById('sizeForm');
  const key  = getSizeCategoryKey(category);
  const fields = SIZE_FIELDS[key] || SIZE_FIELDS['その他'];

  form.innerHTML = fields.map(f =>
    `<div class="size-field">
       <label class="size-label" for="size_${f.id}">${esc(f.label)}</label>
       <input type="text" class="size-input" id="size_${f.id}" placeholder="例: 30">
     </div>`
  ).join('');
}

document.getElementById('applySizeBtn').addEventListener('click', applySizeToDescription);

function applySizeToDescription() {
  const form   = document.getElementById('sizeForm');
  const inputs = form.querySelectorAll('input[id^="size_"]');

  const lines = [];
  inputs.forEach(input => {
    if (input.value.trim()) {
      const label = input.previousElementSibling.textContent;
      lines.push(`${label}: ${input.value.trim()}`);
    }
  });

  if (lines.length === 0) {
    alert('採寸情報を入力してください');
    return;
  }

  let desc = descriptionArea.value;
  const sizeText   = lines.join('\n');
  const sizeMarker = '○サイズ・採寸';

  if (desc.includes(sizeMarker)) {
    const start       = desc.indexOf(sizeMarker);
    const afterHeader = start + sizeMarker.length + 1;
    const nextSection = desc.indexOf('\n\n○', afterHeader);
    const end         = nextSection !== -1 ? nextSection : desc.length;
    desc = desc.slice(0, afterHeader) + sizeText + desc.slice(end);
  } else if (desc.includes('○購入元')) {
    desc = desc.replace('○購入元', `${sizeMarker}\n${sizeText}\n\n○購入元`);
  } else {
    desc += `\n\n${sizeMarker}\n${sizeText}`;
  }

  descriptionArea.value = desc;
  updateCharCount();

  descriptionArea.classList.add('flash-update');
  setTimeout(() => descriptionArea.classList.remove('flash-update'), 600);
}

/* =====================
   Titles
   ===================== */
function renderTitles(titles) {
  const list = document.getElementById('titleList');
  state.selectedTitleIdx = 0;

  if (!titles.length) {
    list.innerHTML = '<p style="color:var(--gray-400);font-size:13px;">タイトルを生成できませんでした</p>';
    return;
  }

  list.innerHTML = titles.map((title, i) => `
    <div class="title-item ${i === 0 ? 'selected' : ''}" id="title_${i}">
      <div class="title-header">
        <span class="title-num">案 ${i + 1}</span>
        <span class="title-chars" id="chars_${i}">${title.length}文字</span>
        <button class="btn-use ${i === 0 ? 'active' : ''}" id="use_${i}" onclick="selectTitle(${i})">
          ${i === 0 ? '✓ 使用中' : '使用する'}
        </button>
      </div>
      <input type="text" class="title-input" id="title_input_${i}" value="${esc(title)}" oninput="onTitleInput(${i})">
    </div>
  `).join('');
}

function selectTitle(idx) {
  state.selectedTitleIdx = idx;
  document.querySelectorAll('.title-item').forEach((el, i) => el.classList.toggle('selected', i === idx));
  document.querySelectorAll('.btn-use').forEach((el, i) => {
    el.classList.toggle('active', i === idx);
    el.textContent = i === idx ? '✓ 使用中' : '使用する';
  });
}

function onTitleInput(idx) {
  const input = document.getElementById(`title_input_${idx}`);
  document.getElementById(`chars_${idx}`).textContent = `${input.value.length}文字`;
}

function getSelectedTitle() {
  const input = document.getElementById(`title_input_${state.selectedTitleIdx}`);
  return input ? input.value : '';
}

/* =====================
   Keywords
   ===================== */
function renderKeywords(keywords) {
  const container = document.getElementById('keywordChips');
  state.activeKeywords = new Set(keywords);

  if (!keywords.length) {
    container.innerHTML = '<p style="color:var(--gray-400);font-size:13px;">キーワードを生成できませんでした</p>';
    return;
  }

  container.innerHTML = keywords.map(kw =>
    `<span class="keyword-chip active" data-keyword="${esc(kw)}" onclick="toggleKeyword(this)">${esc(kw)}</span>`
  ).join('');
}

function toggleKeyword(el) {
  const kw = el.dataset.keyword;
  el.classList.toggle('active');
  if (state.activeKeywords.has(kw)) state.activeKeywords.delete(kw);
  else                               state.activeKeywords.add(kw);
}

document.getElementById('copyKeywordsBtn').addEventListener('click', () => {
  const kws = [...state.activeKeywords].join(' ');
  if (!kws) { showToast('キーワードが選択されていません', 'error'); return; }
  copyToClipboard(kws, 'キーワードをコピーしました！');
});

/* =====================
   Description
   ===================== */
descriptionArea.addEventListener('input', updateCharCount);

function updateCharCount() {
  descCharCount.textContent = descriptionArea.value.length;
}

/* =====================
   Copy Buttons
   ===================== */
document.getElementById('copyTitleBtn').addEventListener('click', () => {
  const title = getSelectedTitle();
  if (!title) { showToast('タイトルが選択されていません', 'error'); return; }
  copyToClipboard(title, 'タイトルをコピーしました！');
});

document.getElementById('copyDescBtn').addEventListener('click', () => {
  const desc = descriptionArea.value;
  if (!desc.trim()) { showToast('説明文がありません', 'error'); return; }
  copyToClipboard(desc, '説明文をコピーしました！');
});

document.getElementById('copyAllBtn').addEventListener('click', () => {
  const title = getSelectedTitle();
  const desc  = descriptionArea.value;
  if (!title && !desc.trim()) { showToast('タイトルと説明文がありません', 'error'); return; }
  copyToClipboard([title, '', desc].filter(s => s.trim()).join('\n'), 'タイトル＋説明文をコピーしました！');
});

async function copyToClipboard(text, successMsg) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  showToast(successMsg, 'success');
}

function showToast(msg, type) {
  const toast = document.getElementById('copyToast');
  toast.textContent = (type === 'success' ? '✅ ' : '⚠️ ') + msg;
  toast.className = `copy-toast ${type}`;
  toast.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.hidden = true; }, 3000);
}

/* =====================
   Reset
   ===================== */
document.getElementById('resetBtn').addEventListener('click', () => {
  if (!confirm('入力内容をすべてリセットしますか？')) return;

  state.images = [];
  state.analysisData = null;
  state.selectedTitleIdx = 0;
  state.activeKeywords = new Set();

  renderGallery();
  updateAnalyzeBtn();
  hideUploadError();
  resultsSection.hidden = true;
  analysisInfo.hidden   = true;
  descriptionArea.value = '';
  updateCharCount();

  document.getElementById('section-upload').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* =====================
   Error Helpers
   ===================== */
function showUploadError(msg) {
  uploadError.textContent = msg;
  uploadError.hidden = false;
  uploadError.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideUploadError() {
  uploadError.hidden = true;
}

/* =====================
   Utility
   ===================== */
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
