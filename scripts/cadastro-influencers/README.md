# Cadastro em lote de influencers (Supabase)

Script pra cadastrar de uma vez as influencers que estão na planilha de novembro mas
ainda não têm acesso ao portal (login + linha na tabela `influencers`).

## Passo a passo (peça pro Claude Code fazer isso no seu terminal)

1. **Instalar dependências** — dentro desta pasta:
   ```
   npm install
   ```

2. **Configurar a chave do Supabase** — copie `.env.example` para `.env` e cole a
   *Service Role Key* do projeto (Supabase Dashboard → Project Settings → API →
   `service_role` secret). Essa chave é sensível: nunca cole ela no chat do
   Claude/Cowork, só neste arquivo `.env` local (ele já não entra no git).

3. **Preencher `influencers.json`** — já vem com nome e cupom de cada uma
   (cruzados entre a planilha e o que já está no Supabase). Falta preencher,
   para cada linha:
   - `tier`: um de `Iconic`, `Signature`, `Ambassador`, `Gift`
   - `perc_comissao`: % de comissão sobre as vendas do cupom (ex.: `5` = 5%)
   - `perc_desconto`: % de desconto que o cupom dá ao cliente (ex.: `5` = 5%)
   - `valor_fixo`: valor fixo mensal em R$ (`0` se não tiver)
   - `email`: o email que a influencer vai usar pra logar no portal
   - `senha`: opcional — se deixar em branco, o script gera uma senha
     aleatória pra ela (e mostra no final, pra você enviar)

   A "Jordana Barros" está sem cupom na planilha ainda — crie um cupom pra
   ela antes de preencher essa linha, ou remova a linha do JSON por enquanto.

4. **Rodar em modo teste primeiro** (não grava nada, só mostra o plano):
   ```
   npm run cadastrar
   ```

5. **Conferir a saída** — linhas puladas (`[PULADO]`), já existentes
   (`[JÁ EXISTE]`) e o que seria criado (`[PLANO]`). Ajuste o JSON se algo
   estiver errado.

6. **Rodar de verdade**:
   ```
   node cadastrar.js --confirmar
   ```
   Isso cria o login de cada influencer no Supabase Auth e a linha
   correspondente na tabela `influencers`, ligando as duas. No final, mostra
   a lista de senhas geradas automaticamente (se houver) pra você repassar.

O script é seguro para rodar mais de uma vez: ele pula qualquer cupom que já
exista na tabela, e reaproveita o login se o email já tiver conta no Auth.
