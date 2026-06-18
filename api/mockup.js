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

  const prompt = `Ultra-realistic website design mockup screenshot for "${lead.company}", a ${lead.category} business in ${lead.location}. ${style}. Shown as a full desktop browser viewport. Design includes: sticky navigation bar with logo text and 4 menu links, full-width hero section with a stunning professional background photo, large bold headline in white, subtitle text, two CTA buttons. Below: a clean white section with 3 feature/service cards with icons, each with a short heading and description. Footer with contact info. Pixel-perfect modern UI, Dribbble-quality web design, professional typography, realistic and detailed. High-end agency portfolio style. No lorem ipsum.`;

  const response = await openai.images.generate({
    model: 'dall-e-3',
    prompt,
    size: '1792x1024',
    quality: 'hd',
    n: 1,
  });

  const tempUrl = response.data[0].url;
  const imgRes = await fetch(tempUrl);
  const buffer = await imgRes.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
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
