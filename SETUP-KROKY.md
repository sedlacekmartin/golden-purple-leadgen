# Setup pořadí — lead-gen agent (multi-device)

## 1. GitHub
```bash
git init
git add .
git commit -m "init"
```
→ založ repo na GitHubu → `git remote add origin ...` → `git push -u origin main`

⚠️ Ověř, že `.env` NENÍ v `git status` před prvním commitem!

## 2. Supabase
- supabase.com → New Project
- SQL Editor → vytvoř tabulku `leads` (viz LEADGEN-NAVOD.md)
- Settings → API → zkopíruj SUPABASE_URL a SUPABASE_ANON_KEY

## 3. Vercel
- Add New Project → Import z GitHubu
- Settings → Environment Variables → zadej:
  ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY
- Deploy

## 4. Druhé zařízení
```bash
git clone https://github.com/TVUJ-UCET/golden-purple-leadgen.git
cd golden-purple-leadgen
cp .env.example .env   # vyplň klíče (z password manageru, ne přes mail)
pip install -r requirements.txt
```

## RYTMUS PRÁCE (obě zařízení)
- Před prací: `git pull`
- Po práci:   `git add . && git commit -m "..." && git push`

Klíče (.env) si udržuj v password manageru (1Password/Bitwarden) —
ne v mailu, ne na USB. Na každém zařízení vlastní .env soubor.
