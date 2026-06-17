import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY;

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
  console.log('Places raw:', JSON.stringify(data).slice(0, 500));
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
    website_age_years: null,
  }));
}

function scoreLead(company) {
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

async function draftEmail(company) {
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `Jsi Martin z agentury Golden Purple (goldenpurple.cz).
Napiš krátký, přirozený, neprodejný e-mail pro tuto firmu.
Firma: ${company.name} | ${company.location} | ${company.category}
Má web: ${company.has_website} | Stáří webu: ${company.website_age_years ?? 'N/A'} let
Proč příležitost: ${company.reasons.join(', ')}
Pravidla: max 5 vět, žádná klišé, konkrétní zmínka situace, CTA na call/reply, přímý lidský tón.
Podpis: Martin / Golden Purple`,
    }],
  });
  return msg.content[0].text;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { location = 'Třebíč', categories = ['restaurace'], limit = 10 } = req.body || {};

  try {
    const perCat = Math.max(3, Math.ceil(parseInt(limit) / categories.length));
    const allCompanies = [];
    for (const cat of categories) {
      const results = await searchCompanies(location, cat, perCat);
      allCompanies.push(...results);
    }
    const companies = allCompanies;
    console.log('Companies found:', companies.length);
    const scored = companies.map(scoreLead);

    const leads = [];
    for (const company of scored) {
      const draft = await draftEmail(company);
      const { data, error } = await supabase
        .from('leads')
        .insert({
          company: company.name,
          location: company.location,
          category: company.category,
          website: company.website,
          phone: company.phone,
          score: company.score,
          reasons: company.reasons,
          email_draft: draft,
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
