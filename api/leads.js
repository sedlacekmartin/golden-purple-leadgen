import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { status } = req.query;

  try {
    let query = supabase.from('leads').select('*').order('score', { ascending: false });
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    res.status(200).json({ leads: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
