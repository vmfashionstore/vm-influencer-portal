-- Etapa 3 do painel admin: tabelas para a Análise de Instagram.
--
-- Rodar manualmente no SQL Editor do Supabase (não há CLI de migrations
-- configurado neste projeto). Script idempotente — pode rodar mais de uma vez.
--
-- Contexto: a nova aba "Análise Instagram" do admin precisa de comparativos
-- históricos (mês atual x mês anterior, evolução de seguidores, etc).
-- A API do Instagram só guarda ~90 dias de métricas de conta e as stories
-- somem depois de 24h, então gravamos um snapshot diário via
-- api/instagram-sync.js (cron da Vercel) em vez de buscar tudo ao vivo
-- toda vez que o admin abre o dashboard.
--
-- 3 tabelas:
--   ig_account_daily  - 1 linha por dia, métricas da conta (@vmfashionstore)
--   ig_media_snapshot - 1 linha por post por dia em que foi capturado
--                       (permite ver como um post evoluiu, e comparar meses)
--   ig_story_snapshot - 1 linha por story (capturada enquanto ainda existe,
--                       já que expira em 24h)

-- 1. ig_account_daily -----------------------------------------------------
create table if not exists public.ig_account_daily (
  id bigint generated always as identity primary key,
  date date not null unique,
  followers_count integer,
  reach integer,
  impressions integer,
  profile_views integer,
  online_followers_by_hour jsonb, -- {"0": 120, "1": 98, ..., "23": 340}
  created_at timestamptz not null default now()
);

alter table public.ig_account_daily enable row level security;

drop policy if exists "admin_read_ig_account_daily" on public.ig_account_daily;
create policy "admin_read_ig_account_daily"
  on public.ig_account_daily for select
  using (public.is_admin(auth.uid()));

-- 2. ig_media_snapshot ------------------------------------------------------
create table if not exists public.ig_media_snapshot (
  id bigint generated always as identity primary key,
  media_id text not null,
  snapshot_date date not null,
  media_type text, -- IMAGE / VIDEO / CAROUSEL_ALBUM / REEL
  caption text,
  permalink text,
  media_url text,
  thumbnail_url text,
  posted_at timestamptz,
  like_count integer,
  comments_count integer,
  reach integer,
  views integer, -- substitui "impressions" (descontinuado p/ posts após jul/2024)
  saved integer,
  shares integer,
  total_interactions integer,
  avg_watch_time integer, -- reels, em ms
  created_at timestamptz not null default now(),
  unique (media_id, snapshot_date)
);

create index if not exists ig_media_snapshot_posted_at_idx
  on public.ig_media_snapshot (posted_at desc);
create index if not exists ig_media_snapshot_media_id_idx
  on public.ig_media_snapshot (media_id);

alter table public.ig_media_snapshot enable row level security;

drop policy if exists "admin_read_ig_media_snapshot" on public.ig_media_snapshot;
create policy "admin_read_ig_media_snapshot"
  on public.ig_media_snapshot for select
  using (public.is_admin(auth.uid()));

-- 3. ig_story_snapshot -------------------------------------------------------
create table if not exists public.ig_story_snapshot (
  id bigint generated always as identity primary key,
  story_id text not null unique,
  posted_at timestamptz,
  captured_at timestamptz not null default now(),
  media_type text,
  media_url text,
  reach integer,
  impressions integer,
  replies integer,
  exits integer,
  taps_forward integer,
  taps_back integer,
  link_clicks integer,
  shares integer,
  profile_visits integer,
  profile_activity integer,
  follows integer,
  created_at timestamptz not null default now()
);

create index if not exists ig_story_snapshot_posted_at_idx
  on public.ig_story_snapshot (posted_at desc);

alter table public.ig_story_snapshot enable row level security;

drop policy if exists "admin_read_ig_story_snapshot" on public.ig_story_snapshot;
create policy "admin_read_ig_story_snapshot"
  on public.ig_story_snapshot for select
  using (public.is_admin(auth.uid()));

-- NOTA: não há policy de insert/update para nenhuma das 3 tabelas — quem
-- escreve é api/instagram-sync.js usando a Service Role Key da Vercel, que
-- ignora RLS. Isso é proposital: nenhuma influencer ou admin escreve aqui
-- direto pelo navegador, só lê.
