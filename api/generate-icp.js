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
        content: `Napiš scoring popis ideálního zákazníka pro AI lead scoring systém.

Persona zákazníka:
- Jméno/typ: ${persona.name || '—'}
- Role: ${persona.role || '—'}, věk: ${persona.age || '—'}
- Velikost firmy: ${persona.size || '—'}
- Obor: ${persona.industry || '—'}
${pains.length ? `- Problémy zákazníka: ${pains.join('; ')}` : ''}
${goals.length ? `- Cíle zákazníka: ${goals.join('; ')}` : ''}

Úkol: Napiš stručný popis, který pomůže AI rozpoznat firmy STEJNÉHO TYPU jako je tato persona.
Popis popisuje TYP FIRMY A ZÁKAZNÍKA — ne co jim nabízíme.

Pravidla:
- Max 4 věty, max 100 slov
- Vycházej VÝHRADNĚ z dat persony výše — nepřidávej nic co tam není
- Zaměř se na: obor, velikost firmy, typickou situaci a problémy zákazníka
- NEZMIŇUJ web, online prezentaci ani marketing — pokud to není přímo v datech persony
- Piš ve třetí osobě ("Firmy v oboru...", "Typicky se jedná o...")
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
