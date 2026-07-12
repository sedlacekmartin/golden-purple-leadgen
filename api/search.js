import Anthropic from '@anthropic-ai/sdk';
import { requireUser } from '../lib/auth.js';
import { enrichCompany, mapConcurrent } from '../lib/enrich.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY;

export const config = { maxDuration: 60 };

async function searchCompanies(location, category, limit) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': PLACES_KEY,
      'X-Goog-FieldMask': 'places.displayName,places.rating,places.userRatingCount,places.websiteUri,places.nationalPhoneNumber',
    },
    body: JSON.stringify({ textQuery: `${category} ${location}`, languageCode: 'cs', pageSize: limit }),
  });

  const data = await res.json();
  if (!res.ok || data.error) throw new Error(`Google Places ${res.status}: ${data.error?.message || JSON.stringify(data.error)}`);

  return (data.places || []).map(p => ({
    name: p.displayName?.text || '',
    category,
    location,
    website: p.websiteUri || null,
    phone: p.nationalPhoneNumber || null,
    google_rating: p.rating || null,
    review_count: p.userRatingCount || 0,
    has_website: !!p.websiteUri,
  }));
}

// ── Feedback loop: historická data z vlastních leadů ─────────────────────────

async function getWorkspaceInsights(sb, workspaceId) {
  const { data: leads } = await sb
    .from('leads')
    .select('status, category, skip_reason')
    .eq('workspace_id', workspaceId)
    .in('status', ['approved', 'skipped'])
    .order('created_at', { ascending: false })
    .limit(200);

  if (!leads || leads.length < 5) return null;

  const total = leads.length;
  const approved = leads.filter(l => l.status === 'approved').length;
  const approvalRate = Math.round(approved / total * 100);

  const catMap = {};
  leads.forEach(l => {
    if (!l.category) return;
    if (!catMap[l.category]) catMap[l.category] = { approved: 0, total: 0 };
    catMap[l.category].total++;
    if (l.status === 'approved') catMap[l.category].approved++;
  });
  const bestCats = Object.entries(catMap)
    .filter(([, v]) => v.total >= 3)
    .sort((a, b) => (b[1].approved / b[1].total) - (a[1].approved / a[1].total))
    .slice(0, 3)
    .map(([cat, v]) => `${cat} (${Math.round(v.approved / v.total * 100)} % approval)`);

  const reasonMap = {};
  leads.filter(l => l.skip_reason).forEach(l => {
    l.skip_reason.split(', ').forEach(r => { if (r) reasonMap[r] = (reasonMap[r] || 0) + 1; });
  });
  const topReasons = Object.entries(reasonMap).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r]) => r);

  return { total, approvalRate, bestCats, topReasons };
}

function formatInsights(insights) {
  if (!insights) return '';
  const lines = [
    `\nHistorický kontext (z posledních ${insights.total} rozhodnutých leadů):`,
    `- Celkový approval rate: ${insights.approvalRate} %`,
    insights.bestCats.length ? `- Nejlépe fungující kategorie: ${insights.bestCats.join(', ')}` : null,
    insights.topReasons.length ? `- Nejčastější důvody přeskočení: ${insights.topReasons.join(', ')}` : null,
  ];
  return lines.filter(Boolean).join('\n');
}

// ── Scoring: režim "web" (slabá online prezentace) ───────────────────────────

function scoreLeadWeb(company) {
  let score = 0;
  const reasons = [];

  if (!company.has_website) {
    score += 40;
    reasons.push('Nemá web');
  }

  const rating = company.google_rating || 0;
  if (rating < 3.5) {
    score += 20;
    reasons.push('Nízké Google hodnocení');
  } else if (rating > 4.3) {
    score += 5;
    reasons.push('Dobré hodnocení = reagující firma');
  }

  const reviews = company.review_count || 0;
  if (reviews < 20) {
    score += 25;
    reasons.push('Málo recenzí — slabá online přítomnost');
  } else if (reviews < 50) {
    score += 10;
    reasons.push('Podprůměrný počet recenzí');
  }

  return { ...company, score, reasons };
}

// ── Scoring: režim "icp" (AI shoda s ideálním zákazníkem) ────────────────────

