// 사진 1장 분류 API — 토큰 절감형 2단계 구조
//  1단계(fast)  : Haiku 5.5, 800px 저해상도, 도구 호출 강제(=추론 없음) → 대부분 여기서 끝
//  2단계(strong): Sonnet 5.5, 1024px, 추론 최소화(between_tools + effort low) → 1단계가 자신 없을 때만
// 공통: 고정 지침(system+tools)은 프롬프트 캐시, 출력은 짧은 키(t,s,c,d,n,r)로 압축
// 환경변수: ANTHROPIC_API_KEY(필수), APP_PASSCODE(권장), CLAUDE_MODEL_FAST, CLAUDE_MODEL_STRONG

const TRADES = [
  '가설·보양', '철거', '목공', '경량·석고보드', '천장', '전기·조명', '설비·배관', '방수', '타일', '미장·조적',
  '도장-바탕처리', '도장-하도(프라이머)', '도장-중·상도', '도장-특수(에폭시·스프레이·방청)', '도배', '바닥재',
  '창호·유리', '가구·싱크대', '금속·철물', '필름·시트', '청소·마감', '자재반입·현황', '기타',
];
const STAGES = ['시공전', '시공중', '시공후', '기타'];

const FAST_MODEL = process.env.CLAUDE_MODEL_FAST || 'claude-haiku-5-5';
const STRONG_MODEL = process.env.CLAUDE_MODEL_STRONG || process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';

// 출력 스키마: 키를 짧게, 서술은 최소로 (출력 토큰이 입력보다 비쌈)
const TOOL = {
  name: 'record_photo',
  description: 'Record the classification of one site photo.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      t: { type: 'string', enum: TRADES },
      s: { type: 'string', enum: STAGES },
      c: { type: 'integer', enum: [1, 2, 3, 4, 5] },
      d: { type: 'string' },
      n: { type: 'string' },
      r: { type: 'string' },
    },
    required: ['t', 's', 'c', 'd', 'n', 'r'],
  },
};

// 고정 지침(영문=토큰 절약, 공종 판별 기준=정확도). 캐시 대상이라 길어도 반복 비용이 거의 없음.
const SYSTEM = `You classify ONE photo from an interior-construction site in Korea (the company specializes in painting) for a photo-evidence ledger. Call record_photo exactly once. No other text.

Fields: t=trade. s=stage. c=confidence 1-5. d=detail in Korean, max 12 chars. n=caption in Korean, max 30 chars, only what is visible, include the room if visible. r=reason a human should double-check, Korean, max 20 chars, otherwise empty string.

Choose t by the WORK shown, not by the room:
- 가설·보양: masking tape, plastic sheeting, floor/film protection, scaffolding, temporary partition
- 철거: demolition, removed ceiling/wall/floor, debris
- 목공: wood framing, plywood, trim/molding, door frames, carpentry
- 경량·석고보드: steel studs, gypsum board installation, joint tape
- 천장: ceiling structure work (grid, boards)
- 전기·조명: wiring, switches, outlets, lights, panels
- 설비·배관: pipes, drains, boiler, plumbing, HVAC ducts
- 방수: waterproofing membrane or coating in wet areas
- 타일: tile laying, grout
- 미장·조적: cement mortar, plastering, brick/block
- 도장-바탕처리: paint surface prep: sanding, putty/filler, patching, crack repair, caulking/sealant, masking before paint
- 도장-하도(프라이머): primer or sealer coat
- 도장-중·상도: intermediate/finish coats by roller, brush or airless sprayer; finished painted surfaces
- 도장-특수(에폭시·스프레이·방청): epoxy floor, rust-proof paint on steel, industrial spray, special coatings
- 도배: wallpaper
- 바닥재: flooring (vinyl, wood, deco tile, sheet)
- 창호·유리: windows, glazing, door installation
- 가구·싱크대: kitchen cabinets, furniture, built-in closets
- 금속·철물: steel/aluminum work, handrails, hardware
- 필름·시트: interior film or sheet wrapping
- 청소·마감: final cleaning, punch-list touch-up, completion shots
- 자재반입·현황: material deliveries, stacked paint cans or boxes, tools only, general overview with no specific work
- 기타: none of the above

Stage: 시공전=existing condition, defects, before work; 시공중=work in progress or intermediate state (masking applied, putty drying, primer coat, wet roller marks, workers painting); 시공후=finished and clean; 기타=unclear.
Painting hints: rough patched or white filler spots and sanding dust mean 바탕처리; a worker rolling or brushing, or wet roller marks, means 중·상도 + 시공중; a uniform clean painted wall means 중·상도 + 시공후.
Confidence c: 5 clear, 4 likely, 3 plausible alternatives exist, 2 guess, 1 cannot tell.
If a "prev" trade is given, it was shot minutes earlier and is often the same work, but decide from the image.
Never identify people. Use only what is visible.`;

