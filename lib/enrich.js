// Obohacení leadů: e-mail z webu firmy + data z ARES (zdarma, bez klíče)

const FETCH_TIMEOUT = 6000;

const JUNK_EMAIL = /(example\.|sentry\.|wixpress\.|godaddy\.|cloudflare\.|\.(png|jpe?g|gif|svg|webp)$)/i;
const SKIP_SCRAPE = /(facebook\.com|instagram\.com|firmy\.cz|seznam\.cz)/i;

async function fetchText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GoldenPurpleBot/1.0)' },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function extractEmails(html) {
  const found = html.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return [...new Set(found.map(e => e.toLowerCase()))].filter(e => !JUNK_EMAIL.test(e));
}

function pickBestEmail(emails, websiteUrl) {
  if (!emails.length) return null;
  try {
    const domain = new URL(websiteUrl).hostname.replace(/^www\./, '');
    const sameDomain = emails.find(e => e.endsWith('@' + domain));
    if (sameDomain) return sameDomain;
  } catch {}
  const info = emails.find(e => /^(info|kontakt|obchod|recepce|objednavky)@/.test(e));
  return info || emails[0];
}

export async function scrapeEmail(websiteUrl) {
  if (!websiteUrl || SKIP_SCRAPE.test(websiteUrl)) return null;

  const home = await fetchText(websiteUrl);
  if (!home) return null;

  let emails = extractEmails(home);
  if (!emails.length) {
    // zkus stránku s kontakty
    const m = home.match(/href=["']([^"']*(?:kontakt|contact)[^"']*)["']/i);
    if (m) {
      try {
        const contactUrl = new URL(m[1], websiteUrl).href;
        const contact = await fetchText(contactUrl);
        if (contact) emails = extractEmails(contact);
      } catch {}
    }
  }
  return pickBestEmail(emails, websiteUrl);
}

// ── ARES ─────────────────────────────────────────────────────────────────────

const LEGAL_FORMS = {
  '101': 'OSVČ', '102': 'OSVČ', '105': 'OSVČ',
  '112': 's.r.o.', '113': 'v.o.s.', '115': 'k.s.',
  '121': 'a.s.', '205': 'družstvo', '301': 'státní podnik',
  '706': 'spolek', '751': 'zájmové sdružení',
};

const EMPLOYEE_CATS = {
  '000': 'bez zaměstnanců',
  '110': '1–5', '120': '6–9', '130': '10–19',
  '210': '20–24', '220': '25–49', '230': '50–99',
  '310': '100–199', '320': '200–249', '330': '250–499', '340': '500–999',
  '410': '1000–1499', '420': '1500–1999', '430': '2000–2499', '440': '2500–2999',
  '510': '3000–3999', '520': '4000–4999', '530': '5000–9999', '610': '10000+',
};

function normalize(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export async function aresLookup(companyName, location) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch('https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/vyhledat', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ obchodniJmeno: companyName, pocet: 5 }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const subjects = data.ekonomickeSubjekty || [];
    if (!subjects.length) return null;

    // preferuj shodu města se zadanou lokalitou, jinak jen jednoznačný výsledek
    const loc = normalize(location);
    let match = subjects.find(s =>
      loc && (normalize(s.sidlo?.nazevObce).includes(loc) || normalize(s.sidlo?.textovaAdresa).includes(loc)));
    if (!match && subjects.length === 1) match = subjects[0];
    if (!match) return null;

    let employees = null;
    const resData = await fetch(`https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty-res/${match.ico}`)
      .then(r => r.ok ? r.json() : null).catch(() => null);
    const cat = resData?.zaznamy?.[0]?.statistickeUdaje?.kategoriePoctuPracovniku;
    if (cat) employees = EMPLOYEE_CATS[cat] || null;

    return {
      ico: match.ico,
      founded: match.datumVzniku || null,
      legal_form: LEGAL_FORMS[match.pravniForma] || match.pravniForma || null,
      employees,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ── Souběh ───────────────────────────────────────────────────────────────────

export async function mapConcurrent(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function enrichCompany(company) {
  const [email, ares] = await Promise.all([
    scrapeEmail(company.website),
    aresLookup(company.name, company.location),
  ]);
  return {
    ...company,
    email,
    ico: ares?.ico || null,
    founded: ares?.founded || null,
    legal_form: ares?.legal_form || null,
    employees: ares?.employees || null,
  };
}
