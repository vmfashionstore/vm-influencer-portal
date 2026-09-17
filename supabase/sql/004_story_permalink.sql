-- Etapa 4 do painel admin: adiciona a coluna permalink na tabela de stories.
--
-- Rodar manualmente no SQL Editor do Supabase. Idempotente — pode rodar mais
-- de uma vez.
--
-- Contexto: a tabela "Taxa de ação por story" do admin agora mostra uma
-- miniatura + link "ver no Instagram" pra cada story, pra dar pra identificar
-- visualmente qual foi (stories não têm legenda/texto pela API do Instagram).
-- O link some depois de ~24h junto com a própria story (limitação da Meta,
-- não do dashboard) — a miniatura continua funcionando por mais tempo.

alter table public.ig_story_snapshot
  add column if not exists permalink text;
