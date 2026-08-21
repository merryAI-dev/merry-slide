# Merry-slide 리드문 작성

리드문은 슬라이드마다 두 군데 들어간다. 둘 다 이 문서의 기준을 따른다.

| 위치 | 필드 | 성격 |
| --- | --- | --- |
| 헤더 구분선 위 제목줄 | `title` | 그 장이 증명하는 **주장** 한 문장 |
| 헤더 구분선 아래 문단 | `content.intro` | 그 페이지 전체를 설명하는 **배경과 맥락** |

`title`이 결론이고 `intro`가 그 결론에 이르는 맥락이다. 같은 말을 두 번 쓰지 않는다.

## API를 호출하지 않는다

리드문은 **이 스킬을 실행하는 모델이 세션 안에서 직접 쓴다.** 외부 API를 부르지 않는다.

로컬 스크립트가 하는 일은 계산뿐이다.

- `scripts/lead/lead_retriever.py` — 코퍼스에서 비슷한 리드문을 검색해 few-shot 재료로 준다
- `scripts/lead/lead_scorer.py` — 작성한 문장을 규칙으로 채점한다

검색과 채점은 순수 Python이고 네트워크를 쓰지 않는다. 모델은 검색 결과를 참고해 문장을 쓰고, 채점 결과로 스스로 고친다.

## 코퍼스

`references/lead-corpus/`에 기존 제안서에서 추출한 리드문 예시 약 2,700개가 있다. 슬롯이 치환된 형태로 저장되어 문장 구조만 참고하게 되어 있다.

```
{METHOD}을 통해 {TARGET}이 방향{EFFECT} 모델을 검증하고 정교화 할 수 있도록 지속적으로 지원합니다.
```

주요 슬롯: `EFFECT` 성과·효과 · `METHOD` 방법·프로그램 · `TARGET` 대상 · `ORG` 기관 · `THEME` 주제 · `YEAR` 연도

원 자료는 [SuggestionPPT](https://github.com/merryAI-dev/SuggestionPPT)의 `lead-writer` 스킬이다.

## 작성 절차

### 1. 검색

슬라이드의 성격에 맞는 예시를 먼저 뽑는다.

```bash
python3 scripts/lead/lead_retriever.py \
  --part PART_3 --slots EFFECT,METHOD,TARGET --keywords 지원,전문가 --k 5
```

| 인자 | 값 |
| --- | --- |
| `--part` | `INTRO` `OVERVIEW` `PART_1`~`PART_4` `PLAN` `UNKNOWN` |
| `--slots` | 그 문장에 쓸 슬롯 조합 |
| `--keywords` | 슬라이드 내용에서 뽑은 핵심어 |
| `--k` | 가져올 예시 수. 3~5개면 충분하다 |

코퍼스 위치를 바꾸려면 `MERRY_LEAD_CORPUS` 환경변수를 쓴다.

### 2. 작성

검색된 예시의 **문장 구조와 호흡**을 참고하되 내용을 베끼지 않는다. 사실관계는 사용자 자료에서만 가져온다.

- 종결은 `합니다` `입니다` `습니다` 계열 경어체로 통일한다.
- 슬롯 자리에 실제 고유명사와 수치를 넣는다. `{TARGET}` 같은 placeholder를 산출물에 남기지 않는다.
- 한 문장에 쉼표를 세 개 이상 넣지 않는다. 길어지면 두 문장으로 나눈다.
- 제목줄(`title`)을 되풀이하지 않는다.
- 아래 본문 블록의 항목을 그대로 나열하지 않는다.

### 3. 자가 채점

```bash
python3 - <<'PY'
import sys, json; sys.path.insert(0, "scripts/lead")
from lead_scorer import score_lead
text = "작성한 리드문"
print(score_lead(text, {"length_min": 150, "length_max": 200}))
PY
```

점수가 0 이하면 고쳐 쓴다. `details`가 어디가 걸렸는지 알려준다.

| 항목 | 의미 |
| --- | --- |
| `length_ok` | 길이 범위 |
| `ending_ok` | 경어체 종결 |
| `unknown_placeholders` | 치환되지 않은 슬롯이 남았는지 |
| `missing_slots` | 요구한 슬롯이 빠졌는지 |

## 길이 기준

기준이 셋으로 갈린다. 작업 전에 어느 것을 따를지 정한다.

| 출처 | 범위 | 비고 |
| --- | --- | --- |
| Merry-slide 기본값 | **150~200자** | `intro`에 적용 |
| `lead_scorer.py` 기본값 | 100~120자 | SuggestionPPT의 원래 설정 |
| 레퍼런스 실측 | 80~243자 (중앙값 172) | 본문 21장 실측. 기본값과 대체로 일치 |

Merry-slide는 150~200자를 기본으로 쓴다. 채점할 때 `{"length_min": 150, "length_max": 200}`을 반드시 넘긴다. 넘기지 않으면 100~120자 기준으로 채점되어 정상 문장이 감점된다.

프리뷰의 길이 배지도 같은 기준을 쓴다. 다른 범위가 필요하면 `--lead-min` / `--lead-max`로 넘긴다.

사용자가 레퍼런스와 같은 밀도를 원하면 범위를 넓히되, 정하기 전에 물어본다.