async function scoreLeadsIcp(companies, workspace, insights) {
  const list = companies.map((c, i) => ({
    i,
    name: c.name,
    category: c.category,
    location: c.location,
    website: c.website,
    rating: c.google_rating,
    reviews: c.review_count,
    founded: c.founded,
    employees: c.employees,
    legal_form: c.legal_form,
  }));

  const p = workspace.persona;
  const personaContext = p ? `
Persona ideálního zákazníka:
- Jméno/typ: ${p.name || ''}
- Role: ${p.role || ''}, věk: ${p.age || ''}
- Firma: ${p.size || ''}, obor: ${p.industry || ''}
- Problémy: ${[p.pain1, p.pain2, p.pain3].filter(Boolean).join('; ')}
- Cíle: ${[p.goal1, p.goal2].filter(Boolean).join('; ')}` : '';

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: `Firma "${workspace.company_name}" hledá zákazníky.
Co nabízí: ${workspace.pitch || 'neuvedeno'}
Ideální zákazník (scoring popis): ${workspace.icp}
${personaContext}
${formatInsights(insights)}

Ohodnoť každou firmu skóre 0–100 podle shody s ideálním zákazníkem a personou.
${insights ? 'Zohledni historický kontext — kategorie s vyšším approval rate jsou pravděpodobně lepší shoda.' : ''}
Uveď max 3 krátké konkrétní důvody česky (proč sedí nebo nesedí).

Firmy: ${JSON.stringify(list)}

Odpověz POUZE validním JSON polem: [{"i": 0, "score": 75, "reasons": ["...", "..."]}, ...]`,
    }],
  });

  let scores = [];
  try {
    const text = msg.content[0].text.trim().replace(/^```json?\s*|\s*```$/g, '');
    scores = JSON.parse(text);
  } catch (e) {
    console.error('ICP scoring parse error:', e.message);
    return companies.map(c => ({ ...c, score: 50, reasons: ['AI scoring selhal — výchozí skóre'] }));
  }

  return companies.map((c, idx) => {
    const s = scores.find(x => x.i === idx);
    return { ...c, score: s?.score ?? 50, reasons: s?.reasons ?? [] };
  });
}

// ── Opening styly — generické, fungují pro jakýkoliv B2B byznys ──────────────

const OPENING_STYLES = [
  // 1 — Lokální průzkum
  (c) => `Procházím firmy v ${c.location} v oboru ${c.category} a ${c.name} mi přišla jako zajímavá adresa — proto Vám píšu.`,
  // 2 — Přímé B2B
  (c) => `Hledám firmy v ${c.location} pro případnou spolupráci a ${c.name} mi přijde jako dobré spojení — dovolte, abych se představil.`,
  // 4 — Kompliment + příležitost
  (c) => `${c.google_rating && c.google_rating > 4 ? `Dobré hodnocení na Googlu — vidím, že ${c.name} má solidní základ.` : `Podíval jsem se na ${c.name} a myslím, že máte potenciál, který ještě není plně využitý.`} Proto Vám píšu.`,
  // 6 — Zákaznický pohled
  (c) => `Trochu jsem se podíval na ${c.name} v ${c.location} — a říkám si, že by stálo za to se Vám ozvat.`,
  // 8 — Spolupráce v regionu
  (c) => `Pracujeme s firmami v ${c.location} a ${c.name} mi přijde jako někdo, s kým by se dalo mluvit o spolupráci.`,
  // 11 — Rozšiřuju klientskou základnu
  (c) => `Rozšiřuji spolupráci s firmami v oboru ${c.category} v ${c.location} a připravil jsem pro Vás konkrétní nabídku.`,
];

function pickOpening(company) {
  const style = OPENING_STYLES[Math.floor(Math.random() * OPENING_STYLES.length)];
  return style(company);
}

// ── Draft e-mailu z profilu workspace ────────────────────────────────────────

