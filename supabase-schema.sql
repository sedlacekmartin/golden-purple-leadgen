-- Multi-tenant schéma — spusť v Supabase SQL Editoru
-- (bezpečné spustit opakovaně)

-- 1. Workspace = jedna firma / zákazník
create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  owner uuid references auth.users not null unique,
  company_name text not null,
  sender_name text not null,
  website text,
  pitch text,                        -- co firma nabízí (jde do promptu draftů)
  icp text,                          -- popis ideálního zákazníka (pro AI scoring)
  scoring_mode text default 'web',   -- 'web' = slabá online prezentace | 'icp' = AI shoda s ICP
  created_at timestamptz default now()
);

-- 2. Leady patří workspace
alter table leads add column if not exists workspace_id uuid references workspaces(id);

-- 3. Row Level Security — každý vidí jen svoje
alter table workspaces enable row level security;
alter table leads enable row level security;

drop policy if exists "own workspace" on workspaces;
create policy "own workspace" on workspaces
  for all using (owner = auth.uid()) with check (owner = auth.uid());

drop policy if exists "own leads" on leads;
create policy "own leads" on leads
  for all using (workspace_id in (select id from workspaces where owner = auth.uid()))
  with check (workspace_id in (select id from workspaces where owner = auth.uid()));

-- 4. Webhook URL pro integrace (Make.com, Zapier, n8n)
alter table workspaces add column if not exists webhook_url text;

-- 5. PO PRVNÍ REGISTRACI (Golden Purple účet) si přiřaď stará data:
-- update leads set workspace_id = (select id from workspaces limit 1)
--   where workspace_id is null;
