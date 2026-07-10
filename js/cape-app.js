/* =====================================================================
   Tool Cape — app logic (refactored)
   - Fetches the base cape template automatically from GitHub (no manual
     template upload step anymore).
   - Lets the user upload a GIF/WebP to animate the cape.
   - Lets the user upload a custom player skin; it is remembered via
     Telegram CloudStorage and re-applied automatically next time.
   - Feeds live results into the CapeViewer3D at the bottom of the page.
   - Exports the finished frames as a resource-pack-ready ZIP and hands
     it off to the Telegram bot for delivery.
   ===================================================================== */

(function () {
  'use strict';

  // TODO: point this at the real raw GitHub URL once the template pack is uploaded.
  const CAPE_TEMPLATE_URL = 'https://raw.githubusercontent.com/REPLACE_ME/mcfrom-tools/main/templates/cape/cape_template.png';

  const TOOL_NAME = 'cape';

  // ---------- DOM refs ----------
  const el = {
    upload: document.getElementById('capeUpload'),
    uploadInput: document.getElementById('capeUploadInput'),
    uploadTitle: document.getElementById('capeUploadTitle'),
    uploadFilename: document.getElementById('capeUploadFilename'),
    status: document.getElementById('capeStatus'),

    skinUpload: document.getElementById('skinUpload'),
    skinUploadInput: document.getElementById('skinUploadInput'),
    skinUploadTitle: document.getElementById('skinUploadTitle'),
    skinResetBtn: document.getElementById('skinResetBtn'),

    duplicateCheckbox: document.getElementById('duplicateSidesCheckbox'),
    sideGapInput: document.getElementById('sideGapInput'),
    sideDirectionSelect: document.getElementById('sideDirectionSelect'),

    createBtn: document.getElementById('capeCreateBtn'),
    downloadBtn: document.getElementById('capeDownloadBtn'),
    resetBtn: document.getElementById('capeResetBtn'),
    usageBadge: document.getElementById('capeUsageBadge'),

    viewerWrap: document.getElementById('capeViewerWrap'),
    viewerLoading: document.getElementById('capeViewerLoading'),
    playPauseBtn: document.getElementById('capePlayPauseBtn'),
    speedSelect: document.getElementById('capeSpeedSelect'),
  };

  // ---------- State ----------
  let gifCanvases = [];
  let templateImage = null;
  let templateCanvasEl = null;
  let templateW = 0, templateH = 0;
  let drawRegion = null;
  let detectionMethod = 'شفافية';
  let outputFrames = [];
  let viewer = null;

  function setStatus(msg, type) {
    el.status.textContent = msg;
    el.status.className = 'mct-status show' + (type ? ' ' + type : '');
  }

  // ---------- Boot ----------
  async function boot() {
    viewer = window.CapeViewer3D.init({ wrapEl: el.viewerWrap, loadingEl: el.viewerLoading });
    await refreshUsageBadge();
    await loadTemplateFromGithub();
    await restoreSavedSkin();
    wireEvents();
  }

  async function refreshUsageBadge() {
    const usage = await window.MCfromTelegram.getUsage(TOOL_NAME);
    el.usageBadge.textContent = usage.remaining > 0
      ? `الاستخدامات المتبقية: ${usage.remaining}`
      : 'انتهت الاستخدامات المجانية';
    el.usageBadge.classList.toggle('low', usage.remaining <= 0);
  }

  async function restoreSavedSkin() {
    try {
      const savedDataUrl = await window.MCfromTelegram.loadImageDataUrl(TOOL_NAME, 'skin');
      if (!savedDataUrl) return;
      const img = new Image();
      img.onload = () => {
        viewer.setSkinFromImageElement(img);
        el.skinUploadTitle.textContent = '✓ تم استرجاع سكنك المحفوظ';
        el.skinUpload.classList.add('filled');
      };
      img.src = savedDataUrl;
    } catch (e) { /* no saved skin yet */ }
  }

  // ---------- Step: load base template automatically from GitHub ----------
  async function loadTemplateFromGithub() {
    setStatus('جارٍ تحميل قالب الكيب الأساسي...', '');
    try {
      const img = await loadImageFromUrl(CAPE_TEMPLATE_URL);
      templateImage = img;
      templateW = img.naturalWidth;
      templateH = img.naturalHeight;

      const canvas = document.createElement('canvas');
      canvas.width = templateW; canvas.height = templateH;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      templateCanvasEl = canvas;

      const data = ctx.getImageData(0, 0, templateW, templateH).data;
      let region = detectByTransparency(data, templateW, templateH);
      let method = 'شفافية';
      if (!region) {
        region = detectByOutline(data, templateW, templateH);
        method = 'إطار ملوّن';
      }
      if (!region) {
        region = { x: 0, y: 0, w: templateW, h: templateH };
        method = 'الصورة كاملة (تعذّر الاكتشاف التلقائي)';
      }
      detectionMethod = method;
      drawRegion = region;

      setStatus('✓ تم تجهيز القالب الأساسي، ارفع GIF أو WebP للمتابعة', 'success');
    } catch (err) {
      console.error(err);
      setStatus('تعذّر تحميل قالب الكيب الأساسي من GitHub: ' + err.message, 'error');
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

  // ---------- Region auto-detection (unchanged logic) ----------
  function detectByTransparency(data, w, h) {
    let minX = w, minY = h, maxX = -1, maxY = -1;
    const ALPHA_THRESHOLD = 8;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        if (data[idx + 3] > ALPHA_THRESHOLD) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    const coverage = ((maxX - minX + 1) * (maxY - minY + 1)) / (w * h);
    if (coverage > 0.97) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  function detectByOutline(data, w, h) {
    const colorCounts = new Map();
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const idx = (y * w + x) * 4;
        const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
        if (a < 100) continue;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const sat = max - min;
        if (sat > 40 && max > 60 && !(r > 230 && g > 230 && b > 230)) {
          const key = (r >> 4) + ',' + (g >> 4) + ',' + (b >> 4);
          colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
        }
      }
    }
    if (colorCounts.size === 0) return null;

    let bestKey = null, bestCount = 0;
    for (const [key, count] of colorCounts) {
      if (count > bestCount) { bestCount = count; bestKey = key; }
    }
    if (!bestKey || bestCount < 20) return null;

    const [rb, gb, bb] = bestKey.split(',').map(Number);
    const matches = (r, g, b) => (r >> 4) === rb && (g >> 4) === gb && (b >> 4) === bb;

    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const a = data[idx + 3];
        if (a < 100) continue;
        if (matches(data[idx], data[idx + 1], data[idx + 2])) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;

    const midY = Math.floor((minY + maxY) / 2);
    let strokeW = 2;
    for (let x = minX; x <= maxX; x++) {
      const idx = (midY * w + x) * 4;
      if (matches(data[idx], data[idx + 1], data[idx + 2])) {
        let run = 0;
        let xx = x;
        while (xx <= maxX) {
          const idx2 = (midY * w + xx) * 4;
          if (!matches(data[idx2], data[idx2 + 1], data[idx2 + 2])) break;
          run++; xx++;
        }
        strokeW = Math.max(1, run);
        break;
      }
    }

    const innerX = minX + strokeW;
    const innerY = minY + strokeW;
    const innerW = (maxX - strokeW) - innerX + 1;
    const innerH = (maxY - strokeW) - innerY + 1;

    if (innerW <= 0 || innerH <= 0) return null;
    return { x: innerX, y: innerY, w: innerW, h: innerH };
  }

  // ---------- Step: GIF/WebP upload ----------
  function isWebpFile(file) {
    if (file.type === 'image/webp') return true;
    return /\.webp$/i.test(file.name);
  }

  async function handleGif(file) {
    el.uploadFilename.textContent = file.name;
    const isWebp = isWebpFile(file);
    setStatus(isWebp ? 'جارٍ تحليل الـ WebP...' : 'جارٍ تحليل الـ GIF...', '');
    gifCanvases = [];

    try {
      const buffer = await file.arrayBuffer();

      if (isWebp) {
        gifCanvases = await parseAnimatedWebP(buffer);
      } else {
        const gifData = parseGIF(buffer);
        if (!gifData.frames.length) throw new Error('لم يتم العثور على فريمات في هذا الملف');
        gifCanvases = framesToCanvases(gifData);
      }

      setStatus(`✓ تم استخراج ${gifCanvases.length} فريم — جاهز للإنشاء`, 'success');
      el.uploadTitle.textContent = '✓ تم رفع الملف';
      el.uploadTitle.classList.add('filled-text');
      el.upload.classList.add('filled');
      el.createBtn.disabled = false;
    } catch (err) {
      console.error(err);
      setStatus('خطأ: ' + err.message, 'error');
    }
  }

  // ---------- Step: generate merged frames ----------
  async function generateFrames() {
    if (!gifCanvases.length || !templateImage || !drawRegion) return;

    const canUse = await window.MCfromTelegram.canUseTool(TOOL_NAME);
    if (!canUse) {
      setStatus('انتهت استخداماتك المجانية لهذه الأداة. اضغط "شراء استخدامات إضافية".', 'error');
      return;
    }

    el.createBtn.disabled = true;
    outputFrames = [];

    const { x, y, w, h } = drawRegion;

    const duplicateSide = el.duplicateCheckbox.checked;
    const gap = parseInt(el.sideGapInput.value, 10) || 0;
    const direction = el.sideDirectionSelect.value;

    let canvasW = templateW;
    let canvasH = templateH;
    let secondX = null;
    if (duplicateSide) {
      if (direction === 'right') {
        secondX = x + w + gap;
        canvasW = Math.max(templateW, secondX + w);
      } else {
        secondX = x - gap - w;
      }
    }
    let shiftX = 0;
    if (duplicateSide && direction === 'left' && secondX < 0) {
      shiftX = -secondX;
      canvasW = templateW + shiftX;
    }

    const outputCanvases = [];

    for (let i = 0; i < gifCanvases.length; i++) {
      setStatus(`جارٍ الدمج... ${i + 1}/${gifCanvases.length}`, '');

      const outCanvas = document.createElement('canvas');
      outCanvas.width = canvasW;
      outCanvas.height = canvasH;
      const outCtx = outCanvas.getContext('2d');
      outCtx.imageSmoothingEnabled = false;

      const baseX = x + shiftX;

      if (detectionMethod === 'شفافية') {
        outCtx.drawImage(templateImage, shiftX, 0, templateW, templateH);
        outCtx.clearRect(baseX, y, w, h);
      }

      outCtx.drawImage(gifCanvases[i], 0, 0, gifCanvases[i].width, gifCanvases[i].height, baseX, y, w, h);

      if (duplicateSide) {
        const finalSecondX = secondX + shiftX;
        outCtx.clearRect(finalSecondX, y, w, h);
        outCtx.drawImage(gifCanvases[i], 0, 0, gifCanvases[i].width, gifCanvases[i].height, finalSecondX, y, w, h);
      }

      outputCanvases.push(outCanvas);

      const blob = await new Promise((res) => outCanvas.toBlob(res, 'image/png'));
      outputFrames.push({ name: `cap_frame_${i}.png`, blob });
    }

    setStatus(`✓ تم إنشاء ${outputFrames.length} فريم`, 'success');
    el.createBtn.disabled = false;
    el.downloadBtn.disabled = false;

    const frontX = x + shiftX;
    const regionFrames = outputCanvases.map((oc) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const cx = c.getContext('2d');
      cx.imageSmoothingEnabled = false;
      cx.drawImage(oc, frontX, y, w, h, 0, 0, w, h);
      return c;
    });
    viewer.setCapeFrames(regionFrames);

    await window.MCfromTelegram.recordUse(TOOL_NAME);
    await refreshUsageBadge();
  }

  // ---------- Step: export + send via bot ----------
  async function downloadAndSend() {
    el.downloadBtn.disabled = true;
    el.downloadBtn.textContent = 'جارٍ التجهيز...';
    try {
      const zipBlob = await buildZip(outputFrames);

      if (window.MCfromTelegram.isInsideTelegram) {
        await window.MCfromTelegram.sendFileToTelegram(TOOL_NAME, 'cape_resource_pack.zip', zipBlob);
        setStatus('✓ تم إرسال الملف إلى محادثتك في تيليجرام', 'success');
      } else {
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url; a.download = 'cape_frames.zip';
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

  // ---------- Skin upload / reset (persisted) ----------
  async function handleSkinUpload(file) {
    const img = new Image();
    img.onload = async () => {
      viewer.setSkinFromImageElement(img);
      el.skinUploadTitle.textContent = '✓ تم تطبيق السكن: ' + file.name;
      el.skinUpload.classList.add('filled');

      // Persist for next time.
      const reader = new FileReader();
      reader.onload = async () => {
        await window.MCfromTelegram.saveImageDataUrl(TOOL_NAME, 'skin', reader.result);
      };
      reader.readAsDataURL(file);
    };
    img.onerror = () => {
      el.skinUploadTitle.textContent = '⚠️ تعذّر قراءة الصورة، جرّب PNG آخر';
    };
    img.src = URL.createObjectURL(file);
  }

  async function resetSkin() {
    viewer.resetSkinToDefault();
    el.skinUploadTitle.textContent = 'Upload PNG (اختياري)';
    el.skinUpload.classList.remove('filled');
    await window.MCfromTelegram.saveImageDataUrl(TOOL_NAME, 'skin', '');
  }

  // ---------- Reset tool ----------
  function resetTool() {
    gifCanvases = [];
    outputFrames = [];
    el.uploadFilename.textContent = '';
    el.uploadTitle.textContent = 'Upload GIF/WebP';
    el.uploadTitle.classList.remove('filled-text');
    el.upload.classList.remove('filled');
    el.uploadInput.value = '';
    el.createBtn.disabled = true;
    el.downloadBtn.disabled = true;
    setStatus('', '');
    el.status.classList.remove('show');
    viewer.setCapeFrames([]);
  }

  // ---------- Wire up events ----------
  function wireEvents() {
    el.upload.addEventListener('click', () => el.uploadInput.click());
    el.upload.addEventListener('dragover', (e) => { e.preventDefault(); el.upload.classList.add('dragover'); });
    el.upload.addEventListener('dragleave', () => el.upload.classList.remove('dragover'));
    el.upload.addEventListener('drop', (e) => {
      e.preventDefault();
      el.upload.classList.remove('dragover');
      if (e.dataTransfer.files.length) handleGif(e.dataTransfer.files[0]);
    });
    el.uploadInput.addEventListener('change', (e) => {
      if (e.target.files.length) handleGif(e.target.files[0]);
    });

    el.skinUpload.addEventListener('click', () => el.skinUploadInput.click());
    el.skinUploadInput.addEventListener('change', (e) => {
      if (e.target.files.length) handleSkinUpload(e.target.files[0]);
    });
    el.skinResetBtn.addEventListener('click', resetSkin);

    el.createBtn.addEventListener('click', generateFrames);
    el.downloadBtn.addEventListener('click', downloadAndSend);
    el.resetBtn.addEventListener('click', resetTool);

    el.playPauseBtn.addEventListener('click', () => {
      const playing = !viewer.isPlaying();
      viewer.setPlaying(playing);
      el.playPauseBtn.textContent = playing ? '⏸ إيقاف الحركة' : '▶️ تشغيل الحركة';
    });
    el.speedSelect.addEventListener('change', () => {
      viewer.setFrameDelay(parseInt(el.speedSelect.value, 10) || 100);
    });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