async function draftEmail(company, workspace, insights) {
  const opening = pickOpening(company);

  const companyContext = [
    company.founded ? `Firma existuje od ${company.founded.slice(0, 4)}` : null,
    company.employees ? `Počet zaměstnanců: ${company.employees}` : null,
    company.legal_form ? `Právní forma: ${company.legal_form}` : null,
    company.google_rating ? `Google hodnocení: ${company.google_rating} (${company.review_count} recenzí)` : null,
  ].filter(Boolean).join(', ');

  const m = workspace.messaging || {};
  const p = workspace.persona || {};
  const ctaMap = {
    konzultace: 'nezávazný hovor nebo bezplatnou konzultaci',
    demo: 'krátkou demo ukázku výsledků',
    reply: 'odpověď — zájem ano/ne',
    telefon: 'telefonát v čas, který vám vyhovuje',
    nabidka: 'nezávaznou nabídku',
  };
  const ctaPhrase = ctaMap[m.cta_type] || 'krátký hovor';

  const insightHint = insights && insights.bestCats.some(c => c.startsWith(company.category))
    ? `Poznámka: kategorie "${company.category}" má historicky nadprůměrný approval rate — tato firma má vysoký potenciál.`
    : '';

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `Napiš krátký B2B cold email v češtině. Přímo, bez klišé, lidsky.
${insightHint}

Odesílatel: ${workspace.sender_name}, firma ${workspace.company_name}${workspace.website ? ` (${workspace.website})` : ''}
Co nabízí: ${workspace.pitch || 'služby pro firmy'}
${m.problem ? `Problém, který pojmenováváme: ${m.problem}` : ''}
${m.proof ? `Důkaz / reference: ${m.proof}` : ''}
${m.objection ? `Nejčastější námitka a odpověď: ${m.objection}` : ''}
${p.trigger ? `Buying trigger — kdy zákazník potřebu cítí nejvíc: ${p.trigger}` : ''}
${p.priority ? `Co musí nastat, aby se z toho stala priorita: ${p.priority}` : ''}

Příjemce: ${company.name}, ${company.location}, obor: ${company.category}
${companyContext ? `Kontext o firmě: ${companyContext}` : ''}
${company.reasons?.length ? `Interní signál proč oslovit (NEPIŠ doslova, jen se tím inspiruj při volbě tónu): ${company.reasons.join(', ')}` : ''}

Pravidla:
- Začni PŘESNĚ tímto větou (nic před ní): "${opening}"
- Celkem max 5 vět včetně úvodní
- VŽDY vykat — žádné tykání, žádné neformální oslovení
- Nikdy nepoužij slovo "problém" — místo toho "prostor pro zlepšení", "výzva" nebo "příležitost"
- CTA: nabídni ${ctaPhrase}
- Podpis: ${workspace.sender_name} / ${workspace.company_name}
- Nepiš předmět emailu, jen tělo`,
    }],
  });
  return msg.content[0].text;
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await requireUser(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const { sb, workspace } = auth;
  if (!workspace) return res.status(400).json({ error: 'Nejdřív si vyplň profil firmy (⚙ Nastavení)' });

  const { location = 'Třebíč', categories = ['restaurace'], limit = 10 } = req.body || {};

  // ICP mode is heavy (Claude call per draft) — cap total to avoid Vercel 60s timeout
  const isIcp = workspace.scoring_mode === 'icp' && workspace.icp;
  const effectiveLimit = isIcp ? Math.min(parseInt(limit), 15) : parseInt(limit);

  try {
    const perCat = Math.max(2, Math.ceil(effectiveLimit / categories.length));
    const allCompanies = [];
    for (const cat of categories) {
      const results = await searchCompanies(location, cat, perCat);
      allCompanies.push(...results);
      if (allCompanies.length >= effectiveLimit) break;
    }
    console.log('Companies found:', allCompanies.length);

    // 1) vyřaď duplicity (RLS omezuje dotaz na vlastní workspace)
    const fresh = [];
    for (const company of allCompanies) {
      const { data: existing } = await sb
        .from('leads')
        .select('id')
        .eq('company', company.name)
        .neq('status', 'skipped')
        .maybeSingle();
      if (existing) { console.log('Duplicate skip:', company.name); continue; }
      fresh.push(company);
    }

    // 2) obohať: e-mail z webu + ARES (paralelně)
    const enriched = await mapConcurrent(fresh, 5, enrichCompany);

    // 3) feedback loop — historické insights z vlastních leadů
    const insights = await getWorkspaceInsights(sb, workspace.id);
    if (insights) console.log(`Insights: ${insights.approvalRate}% approval, bestCats: ${insights.bestCats.join(', ')}`);

    // 4) scoring podle režimu workspace
    const scored = isIcp
      ? await scoreLeadsIcp(enriched, workspace, insights)
      : enriched.map(scoreLeadWeb);

    // 5) drafty paralelně
    const withDrafts = await mapConcurrent(scored, 5, async c => ({
      ...c,
      email_draft: await draftEmail(c, workspace, insights).catch(err => {
        console.error('Draft error:', c.name, err.message);
        return null;
      }),
    }));

    // 5) ulož
    const leads = [];
    for (const company of withDrafts) {
      const { data, error } = await sb
        .from('leads')
        .insert({
          workspace_id: workspace.id,
          company: company.name,
          location: company.location,
          category: company.category,
          website: company.website,
          phone: company.phone,
          email: company.email,
          ico: company.ico,
          founded: company.founded,
          legal_form: company.legal_form,
          employees: company.employees,
          score: company.score,
          reasons: company.reasons,
          email_draft: company.email_draft,
          status: 'pending',
        })
        .select()
        .single();

      if (error) { console.error('Supabase insert:', error.message); continue; }
      leads.push(data);
    }

    res.status(200).json({ leads });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: err.message });
  }
}
