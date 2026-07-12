import Anthropic from '@anthropic-ai/sdk';
import { requireUser } from '../lib/auth.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const config = { maxDuration: 30 };

async function generateFollowUpDraft(lead, workspace) {
  const count = (lead.followup_count || 0) + 1;
  const daysSince = lead.contacted_at
    ? Math.round((Date.now() - new Date(lead.contacted_at)) / 86400000)
    : 5;

  const tone = count === 1
    ? 'přátelský, lehce neformální, zmínka na předchozí e-mail'
    : 'stručný, nový úhel pohledu nebo konkrétní otázka, bez omluv za připomenutí';

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: `Jsi ${workspace.sender_name} z firmy ${workspace.company_name}${workspace.website ? ` (${workspace.website})` : ''}.
Co nabízíš: ${workspace.pitch || 'služby pro firmy'}
Před ${daysSince} dny jsi poslal e-mail firmě ${lead.company} (${lead.category}, ${lead.location}). Neodpověděli.
Toto je follow-up č. ${count}.

Tón: ${tone}
Pravidla: max 3 věty, konkrétní a lidský tón, žádná klišé, CTA na odpověď nebo krátký hovor.
Podpis: ${workspace.sender_name} / ${workspace.company_name}`,
    }],
  });
  return msg.content[0].text;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await requireUser(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const { sb, workspace } = auth;
  if (!workspace) return res.status(400).json({ error: 'Chybí profil firmy' });

  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Chybí ID leadu' });

  const { data: lead, error } = await sb.from('leads').select('*').eq('id', id).single();
  if (error || !lead) return res.status(404).json({ error: 'Lead nenalezen' });

  try {
    const draft = await generateFollowUpDraft(lead, workspace);
    const newCount = (lead.followup_count || 0) + 1;
    const nextDue = new Date();
    nextDue.setDate(nextDue.getDate() + (newCount === 1 ? 7 : 14));

    const { data: updated } = await sb.from('leads').update({
      followup_draft: draft,
      followup_count: newCount,
      followup_due_at: nextDue.toISOString(),
    }).eq('id', id).select().single();

    res.status(200).json({ draft, followup_count: newCount, lead: updated });
  } catch (err) {
    console.error('Followup error:', err);
    res.status(500).json({ error: err.message });
  }
}
