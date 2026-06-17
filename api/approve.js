import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { id, status, email_draft } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id is required' });

  try {
    const updates = {};
    if (status !== undefined) updates.status = status;
    if (email_draft !== undefined) updates.email_draft = email_draft;

    const { data, error } = await supabase
      .from('leads')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.status(200).json({ lead: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
