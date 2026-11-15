'use strict';
const { loadConfig } = require('./config');
const { openDb, cleanup } = require('./db');
const { createApp } = require('./app');

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const app = createApp({ cfg, db });

cleanup(db, cfg);
setInterval(() => cleanup(db, cfg), 3600 * 1000).unref();

const server = app.listen(cfg.port, () => {
  console.log(`[kashif] يشتغل على http://localhost:${cfg.port}`);
  console.log(`[kashif] رموز التحقق: ${cfg.otp.provider === 'console' ? 'تطلع هنا في الطرفية (وضع التطوير)' : 'Twilio Verify'}`);
  console.log(`[kashif] معلومات شركة الاتصالات: ${cfg.twilio.lookupEnabled ? 'مفعّلة (Twilio Lookup)' : 'غير مفعّلة'}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
