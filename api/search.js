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

async function scoreLeadsIcp(companies, workspace) {
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

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: `Firma "${workspace.company_name}" hledá zákazníky.
Co nabízí: ${workspace.pitch || 'neuvedeno'}
Ideální zákazník: ${workspace.icp}

Ohodnoť každou firmu skóre 0–100 podle shody s ideálním zákazníkem
a uveď max 3 krátké důvody česky.

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

// ── Draft e-mailu z profilu workspace ────────────────────────────────────────

async function draftEmail(company, workspace) {
  const facts = [
    `Firma: ${company.name} | ${company.location} | ${company.category}`,
    `Má web: ${company.has_website}`,
    company.founded ? `Založena: ${company.founded.slice(0, 4)}` : null,
    company.employees ? `Zaměstnanců: ${company.employees}` : null,
    company.legal_form ? `Právní forma: ${company.legal_form}` : null,
  ].filter(Boolean).join('\n');

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `Jsi ${workspace.sender_name} z firmy ${workspace.company_name}${workspace.website ? ` (${workspace.website})` : ''}.
Co nabízíš: ${workspace.pitch || 'služby pro firmy'}
Napiš krátký, přirozený, neprodejný e-mail pro tuto firmu.
${facts}
Proč příležitost: ${company.reasons.join(', ')}
Pravidla: max 5 vět, žádná klišé, konkrétní zmínka situace (klidně využij stáří firmy nebo velikost, pokud to zní přirozeně), CTA na call/reply, přímý lidský tón.
Podpis: ${workspace.sender_name} / ${workspace.company_name}`,
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

    // 3) scoring podle režimu workspace
    const scored = isIcp
      ? await scoreLeadsIcp(enriched, workspace)
      : enriched.map(scoreLeadWeb);

    // 4) drafty paralelně
    const withDrafts = await mapConcurrent(scored, 5, async c => ({
      ...c,
      email_draft: await draftEmail(c, workspace).catch(err => {
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
