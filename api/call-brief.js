import Anthropic from '@anthropic-ai/sdk';
import { requireUser } from '../lib/auth.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await requireUser(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const { sb, workspace } = auth;

  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Chybí ID leadu' });

  const { data: lead, error } = await sb.from('leads').select('*').eq('id', id).single();
  if (error || !lead) return res.status(404).json({ error: 'Lead nenalezen' });

  // Vrátíme cached brief pokud už existuje
  if (lead.call_brief) return res.status(200).json({ brief: lead.call_brief });

  const m = workspace.messaging || {};
  const p = workspace.persona || {};

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Připrav stručný call brief pro B2B telefonát v češtině. Formálně, výhradně vykat.

Odesílatel: ${workspace.sender_name}, firma ${workspace.company_name}
Co nabízí: ${workspace.pitch || 'B2B služby'}
${m.problem ? `Problém zákazníka: ${m.problem}` : ''}
${p.role ? `Cílová osoba: ${p.role}` : ''}${p.seniority ? `, ${p.seniority}` : ''}
${p.priority_focus ? `Co zákazník primárně řeší: ${p.priority_focus}` : ''}
${p.blocker ? `Kdo nákup blokuje: ${p.blocker}` : ''}
${p.trigger ? `Kdy potřeba vzniká: ${p.trigger}` : ''}
${lead.buying_trigger ? `Detekovaný signál u této firmy: ${lead.buying_trigger}` : ''}

Volaná firma: ${lead.company}, ${lead.location}, obor: ${lead.category}
${lead.employees ? `Zaměstnanců: ${lead.employees}` : ''}

Formát výstupu — přesně dodržuj tyto sekce, nic nepřidávej:
ÚVOD: [Jedna konkrétní věta — jak se představíš a proč voláš. Vykat.]
OTÁZKY:
• [otázka 1 — zjistit situaci nebo potřebu]
• [otázka 2 — zjistit rozhodovatele nebo timing]
NÁMITKA: [nejpravděpodobnější námitka]
ODPOVĚĎ: [stručná odpověď na námitku]
CÍL HOVORU: [co chceš od hovoru odejít — max 1 věta]`,
      }],
    });

    const brief = msg.content[0].text.trim();
    await sb.from('leads').update({ call_brief: brief }).eq('id', id);
    res.status(200).json({ brief });
  } catch (err) {
    console.error('Call brief error:', err);
    res.status(500).json({ error: err.message });
  }
}
