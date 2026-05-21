# Vibepick CRM

Internal CRM for managing Vibepick users — built with React 18 + TypeScript + Vite + Tailwind CSS + Supabase.

## Features

- **Usuarios** — full user table with search, plan filter, credit balance, prompt count
- **Seguimiento** — pipeline kanban (Lead → Activo → Convertido → Churned) with per-client notes
- **Sesiones** — active session monitor by browser/device
- **Métricas** — monthly churn rate + LTV charts (Recharts)
- **AIMessenger** — slide-in panel powered by Google Gemini for drafting personalized messages
- **Strategy Engine** — Hormozi/Brunson automatic reactivation strategy per client profile

## Stack

| Layer | Tech |
|---|---|
| UI | React 18 + TypeScript + Framer Motion |
| Styling | Tailwind CSS v3 |
| DB | Supabase (PostgreSQL + Auth) |
| Charts | Recharts |
| AI | Google Gemini (`@google/generative-ai`) |
| Build | Vite |

## Setup

```bash
# 1. Install deps
npm install

# 2. Configure env vars
cp .env.example .env.local
# → fill in VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_ADMIN_EMAIL, VITE_ADMIN_PASSWORD, VITE_GEMINI_API_KEY

# 3. Dev server
npm run dev
```

## Required Supabase views / tables

The CRM reads from these Supabase objects (must exist in your project):

- `public.profiles` — `id`, `email`, `full_name`, `plan`, `prompt_count`, `created_at`, `last_sign_in_at`
- `public.user_credits` — `user_id`, `credits_remaining`, `credits_used`, `last_updated`
- `public.v_churn_rate_monthly` — view: `month` (text), `churn_rate` (numeric)
- `public.v_ltv_by_plan` — view: `plan` (text), `avg_ltv` (numeric)

## Auth

Login uses local credential comparison against `VITE_ADMIN_EMAIL` / `VITE_ADMIN_PASSWORD` env vars. No database write happens on CRM login — credentials never leave the browser. Supabase session is checked on load to auto-login if an admin session already exists.

## Deploy

This is a pure SPA — deploy to Vercel, Netlify, or any static host:

```bash
npm run build   # outputs to dist/
```
