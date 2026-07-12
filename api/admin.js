import { createClient } from '@supabase/supabase-js';
import { requireUser } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  // Auth check
  const auth = await requireUser(req);
  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  const envEmails = (process.env.ADMIN_EMAIL || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  // fallback hardcoded so access works even if env var isn't updated yet
  const adminEmails = envEmails.length ? envEmails : ['sedlacek_m@centrum.cz', 'sedlacekmartin1@gmail.com'];
  if (!adminEmails.includes(auth.user.email?.toLowerCase())) {
    return res.status(403).json({ error: 'Přístup odepřen' });
  }

  // Service role client — bypasses RLS
  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  try {
    // All workspaces
    const { data: workspaces, error: wsErr } = await sb
      .from('workspaces')
      .select('*')
      .order('created_at', { ascending: false });
    if (wsErr) throw wsErr;

    // Lead counts per workspace
    const { data: leads, error: lErr } = await sb
      .from('leads')
      .select('workspace_id, status, created_at');
    if (lErr) throw lErr;

    // User emails from auth
    const { data: { users }, error: uErr } = await sb.auth.admin.listUsers({ perPage: 1000 });
    if (uErr) throw uErr;

    const userMap = {};
    (users || []).forEach(u => { userMap[u.id] = u.email; });

    // Merge data
    const now = Date.now();
    const week = 7 * 24 * 60 * 60 * 1000;

    const result = workspaces.map(ws => {
      const wsLeads = leads.filter(l => l.workspace_id === ws.id);
      const byStatus = {};
      wsLeads.forEach(l => { byStatus[l.status] = (byStatus[l.status] || 0) + 1; });
      const lastLead = wsLeads.length
        ? new Date(Math.max(...wsLeads.map(l => new Date(l.created_at)))).toISOString()
        : null;
      return {
        ...ws,
        email: userMap[ws.owner] || '—',
        total_leads: wsLeads.length,
        by_status: byStatus,
        last_lead_at: lastLead,
        active_this_week: lastLead && (now - new Date(lastLead)) < week,
      };
    });

    // Global stats
    const stats = {
      workspaces: result.length,
      total_leads: leads.length,
      won: leads.filter(l => l.status === 'won').length,
      active_workspaces: result.filter(w => w.active_this_week).length,
    };

    res.status(200).json({ workspaces: result, stats });
  } catch (err) {
    console.error('Admin error:', err);
    res.status(500).json({ error: err.message });
  }
}
