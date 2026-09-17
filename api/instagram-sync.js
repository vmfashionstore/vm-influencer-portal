// VM Fashion Store - Sincroniza métricas do Instagram (@vmfashionstore) para o Supabase.
//
// Roda via Vercel Cron (ver vercel.json) uma vez por dia. Gera um snapshot do
// dia em 3 tabelas (ig_account_daily, ig_media_snapshot, ig_story_snapshot),
// para o dashboard "Análise Instagram" do admin poder comparar mês atual x
// mês anterior sem depender da API ao vivo (que só guarda ~90 dias de
// métricas de conta e perde as stories depois de 24h).
//
// Variáveis de ambiente necessárias (Vercel > Settings > Environment Variables):
//   FB_PAGE_TOKEN         - mesmo token já usado no Apps Script (ConteudosInstagram.gs)
//   IG_USER_ID            - mesmo ID já usado no Apps Script (conta comercial @vmfashionstore)
//   SUPABASE_URL          - https://ckqqfppssynlicsejrqc.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY - Service Role key do Supabase (Settings > API). NUNCA usar a anon key
//                               aqui, pois as tabelas ig_* só tem policy de leitura para admin.
//   CRON_SECRET           - string aleatória qualquer. Se definida, só aceita chamadas com
//                           header "Authorization: Bearer <CRON_SECRET>" (a Vercel Cron manda
//                           esse header automaticamente quando essa env var existe).
//
// Performance: busca as métricas de cada post/story em UMA chamada (metrics
// separados por vírgula) em vez de uma por vez, e processa todos os posts e
// stories EM PARALELO (Promise.all) — com muitas chamadas sequenciais isso
// facilmente passa do tempo limite da função (erro 504 "Runtime Timeout").
// Só cai pra buscar métrica por métrica se a chamada em lote falhar.

const GRAPH_API_BASE = 'https://graph.facebook.com/v26.0';
const LOOKBACK_DAYS = 45; // cobre mes atual + mes anterior com folga

function todayInSaoPaulo() {
  // yyyy-mm-dd na hora de Brasilia, independente do timezone do servidor da Vercel
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

async function graphGet(path, params) {
  const url = new URL(`${GRAPH_API_BASE}${path}`);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });
  url.searchParams.set('access_token', process.env.FB_PAGE_TOKEN);
  const resp = await fetch(url.toString());
  const data = await resp.json();
  if (data.error) {
    throw new Error(`Graph API ${path}: ${data.error.message}`);
  }
  return data;
}

function extractMetricValue(entry) {
  if (!entry) return null;
  if (entry.values && entry.values.length) return entry.values[entry.values.length - 1].value;
  if (entry.total_value) return entry.total_value.value;
  return null;
}

// Busca métricas de insight uma por uma (mais lento, só usado como fallback
// quando a chamada em lote falha porque alguma métrica não é aplicável).
async function fetchInsightsSafely(objectId, metricSpecs) {
  const out = {};
  for (const spec of metricSpecs) {
    const { key, metric, extraParams } = typeof spec === 'string' ? { key: spec, metric: spec } : spec;
    try {
      const data = await graphGet(`/${objectId}/insights`, { metric, ...extraParams });
      out[key] = extractMetricValue((data.data || [])[0]);
    } catch (e) {
      out[key] = null;
    }
  }
  return out;
}

// Busca várias métricas juntas numa única chamada (metric=a,b,c). Todas as
// specs precisam compartilhar os mesmos extraParams (period/metric_type/etc).
// Se a chamada em lote falhar (ex: uma métrica não suportada pra esse tipo de
// mídia), cai pro fallback de buscar uma por uma.
async function fetchInsightsBatch(objectId, metricSpecs, sharedExtraParams) {
  const names = metricSpecs.map((s) => (typeof s === 'string' ? s : s.metric));
  try {
    const data = await graphGet(`/${objectId}/insights`, { metric: names.join(','), ...sharedExtraParams });
    const out = {};
    metricSpecs.forEach((spec) => {
      const key = typeof spec === 'string' ? spec : spec.key;
      const metric = typeof spec === 'string' ? spec : spec.metric;
      out[key] = extractMetricValue((data.data || []).find((d) => d.name === metric));
    });
    return out;
  } catch (e) {
    return fetchInsightsSafely(objectId, metricSpecs.map((s) => (typeof s === 'string' ? s : { ...s, extraParams: sharedExtraParams })));
  }
}

async function supabaseUpsert(table, rows, onConflict) {
  if (!rows.length) return { count: 0 };
  const url = `${process.env.SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Supabase upsert ${table}: ${resp.status} ${text}`);
  }
  return { count: rows.length };
}

