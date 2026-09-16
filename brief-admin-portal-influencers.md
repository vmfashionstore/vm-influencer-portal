# Brief — Painel de Gestão do Portal de Influencers (VM Fashion Store)

## Contexto
Portal de influencers já existe em produção: `portal.vmfashionstore.com.br` (HTML/JS + Supabase + Vercel + Resend). Já há integração ativa com a **API da VNDA**. Este brief cobre a construção de uma área administrativa dentro do mesmo projeto — **sem incluir o sistema de cashback**, que é um projeto separado.

## Objetivo
Dar à Julia e à Vanessa Mansur visibilidade completa sobre todas as influencers cadastradas: performance, ROI e vendas físicas atribuídas via cupom.

## Escopo

### 1. Autenticação e acesso
- Nova role `admin` na tabela de usuários do Supabase.
- Acesso restrito a Julia e Vanessa (2 contas).
- Middleware protegendo rotas `/admin/*`.
- Reaproveitar o mesmo sistema de auth do portal atual (sem novo provedor).

### 2. Estrutura
- Rota interna dentro do projeto existente: `portal.vmfashionstore.com.br/admin`.
- Mesmo deploy Vercel, mesmo banco Supabase.

### 3. Dashboard geral (home do admin)
- Total de influencers ativas por tier (Iconic, Signature, Ambassador, Gift).
- Performance agregada: vendas, cupons utilizados, conversão (via VNDA API).
- ROI agregado do período.

### 4. Lista de influencers
- Tabela com tier, status, performance resumida, ROI.
- Filtros por tier e ordenação por performance/ROI.

### 5. Perfil individual da influencer
- Histórico de cupons e vendas atribuídas (VNDA).
- Vendas físicas atribuídas via cupom (Bling — ver item 7).
- ROI individual (ver item 6).
- Dados de contato e tier.

### 6. Cálculo de ROI
- Nova tabela `investimentos` no Supabase (valor pago, período, tipo de parceria por influencer).
- **Fonte dos dados:** integração direta com Google Sheets API (a planilha atual de investimentos vira a fonte, sincronizada — não é upload pontual nem recriação manual).
- Fórmula base: `(receita atribuída − investimento) / investimento`.
- Precisa decidir: sync automático (ex: a cada X horas) ou botão de "atualizar agora" no admin.

### 7. Integração Bling API (nova)
- Objetivo: puxar vendas realizadas na loja física que usaram cupom de influencer.
- **Não reaproveita** as credenciais do projeto de cashback — precisa de app/token novo no Bling.
- Cruzar vendas por cupom com o cadastro de influencers.

### 8. Visão espelhada das abas do portal da influencer
- No perfil individual (item 5), o admin deve conseguir visualizar **todas as abas/funcionalidades que a própria influencer vê no portal dela**, com dados reais:
  - Produto mais vendido (atribuído a ela)
  - Produto mais comunicado (conteúdo que ela mais postou/divulgou)
  - Datas de comunicados/postagens
  - Calendário de conteúdos
  - Demais abas já existentes no portal da influencer (mapear tudo que existe hoje antes de replicar)
- Objetivo: o admin não é só um resumo agregado — é uma visão completa de "o que essa influencer vê e faz", visto de fora, sem precisar logar como ela.
- **Antes de implementar:** levantar a lista completa das abas/seções que já existem no portal da influencer hoje, pra garantir que nada fique de fora.

## Integrações — resumo
| Integração | Status | Observação |
|---|---|---|
| VNDA API | ✅ já existe | Mesma conexão do portal atual |
| Google Sheets API | 🆕 nova | Fonte dos dados de investimento (ROI) |
| Bling API | 🆕 nova | Precisa criar app/credenciais novas; puxar vendas físicas por cupom |

## Pontos em aberto para decidir durante a implementação
1. **Rate limit da VNDA API** — dashboard busca em tempo real a cada acesso ou precisa de cache/snapshot (ex: Supabase Edge Function periódica)?
2. **Frequência de sync do Google Sheets** — automática ou manual?
3. **Escopo de permissões no Bling** — só leitura de vendas, filtrado por cupom.
4. **Formato da planilha de investimento** — colunas/estrutura atual, para mapear o schema da tabela `investimentos`.
5. **Mapeamento completo do portal da influencer** — listar todas as abas/seções existentes hoje (produto mais vendido, produto mais comunicado, datas de comunicados, calendário de conteúdos, e quaisquer outras) para replicar na visão do admin.

## Fora de escopo
- Sistema de cashback (projeto separado, já em desenvolvimento).
- Acesso de mais pessoas do time além de Julia e Vanessa (por enquanto).
