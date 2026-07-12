// Ověření přihlášení v API endpointech.
// Klient posílá Authorization: Bearer <access_token> ze Supabase Auth.
// Supabase klient vytvořený s tokenem uživatele respektuje RLS —
// každý dotaz automaticky vidí jen data vlastního workspace.

import { createClient } from '@supabase/supabase-js';

export async function requireUser(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return { error: 'Nepřihlášen', status: 401 };

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  const { data: { user }, error } = await sb.auth.getUser(token);
  if (error || !user) return { error: 'Neplatné přihlášení', status: 401 };

  const { data: workspace } = await sb
    .from('workspaces')
    .select('*')
    .eq('owner', user.id)
    .maybeSingle();

  return { sb, user, workspace };
}