// Preenche dias passados de reach usando o modo "time_series" da API
// (period=day, metric_type=time_series, since/until em unix time) — isso
// traz até ~30 dias de histórico numa chamada só, em vez de esperar o cron
// rodar dia após dia pra ir preenchendo o gráfico "Alcance por dia".
// profile_views NÃO entra aqui: a Graph API não aceita esse metric junto
// com metric_type=time_series (erro #100 "incompatible metric"), só reach.
// Só grava reach (nunca followers_count nem online_followers, que a Meta
// não expõe retroativamente) e nunca sobrescreve o dia de hoje, que já foi
// gravado pelo syncAccountDaily acima com o valor "oficial".
async function backfillAccountDaily(todayDate) {
  const errors = [];
  const nowSec = Math.floor(Date.now() / 1000);
  const sinceSec = nowSec - 30 * 24 * 60 * 60;

  let data;
  try {
    data = await graphGet(`/${process.env.IG_USER_ID}/insights`, {
      metric: 'reach',
      period: 'day',
      metric_type: 'time_series',
      since: sinceSec,
      until: nowSec,
    });
  } catch (e) {
    errors.push('backfill: ' + e.message);
    return { count: 0, errors };
  }

  const byDate = {};
  (data.data || []).forEach((entry) => {
    (entry.values || []).forEach((v) => {
      if (!v.end_time || typeof v.value !== 'number') return;
      // end_time vem como meia-noite UTC do dia SEGUINTE ao período somado
      // (padrão da API pra period=day) — subtrai 1 dia pra bater com a data certa.
      const d = new Date(v.end_time);
      d.setUTCDate(d.getUTCDate() - 1);
      const dateStr = d.toISOString().substring(0, 10);
      if (!byDate[dateStr]) byDate[dateStr] = { date: dateStr };
      byDate[dateStr][entry.name] = v.value;
    });
  });

  const rows = Object.values(byDate).filter((r) => r.date < todayDate);
  if (rows.length) {
    try {
      await supabaseUpsert('ig_account_daily', rows, 'date');
    } catch (e) {
      errors.push('backfill upsert: ' + e.message);
      return { count: 0, errors };
    }
  }
  return { count: rows.length, errors };
}

async function syncAccountDaily(date) {
  const errors = [];

  const profile = await graphGet(`/${process.env.IG_USER_ID}`, { fields: 'followers_count' }).catch((e) => {
    errors.push('profile: ' + e.message);
    return {};
  });

  const dayMetrics = await fetchInsightsBatch(
    process.env.IG_USER_ID,
    [
      { key: 'reach', metric: 'reach' },
      { key: 'profile_views', metric: 'profile_views' },
      { key: 'impressions', metric: 'impressions' },
    ],
    { period: 'day', metric_type: 'total_value' },
  ).catch((e) => { errors.push('day metrics: ' + e.message); return {}; });

  const onlineFollowers = await fetchInsightsSafely(process.env.IG_USER_ID, [
    { key: 'online_followers', metric: 'online_followers', extraParams: { period: 'lifetime' } },
  ]);

  const row = {
    date,
    followers_count: profile.followers_count ?? null,
    reach: dayMetrics.reach ?? null,
    impressions: dayMetrics.impressions ?? null,
    profile_views: dayMetrics.profile_views ?? null,
    online_followers_by_hour: onlineFollowers.online_followers ?? null,
  };

  await supabaseUpsert('ig_account_daily', [row], 'date');
  return { row, errors };
}

function metricsForMediaType(mediaType) {
  const base = [
    { key: 'reach', metric: 'reach' },
    { key: 'saved', metric: 'saved' },
    { key: 'shares', metric: 'shares' },
    { key: 'total_interactions', metric: 'total_interactions' },
    { key: 'views', metric: 'views' },
  ];
  if (mediaType === 'VIDEO' || mediaType === 'REEL') {
    base.push({ key: 'avg_watch_time', metric: 'ig_reels_avg_watch_time' });
  }
  return base;
}

async function fetchAllRecentMedia() {
  const cutoff = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const media = [];
  let after;
  for (let page = 0; page < 10; page++) {
    const data = await graphGet(`/${process.env.IG_USER_ID}/media`, {
      fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count',
      limit: 50,
      after,
    });
    const items = data.data || [];
    let hitCutoff = false;
    for (const item of items) {
      if (new Date(item.timestamp).getTime() < cutoff) { hitCutoff = true; break; }
      media.push(item);
    }
    if (hitCutoff) break;
    after = data.paging && data.paging.cursors && data.paging.next ? data.paging.cursors.after : null;
    if (!after || items.length === 0) break;
  }
  return media;
}

