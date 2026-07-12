import Anthropic from '@anthropic-ai/sdk';
import { requireUser } from '../lib/auth.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await requireUser(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  const { q1, q2, q3, q4, company, pitch } = req.body || {};
  if (!q1 || !q2 || !q3) return res.status(400).json({ error: 'Chybí odpovědi na otázky' });

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `Firma "${company || 'neznámá'}" nabízí: ${pitch || 'služby'}

Na základě těchto odpovědí napiš stručný, konkrétní popis ideálního zákazníka (ICP) pro AI lead scoring:

Obor zákazníků: ${q1}
Velikost firmy: ${q2}
Problém který řešíš: ${q3}
${q4 ? `Proč tě vybírají: ${q4}` : ''}

Pravidla:
- Max 3 věty, max 80 slov
- Konkrétní (obor, velikost, situace), žádné obecné fráze
- Zaměř se na charakteristiky které pomůžou AI rozpoznat dobré leady
- Piš česky, bez uvozovek, bez nadpisů — jen text popisu

Příklad výstupu: "Výrobní firmy s 10–50 zaměstnanci v oborech kovo, plast nebo dřevo, které nemají vlastní marketingové oddělení. Typicky existují 5–20 let, mají slabou nebo žádnou online prezentaci a hledají způsob jak získat nové B2B zákazníky mimo osobní doporučení."`,
      }],
    });

    const icp = msg.content[0].text.trim();
    res.status(200).json({ icp });
  } catch (err) {
    console.error('Generate ICP error:', err);
    res.status(500).json({ error: err.message });
  }
}
