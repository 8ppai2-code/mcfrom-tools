/* =====================================================================
   Tool Bed — app logic (refactored)
   - Fetches the base bed template automatically from GitHub.
   - User uploads a character image; background is auto-removed.
   - Settings gear (⚙️) exposes scale / position sliders; all settings
     (including the character image itself) are persisted via Telegram
     CloudStorage and restored automatically next time.
   - Live 3D preview always visible at the bottom.
   - Exports the finished bed texture and hands it to the Telegram bot.
   ===================================================================== */

(function () {
  'use strict';

  // TODO: point this at the real raw GitHub URL once the template pack is uploaded.
  const BED_TEMPLATE_URL = 'https://raw.githubusercontent.com/REPLACE_ME/mcfrom-tools/main/templates/bed/bed_template.png';

  const TOOL_NAME = 'bed';

  const el = {
    upload: document.getElementById('bedCharUpload'),
    uploadInput: document.getElementById('bedCharUploadInput'),
    uploadTitle: document.getElementById('bedCharUploadTitle'),
    uploadFilename: document.getElementById('bedCharUploadFilename'),
    status: document.getElementById('bedStatus'),

    settingsToggle: document.getElementById('bedSettingsToggle'),
    settingsPanel: document.getElementById('bedSettingsPanel'),
    scaleSlider: document.getElementById('bedScaleSlider'),
    scaleVal: document.getElementById('bedScaleVal'),
    posXSlider: document.getElementById('bedPosXSlider'),
    posXVal: document.getElementById('bedPosXVal'),
    posYSlider: document.getElementById('bedPosYSlider'),
    posYVal: document.getElementById('bedPosYVal'),
    threshSlider: document.getElementById('bedThreshSlider'),
    threshVal: document.getElementById('bedThreshVal'),

    editorCanvas: document.getElementById('bedEditorCanvas'),

    createBtn: document.getElementById('bedCreateBtn'),
    downloadBtn: document.getElementById('bedDownloadBtn'),
    resetBtn: document.getElementById('bedResetBtn'),
    usageBadge: document.getElementById('bedUsageBadge'),

    viewerWrap: document.getElementById('bedViewerWrap'),
    viewerLoading: document.getElementById('bedViewerLoading'),
  };

  const ctx = el.editorCanvas.getContext('2d');

  // ---------- State ----------
  let bedImage = null;
  let charImage = null;
  let processedChar = null;
  let blanketArea = null;

  let posX = 0.30, posY = 0.45;
  let charScale = 0.36;
  let charPixelX = 0, charPixelY = 0;
  let isDragging = false;
  let dragStartX = 0, dragStartY = 0, dragPosStartX = 0, dragPosStartY = 0;

  let viewer = null;

  function setStatus(msg, type) {
    el.status.textContent = msg;
    el.status.className = 'mct-status show' + (type ? ' ' + type : '');
  }

  // ---------- Boot ----------
  async function boot() {
    viewer = window.BedViewer3D.init({ wrapEl: el.viewerWrap, loadingEl: el.viewerLoading });
    await refreshUsageBadge();
    await loadTemplateFromGithub();
    await restoreSavedCharacter();
    wireEvents();
  }

  async function refreshUsageBadge() {
    const usage = await window.MCfromTelegram.getUsage(TOOL_NAME);
    el.usageBadge.textContent = usage.remaining > 0
      ? `الاستخدامات المتبقية: ${usage.remaining}`
      : 'انتهت الاستخدامات المجانية';
    el.usageBadge.classList.toggle('low', usage.remaining <= 0);
  }

  async function loadTemplateFromGithub() {
    setStatus('جارٍ تحميل قالب السرير الأساسي...', '');
    try {
      const img = await loadImageFromUrl(BED_TEMPLATE_URL);
      bedImage = img;
      el.editorCanvas.width = img.width;
      el.editorCanvas.height = img.height;
      blanketArea = detectBlanketArea(img);
      updateCharPosition();
      updateTexture();
      setStatus('✓ تم تجهيز قالب السرير، ارفع صورة الشخصية للمتابعة', 'success');
    } catch (err) {
      console.error(err);
      setStatus('تعذّر تحميل قالب السرير من GitHub: ' + err.message, 'error');
    }
  }

  function loadImageFromUrl(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('تعذّر تحميل الصورة من ' + url));
      img.src = url;
    });
  }

  // ---------- Restore saved character + settings ----------
  async function restoreSavedCharacter() {
    try {
      const cfg = await window.MCfromTelegram.loadCustomization(TOOL_NAME);
      if (cfg) {
        posX = typeof cfg.posX === 'number' ? cfg.posX : posX;
        posY = typeof cfg.posY === 'number' ? cfg.posY : posY;
        charScale = typeof cfg.charScale === 'number' ? cfg.charScale : charScale;
        syncSettingsUI();
      }
      const savedDataUrl = await window.MCfromTelegram.loadImageDataUrl(TOOL_NAME, 'character');
      if (!savedDataUrl) return;
      const img = new Image();
      img.onload = () => {
        charImage = img;
        el.uploadTitle.textContent = '✓ تم استرجاع شخصيتك المحفوظة';
        el.uploadTitle.classList.add('filled-text');
        el.upload.classList.add('filled');
        processCharacter();
        updateTexture();
      };
      img.src = savedDataUrl;
    } catch (e) { /* nothing saved yet */ }
  }

  function syncSettingsUI() {
    el.scaleSlider.value = Math.round(charScale * 100);
    el.scaleVal.textContent = Math.round(charScale * 100) + '%';
    el.posXSlider.value = Math.round(posX * 100);
    el.posXVal.textContent = Math.round(posX * 100) + '%';
    el.posYSlider.value = Math.round(posY * 100);
    el.posYVal.textContent = Math.round(posY * 100) + '%';
  }

  async function persistSettings() {
    await window.MCfromTelegram.saveCustomization(TOOL_NAME, { posX, posY, charScale });
  }

  // ---------- Character upload + background removal (unchanged logic) ----------
  function handleCharacterUpload(file) {
    const img = new Image();
    img.onload = () => {
      charImage = img;
      el.uploadFilename.textContent = file.name;
      el.uploadTitle.textContent = '✓ تم رفع الصورة';
      el.uploadTitle.classList.add('filled-text');
      el.upload.classList.add('filled');
      processCharacter();
      updateTexture();
      setStatus('✓ تم! اضغط "إنشاء" للمعاينة', 'success');

      const reader = new FileReader();
      reader.onload = async () => {
        await window.MCfromTelegram.saveImageDataUrl(TOOL_NAME, 'character', reader.result);
      };
      reader.readAsDataURL(file);
    };
    img.src = URL.createObjectURL(file);
  }

  function detectBlanketArea(img) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const cx = c.getContext('2d'); cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, c.width, c.height).data;
    const w = c.width, h = c.height;
    let minX = w, minY = h, maxX = 0, maxY = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
        if (a < 50) continue;
        const isWood = (r > 90 && g > 50 && b < 90 && r > g + 10);
        const isPillow = (r > 170 && g > 170 && b > 170 && Math.abs(r - g) < 30 && Math.abs(g - b) < 30);
        if (!isWood && !isPillow) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (minX >= maxX) return null;
    return { x1: minX, y1: minY, x2: maxX, y2: maxY };
  }

  function processCharacter() {
    if (!charImage) return;
    const thresh = parseInt(el.threshSlider.value, 10);
    const c = document.createElement('canvas');
    c.width = charImage.width; c.height = charImage.height;
    const cx = c.getContext('2d'); cx.drawImage(charImage, 0, 0);
    const imgData = cx.getImageData(0, 0, c.width, c.height);
    const data = imgData.data;
    const w = c.width, h = c.height;
    const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1], [Math.floor(w * 0.05), Math.floor(h * 0.05)], [Math.floor(w * 0.95), Math.floor(h * 0.05)], [Math.floor(w * 0.05), Math.floor(h * 0.95)], [Math.floor(w * 0.95), Math.floor(h * 0.95)]];
    let avgR = 0, avgG = 0, avgB = 0;
    for (const [sx, sy] of corners) { const i = (sy * w + sx) * 4; avgR += data[i]; avgG += data[i + 1]; avgB += data[i + 2]; }
    avgR /= 8; avgG /= 8; avgB /= 8;
    const isLightBg = (avgR > 200 && avgG > 200 && avgB > 200);
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const dist = Math.sqrt((r - avgR) ** 2 + (g - avgG) ** 2 + (b - avgB) ** 2);
      const whiteDist = Math.sqrt((r - 255) ** 2 + (g - 255) ** 2 + (b - 255) ** 2);
      const blackDist = Math.sqrt(r * r + g * g + b * b);
      let isBg = false;
      if (dist < thresh) isBg = true;
      if (isLightBg && whiteDist < thresh * 1.2) isBg = true;
      if (blackDist < 25) isBg = false;
      if (isBg) data[i + 3] = 0;
    }
    cx.putImageData(imgData, 0, 0);
    processedChar = c;
  }

  function updateCharPosition() {
    if (!blanketArea) return;
    const bw = blanketArea.x2 - blanketArea.x1 + 1;
    const bh = blanketArea.y2 - blanketArea.y1 + 1;
    charPixelX = blanketArea.x1 + bw * posX;
    charPixelY = blanketArea.y1 + bh * posY;
  }

  function updateTexture() {
    ctx.clearRect(0, 0, el.editorCanvas.width, el.editorCanvas.height);
    if (bedImage) ctx.drawImage(bedImage, 0, 0);
    if (processedChar && blanketArea) {
      updateCharPosition();
      const size = { w: processedChar.width * charScale, h: processedChar.height * charScale };
      ctx.drawImage(processedChar, charPixelX - size.w / 2, charPixelY - size.h / 2, size.w, size.h);
    }
    if (viewer) viewer.updateTextureFromCanvas(el.editorCanvas);
  }

  // ---------- Drag to reposition on the editor canvas ----------
  function startDrag(e) {
    if (!processedChar || !blanketArea) return;
    const rect = el.editorCanvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (el.editorCanvas.width / rect.width);
    const my = (e.clientY - rect.top) * (el.editorCanvas.height / rect.height);
    const size = { w: processedChar.width * charScale, h: processedChar.height * charScale };
    const dx = charPixelX - size.w / 2, dy = charPixelY - size.h / 2;
    if (mx >= dx && mx <= dx + size.w && my >= dy && my <= dy + size.h) {
      isDragging = true; dragStartX = mx; dragStartY = my;
      dragPosStartX = posX; dragPosStartY = posY;
      el.editorCanvas.style.cursor = 'grabbing'; e.preventDefault();
    }
  }
  function drag(e) {
    if (!isDragging || !blanketArea) return;
    const rect = el.editorCanvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (el.editorCanvas.width / rect.width);
    const my = (e.clientY - rect.top) * (el.editorCanvas.height / rect.height);
    const bw = blanketArea.x2 - blanketArea.x1 + 1;
    const bh = blanketArea.y2 - blanketArea.y1 + 1;
    posX = Math.max(0, Math.min(1, dragPosStartX + (mx - dragStartX) / bw));
    posY = Math.max(0, Math.min(1, dragPosStartY + (my - dragStartY) / bh));
    syncSettingsUI();
    updateTexture();
  }
  async function endDrag() {
    if (isDragging) { isDragging = false; el.editorCanvas.style.cursor = 'grab'; await persistSettings(); }
  }

  // ---------- Generate / export ----------
  async function generateBed() {
    if (!bedImage || !processedChar) {
      setStatus('❌ ارفع صورة الشخصية أولاً', 'error');
      return;
    }
    const canUse = await window.MCfromTelegram.canUseTool(TOOL_NAME);
    if (!canUse) {
      setStatus('انتهت استخداماتك المجانية لهذه الأداة. اضغط "شراء استخدامات إضافية".', 'error');
      return;
    }
    updateTexture();
    setStatus('✓ تم إنشاء المعاينة أدناه', 'success');
    el.downloadBtn.disabled = false;

    await window.MCfromTelegram.recordUse(TOOL_NAME);
    await refreshUsageBadge();
  }

  async function downloadAndSend() {
    el.downloadBtn.disabled = true;
    el.downloadBtn.textContent = 'جارٍ التجهيز...';
    try {
      const blob = await new Promise((res) => el.editorCanvas.toBlob(res, 'image/png'));

      if (window.MCfromTelegram.isInsideTelegram) {
        await window.MCfromTelegram.sendFileToTelegram(TOOL_NAME, 'bed_texture.png', blob);
        setStatus('✓ تم إرسال الملف إلى محادثتك في تيليجرام', 'success');
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'bed.png';
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error(err);
      setStatus('تعذّر إتمام الإرسال: ' + err.message, 'error');
    }
    el.downloadBtn.disabled = false;
    el.downloadBtn.textContent = '📤 إرسال إلى تيليجرام';
  }

  function resetTool() {
    charImage = null; processedChar = null;
    posX = 0.30; posY = 0.45; charScale = 0.36;
    el.uploadInput.value = '';
    el.uploadFilename.textContent = '';
    el.uploadTitle.textContent = 'Upload PNG/JPG';
    el.uploadTitle.classList.remove('filled-text');
    el.upload.classList.remove('filled');
    syncSettingsUI();
    updateTexture();
    el.downloadBtn.disabled = true;
    setStatus('', '');
    el.status.classList.remove('show');
  }

  // ---------- Wire up events ----------
  function wireEvents() {
    el.upload.addEventListener('click', () => el.uploadInput.click());
    el.upload.addEventListener('dragover', (e) => { e.preventDefault(); el.upload.classList.add('dragover'); });
    el.upload.addEventListener('dragleave', () => el.upload.classList.remove('dragover'));
    el.upload.addEventListener('drop', (e) => {
      e.preventDefault();
      el.upload.classList.remove('dragover');
      if (e.dataTransfer.files.length) handleCharacterUpload(e.dataTransfer.files[0]);
    });
    el.uploadInput.addEventListener('change', (e) => {
      if (e.target.files.length) handleCharacterUpload(e.target.files[0]);
    });

    el.settingsToggle.addEventListener('click', () => {
      const isOpen = el.settingsPanel.classList.toggle('hidden') === false;
      el.settingsToggle.classList.toggle('open', isOpen);
    });

    el.scaleSlider.addEventListener('input', async (e) => {
      charScale = parseInt(e.target.value, 10) / 100;
      el.scaleVal.textContent = e.target.value + '%';
      updateTexture();
      await persistSettings();
    });
    el.posXSlider.addEventListener('input', async (e) => {
      posX = parseInt(e.target.value, 10) / 100;
      el.posXVal.textContent = e.target.value + '%';
      updateTexture();
      await persistSettings();
    });
    el.posYSlider.addEventListener('input', async (e) => {
      posY = parseInt(e.target.value, 10) / 100;
      el.posYVal.textContent = e.target.value + '%';
      updateTexture();
      await persistSettings();
    });
    el.threshSlider.addEventListener('input', (e) => {
      el.threshVal.textContent = e.target.value;
      if (charImage) { processCharacter(); updateTexture(); }
    });

    el.editorCanvas.addEventListener('mousedown', startDrag);
    el.editorCanvas.addEventListener('mousemove', drag);
    el.editorCanvas.addEventListener('mouseup', endDrag);
    el.editorCanvas.addEventListener('mouseleave', endDrag);

    el.createBtn.addEventListener('click', generateBed);
    el.downloadBtn.addEventListener('click', downloadAndSend);
    el.resetBtn.addEventListener('click', resetTool);
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
    
