-- Histórico de comissão por mês.
--
-- Rodar manualmente no SQL Editor do Supabase (não há CLI de migrations
-- configurado neste projeto). Script idempotente — pode rodar mais de uma vez.
--
-- Contexto: antes, cada influencer tinha um único perc_comissao/valor_fixo
-- (colunas em `influencers`) aplicado a todos os meses — mudar o percentual
-- reescrevia o resultado dos meses passados. Esta tabela registra cada
-- mudança com o mês a partir do qual ela vale. Para cada mês, o portal e o
-- painel admin usam a linha com o maior `vigente_desde` <= aquele mês.
--
-- `vigente_desde` = '2000-01-01' significa "desde o início" (valor base).
-- As colunas perc_comissao/valor_fixo de `influencers` continuam existindo
-- e só são usadas como fallback se a influencer não tiver nenhuma linha aqui.

create table if not exists public.comissao_historico (
  id uuid primary key default gen_random_uuid(),
  influencer_id uuid not null references public.influencers(id) on delete cascade,
  vigente_desde date not null check (extract(day from vigente_desde) = 1),
  perc_comissao numeric(6,4) not null default 0 check (perc_comissao >= 0 and perc_comissao <= 1),
  valor_fixo numeric(12,2) not null default 0 check (valor_fixo >= 0),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (influencer_id, vigente_desde)
);

alter table public.comissao_historico enable row level security;

-- Influencer lê só o próprio histórico.
drop policy if exists "comissao_hist_select_own" on public.comissao_historico;
create policy "comissao_hist_select_own"
  on public.comissao_historico for select
  using (exists (
    select 1 from public.influencers i
    where i.id = comissao_historico.influencer_id and i.user_id = auth.uid()
  ));

-- Admin lê e altera tudo.
drop policy if exists "comissao_hist_admin_all" on public.comissao_historico;
create policy "comissao_hist_admin_all"
  on public.comissao_historico for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- Backfill: valor atual de cada influencer vira o valor base ("desde o início").
insert into public.comissao_historico (influencer_id, vigente_desde, perc_comissao, valor_fixo)
select i.id, date '2000-01-01', coalesce(i.perc_comissao, 0), coalesce(i.valor_fixo, 0)
from public.influencers i
where not exists (
  select 1 from public.comissao_historico h where h.influencer_id = i.id
);
