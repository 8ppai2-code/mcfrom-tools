/* =====================================================================
   MCfrom Tools — Telegram integration layer
   Shared by Tool Cape and Tool Bed.

   Responsibilities:
   1) Wrap Telegram.WebApp.CloudStorage behind a small Promise-based API
      used to persist per-tool usage counters and per-tool user
      customizations (custom skin, bed character settings, etc).
   2) Track "3 free uses, then pay" per tool.
   3) Send the exported resource pack to the user's Telegram chat by
      posting it to the MCfrom Cloudflare Worker, which relays it through
      mcfrom_bot as a document.
   4) Open a Telegram Stars invoice (via the same Worker/bot) once the
      free-use quota is exhausted, and unlock the export after payment
      is confirmed by Telegram's successful_payment callback server-side.
   ===================================================================== */

(function (global) {
  'use strict';

  // ---- Configuration -------------------------------------------------
  // Update WORKER_BASE to point at the MCfrom Cloudflare Worker once the
  // new endpoints below are deployed there.
  const WORKER_BASE = 'https://api.mcfrom.workers.dev'; // TODO: set to the real Worker URL
  const ENDPOINTS = {
    sendFile:     WORKER_BASE + '/tools/send-file',     // POST: relay exported file to user via bot
    createInvoice: WORKER_BASE + '/tools/create-invoice', // POST: get a Stars invoice link
    checkPayment: WORKER_BASE + '/tools/check-payment'   // GET:  poll whether a Stars payment succeeded
  };

  const FREE_USES = 3;

  const tg = global.Telegram && global.Telegram.WebApp ? global.Telegram.WebApp : null;
  const cloud = tg && tg.CloudStorage ? tg.CloudStorage : null;

  function tgReady() {
    if (tg) {
      try { tg.ready(); tg.expand(); } catch (e) { /* noop outside Telegram */ }
    }
  }
  tgReady();

  // ---- CloudStorage helpers (Promise wrappers) ------------------------
  function csGet(key) {
    return new Promise((resolve) => {
      if (!cloud) { resolve(localStorageFallbackGet(key)); return; }
      cloud.getItem(key, (err, value) => {
        if (err) { resolve(null); return; }
        resolve(value || null);
      });
    });
  }

  function csSet(key, value) {
    return new Promise((resolve) => {
      if (!cloud) { localStorageFallbackSet(key, value); resolve(true); return; }
      cloud.setItem(key, value, (err, ok) => resolve(!err && ok));
    });
  }

  // Fallback so the tool still works when opened outside Telegram
  // (e.g. during local development in a normal browser tab).
  function localStorageFallbackGet(key) {
    try { return localStorage.getItem('mct:' + key); } catch (e) { return null; }
  }
  function localStorageFallbackSet(key, value) {
    try { localStorage.setItem('mct:' + key, value); } catch (e) { /* noop */ }
  }

  function getTelegramUserId() {
    try {
      return tg && tg.initDataUnsafe && tg.initDataUnsafe.user
        ? String(tg.initDataUnsafe.user.id)
        : 'anon';
    } catch (e) { return 'anon'; }
  }

  // ---- Usage counter ----------------------------------------------------
  // Each tool ('cape' | 'bed') gets its own counter key so the 3 free uses
  // are tracked independently per tool.
  async function getUsage(toolName) {
    const raw = await csGet('usage:' + toolName);
    const count = raw ? parseInt(raw, 10) || 0 : 0;
    const paidRaw = await csGet('paid:' + toolName);
    const paidCredits = paidRaw ? parseInt(paidRaw, 10) || 0 : 0;
    return { count, paidCredits, remaining: Math.max(0, FREE_USES - count) + paidCredits };
  }

  async function recordUse(toolName) {
    const usage = await getUsage(toolName);
    if (usage.paidCredits > 0) {
      // Spend a paid credit first once free uses are gone.
      await csSet('paid:' + toolName, String(usage.paidCredits - 1));
    } else {
      await csSet('usage:' + toolName, String(usage.count + 1));
    }
  }

  async function addPaidCredits(toolName, n) {
    const usage = await getUsage(toolName);
    await csSet('paid:' + toolName, String(usage.paidCredits + n));
  }

  async function canUseTool(toolName) {
    const usage = await getUsage(toolName);
    return usage.remaining > 0;
  }

  // ---- Per-tool saved customization (custom cape skin, bed settings) ----
  async function saveCustomization(toolName, dataObj) {
    try {
      const json = JSON.stringify(dataObj);
      // CloudStorage values are capped (~4KB per key on Telegram's side),
      // large binary payloads (e.g. skin PNG) should be stored elsewhere
      // (see saveSkinImage below) - this is for small settings objects.
      return await csSet('cfg:' + toolName, json);
    } catch (e) { return false; }
  }

  async function loadCustomization(toolName) {
    const raw = await csGet('cfg:' + toolName);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  // Custom skin/character images are usually bigger than CloudStorage's
  // per-key limit, so they are chunked into multiple keys transparently.
  const CHUNK_SIZE = 3500; // conservative, stays under Telegram's ~4096 char/value cap

  async function saveImageDataUrl(toolName, slot, dataUrl) {
    const chunks = [];
    for (let i = 0; i < dataUrl.length; i += CHUNK_SIZE) {
      chunks.push(dataUrl.slice(i, i + CHUNK_SIZE));
    }
    await csSet(`img:${toolName}:${slot}:meta`, String(chunks.length));
    for (let i = 0; i < chunks.length; i++) {
      await csSet(`img:${toolName}:${slot}:${i}`, chunks[i]);
    }
    return true;
  }

  async function loadImageDataUrl(toolName, slot) {
    const metaRaw = await csGet(`img:${toolName}:${slot}:meta`);
    const count = metaRaw ? parseInt(metaRaw, 10) || 0 : 0;
    if (!count) return null;
    let full = '';
    for (let i = 0; i < count; i++) {
      const part = await csGet(`img:${toolName}:${slot}:${i}`);
      if (!part) return null;
      full += part;
    }
    return full;
  }

  // ---- Sending the exported file through the bot -------------------------
  async function sendFileToTelegram(toolName, filename, blob) {
    const userId = getTelegramUserId();
    const base64 = await blobToBase64(blob);
    const res = await fetch(ENDPOINTS.sendFile, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: toolName,
        userId,
        filename,
        fileBase64: base64,
        initData: tg ? tg.initData : null
      })
    });
    if (!res.ok) throw new Error('تعذّر إرسال الملف عبر البوت (' + res.status + ')');
    return res.json();
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // ---- Stars payment flow ------------------------------------------------
  async function purchaseMoreUses(toolName) {
    const userId = getTelegramUserId();
    const res = await fetch(ENDPOINTS.createInvoice, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: toolName, userId })
    });
    if (!res.ok) throw new Error('تعذّر إنشاء فاتورة الدفع');
    const { invoiceLink } = await res.json();

    return new Promise((resolve, reject) => {
      if (!tg || !tg.openInvoice) {
        reject(new Error('الدفع متاح فقط داخل تطبيق تيليجرام'));
        return;
      }
      tg.openInvoice(invoiceLink, async (status) => {
        if (status !== 'paid') { reject(new Error('لم يكتمل الدفع (' + status + ')')); return; }
        // Server already credited the account on successful_payment;
        // re-check to be safe, then reflect locally.
        try {
          const check = await fetch(ENDPOINTS.checkPayment + '?tool=' + toolName + '&userId=' + userId);
          const data = await check.json();
          if (data.credited) {
            await addPaidCredits(toolName, data.credits || 5);
            resolve(true);
          } else {
            reject(new Error('لم يتم تأكيد الدفع بعد، حاول لاحقًا'));
          }
        } catch (e) {
          resolve(true); // bot-side credit already applied even if this check fails
        }
      });
    });
  }

  global.MCfromTelegram = {
    FREE_USES,
    isInsideTelegram: !!tg,
    getUsage,
    recordUse,
    canUseTool,
    saveCustomization,
    loadCustomization,
    saveImageDataUrl,
    loadImageDataUrl,
    sendFileToTelegram,
    purchaseMoreUses
  };
})(window);
