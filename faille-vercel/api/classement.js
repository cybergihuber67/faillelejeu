// Fonction serveur Vercel : classement top 10 de Faille (stockage Upstash Redis).
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const ODDS = [2,4,8,16,40,100,300,1000,3000,10000,40000,150000,1000000,3500000,10000000,1e9];
const rd = (cmd) => fetch(URL_, { method: 'POST', headers: { Authorization: 'Bearer ' + TOK }, body: JSON.stringify(cmd) })
  .then((r) => r.json()).then((j) => { if (j.error) throw new Error(j.error); return j.result; });

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_ || !TOK) return res.status(500).json({ error: 'Base de données non configurée' });
  try {
    if (req.method === 'GET') {
      const ids = await rd(['ZREVRANGE', 'faille:board', 0, 9]);
      let top = [];
      if (ids.length) {
        const raw = await rd(['HMGET', 'faille:players', ...ids]);
        top = raw.map((x) => x && JSON.parse(x)).filter(Boolean).map((p) => ({ nick: p.nick, top: p.top, n: p.n }));
      }
      const id = String(req.query.id || '');
      let rank = null;
      if (/^[\w-]{16,64}$/.test(id)) { const r = await rd(['ZREVRANK', 'faille:board', id]); if (r != null) rank = r; }
      return res.status(200).json({ top, rank });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    if (!/^[\w-]{16,64}$/.test(String(b.id))) return res.status(400).json({ error: 'id invalide' });
    if (b.del) {
      await rd(['ZREM', 'faille:board', b.id]); await rd(['HDEL', 'faille:players', b.id]);
      return res.status(200).json({ ok: 1 });
    }
    const nick = String(b.nick || '').trim(), top = b.top, n = b.n, rolls = b.rolls;
    if (!/^[\p{L}\p{N}_\- .]{3,16}$/u.test(nick)) return res.status(400).json({ error: 'pseudo invalide' });
    if (!Number.isInteger(top) || top < 5 || top > 15) return res.status(400).json({ error: 'aura invalide' });
    if (!Number.isInteger(n) || n < 1 || n > 15 || (top === 15 && n !== 15)) return res.status(400).json({ error: 'collection invalide' });
    if (!Number.isInteger(rolls) || rolls < Math.floor(ODDS[top] / 1200) || rolls > 1e8) return res.status(400).json({ error: 'score improbable' });
    const ok = await rd(['SET', 'faille:rl:' + b.id, '1', 'NX', 'EX', 5]);
    if (ok == null) return res.status(429).json({ error: 'trop rapide' });
    await rd(['ZADD', 'faille:board', (top + 1) * 1000 + n, b.id]);
    await rd(['HSET', 'faille:players', b.id, JSON.stringify({ nick, top, n })]);
    await rd(['ZREMRANGEBYRANK', 'faille:board', 0, -501]);
    return res.status(200).json({ ok: 1 });
  } catch (e) {
    return res.status(500).json({ error: 'erreur serveur' });
  }
};
