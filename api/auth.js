// 로그인 / 비밀번호 변경. 실패 5회 → 10분 잠금.
const crypto = require('crypto');
const { sb, sign, readToken, hashPw, getAuth } = require('./_auth');

const MAX_FAILS = 5, LOCK_MIN = 10;
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: '서버 설정이 없습니다.' });
  const { action, password, newPassword } = req.body || {};
  const s = sb();
  try {
    const a = await getAuth();

    if (action === 'login') {
      const { data: f } = await s.from('pl_auth_fail').select('*').eq('id', 1).maybeSingle();
      if (f?.locked_until && new Date(f.locked_until) > new Date()) {
        const m = Math.ceil((new Date(f.locked_until) - Date.now()) / 60000);
        return res.status(429).json({ error: `시도 횟수 초과. ${m}분 후 다시 시도하세요.` });
      }
      let ok = false;
      if (a) ok = eq(hashPw(String(password || ''), a.salt), a.pw_hash);
      else ok = !!process.env.APP_PASSCODE && eq(password || '', process.env.APP_PASSCODE);
      if (!ok) {
        const n = (f?.fails || 0) + 1;
        await s.from('pl_auth_fail').upsert({ id: 1, fails: n >= MAX_FAILS ? 0 : n,
          locked_until: n >= MAX_FAILS ? new Date(Date.now() + LOCK_MIN * 60000).toISOString() : null });
        return res.status(401).json({ error: n >= MAX_FAILS ? `${MAX_FAILS}회 실패. ${LOCK_MIN}분간 잠깁니다.` : '비밀번호가 올바르지 않습니다.' });
      }
      await s.from('pl_auth_fail').upsert({ id: 1, fails: 0, locked_until: null });
      return res.status(200).json({ token: sign(a ? a.ver : 0), mustChange: !a });
    }

    if (action === 'change') {
      // 현재 토큰 필요 (임시 로그인 직후 포함)
      const o = readToken(req.headers['x-app-token']);
      if (!o || o.v !== (a ? a.ver : 0)) return res.status(401).json({ error: '로그인이 필요합니다.' });
      const pw = String(newPassword || '');
      if (pw.length < 8 || pw.length > 64) return res.status(400).json({ error: '비밀번호는 8~64자로 입력하세요.' });
      if (process.env.APP_PASSCODE && eq(pw, process.env.APP_PASSCODE)) return res.status(400).json({ error: '임시 비밀번호와 다른 값을 사용하세요.' });
      if (a) { // 이미 변경된 상태에서의 재변경은 현재 비밀번호 재확인
        if (!eq(hashPw(String(password || ''), a.salt), a.pw_hash)) return res.status(401).json({ error: '현재 비밀번호가 올바르지 않습니다.' });
      }
      const salt = crypto.randomBytes(16).toString('hex');
      const ver = (a ? a.ver : 0) + 1;
      const { error } = await s.from('pl_auth').upsert({ id: 1, pw_hash: hashPw(pw, salt), salt, ver, updated_at: new Date().toISOString() });
      if (error) throw error;
      return res.status(200).json({ token: sign(ver) });   // 다른 기기의 기존 토큰은 ver 불일치로 무효
    }
    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
};
