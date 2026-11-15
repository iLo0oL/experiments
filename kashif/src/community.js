'use strict';
/*
  What the community knows about a number:
  - the name its owner added themselves (only with consent, and only if not hidden)
  - how many users reported it as spam or fraud (counts only, never who reported)
*/

function createCommunity({ db, cfg }) {
  const owner = db.prepare('SELECT display_name, name_consent_at, hidden FROM users WHERE phone = ?');
  const counts = db.prepare('SELECT category, COUNT(*) AS n FROM reports WHERE phone = ? GROUP BY category');
  const mine = db.prepare('SELECT category FROM reports WHERE reporter_id = ? AND phone = ?');

  return function communityFor(phone, user) {
    const o = owner.get(phone);
    const name = o && !o.hidden && o.display_name && o.name_consent_at ? o.display_name : null;

    const c = { spam: 0, fraud: 0 };
    for (const row of counts.all(phone)) c[row.category] = row.n;
    const total = c.spam + c.fraud;
    const visible = total >= cfg.reports.minToShow;

    const my = user ? mine.get(user.id, phone) : null;
    return {
      name,
      isMe: !!user && user.phone === phone,
      reports: visible ? { spam: c.spam, fraud: c.fraud, total } : null,
      reportsMinToShow: cfg.reports.minToShow,
      myReport: my ? my.category : null,
    };
  };
}

module.exports = { createCommunity };
