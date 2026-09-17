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

// Busca métricas de insight uma por uma (uma métrica incompatível com o tipo
// de mídia derruba a chamada inteira se pedida junto com as outras) e
// devolve um objeto { metric: value }. Métricas que falharem viram null,
// sem quebrar as demais.
async function fetchInsightsSafely(objectId, metricSpecs) {
  const out = {};
  for (const spec of metricSpecs) {
    const { key, metric, extraParams } = typeof spec === 'string' ? { key: spec, metric: spec } : spec;
    try {
      const data = await graphGet(`/${objectId}/insights`, { metric, ...extraParams });
      const entry = (data.data || [])[0];
      if (!entry) { out[key] = null; continue; }
      if (entry.values && entry.values.length) {
        out[key] = entry.values[entry.values.length - 1].value;
      } else if (entry.total_value) {
        out[key] = entry.total_value.value;
      } else {
        out[key] = null;
      }
    } catch (e) {
      out[key] = null;
      out[`${key}_error`] = e.message;
    }
  }
  return out;
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

async function syncAccountDaily(date) {
  const errors = [];

  const profile = await graphGet(`/${process.env.IG_USER_ID}`, { fields: 'followers_count' }).catch((e) => {
    errors.push(e.message);
    return {};
  });

  const dayMetrics = await fetchInsightsSafely(process.env.IG_USER_ID, [
    { key: 'reach', metric: 'reach', extraParams: { period: 'day', metric_type: 'total_value' } },
    { key: 'profile_views', metric: 'profile_views', extraParams: { period: 'day', metric_type: 'total_value' } },
    { key: 'impressions', metric: 'impressions', extraParams: { period: 'day', metric_type: 'total_value' } },
  ]);

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
    base.push(
      { key: 'avg_watch_time', metric: 'ig_reels_avg_watch_time' },
    );
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
    for (const item of items) {
      if (new Date(item.timestamp).getTime() < cutoff) return media;
      media.push(item);
    }
    after = data.paging && data.paging.cursors && data.paging.next ? data.paging.cursors.after : null;
    if (!after || items.length === 0) break;
  }
  return media;
}

async function syncMedia(date) {
  const errors = [];
  const mediaList = await fetchAllRecentMedia().catch((e) => {
    errors.push(e.message);
    return [];
  });

  const rows = [];
  for (const item of mediaList) {
    const insights = await fetchInsightsSafely(item.id, metricsForMediaType(item.media_type));
    rows.push({
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
    });
  }

  await supabaseUpsert('ig_media_snapshot', rows, 'media_id,snapshot_date');
  return { count: rows.length, errors };
}

async function syncStories() {
  const errors = [];
  const data = await graphGet(`/${process.env.IG_USER_ID}/stories`, {
    fields: 'id,media_type,media_url,timestamp,permalink',
  }).catch((e) => {
    errors.push(e.message);
    return { data: [] };
  });

  const stories = data.data || [];
  const rows = [];
  for (const story of stories) {
    const insights = await fetchInsightsSafely(story.id, [
      { key: 'reach', metric: 'reach' },
      { key: 'replies', metric: 'replies' },
      { key: 'shares', metric: 'shares' },
      { key: 'profile_visits', metric: 'profile_visits' },
      { key: 'profile_activity', metric: 'profile_activity' },
      { key: 'follows', metric: 'follows' },
      { key: 'navigation', metric: 'navigation', extraParams: { breakdown: 'story_navigation_action_type' } },
    ]);

    let taps_forward = null, taps_back = null, exits = null;
    if (Array.isArray(insights.navigation)) {
      for (const v of insights.navigation) {
        const action = v.dimension_values && v.dimension_values[0];
        if (action === 'TAP_FORWARD') taps_forward = v.value;
        if (action === 'TAP_BACK') taps_back = v.value;
        if (action === 'EXITED') exits = v.value;
      }
    }

    rows.push({
      story_id: story.id,
      posted_at: story.timestamp,
      media_type: story.media_type,
      media_url: story.media_url || null,
      reach: insights.reach ?? null,
      replies: insights.replies ?? null,
      shares: insights.shares ?? null,
      profile_visits: insights.profile_visits ?? null,
      profile_activity: insights.profile_activity ?? null,
      follows: insights.follows ?? null,
      taps_forward,
      taps_back,
      exits,
    });
  }

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

  try {
    const account = await syncAccountDaily(date);
    result.account = account.row;
    result.errors.push(...account.errors);

    const media = await syncMedia(date);
    result.mediaCount = media.count;
    result.errors.push(...media.errors);

    const stories = await syncStories();
    result.storyCount = stories.count;
    result.errors.push(...stories.errors);

    res.status(200).json({ ok: true, ...result });
  } catch (e) {
    result.errors.push(e.message);
    res.status(500).json({ ok: false, ...result });
  }
}
