"""
Golden Purple — Lead-gen agent
================================
Hledá firmy se slabou online prezentací a připravuje personalizované
e-mail drafty. NEODESÍLÁ sám — člověk schvaluje každý mail.

TODO pro dodělání:
  1. Napojit reálný zdroj dat (Google Places API nebo scraping)
  2. Persistentní DB leadů (SQLite nebo Supabase)
  3. E-mailový provider (Resend.com nebo SMTP)
  4. Přesunout do PWA dashboardu (viz architektura níže)

Závislosti: pip install anthropic requests pyyaml
"""

import os, json, yaml, requests
from anthropic import Anthropic

client = Anthropic()

def load_config(path="config.yaml"):
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)

# ── TOOL FUNKCE ──────────────────────────────────────────────────────────────

def search_companies(location: str, category: str, limit: int = 10) -> list:
    """
    TODO: Nahradit dummy daty → Google Places API nebo scraping
    Klíč: GOOGLE_PLACES_API_KEY v .env
    """
    return [
        {
            "name": "Restaurace U Koruny",
            "category": category, "location": location,
            "website": "http://ukoruny-trebic.cz",
            "phone": "+420 568 123 456",
            "google_rating": 4.1,
            "has_website": True, "website_age_years": 7,
        },
        {
            "name": "Pekárna Novák s.r.o.",
            "category": category, "location": location,
            "website": None, "phone": "+420 568 654 321",
            "google_rating": 4.6,
            "has_website": False, "website_age_years": None,
        },
    ]

def score_lead(company: dict) -> dict:
    score = 0
    reasons = []
    if not company.get("has_website"):
        score += 40; reasons.append("Nemá web")
    elif company.get("website_age_years", 0) > 5:
        score += 25; reasons.append(f"Web starý {company['website_age_years']} let")
    rating = company.get("google_rating", 0)
    if rating < 3.5:
        score += 20; reasons.append("Nízké Google hodnocení")
    elif rating > 4.3:
        score += 5; reasons.append("Dobré hodnocení = aktivní firma")
    return {**company, "score": score, "reasons": reasons}

def draft_email(company: dict) -> str:
    prompt = f"""Jsi Martin z agentury Golden Purple (goldenpurple.cz).
Napiš krátký, přirozený, neprodejný e-mail pro tuto firmu.
Firma: {company['name']} | {company['location']} | {company['category']}
Má web: {company['has_website']} | Stáří: {company.get('website_age_years','N/A')} let
Proč příležitost: {', '.join(company['reasons'])}
Pravidla: max 5 vět, žádná klišé, konkrétní zmínka situace, CTA na call/reply, přímý lidský tón.
Podpis: Martin / Golden Purple"""
    r = client.messages.create(
        model="claude-sonnet-4-6", max_tokens=400,
        messages=[{"role": "user", "content": prompt}]
    )
    return r.content[0].text

# ── TOOL DEFINITIONS ─────────────────────────────────────────────────────────

TOOLS = [
    {"name": "search_companies", "description": "Hledá firmy podle lokality a kategorie",
     "input_schema": {"type": "object", "properties": {
         "location": {"type": "string"}, "category": {"type": "string"},
         "limit": {"type": "integer", "default": 10}},
         "required": ["location", "category"]}},
    {"name": "score_lead", "description": "Ohodnotí firmu jako lead (skóre 0–100)",
     "input_schema": {"type": "object", "properties": {
         "company": {"type": "object"}}, "required": ["company"]}},
    {"name": "draft_email", "description": "Vygeneruje personalizovaný e-mail draft",
     "input_schema": {"type": "object", "properties": {
         "company": {"type": "object"}}, "required": ["company"]}},
]

TOOL_MAP = {"search_companies": search_companies, "score_lead": score_lead, "draft_email": draft_email}

# ── AGENTNÍ SMYČKA ───────────────────────────────────────────────────────────

def run_agent(task: str) -> list:
    print(f"\n🔍 Agent: {task}\n")
    messages = [{"role": "user", "content": task}]
    results = []

    while True:
        response = client.messages.create(
            model="claude-sonnet-4-6", max_tokens=4096,
            tools=TOOLS, messages=messages,
            system="""Lead-gen asistent pro Golden Purple.
Hledáš lokální firmy se slabou online prezentací.
Postup: 1) hledej firmy 2) ohodnoť každou 3) pro skóre >30 připrav e-mail draft."""
        )
        messages.append({"role": "assistant", "content": response.content})
        if response.stop_reason == "end_turn":
            break

        tool_results = []
        for block in response.content:
            if block.type != "tool_use": continue
            fn = TOOL_MAP.get(block.name)
            if not fn: continue
            print(f"  → {block.name}")
            result = fn(**block.input)
            if block.name == "draft_email":
                c = block.input.get("company", {})
                results.append({
                    "company": c.get("name"), "score": c.get("score"),
                    "reasons": c.get("reasons", []), "email_draft": result,
                    "contact": c.get("phone", ""), "website": c.get("website", ""),
                    "approved": False,
                })
            tool_results.append({
                "type": "tool_result", "tool_use_id": block.id,
                "content": json.dumps(result, ensure_ascii=False) if isinstance(result, (dict, list)) else str(result)
            })
        messages.append({"role": "user", "content": tool_results})

    return results

# ── HUMAN-IN-THE-LOOP ────────────────────────────────────────────────────────

def review_leads(leads: list) -> list:
    approved = []
    print(f"\n{'='*60}\nNalezeno {len(leads)} leadů\n{'='*60}\n")
    for i, lead in enumerate(sorted(leads, key=lambda x: x.get("score", 0), reverse=True)):
        print(f"[{i+1}] {lead['company']} (skóre: {lead['score']})")
        print(f"  Proč: {', '.join(lead['reasons'])}")
        print(f"  {lead['contact']} | {lead['website'] or 'nemá web'}")
        print(f"\n{'─'*50}\n{lead['email_draft']}\n{'─'*50}")
        action = input("\n[s]chválit / [u]pravit / [p]řeskočit / [k]onec? ").strip().lower()
        if action == "k": break
        elif action == "p": continue
        elif action == "u":
            lines = []
            print("Uprav (prázdný řádek = konec):")
            while True:
                line = input()
                if line == "": break
                lines.append(line)
            lead["email_draft"] = "\n".join(lines)
            lead["approved"] = True; approved.append(lead)
        elif action == "s":
            lead["approved"] = True; approved.append(lead)
    return approved

def export_leads(leads: list, path="leads_output.json"):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(leads, f, ensure_ascii=False, indent=2)
    print(f"\n💾 Uloženo: {path}")

# ── MAIN ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    config = load_config()
    task = (
        f"Najdi {config['target']['category']} v {config['target']['location']}. "
        f"Ohodnoť každou a pro skóre nad {config['scoring']['min_score']} připrav e-mail draft."
    )
    leads = run_agent(task)
    approved = review_leads(leads)
    if approved:
        export_leads(approved)
        print(f"\n✅ {len(approved)} mailů připraveno k odeslání")
