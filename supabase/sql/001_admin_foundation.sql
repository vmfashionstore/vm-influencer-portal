-- Etapa 1 do painel admin: tabela admin_users, helper is_admin() e
-- policies adicionais de leitura para admins em influencers/calendario.
--
-- Rodar manualmente no SQL Editor do Supabase (não há CLI de migrations
-- configurado neste projeto). Script idempotente — pode rodar mais de uma vez.
--
-- IMPORTANTE: antes de rodar, confira em Database > Policies que
-- `influencers` e `calendario` já têm RLS habilitado com uma policy de
-- "usuária só lê a própria linha" (auth.uid() = user_id). Este script
-- NÃO habilita RLS nessas duas tabelas nem mexe nas policies existentes —
-- só adiciona uma policy extra para admins. Se RLS ainda não estiver
-- habilitado nelas, pare e resolva isso primeiro (habilitar sem nenhuma
-- policy de usuária derrubaria o portal das influencers).

-- 1. Tabela admin_users -------------------------------------------------
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

drop policy if exists "admin_users_select_own" on public.admin_users;
create policy "admin_users_select_own"
  on public.admin_users for select
  using (auth.uid() = user_id);

-- 2. Helper is_admin() ----------------------------------------------------
-- security definer: para que a checagem funcione mesmo se a própria
-- política de admin_users não desse visibilidade cruzada entre usuárias.
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.admin_users where user_id = uid
  );
$$;

-- 3. Policies adicionais de leitura para admin (não substituem as existentes)
drop policy if exists "admin_read_all_influencers" on public.influencers;
create policy "admin_read_all_influencers"
  on public.influencers for select
  using (public.is_admin(auth.uid()));

drop policy if exists "admin_read_all_calendario" on public.calendario;
create policy "admin_read_all_calendario"
  on public.calendario for select
  using (public.is_admin(auth.uid()));

-- 4. Provisionar as duas contas admin (Julia e Vanessa) --------------------
-- Rodar depois de criar os usuários no Authentication > Users do Supabase
-- (mesmo fluxo usado para criar contas de influencer hoje).
-- Substitua os UUIDs pelos ids reais de cada conta antes de rodar:
--
-- insert into public.admin_users (user_id, nome) values
--   ('<uuid-da-julia>', 'Julia'),
--   ('<uuid-da-vanessa>', 'Vanessa')
-- on conflict (user_id) do nothing;
