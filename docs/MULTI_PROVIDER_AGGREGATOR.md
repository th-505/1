# مجمع المزودين حسب التخصص

يتطلب Node.js 22 أو أحدث، ويعمل بوحدات `.mjs` وواجهات مدمجة فقط، دون حزم خارجية.

```js
import { searchByCategory, searchAll, getProvider, registerProvider } from '../server/provider-registry.mjs';

const turkish = await searchByCategory('turkish', 'مسلسل');
const everything = await searchAll('مسلسل');
// { status: 'success' | 'degraded' | 'error', cards: [...], errors: [...] }
const provider = getProvider('3sheeq');
const cards = await provider.directSearch('مسلسل');
const details = await provider.directDetails(cards[0].href);
const playback = await provider.directWatch(details.episodes[0].link, details.page_url);
```

السجل يضم `general: [akwam, arabseed, faselhd]` و`turkish: [3sheeq]`
و`asian: [asia2tv]` و`anime: [animelek]`. تصنيف `arabic` فارغ لأن الطلب لم يحدد
مزوداً حصرياً له. يمكن البحث في `general` للمحتوى العربي لدى المصادر العامة.

أكوام موصول بالمزود الموروث عبر محول يوحد البطاقة والتفاصيل والمشاهدة.
قصة عشق له تنفيذ كامل قابل للتهيئة. عرب سيد وفاصل وآسيا تو تي في وأنمي ليك
مسجلون بحالة `configured: false` ويعيدون `PROVIDER_NOT_CONFIGURED` حتى توفير
محولات حقيقية لهم. لا تمثل هذه المداخل دعماً تشغيلياً للمواقع. لتوصيل محول:

```js
import * as arabseed from '../server/providers/arabseed.mjs'; // المحول الذي ستضيفه
registerProvider('arabseed', arabseed);
```

كل محول يجب أن يصدر `directSearch(query)` و`directCategory(categoryUrl, page)`
و`directDetails(targetUrl)` و`directWatch(targetUrl, referer)`.
بطاقات البحث والتصنيف مصفوفة تحتوي `{ title, img, is_series, href, year, provider_id, category_tag }`.
التفاصيل تحتوي `{ status, source, movie_title, poster, episodes, page_url }`
وكل حلقة `{ num, link, episode_id }`. المشاهدة تحتوي `media_src` و`media_type`
و`candidates` المرتبة عبر `rankMediaCandidates` لتفضيل mp4 على m3u8.
يحتفظ المجمع بنفس العنوان لدى مزودين مختلفين لإبقاء خيارات التشغيل، ويحذف
تكرار الرابط داخل المزود. فشل أحد المصادر يظهر في `errors` ولا يسقط بقية النتائج.

## تهيئة قصة عشق

`THREESHEEQ_ORIGIN` يحدد النطاق المدقق؛ القيمة الابتدائية `https://3seq.com`
مثال تهيئة وليست نطاقاً حياً تم التحقق منه. `THREESHEEQ_PLAYER_HOSTS` و
`THREESHEEQ_MEDIA_HOSTS` قائمتان مفصولتان بفواصل لأسماء نطاقات دقيقة دون بروتوكول.
القائمتان فارغتان افتراضياً. لا تستخدم نطاقات لاعبين أو CDN دون تدقيق.

الروابط النسبية تحل نسبة إلى الصفحة النهائية. حماية النطاق تتحقق من HTTPS
والمضيف والمنفذ وبيانات الدخول، وتفحص كل تحويل قبل طلبه. تتبع المشاهدة محدود
بست صفحات، يشمل iframe وروابط المشاهدة المعروفة، ولا ينفذ JavaScript أو يفك
تحديات الحماية. يحتفظ `normalizeEpisodes` بأرقام الحلقات الحقيقية والفجوات
ويحول الأرقام العربية ويحذف تكرار الرابط؛ هوية الحلقة مسارها إذا لم يوجد معرّف صريح.

المحلل يستهدف HTML ثابتاً بنمط WordPress: بحث `?s=` وتصنيف `?paged=`، بطاقات
بصور داخل روابط، وعناوين حلقات صريحة. يجب ضبطه بعينات الموقع الحالي قبل النشر.
لم يجر اختبار المواقع الحية أو توصيل مسارات HTTP والواجهة بهذا السجل؛ واجهته
الخادمية جاهزة للاستيراد دون تغيير سلوك المسارات الحالية.

التحقق المحلي:

```sh
node scripts/provider_registry_test.mjs
```

يشمل عقود البيانات والفشل الجزئي وحماية التحويلات والروابط النسبية وأرقام
الحلقات ومرشحات الوسائط و ترتيب mp4 قبل HLS باستخدام fetch وهمي.
