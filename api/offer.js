import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Chybí token' });

  const { data: lead, error } = await sb
    .from('leads')
    .select('id, company, location, category, mockup_url, offer_token, offer_viewed_at, offer_clicked_at, workspace_id')
    .eq('offer_token', token)
    .single();

  if (error || !lead) return res.status(404).json({ error: 'Nabídka nenalezena nebo vypršela' });

  const { data: workspace } = await sb
    .from('workspaces')
    .select('company_name, sender_name, website, offer')
    .eq('id', lead.workspace_id)
    .single();

  if (!workspace?.offer) return res.status(404).json({ error: 'Nabídka není nakonfigurována' });

  // Zaznamenat první zobrazení
  if (!lead.offer_viewed_at) {
    await sb.from('leads').update({ offer_viewed_at: new Date().toISOString() }).eq('id', lead.id);
  }

  if (req.method === 'POST') {
    // CTA click
    if (!lead.offer_clicked_at) {
      await sb.from('leads').update({ offer_clicked_at: new Date().toISOString(), status: 'replied' }).eq('id', lead.id);
    }
    return res.status(200).json({ ok: true, contact: workspace.offer.contact });
  }

  // GET — vrátí data pro stránku
  const offer = workspace.offer;
  const validUntil = lead.offer_viewed_at
    ? new Date(new Date(lead.offer_viewed_at).getTime() + (offer.validity_hours || 72) * 3600 * 1000).toISOString()
    : new Date(Date.now() + (offer.validity_hours || 72) * 3600 * 1000).toISOString();

  res.status(200).json({
    company: lead.company,
    location: lead.location,
    category: lead.category,
    mockup_url: lead.mockup_url || null,
    sender: { name: workspace.sender_name, company: workspace.company_name, website: workspace.website },
    offer: {
      items:       offer.items || [],
      price_full:  offer.price_full,
      price_offer: offer.price_offer,
      cta:         offer.cta || 'Mám zájem →',
      contact:     offer.contact,
      valid_until: validUntil,
    },
  });
}
