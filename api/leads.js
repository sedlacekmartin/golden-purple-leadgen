import { requireUser } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const auth = await requireUser(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const { sb } = auth;

  const { status } = req.query;

  try {
    let query = sb.from('leads').select('*').order('score', { ascending: false });
    if (status) query = query.eq('status', status);
    else query = query.neq('status', 'skipped');

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    res.status(200).json({ leads: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
