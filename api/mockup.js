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

  const prompt = `Professional website landing page mockup design for "${lead.company}", a ${lead.category} business located in ${lead.location}, Czech Republic. ${style}. Desktop browser screenshot, full page view showing: modern navigation bar with logo and menu, large hero section with compelling headline and call-to-action button, services or features section with 3 cards, contact section. Ultra realistic web design, high quality UI, modern typography, professional photography as background. Clean layout, pixel perfect design. No text overlays in foreign languages.`;

  const response = await openai.images.generate({
    model: 'gpt-image-1',
    prompt,
    size: '1536x1024',
    quality: 'medium',
    n: 1,
  });

  const base64 = response.data[0].b64_json;
  const buffer = Buffer.from(base64, 'base64');

  // Upload to Supabase Storage
  const fileName = `${lead.id}.png`;
  await supabase.storage.from('mockups').upload(fileName, buffer, {
    contentType: 'image/png',
    upsert: true,
  });

  const { data: { publicUrl } } = supabase.storage.from('mockups').getPublicUrl(fileName);
  return publicUrl;
}

export default async function handler(req, res) {
  const { id, regen } = req.query;
  if (!id) return res.status(400).json({ error: 'Chybí ID' });

  const { data: lead, error } = await supabase
    .from('leads').select('*').eq('id', id).single();

  if (error || !lead) return res.status(404).json({ error: 'Lead nenalezen' });

  if (lead.mockup_url && regen !== '1') {
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
