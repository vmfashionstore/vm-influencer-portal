# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The influencer-facing portal for VM Fashion Store (`portal.vmfashionstore.com.br`): a single static HTML page (`index.html`) plus one Vercel serverless function (`api/orders.js`). There is no build step, no package manager, and no test suite — it's plain HTML/CSS/JS deployed directly to Vercel.

`brief-admin-portal-influencers.md` is a planning doc (in Portuguese) for a **not-yet-built** admin area to be added inside this same project (routes under `/admin`, restricted to two accounts). Read it before starting any admin-dashboard work — it defines scope, the new Supabase tables expected (`investimentos`), and integrations still to be wired up (Google Sheets API for ROI data, Bling API for physical-store sales by coupon).

## Running / testing locally

There are no npm scripts. To exercise the serverless function locally you need the Vercel CLI (`vercel dev`), since `api/orders.js` uses the Vercel Node function signature (`export default async function handler(req, res)`). Opening `index.html` directly in a browser works for UI iteration but calls to `/api/orders` will 404 without `vercel dev` (or an equivalent proxy) running.

## Architecture

Everything client-side lives in one `<script>` block at the bottom of `index.html`. Key pieces:

- **Auth & data**: Supabase (`@supabase/supabase-js` via CDN). `sb.auth` handles email/password login; on sign-in, `loadPortal()` looks up the logged-in user's row in the `influencers` table (`.eq('user_id', user.id)`) and uses fields like `nome` and `cupom` (coupon code) to personalize the portal. There is no signup flow — influencer accounts/rows are provisioned out-of-band.
- **Orders/sales data (VNDA)**: the frontend never calls VNDA directly. It calls the same-origin `/api/orders` (`VNDA_BASE`), which `api/orders.js` proxies to `api.vnda.com.br`, injecting the bearer token and shop host header server-side. `fetchCurrentMonth()` loads the first few pages synchronously for fast initial render, then `fetchAllOrdersBackground()` keeps paging in the background to backfill `allOrders` for historical months.
- **Content/materials/gallery/calendar data**: pulled from published Google Sheets CSV exports (`SHEETS_CSV`, `MATERIALS_CSV`, `GALLERY_CSV`, `PRODUTOS_ENVIADOS_CSV` — same spreadsheet, different `gid` per tab) and parsed with a hand-rolled `parseCSV()`. Materials are filtered per-influencer client-side via coupon match (`getMaterialsForUser()`, matching `cupom` or the wildcard `'TODAS'`).
- **Calendar notifications**: writes/deletes to the calendar go through a Supabase Edge Function (`EDGE_NOTIFY` = `notify-calendar`) that sends email notifications; failures there are caught and logged but non-blocking (`notifyCalendar()`).
- **UI**: a single-page tab layout (`nav-tab` buttons with `data-tab`, matched to `.tab-panel#tab-<name>` elements) — Performance, Produtos, Conteúdos, Materiais, Calendário. Tab switching is plain `classList` toggling, no router/framework.

## Things to know before touching credentials

- `api/orders.js` has the VNDA bearer token and shop host hardcoded directly in source (not an env var). If asked to add new server-side integrations (Bling, Google Sheets API per the admin brief), follow the same file's pattern only if the user confirms that's intentional for this project — otherwise prefer `process.env` and flag the existing hardcoding rather than silently replicating it elsewhere.
- The Supabase key in `index.html` (`SUPABASE_KEY`) is the public **anon** key, expected to be client-visible — this is normal for Supabase and not equivalent to the VNDA secret above.