async function syncMedia(date) {
  const errors = [];
  const mediaList = await fetchAllRecentMedia().catch((e) => {
    errors.push('media list: ' + e.message);
    return [];
  });

  const rows = await Promise.all(mediaList.map(async (item) => {
    const insights = await fetchInsightsBatch(item.id, metricsForMediaType(item.media_type), {})
      .catch((e) => { errors.push(`media ${item.id}: ${e.message}`); return {}; });
    return {
      media_id: item.id,
      snapshot_date: date,
      media_type: item.media_type,
      caption: item.caption || null,
      permalink: item.permalink || null,
      media_url: item.media_url || null,
      thumbnail_url: item.thumbnail_url || null,
      posted_at: item.timestamp,
      like_count: item.like_count ?? null,
      comments_count: item.comments_count ?? null,
      reach: insights.reach ?? null,
      views: insights.views ?? null,
      saved: insights.saved ?? null,
      shares: insights.shares ?? null,
      total_interactions: insights.total_interactions ?? null,
      avg_watch_time: insights.avg_watch_time ?? null,
    };
  }));

  await supabaseUpsert('ig_media_snapshot', rows, 'media_id,snapshot_date');
  return { count: rows.length, errors };
}

async function syncStories() {
  const errors = [];
  const data = await graphGet(`/${process.env.IG_USER_ID}/stories`, {
    fields: 'id,media_type,media_url,timestamp,permalink',
  }).catch((e) => {
    errors.push('stories list: ' + e.message);
    return { data: [] };
  });

  const stories = data.data || [];
  const rows = await Promise.all(stories.map(async (story) => {
    const [base, nav] = await Promise.all([
      fetchInsightsBatch(story.id, [
        { key: 'reach', metric: 'reach' },
        { key: 'replies', metric: 'replies' },
        { key: 'shares', metric: 'shares' },
        { key: 'profile_visits', metric: 'profile_visits' },
        { key: 'profile_activity', metric: 'profile_activity' },
        { key: 'follows', metric: 'follows' },
      ], {}).catch((e) => { errors.push(`story ${story.id}: ${e.message}`); return {}; }),
      fetchInsightsSafely(story.id, [
        { key: 'navigation', metric: 'navigation', extraParams: { breakdown: 'story_navigation_action_type' } },
      ]),
    ]);

    let taps_forward = null, taps_back = null, exits = null;
    if (Array.isArray(nav.navigation)) {
      for (const v of nav.navigation) {
        const action = v.dimension_values && v.dimension_values[0];
        if (action === 'TAP_FORWARD') taps_forward = v.value;
        if (action === 'TAP_BACK') taps_back = v.value;
        if (action === 'EXITED') exits = v.value;
      }
    }

    return {
      story_id: story.id,
      posted_at: story.timestamp,
      media_type: story.media_type,
      media_url: story.media_url || null,
      permalink: story.permalink || null,
      reach: base.reach ?? null,
      replies: base.replies ?? null,
      shares: base.shares ?? null,
      profile_visits: base.profile_visits ?? null,
      profile_activity: base.profile_activity ?? null,
      follows: base.follows ?? null,
      taps_forward,
      taps_back,
      exits,
    };
  }));

  await supabaseUpsert('ig_story_snapshot', rows, 'story_id');
  return { count: rows.length, errors };
}

export default async function handler(req, res) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
  }

  const missing = ['FB_PAGE_TOKEN', 'IG_USER_ID', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
    .filter((k) => !process.env[k]);
  if (missing.length) {
    res.status(500).json({ error: `Faltando variáveis de ambiente: ${missing.join(', ')}` });
    return;
  }

  const date = todayInSaoPaulo();
  const result = { date, errors: [] };

  // Cada etapa roda em seu próprio try/catch: se posts falharem, stories e
  // conta continuam sendo salvos mesmo assim (antes, um erro em qualquer
  // etapa derrubava o resto da execução).
  try {
    const account = await syncAccountDaily(date);
    result.account = account.row;
    result.errors.push(...account.errors);
  } catch (e) {
    result.errors.push('conta: ' + e.message);
  }

  try {
    const backfill = await backfillAccountDaily(date);
    result.backfillCount = backfill.count;
    result.errors.push(...backfill.errors);
  } catch (e) {
    result.errors.push('backfill: ' + e.message);
  }

  try {
    const media = await syncMedia(date);
    result.mediaCount = media.count;
    result.errors.push(...media.errors);
  } catch (e) {
    result.errors.push('posts: ' + e.message);
  }

  try {
    const stories = await syncStories();
    result.storyCount = stories.count;
    result.errors.push(...stories.errors);
  } catch (e) {
    result.errors.push('stories: ' + e.message);
  }

  console.log('instagram-sync result:', JSON.stringify(result));
  res.status(200).json({ ok: result.errors.length === 0, ...result });
}
