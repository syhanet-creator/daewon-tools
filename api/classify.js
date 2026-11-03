// Vercel 서버리스 함수: 사진 1장을 보고 공종/단계/설명을 구조화해서 반환
// 환경변수: ANTHROPIC_API_KEY (필수), APP_PASSCODE (권장, 앱 접근 암호), CLAUDE_MODEL (선택)

const TRADES = [
  '가설·보양',
  '철거',
  '목공',
  '경량·석고보드',
  '천장',
  '전기·조명',
  '설비·배관',
  '방수',
  '타일',
  '미장·조적',
  '도장-바탕처리',
  '도장-하도(프라이머)',
  '도장-중·상도',
  '도장-특수(에폭시·스프레이·방청)',
  '도배',
  '바닥재',
  '창호·유리',
  '가구·싱크대',
  '금속·철물',
  '필름·시트',
  '청소·마감',
  '자재반입·현황',
  '기타',
];
const STAGES = ['시공전', '시공중', '시공후', '기타'];

const TOOL = {
  name: 'record_photo',
  description: '현장 사진 1장의 분류 결과를 기록한다.',
  input_schema: {
    type: 'object',
    properties: {
      trade: { type: 'string', enum: TRADES, description: '공종' },
      detail: { type: 'string', description: '세부 작업 (예: 벽체 퍼티 2차, 천장 로울러 도장)' },
      stage: { type: 'string', enum: STAGES, description: '시공 단계' },
      confidence: { type: 'number', description: '공종 판단 신뢰도 0~1' },
      caption: { type: 'string', description: '사진대지 비고란용 한 문장(40자 내외), 보이는 사실만 기술' },
      space: { type: 'string', description: '공간 추정 (거실, 주방, 복도, 외벽 등). 불분명하면 빈 문자열' },
      review_reason: { type: 'string', description: '사람이 확인해야 할 이유. 없으면 빈 문자열' },
    },
    required: ['trade', 'detail', 'stage', 'confidence', 'caption', 'space', 'review_reason'],
  },
};

const SYSTEM = `당신은 실내건축 시공 현장의 사진증빙(사진대지) 정리를 돕는 보조자입니다.
이 회사는 실내건축공사업 면허 보유 업체이며 도장(페인트) 공사가 전문입니다.
사진을 보고 공종, 세부 작업, 시공 단계를 판단해 record_photo 도구로만 답하세요.

판단 기준:
- 도장 공종은 세분화하세요: 바탕처리(사포질, 퍼티, 패치, 크랙보수, 실란트, 마스킹), 하도(프라이머/실러), 중·상도(로울러·붓·에어리스 도장), 특수(에폭시, 방청, 스프레이, 바닥 코팅).
- 시공전: 기존 상태/하자/철거 전. 시공중: 작업 진행 중 또는 자재·도구가 작업 중인 상태. 시공후: 마감이 끝난 상태.
- 보양(비닐, 마스킹테이프, 바닥 포장)은 '가설·보양'. 자재 캔·박스만 있으면 '자재반입·현황'.
- caption에는 사진에서 실제로 보이는 사실만 쓰고 추측을 덧붙이지 마세요. 증빙 서류에 들어갑니다.
- 확신이 낮거나 공종이 둘 이상 겹치면 confidence를 낮추고 review_reason에 이유를 쓰세요.
- 사람 얼굴이 보여도 식별하거나 언급하지 마세요.
- 다른 설명 없이 record_photo 도구를 정확히 한 번만 호출하세요.`;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const pass = process.env.APP_PASSCODE;
  if (pass && req.headers['x-app-passcode'] !== pass) {
    return res.status(401).json({ error: '암호가 올바르지 않습니다.' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: '서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다.' });
  }

  try {
    const { image, takenAt, hint } = req.body || {};
    const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(image || '');
    if (!m) return res.status(400).json({ error: '이미지 형식 오류' });

    const userText =
      `촬영시각: ${takenAt || '알 수 없음'}` + (hint ? `\n참고 메모: ${hint}` : '') + '\n이 사진을 분류하세요.';

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5',
        max_tokens: 600,
        system: SYSTEM,
        tools: [TOOL],
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } },
              { type: 'text', text: userText },
            ],
          },
        ],
      }),
    });

    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: data?.error?.message || 'AI 호출 실패' });

    // 1순위: record_photo 도구 호출. 2순위(안전장치): 본문에 JSON이 온 경우
    let out = (data.content || []).find((b) => b.type === 'tool_use' && b.name === 'record_photo')?.input;
    if (!out) {
      const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      const m2 = /\{[\s\S]*\}/.exec(text);
      if (m2) { try { out = JSON.parse(m2[0]); } catch (_) { /* 아래에서 오류 처리 */ } }
    }
    if (!out || typeof out !== 'object') return res.status(502).json({ error: 'AI 응답에서 결과를 찾지 못했습니다.' });
    out.detail = String(out.detail ?? '');
    out.caption = String(out.caption ?? '');
    out.space = String(out.space ?? '');
    out.review_reason = String(out.review_reason ?? '');
    out.confidence = typeof out.confidence === 'number' ? out.confidence : 0.5;
    if (!TRADES.includes(out.trade)) out.trade = '기타';
    if (!STAGES.includes(out.stage)) out.stage = '기타';
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
};

module.exports.config = { api: { bodyParser: { sizeLimit: '4mb' } } };
