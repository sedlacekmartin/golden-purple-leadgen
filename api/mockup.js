import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const openai    = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase  = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export const config = { maxDuration: 60 };

const CATEGORY_STYLE = {
  'restaurace':           'warm earthy tones, deep red and gold accents, elegant dining',
  'kavárna':              'cozy warm browns and cream whites, artisan coffee shop',
  'pizzerie':             'rustic Italian, red green white palette',
  'autoservis':           'industrial dark blue and silver, professional automotive',
  'kadeřnictví':          'modern minimalist black white gold, luxury salon',
  'kosmetický salon':     'soft pink and rose gold, elegant beauty spa',
  'zubař':                'clean white and light blue, modern medical clinic',
  'stavební firma':       'bold orange and dark grey, construction industrial',
  'strojírenství':        'steel blue and charcoal, precision engineering',
  'dopravní firma':       'navy blue and yellow, professional logistics',
  'účetní':               'trustworthy dark blue and white, professional corporate',
  'právník':              'dark navy and gold, prestigious law firm',
  'fitness':              'black and electric orange, dynamic sports energy',
  'realitní kancelář':    'sophisticated grey and gold, premium real estate',
  'CNC obrábění':         'industrial steel blue, precision manufacturing',
};

function getStyle(category) {
  return CATEGORY_STYLE[category] || 'modern professional purple and white, clean business';
}

async function buildPrompt(lead) {
  const style = getStyle(lead.category);
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `You are an expert at writing image generation prompts for gpt-image-1 to create realistic website mockup screenshots.

Write a single detailed image generation prompt for this Czech business website mockup:

Company: ${lead.company}
Type: ${lead.category}
Location: ${lead.location}
Visual style: ${style}

Requirements for the prompt you write:
- ALL visible text must be in Czech language (Czech navigation, Czech headlines, Czech descriptions, Czech CTAs like "Nezávazná poptávka", "Zjistit více", "Kontaktujte nás")
- Describe a realistic full desktop website screenshot showing multiple sections
- Include specific, realistic Czech content appropriate for ${lead.category} (realistic stats, real-looking phone +420 format, Czech address)
- Describe professional photography relevant to ${lead.category}
- The design quality should match top Czech web agencies - pixel perfect, modern, convincing
- Include company name "${lead.company}" prominently in the design

Output ONLY the image prompt text, no explanation, no preamble.`,
    }],
  });
  return msg.content[0].text.trim();
}

async function generateAndStore(lead) {
  const prompt = await buildPrompt(lead);
  console.log('Image prompt:', prompt.slice(0, 200));

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
