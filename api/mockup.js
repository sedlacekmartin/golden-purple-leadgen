import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase  = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export const config = { maxDuration: 30 };

const CATEGORY_STYLE = {
  'restaurace':             { bg: '#1a0a00', accent: '#c0392b', keyword: 'restaurant' },
  'kavárna':                { bg: '#1c1209', accent: '#7B5E3A', keyword: 'cafe' },
  'pizzerie':               { bg: '#1a0a00', accent: '#c0392b', keyword: 'pizza' },
  'autoservis':             { bg: '#0d1117', accent: '#2563eb', keyword: 'garage' },
  'kadeřnictví':            { bg: '#0f0a12', accent: '#7c3aed', keyword: 'hair salon' },
  'kosmetický salon':       { bg: '#120a10', accent: '#db2777', keyword: 'beauty salon' },
  'zubař':                  { bg: '#0a1020', accent: '#0891b2', keyword: 'dental clinic' },
  'účetní':                 { bg: '#0a1020', accent: '#1d4ed8', keyword: 'office' },
  'stavební firma':         { bg: '#0d0d0d', accent: '#d97706', keyword: 'construction' },
  'strojírenství':          { bg: '#0d0d0d', accent: '#374151', keyword: 'factory' },
  'dopravní firma':         { bg: '#0a1020', accent: '#1d4ed8', keyword: 'logistics' },
};

function getStyle(category) {
  return CATEGORY_STYLE[category] || { bg: '#0f0f0f', accent: '#7c3aed', keyword: 'business' };
}

async function generateMockupHtml(lead) {
  const style   = getStyle(lead.category);
  const imgSeed = encodeURIComponent(lead.company.replace(/\s+/g, '-').toLowerCase());

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 3500,
    messages: [{
      role: 'user',
      content: `Vygeneruj kompletní HTML stránku — vizuální návrh webu pro firmu.

Firma: ${lead.company}
Kategorie: ${lead.category}
Lokalita: ${lead.location}
Primární barva: ${style.accent}
Obrázky: https://picsum.photos/seed/${imgSeed}/1200/600 (hero), https://picsum.photos/seed/${imgSeed}2/800/500 (sekce)

STRUKTURA (v tomto pořadí):
1. Sticky navigace — logo (zkratka názvu), odkazy na sekce, CTA tlačítko
2. Hero — plná výška, foto na pozadí s překryvem, velký nadpis, podnadpis, 2 CTA tlačítka
3. O nás — 2 sloupce (text vlevo, foto vpravo), 3 ikony s čísly (roky praxe, zákazníci, projekty)
4. Služby — grid 3 karet s ikonou, názvem a popisem (realistické pro ${lead.category})
5. Proč my — 4 benefity s ikonami
6. Kontakt — formulář (jméno, email, zpráva, tlačítko) + adresa + telefon
7. Footer — copyright ${lead.company}

PRAVIDLA:
- Tailwind CSS přes CDN https://cdn.tailwindcss.com
- Veškerý text česky, realistický pro obor ${lead.category} v ${lead.location}
- Plně responzivní, moderní dark/light design
- Smooth scroll mezi sekcemi
- Pevný banner vpravo nahoře: "NÁVRH • Golden Purple" — fialové pozadí, bílý text, font-size 11px, z-index 9999
- Vrať POUZE čistý HTML kód, bez markdown, bez komentářů před/po kódu`,
    }],
  });

  let html = msg.content[0].text.trim();
  if (html.startsWith('```')) {
    html = html.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
  }
  return html;
}

export default async function handler(req, res) {
  const { id, regen } = req.query;
  if (!id) return res.status(400).send('<h1>Chybí ID</h1>');

  const { data: lead, error } = await supabase
    .from('leads').select('*').eq('id', id).single();

  if (error || !lead) return res.status(404).send('<h1>Lead nenalezen</h1>');

  if (lead.mockup_html && regen !== '1') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(lead.mockup_html);
  }

  try {
    const html = await generateMockupHtml(lead);
    await supabase.from('leads').update({ mockup_html: html }).eq('id', id);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('Mockup error:', err);
    res.status(500).send(`<h1>Chyba generování</h1><pre>${err.message}</pre>`);
  }
}
