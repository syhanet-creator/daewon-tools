// 사진대지 데이터 API (Supabase: pl_sites, pl_photos, 스토리지 버킷 pl-photos)
// 브라우저는 Supabase에 직접 접근하지 않고 이 함수만 호출한다. (RLS 정책 없음 = 서버 service role 전용)
// 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APP_PASSCODE

const { createClient } = require('@supabase/supabase-js');

const BUCKET = 'pl-photos';
const ID_RE = /^[a-z0-9]{6,24}$/;
const SITE_ID_RE = /^([a-z0-9]{6,24}|unassigned)$/;
const STATES = ['new', 'done', 'error'];

let _sb;
function sb() {
  if (!_sb) {
    _sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _sb;
}

const str = (v, n) => String(v ?? '').slice(0, n);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function fail(res, code, msg) {
  return res.status(code).json({ error: msg });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'POST only');

  const pass = process.env.APP_PASSCODE;
  if (pass && req.headers['x-app-passcode'] !== pass) return fail(res, 401, '암호가 올바르지 않습니다.');
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return fail(res, 500, '서버에 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다.');
  }

  const { action } = req.body || {};
  const s = sb();

  try {
    if (action === 'list') {
      const [a, b] = await Promise.all([
        s.from('pl_sites').select('*').order('created_at'),
        s.from('pl_photos').select('*').order('taken_at'),
      ]);
      if (a.error) throw a.error;
      if (b.error) throw b.error;
      const photos = b.data;
      const urls = {};
      // 서명 URL은 한 번에 최대 수백 건씩 발급
      for (let i = 0; i < photos.length; i += 200) {
        const slice = photos.slice(i, i + 200).map((p) => p.storage_path);
        const { data, error } = await s.storage.from(BUCKET).createSignedUrls(slice, 3600);
        if (error) throw error;
        for (const d of data) if (d.path && d.signedUrl) urls[d.path] = d.signedUrl;
      }
      return res.status(200).json({
        sites: a.data,
        photos: photos.map((p) => ({ ...p, url: urls[p.storage_path] || '' })),
      });
    }

    if (action === 'upload-url') {
      const { id } = req.body;
      if (!ID_RE.test(id || '')) return fail(res, 400, 'id 형식 오류');
      const { data, error } = await s.storage.from(BUCKET).createSignedUploadUrl(`${id}.jpg`, { upsert: true });
      if (error) throw error;
      return res.status(200).json({ signedUrl: data.signedUrl, path: data.path });
    }

    if (action === 'save-site') {
      const x = req.body.site || {};
      if (!SITE_ID_RE.test(x.id || '')) return fail(res, 400, '현장 id 형식 오류');
      const { error } = await s.from('pl_sites').upsert({
        id: x.id,
        name: str(x.name, 100) || '현장',
        lat: num(x.gps?.lat),
        lng: num(x.gps?.lng),
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    if (action === 'save-photo') {
      const x = req.body.photo || {};
      if (!ID_RE.test(x.id || '')) return fail(res, 400, 'id 형식 오류');
      if (!SITE_ID_RE.test(x.siteId || '')) return fail(res, 400, '현장 id 형식 오류');
      const t = new Date(x.takenAt);
      if (isNaN(t)) return fail(res, 400, '촬영시각 오류');
      const { error } = await s.from('pl_photos').upsert({
        id: x.id,
        site_id: x.siteId,
        storage_path: `${x.id}.jpg`,
        taken_at: t.toISOString(),
        src_time: str(x.srcTime, 10) || 'exif',
        lat: num(x.gps?.lat),
        lng: num(x.gps?.lng),
        src_gps: str(x.srcGps, 10) || 'none',
        trade: str(x.trade, 60),
        stage: str(x.stage, 20),
        detail: str(x.detail, 200),
        caption: str(x.caption, 500),
        space: str(x.space, 60),
        confidence: num(x.confidence) ?? 0,
        review: str(x.review, 300),
        state: STATES.includes(x.state) ? x.state : 'new',
        user_edited: !!x.userEdited,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    if (action === 'delete-photo') {
      const { id } = req.body;
      if (!ID_RE.test(id || '')) return fail(res, 400, 'id 형식 오류');
      const { error } = await s.from('pl_photos').delete().eq('id', id);
      if (error) throw error;
      await s.storage.from(BUCKET).remove([`${id}.jpg`]);
      return res.status(200).json({ ok: true });
    }

    return fail(res, 400, '알 수 없는 action');
  } catch (e) {
    return fail(res, 500, String(e && e.message ? e.message : e));
  }
};
