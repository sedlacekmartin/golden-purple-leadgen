import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const openai  = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export const config = { maxDuration: 60 };

const CATEGORY_STYLE = {
  'restaurace':           'warm earthy tones, deep red and gold accents, elegant dining atmosphere',
  'kavárna':              'cozy warm browns, cream whites, artisan coffee shop feel',
  'pizzerie':             'rustic Italian style, red green white palette, brick texture',
  'autoservis':           'industrial dark blue and silver, professional automotive',
  'kadeřnictví':          'modern minimalist, black white gold, luxury salon feel',
  'kosmetický salon':     'soft pink and rose gold, elegant beauty spa atmosphere',
  'zubař':                'clean clinical white and light blue, modern medical',
  'stavební firma':       'strong bold orange and dark grey, construction industrial',
  'strojírenství':        'industrial steel blue and charcoal, precision engineering',
  'dopravní firma':       'navy blue and yellow, professional logistics and transport',
  'účetní':               'trustworthy dark blue and white, professional corporate',
  'právník':              'prestigious dark navy and gold, law firm gravitas',
  'fitness':              'energetic black and electric orange, dynamic sports',
  'realitní kancelář':    'sophisticated grey and gold, premium real estate',
};

function getStyle(category) {
  return CATEGORY_STYLE[category] || 'modern professional purple and white, clean business';
}

async function generateAndStore(lead) {
  const style = getStyle(lead.category);

  const prompt = `Create a stunning, ultra-realistic website design mockup for "${lead.company}", a ${lead.category} business based in ${lead.location}, Czech Republic. ${style}.

The image should look like a real screenshot of a professionally designed website viewed on a large desktop monitor. Include these sections from top to bottom:

1. NAVIGATION BAR: Dark or colored background, company logo/name on left, 5 navigation links in center, contact button on right
2. HERO SECTION: Full-width, dramatic high-quality background photo related to ${lead.category}, dark overlay, large white bold headline about the company, subtitle text, two buttons (primary colored + ghost outline)
3. ABOUT / STATS ROW: Light background, 3-4 large numbers with labels (years of experience, clients, projects etc.)
4. SERVICES SECTION: White background, section heading, grid of 3 cards each with an icon, service name, short description
5. FOOTER: Dark background, company name, links, copyright

Style: Modern, premium, high-end design agency quality. Sharp typography, professional photography, smooth gradients, subtle shadows. Pixel-perfect UI components. The design should feel like it cost 50,000 CZK to build.`;

  const response = await openai.images.generate({
    model: 'gpt-image-1',
    prompt,
    size: '1536x1024',
    quality: 'high',
    n: 1,
  });

  const base64 = response.data[0].b64_json;
  return `data:image/png;base64,${base64}`;
}

export default async function handler(req, res) {
  const { id, regen } = req.query;
  if (!id) return res.status(400).json({ error: 'Chybí ID' });

  const { data: lead, error } = await supabase
    .from('leads').select('*').eq('id', id).single();

  if (error || !lead) return res.status(404).json({ error: 'Lead nenalezen' });

  const isValid = lead.mockup_url?.startsWith('data:image');
  if (isValid && regen !== '1') {
    return res.status(200).json({ url: lead.mockup_url });
  }

  try {
    const url = await generateAndStore(lead);
    await supabase.from('leads').update({ mockup_url: url }).eq('id', id);
    res.status(200).json({ url });
  } catch (err) {
    console.error('Mockup error:', err);
    res.status(500).json({ error: err.message });
  }
}
