import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const config = { maxDuration: 300 };

// Runs daily at 8:00 via Vercel cron — needs SUPABASE_SERVICE_ROLE_KEY in env
// Finds all contacted leads with overdue follow-up, generates drafts automatically

export default async function handler(req, res) {
  // Secure the cron endpoint
  const secret = req.headers['authorization']?.replace('Bearer ', '');
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY, // bypass RLS to access all workspaces
    { auth: { persistSession: false } }
  );

  const now = new Date().toISOString();

  // Find all leads overdue for follow-up (max 2 follow-ups per lead)
  const { data: leads, error } = await sb
    .from('leads')
    .select('*, workspaces(*)')
    .eq('status', 'contacted')
    .lt('followup_due_at', now)
    .lt('followup_count', 2)
    .not('followup_due_at', 'is', null);

  if (error) {
    console.error('Cron query error:', error.message);
    return res.status(500).json({ error: error.message });
  }

  console.log(`Follow-up cron: ${leads?.length ?? 0} leads to process`);

  let processed = 0;
  for (const lead of (leads || [])) {
    const workspace = lead.workspaces;
    if (!workspace) continue;

    try {
      const count = (lead.followup_count || 0) + 1;
      const daysSince = lead.contacted_at
        ? Math.round((Date.now() - new Date(lead.contacted_at)) / 86400000)
        : 5;

      const msg = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `Jsi ${workspace.sender_name} z firmy ${workspace.company_name}.
Co nabízíš: ${workspace.pitch || 'služby pro firmy'}
Před ${daysSince} dny jsi poslal e-mail firmě ${lead.company} (${lead.category}, ${lead.location}). Neodpověděli.
Follow-up č. ${count}: max 3 věty, stručný, nový úhel, bez omluv, CTA na odpověď.
Podpis: ${workspace.sender_name} / ${workspace.company_name}`,
        }],
      });

      const draft = msg.content[0].text;
      const nextDue = new Date();
      nextDue.setDate(nextDue.getDate() + 14);

      await sb.from('leads').update({
        followup_draft: draft,
        followup_count: count,
        followup_due_at: nextDue.toISOString(),
      }).eq('id', lead.id);

      processed++;
    } catch (e) {
      console.error(`Followup failed for lead ${lead.id}:`, e.message);
    }
  }

  res.status(200).json({ processed, total: leads?.length ?? 0 });
}
