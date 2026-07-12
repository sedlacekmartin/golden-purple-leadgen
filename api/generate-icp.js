import Anthropic from '@anthropic-ai/sdk';
import { requireUser } from '../lib/auth.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await requireUser(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  const { persona, company, pitch } = req.body || {};

  if (!persona) return res.status(400).json({ error: 'Chybí data persony' });

  const pains = [persona.pain1, persona.pain2, persona.pain3].filter(Boolean);
  const goals = [persona.goal1, persona.goal2].filter(Boolean);

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 350,
      messages: [{
        role: 'user',
        content: `Firma "${company || 'neznámá'}" nabízí: ${pitch || 'služby pro firmy'}

Vytvořili jsme personu ideálního zákazníka:
Jméno: ${persona.name || 'neznámé'}
Role: ${persona.role || 'neznámá'}
Věk: ${persona.age || 'neznámý'}
Velikost firmy: ${persona.size || 'neznámá'}
Obor: ${persona.industry || 'neznámý'}
${pains.length ? `Problémy:\n${pains.map((p, i) => `${i+1}. ${p}`).join('\n')}` : ''}
${goals.length ? `Cíle:\n${goals.map((g, i) => `${i+1}. ${g}`).join('\n')}` : ''}

Napiš stručný, konkrétní scoring popis ideálního zákazníka pro AI lead scoring systém.
Popis musí pomoci AI rozpoznat, zda konkrétní firma z Google Maps sedí na tuto personu.

Pravidla:
- Max 4 věty, max 100 slov
- Zaměř se na objektivně měřitelné znaky (obor, velikost, online přítomnost, situace)
- Piš ve třetí osobě ("Firmy v oboru...", "Typicky se jedná o...")
- Žádné firemní jargon, žádné buzzwordy
- Piš česky, bez nadpisů, jen čistý text`,
      }],
    });

    const icp = msg.content[0].text.trim();
    res.status(200).json({ icp });
  } catch (err) {
    console.error('Generate ICP error:', err);
    res.status(500).json({ error: err.message });
  }
}
