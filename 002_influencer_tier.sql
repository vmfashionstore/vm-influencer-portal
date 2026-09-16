-- Etapa 2 do painel admin: coluna tier em influencers.
--
-- Rodar manualmente no SQL Editor do Supabase (não há CLI de migrations
-- configurado neste projeto). Script idempotente.
--
-- Contexto: o dashboard geral do admin (item 3 do brief) precisa agrupar
-- influencers por tier (Iconic, Signature, Ambassador, Gift). Esse dado
-- não existia em nenhuma tabela — vivia só nas propostas/planilhas
-- externas. Esta migration adiciona a coluna e faz o backfill das
-- influencers já cadastradas (dados confirmados pela Julia em 2026-09-16).

alter table public.influencers
  add column if not exists tier text
  check (tier is null or tier in ('Iconic','Signature','Ambassador','Gift'));

update public.influencers set tier='Iconic'    where cupom='BSCAN';
update public.influencers set tier='Iconic'    where cupom='BIANCABUENO';
update public.influencers set tier='Signature' where cupom='CAROLCOSTA';
update public.influencers set tier='Signature' where cupom='PERFEITUDAS';
update public.influencers set tier='Iconic'    where cupom='GABI';
update public.influencers set tier='Signature' where cupom='GIULIA';
update public.influencers set tier='Gift'      where cupom='IANCA';
update public.influencers set tier='Signature' where cupom='ISAMIYAKE';
update public.influencers set tier='Iconic'    where cupom='JULARANGEIRA';
update public.influencers set tier='Signature' where cupom='JUHMARIANO';
update public.influencers set tier='Iconic'    where cupom='JULIA';
update public.influencers set tier='Iconic'    where cupom='JUBALEIA';

-- IMPORTANTE: ao cadastrar uma nova influencer no portal, definir o tier
-- dela também (não é preenchido automaticamente em nenhum fluxo hoje).
