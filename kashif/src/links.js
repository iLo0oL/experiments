'use strict';
/*
  "Search in other apps" buttons.
  These only build links that open the other app or website with the number filled in.
  The person does the search themselves, under that service's own terms.
  Kashif never fetches, scrapes or stores anything from these services.
*/

function externalLinks(info) {
  const digits = info.e164.replace(/\D/g, '');
  const country = (info.country || '').toLowerCase();
  const google = `"${info.international}" OR "${info.e164}" OR "${info.national}"`;

  const links = [
    { id: 'whatsapp', label: 'واتساب', url: `https://wa.me/${digits}` },
    { id: 'telegram', label: 'تيليجرام', url: `https://t.me/+${digits}` },
    country && { id: 'truecaller', label: 'تروكولر', url: `https://www.truecaller.com/search/${country}/${info.nationalNumber}` },
    { id: 'google', label: 'قوقل', url: `https://www.google.com/search?q=${encodeURIComponent(google)}` },
    { id: 'call', label: 'اتصال', url: `tel:${info.e164}` },
  ];
  return links.filter(Boolean);
}

module.exports = { externalLinks };
