/*
  إعدادات اختيارية لصراحة.
  خلّها فاضية والصفحة تشتغل عادي بالضبط مثل قبل. التفاصيل وخطوات التفعيل في SETUP.md

  • firebaseUrl: رابط Firebase Realtime Database عشان الجلسات الجديدة تبقى محفوظة أكثر من 12 ساعة.
    مثال: 'https://my-saraha-default-rtdb.firebaseio.com'

  • aiUrl: رابط خادم إعادة الصياغة بالذكاء الاصطناعي (مجلد ai-worker).
    مثال: 'https://saraha-ai.my-name.workers.dev'
    مفتاح الـ API يبقى في الخادم بس، وما يُكتب هنا أبد.
*/
window.SARAHA_CONFIG = {
  firebaseUrl: '',
  aiUrl: ''
};
