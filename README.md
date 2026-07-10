# MCfrom Tools — Tool Cape & Tool Bed (موقع مستقل)

موقع ثابت (Static Site) مستقل تمامًا عن تطبيق MCfrom الرئيسي، يحتوي على أداتين:

- **Tool Cape** (`/cape/`): تحويل GIF/WebP إلى كيب متحرك لـ Minecraft Bedrock.
- **Tool Bed** (`/bed/`): وضع صورة شخصية على سرير مخصص، مع معاينة ثلاثية الأبعاد.

يُفتح هذا الموقع كـ Telegram Mini App من داخل `mcfrom_bot`.

## البنية

```
mcfrom-tools/
├── index.html              ← صفحة البوابة (بطاقتا الأداتين)
├── cape/index.html          ← صفحة أداة الكيب الكاملة
├── bed/index.html           ← صفحة أداة السرير الكاملة
├── css/tool-shared.css      ← نظام التصميم المشترك (ذهبي/أسود، شبيه modmaker.net)
├── js/
│   ├── telegram-integration.js   ← CloudStorage + عداد الاستخدام + الإرسال عبر Worker/البوت + Stars
│   ├── gif-decoder.js             ← فك ترميز GIF (منطق بحت، بدون DOM)
│   ├── webp-decoder.js            ← فك ترميز WebP المتحرك عبر ImageDecoder API
│   ├── zip-writer.js              ← بناء ملف ZIP بدون مكتبات خارجية
│   ├── steve-model-data.js        ← بيانات نموذج ستيف (glTF) + السكن الافتراضي
│   ├── cape-viewer-3d.js          ← عارض الكيب ثلاثي الأبعاد (Three.js)
│   ├── cape-app.js                ← منطق واجهة أداة الكيب
│   ├── bed-model-data.js          ← بيانات نموذج السرير (glTF)
│   ├── bed-viewer-3d.js           ← عارض السرير ثلاثي الأبعاد (Three.js)
│   └── bed-app.js                 ← منطق واجهة أداة السرير
└── templates/
    ├── cape/cape_template.png     ← ضع هنا قالب تكستشر الكيب الأساسي
    └── bed/bed_template.png       ← ضع هنا قالب تكستشر السرير الأساسي
```

## خطوات التفعيل بعد الرفع على GitHub

1. **رفع القوالب الأساسية**: ضع `cape_template.png` في `templates/cape/` و `bed_template.png` في `templates/bed/`.

2. **تحديث روابط القوالب** في:
   - `js/cape-app.js` → غيّر قيمة `CAPE_TEMPLATE_URL` إلى:
     `https://raw.githubusercontent.com/<user>/<repo>/main/templates/cape/cape_template.png`
   - `js/bed-app.js` → غيّر قيمة `BED_TEMPLATE_URL` بنفس الطريقة.

3. **تفعيل GitHub Pages**: من إعدادات المستودع (Settings → Pages)، فعّل النشر من فرع `main`.

4. **ربط الرابط بـ mcfrom_bot**: اجعل زر/أمر الأداة في البوت يفتح رابط GitHub Pages كـ Web App
   (مثال: `https://<user>.github.io/<repo>/`).

5. **تحديث Worker endpoint**: في `js/telegram-integration.js`، غيّر `WORKER_BASE` إلى رابط Cloudflare
   Worker الفعلي، بعد إضافة النقاط التالية له في الخادم:
   - `POST /tools/send-file` — يستقبل `{tool, userId, filename, fileBase64, initData}`،
     يتحقق من `initData` (توقيع تيليجرام)، ثم يرسل الملف عبر Bot API
     (`sendDocument`) إلى `userId`.
   - `POST /tools/create-invoice` — يستقبل `{tool, userId}`، وينشئ رابط فاتورة
     Telegram Stars عبر `createInvoiceLink`، ويعيد `{invoiceLink}`.
   - `GET /tools/check-payment?tool=&userId=` — يتحقق من استلام `successful_payment`
     من تيليجرام لهذا المستخدم/الأداة، ويعيد `{credited: true, credits: 5}` إذا تم تأكيد الدفع.

## آلية الاستخدام (3 مجاني ثم Stars)

يتم تتبع عدد الاستخدامات لكل أداة بشكل منفصل عبر `Telegram.WebApp.CloudStorage`
(مفاتيح `usage:cape` / `usage:bed`). بعد استهلاك الاستخدامات الثلاثة المجانية،
تظهر رسالة الدفع، ويتم فتح فاتورة Stars عبر `tg.openInvoice()`. عند نجاح الدفع
يُضاف رصيد استخدامات جديد (`paid:cape` / `paid:bed`) يُخصم منه أولًا.

## حفظ تخصيصات المستخدم

- **Tool Cape**: إذا رفع المستخدم سكنًا مخصصًا، يُحفظ (بصيغة data URL مقسّمة على
  عدة مفاتيح CloudStorage) ويُسترجع تلقائيًا في الزيارات القادمة.
- **Tool Bed**: إعدادات الحجم/الموضع + صورة الشخصية نفسها تُحفظ وتُسترجع تلقائيًا.

## ملاحظة حول العمل خارج تيليجرام

كل الميزات (العداد، الحفظ) لها fallback عبر `localStorage` عند فتح الصفحة في متصفح
عادي خارج تيليجرام (لأغراض التطوير/الاختبار المحلي)، لكن ميزة الدفع بـ Stars وإرسال
الملفات عبر البوت تعمل فقط داخل Telegram Mini App.
