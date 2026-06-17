import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// TODO: Nahradit Google Places API (GOOGLE_PLACES_API_KEY)
function searchCompanies(location, category, limit) {
  return [
    {
      name: 'Restaurace U Koruny',
      category, location,
      website: 'http://ukoruny-trebic.cz',
      phone: '+420 568 123 456',
      google_rating: 4.1,
      has_website: true,
      website_age_years: 7,
    },
    {
      name: 'Pekárna Novák s.r.o.',
      category, location,
      website: null,
      phone: '+420 568 654 321',
      google_rating: 4.6,
      has_website: false,
      website_age_years: null,
    },
    {
      name: 'Kavárna Zelená',
      category, location,
      website: 'http://kavarna-zelena-trebic.cz',
      phone: '+420 568 111 222',
      google_rating: 3.1,
      has_website: true,
      website_age_years: 3,
    },
    {
      name: 'Pizzeria Roma',
      category, location,
      website: null,
      phone: '+420 568 999 888',
      google_rating: 4.5,
      has_website: false,
      website_age_years: null,
    },
  ].slice(0, limit);
}

function scoreLead(company) {
  let score = 0;
  const reasons = [];
  if (!company.has_website) {
    score += 40;
    reasons.push('Nemá web');
  } else if (company.website_age_years > 5) {
    score += 25;
    reasons.push(`Web starý ${company.website_age_years} let`);
  }
  const rating = company.google_rating || 0;
  if (rating < 3.5) {
    score += 20;
    reasons.push('Nízké Google hodnocení');
  } else if (rating > 4.3) {
    score += 5;
    reasons.push('Dobré hodnocení = reagující firma');
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

  const { location = 'Třebíč', category = 'restaurace', limit = 10 } = req.body || {};

  try {
    const companies = searchCompanies(location, category, parseInt(limit));
    const scored = companies.map(scoreLead).filter(c => c.score > 30);

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
