// 공용 인증 모듈 (파일명 _ 로 시작 → Vercel 함수로 노출되지 않음)
// 흐름: 임시 비밀번호(APP_PASSCODE) → 본인 비밀번호 변경(해시 저장) → 서명 토큰(HMAC) 발급. 모든 API는 토큰 필수.
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

let _sb;
const sb = () => (_sb ||= createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }));

const secret = () => crypto.createHash('sha256')
  .update('pl-auth|' + (process.env.AUTH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '')).digest();
const b64 = (b) => Buffer.from(b).toString('base64url');
const TTL_MS = 90 * 24 * 3600 * 1000;

function sign(ver) {
  const p = b64(JSON.stringify({ v: ver, e: Date.now() + TTL_MS }));
  const m = crypto.createHmac('sha256', secret()).update(p).digest('base64url');
  return p + '.' + m;
}
function readToken(tok) {
  const [p, m] = String(tok || '').split('.');
  if (!p || !m) return null;
  const ok = crypto.createHmac('sha256', secret()).update(p).digest('base64url');
  const a = Buffer.from(m), b = Buffer.from(ok);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const o = JSON.parse(Buffer.from(p, 'base64url').toString()); return o.e > Date.now() ? o : null; } catch { return null; }
}
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');

async function getAuth() {
  const { data } = await sb().from('pl_auth').select('*').eq('id', 1).maybeSingle();
  return data || null;
}
// 토큰 검증: 비밀번호 변경 시 ver 이 올라가 기존 토큰은 모두 무효
async function verify(req) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, code: 500, msg: '서버 설정(SUPABASE_*)이 없습니다.' };
  const o = readToken(req.headers['x-app-token']);
  if (!o) return { ok: false, code: 401, msg: '로그인이 필요합니다.' };
  const a = await getAuth();
  const ver = a ? a.ver : 0;           // 0 = 아직 임시 비밀번호 상태
  if (o.v !== ver) return { ok: false, code: 401, msg: '로그인이 만료되었습니다.' };
  if (!a) return { ok: false, code: 403, msg: '먼저 비밀번호를 변경해 주세요.' }; // 임시 비밀번호 상태에서는 기능 사용 불가
  return { ok: true };
}

module.exports = { sb, sign, readToken, hashPw, getAuth, verify };
