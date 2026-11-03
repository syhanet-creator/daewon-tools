# daewon-tools — 사진대지 에이전트 (v0.2)

현장 사진을 올리면 EXIF(촬영시각·GPS)를 읽고, AI가 공종·시공단계·설명을 분류해
현장별/공종별로 정리한 뒤 A4 한 장에 4컷씩 들어가는 사진대지 PDF를 만듭니다.
사진과 분류 결과는 Supabase(`khnlu-accounting` 프로젝트)에 저장됩니다.

## 구성
- `index.html` : 모바일 PWA (오프라인 우선: 폰에 먼저 저장 → 연결되면 서버로 업로드)
- `api/classify.js` : Claude 비전으로 공종·단계·설명 분류
- `api/data.js` : Supabase 입출력 (서명 업로드 URL, 목록, 저장, 삭제). 브라우저는 Supabase에 직접 접근하지 않음
- `supabase/migrations/` : 테이블 `pl_sites`, `pl_photos`, 비공개 버킷 `pl-photos` (이미 적용됨)

## Vercel 환경변수 (필수)
| 이름 | 값 |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API 키 |
| `SUPABASE_URL` | `https://helgojjololdjgugwwvr.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → service_role 키 (서버 전용, 절대 앱 코드에 넣지 말 것) |
| `APP_PASSCODE` | 앱 접근 암호 (앱 [설정]에 같은 값 입력) |
| `CLAUDE_MODEL` | 선택. 기본 `claude-sonnet-5-5` |

배포 후 삼성 폰 Chrome에서 접속 → "홈 화면에 추가".

## 사용법
- [촬영]: 카메라로 바로 촬영. EXIF에 위치가 없으면 촬영 순간 기기 위치 사용.
- [갤러리/파일에서 추가]: 여러 장 선택. 위치는 EXIF에 있을 때만 사용.
- GPS 200m 이내는 같은 현장으로 묶이고, 위치 없는 사진은 6시간 이내 직전 사진의 현장에 붙습니다.
- 카드에서 공종·단계·설명 수정, "확인 필요"는 AI 신뢰도가 낮은 사진.
- [사진대지 PDF 만들기] → 현장/기간 선택 → 인쇄 창에서 "PDF로 저장".

## 알아둘 점
- 안드로이드 Chrome 사진 선택기는 GPS를 지우는 경우가 있어, 위치가 중요하면 [촬영]을 쓰세요.
- 증빙 서류이므로 AI 분류는 초안입니다. 출력 전에 "확인 필요"를 점검하세요.
- 목록은 한 번에 전체를 불러옵니다. 사진이 수천 장 쌓이면 현장·기간별 조회로 바꿔야 합니다.
