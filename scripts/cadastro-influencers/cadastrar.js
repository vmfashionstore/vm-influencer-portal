/**
 * Cadastro em lote de influencers no Supabase do portal VM.
 *
 * O que faz, para cada linha de influencers.json:
 *   1. Pula a linha se faltar nome, cupom, tier ou email (com aviso no console).
 *   2. Pula se já existir uma influencer com esse cupom na tabela `influencers` (evita duplicar).
 *   3. Cria a conta de login (Supabase Auth) com o email/senha informados.
 *      Se o email já existir no Auth, reaproveita a conta existente em vez de falhar.
 *   4. Insere a linha correspondente na tabela `influencers`, ligada à conta pelo user_id.
 *
 * Por padrão roda em modo "dry-run" (só mostra o que faria, não grava nada).
 * Para gravar de verdade: node cadastrar.js --confirmar
 *
 * Antes de rodar:
 *   1. npm install          (instala @supabase/supabase-js e dotenv)
 *   2. cp .env.example .env  e cole sua Service Role Key do Supabase
 *   3. Preencha tier, email e senha de cada influencer em influencers.json
 *      tier precisa ser exatamente: Iconic, Signature, Ambassador ou Gift
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const TIERS_VALIDOS = ['Iconic', 'Signature', 'Ambassador', 'Gift'];
const CONFIRMAR = process.argv.includes('--confirmar');

// Aceita 5, "5", "5%" ou 0.05 -> 0.05. Retorna null se vazio/inválido.
function parsePercentual(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = parseFloat(String(v).replace('%', '').replace(',', '.'));
  if (!isFinite(n) || n < 0) return null;
  return n > 1 ? n / 100 : n;
}

function parseValor(v) {
  if (v === undefined || v === null || String(v).trim() === '') return 0;
  const n = parseFloat(String(v).replace(',', '.'));
  return isFinite(n) && n >= 0 ? n : null;
}

function gerarSenhaAleatoria() {
  return 'Vm' + Math.random().toString(36).slice(-8) + '!' + Math.floor(Math.random() * 100);
}

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || SUPABASE_SERVICE_ROLE_KEY.includes('cole_aqui')) {
    console.error('Faltou configurar o .env (copie .env.example para .env e cole a Service Role Key).');
    process.exit(1);
  }

  const dataPath = path.join(__dirname, 'influencers.json');
  const lista = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(CONFIRMAR ? '=== MODO REAL: vai gravar no banco ===' : '=== MODO DRY-RUN: não grava nada, só mostra o plano (use --confirmar para gravar) ===');
  console.log('');

  const senhasGeradas = [];

  for (const item of lista) {
    const nome = (item.nome || '').trim();
    const cupom = (item.cupom || '').trim().toUpperCase();
    const tier = (item.tier || '').trim();
    const email = (item.email || '').trim().toLowerCase();
    let senha = (item.senha || '').trim();
    const percComissao = parsePercentual(item.perc_comissao);
    const percDesconto = parsePercentual(item.perc_desconto);
    const valorFixo = parseValor(item.valor_fixo);

    if (!nome || !cupom || !tier || !email) {
      console.log(`[PULADO] ${nome || '(sem nome)'} — faltando ${[!nome && 'nome', !cupom && 'cupom', !tier && 'tier', !email && 'email'].filter(Boolean).join(', ')} em influencers.json`);
      continue;
    }
    if (percComissao === null || percDesconto === null || valorFixo === null) {
      console.log(`[PULADO] ${nome} — preencha perc_comissao e perc_desconto (ex.: 5 para 5%) e valor_fixo válido (0 se não tiver)`);
      continue;
    }
    if (!TIERS_VALIDOS.includes(tier)) {
      console.log(`[PULADO] ${nome} — tier "${tier}" inválido. Use um de: ${TIERS_VALIDOS.join(', ')}`);
      continue;
    }

    // já existe esse cupom na tabela?
    const { data: existente, error: erroSelect } = await supabase
      .from('influencers')
      .select('id, nome, cupom')
      .ilike('cupom', cupom)
      .maybeSingle();
    if (erroSelect) {
      console.log(`[ERRO] ${nome} — falha ao checar duplicidade: ${erroSelect.message}`);
      continue;
    }
    if (existente) {
      console.log(`[JÁ EXISTE] ${nome} (cupom ${cupom}) já está cadastrada, pulando.`);
      continue;
    }

    if (!senha) {
      senha = gerarSenhaAleatoria();
      senhasGeradas.push({ nome, email, senha });
    }

    if (!CONFIRMAR) {
      console.log(`[PLANO] criaria login (${email}) + linha em influencers (nome="${nome}", cupom="${cupom}", tier="${tier}", comissão ${(percComissao*100).toFixed(1).replace('.0','')}%, desconto ${(percDesconto*100).toFixed(1).replace('.0','')}%, fixo R$ ${valorFixo})`);
      continue;
    }

    // cria (ou reaproveita) a conta de autenticação
    let userId = null;
    const { data: criado, error: erroAuth } = await supabase.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true,
    });
    if (erroAuth) {
      if (String(erroAuth.message || '').toLowerCase().includes('already')) {
        const { data: listaUsers, error: erroLista } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
        if (erroLista) {
          console.log(`[ERRO] ${nome} — email já existe no Auth e não consegui buscá-lo: ${erroLista.message}`);
          continue;
        }
        const existenteAuth = listaUsers.users.find(u => (u.email || '').toLowerCase() === email);
        if (!existenteAuth) {
          console.log(`[ERRO] ${nome} — email já existe no Auth mas não foi localizado na listagem.`);
          continue;
        }
        userId = existenteAuth.id;
        console.log(`[INFO] ${nome} — reaproveitando login já existente para ${email}`);
      } else {
        console.log(`[ERRO] ${nome} — falha ao criar login: ${erroAuth.message}`);
        continue;
      }
    } else {
      userId = criado.user.id;
    }

    const { data: inserida, error: erroInsert } = await supabase
      .from('influencers')
      .insert({ user_id: userId, nome, cupom, tier, perc_comissao: percComissao, perc_desconto: percDesconto, valor_fixo: valorFixo })
      .select('id')
      .single();
    if (erroInsert) {
      console.log(`[ERRO] ${nome} — login criado mas falhou ao inserir em influencers: ${erroInsert.message}`);
      continue;
    }

    // valor base no histórico de comissão (supabase/sql/005_comissao_historico.sql).
    // Se a tabela ainda não existir, o backfill desse SQL cobre depois.
    const { error: erroHist } = await supabase
      .from('comissao_historico')
      .insert({ influencer_id: inserida.id, vigente_desde: '2000-01-01', perc_comissao: percComissao, valor_fixo: valorFixo });
    if (erroHist) {
      console.log(`[AVISO] ${nome} — não gravou o histórico de comissão (${erroHist.message}). Rode o 005_comissao_historico.sql, que preenche isso.`);
    }

    console.log(`[OK] ${nome} cadastrada — cupom ${cupom}, tier ${tier}, comissão ${(percComissao*100).toFixed(1).replace('.0','')}%, desconto ${(percDesconto*100).toFixed(1).replace('.0','')}%, fixo R$ ${valorFixo}, login ${email}`);
  }

  if (CONFIRMAR && senhasGeradas.length) {
    console.log('');
    console.log('Senhas geradas automaticamente (envie para cada influencer, com segurança):');
    senhasGeradas.forEach(s => console.log(`  ${s.nome} <${s.email}>: ${s.senha}`));
  }

  if (!CONFIRMAR) {
    console.log('');
    console.log('Nada foi gravado. Revise o plano acima e rode novamente com --confirmar para gravar de verdade.');
  }
}

main().catch(e => {
  console.error('Erro inesperado:', e);
  process.exit(1);
});
