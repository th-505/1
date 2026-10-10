# نشر نسخة th-505

الواجهة: https://th-505.github.io/1/

تعمل صفحات GitHub Pages كملفات ثابتة فقط؛ لا تشغّل ملفات `server/*.mjs`.
حالياً تستخدم الواجهة `https://al-qahtani-api.onrender.com` للأفلام والمباريات،
وتستخدم Worker منفصلاً للأخبار. الخادم القديم يسمح لحساب GitHub القديم عبر CORS
ولا يمنح `https://th-505.github.io` حق قراءة الاستجابة حتى إعادة نشر النسخة الجديدة.

## الخادم

في Render، اربط خدمة Node بالمستودع `th-505/1` والفرع `main`، دون مجلد فرعي.
استخدم Node.js 22 أو أحدث، وأمر البناء `npm run check`، وأمر التشغيل `npm start`.
احتفظ بمتغيرات الخدمة الحالية وبيانات اعتمادها. المنفذ يأتي من `PORT` الذي يوفره Render.
لا تنسخ أسرار Render إلى المستودع أو الواجهة.

بعد النشر:

```sh
AL_QAHTANI_WEB_ORIGIN=https://th-505.github.io node scripts/remote_cors_smoke.mjs
```

إن لم تكن تملك الخادم الحالي، أنشئ خدمة Node خاصة بك وغيّر عنوان `backend`
في `web/core/api-client.js` إلى رابطها. راجع عناوين الخادم في المشغل وتطبيق Flutter
أيضاً عند الانتقال إلى عنوان جديد.

## Pages

في Settings → Pages → Build and deployment، اختر Source: GitHub Actions.
ملف `.github/workflows/pages.yml` يعتمد هذا الوضع؛ اختيار Deploy from a branch
يشغّل نشراً منفصلاً وقد يعمل الموقع رغم فشل ملف Actions المذكور.

فشل اختبار الشعارات عولج بإضافة نطاق `koooracity.news` الذي ظهر في بيانات
المزود الحية، مع إبقاء التحقق الدقيق من HTTPS والمسار والمضيف ورفض التحويلات.
