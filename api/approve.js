import { requireUser } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = await requireUser(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const { sb, workspace } = auth;

  const { id, status, email_draft, notes, follow_up, contacted_at, skip_reason } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id is required' });

  try {
    const updates = {};
    if (status !== undefined) updates.status = status;
    if (email_draft !== undefined) updates.email_draft = email_draft;
    if (notes !== undefined) updates.notes = notes;
    if (follow_up !== undefined) updates.follow_up = follow_up || null;
    if (contacted_at !== undefined) updates.contacted_at = contacted_at;
    if (skip_reason !== undefined) updates.skip_reason = skip_reason || null;

    const { data, error } = await sb
      .from('leads')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // Fire webhook (fire-and-forget — never fail the request because of it)
    if (workspace?.webhook_url) {
      fetch(workspace.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'lead.updated', lead: data, workspace_id: workspace.id }),
      }).catch(e => console.error('Webhook error:', e.message));
    }

    res.status(200).json({ lead: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