const SYSTEM_BLOCKS = [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }];

async function post(body) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

async function ask(strong, mediaType, b64, text) {
  const base = {
    model: strong ? STRONG_MODEL : FAST_MODEL,
    system: SYSTEM_BLOCKS,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
        { type: 'text', text },
      ],
    }],
  };
  // fast(Haiku): 도구 강제 호출 → 추론 블록 없이 바로 답. strong(Sonnet): 강제 호출 불가 → auto + strict + 추론 최소화
  const first = strong
    ? { ...base, max_tokens: 400, tools: [{ ...TOOL, strict: true }], tool_choice: { type: 'auto' },
        thinking: { type: 'between_tools' }, output_config: { effort: 'low' } }
    : { ...base, max_tokens: 200, tools: [TOOL], tool_choice: { type: 'tool', name: 'record_photo' } };
  let r = await post(first);
  // 안전장치: 모델별 파라미터 차이로 400이 나면 가장 보수적인 형태로 1회만 재시도 (추론은 effort low로 억제)
  if (!r.ok && r.status === 400) {
    r = await post({ ...base, max_tokens: 600, tools: [TOOL], tool_choice: { type: 'auto' }, output_config: { effort: 'low' } });
  }
  return r;
}

function extract(data) {
  const tu = (data.content || []).find((b) => b.type === 'tool_use' && b.name === 'record_photo');
  if (tu && tu.input) return tu.input;
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const m = /\{[\s\S]*\}/.exec(text);
  if (m) { try { return JSON.parse(m[0]); } catch (_) { /* 아래에서 null */ } }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const pass = process.env.APP_PASSCODE;
  if (pass && req.headers['x-app-passcode'] !== pass) return res.status(401).json({ error: '암호가 올바르지 않습니다.' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: '서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다.' });

  try {
    const { image, prev, tier } = req.body || {};
    const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(image || '');
    if (!m) return res.status(400).json({ error: '이미지 형식 오류' });
    const strong = tier === 'strong';
    const prevTrade = TRADES.includes(prev) ? prev : '';
    const text = prevTrade ? `prev: ${prevTrade}` : 'prev: none';

    const r = await ask(strong, m[1], m[2], text);
    if (!r.ok) return res.status(502).json({ error: r.data?.error?.message || ('AI 호출 실패 ' + r.status) });

    const o = extract(r.data);
    if (!o) return res.status(502).json({ error: 'AI 응답에서 결과를 찾지 못했습니다.' });

    const t = TRADES.includes(o.t) ? o.t : '기타';
    const s = STAGES.includes(o.s) ? o.s : '기타';
    const c = Number.isInteger(o.c) && o.c >= 1 && o.c <= 5 ? o.c : 3;
    const rv = String(o.r ?? '').slice(0, 40);
    const u = r.data.usage || {};
    return res.status(200).json({
      trade: t, stage: s, detail: String(o.d ?? '').slice(0, 40), caption: String(o.n ?? '').slice(0, 120), space: '',
      confidence: c / 5, review_reason: rv,
      // 1단계가 자신 없을 때만 2단계 호출을 요청 (비싼 모델 사용 최소화)
      escalate: !strong && (c <= 3 || t === '기타' || !!rv),
      tier: strong ? 'strong' : 'fast', model: r.data.model || (strong ? STRONG_MODEL : FAST_MODEL),
      usage: {
        in: u.input_tokens || 0, out: u.output_tokens || 0,
        cr: u.cache_read_input_tokens || 0, cw: u.cache_creation_input_tokens || 0,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
};

module.exports.config = { api: { bodyParser: { sizeLimit: '4mb' } } };
