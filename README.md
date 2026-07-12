# 정율 캐치 (JY-Catch) 🖐️

정율사관학원 이벤트용 **캠 손동작 학습 게임**.
캠 영상 위로 떨어지는 학습 용어를 손으로 잡아 점수를 얻고, 유혹(SNS) 용어는 흘려보낸다.
최종 점수를 달성 등급으로 환산해 "서강대 ○○학과 합격!" 순위에 등록한다.

## 기술 스택

- Next.js 16 (App Router) + React 19 + TypeScript
- Prisma + SQLite
- MediaPipe Tasks Vision `GestureRecognizer` (CDN, 온디바이스 손 인식)
- `qrcode` (신청 QR 생성)

## 실행

```bash
npm install
npx prisma db push      # SQLite DB 생성 (prisma/dev.db)
npm run dev             # http://localhost:3000
```

> **카메라 주의:** `getUserMedia`는 `localhost` 또는 `https`에서만 동작합니다.
> 학생 폰이 QR로 접속하려면 같은 네트워크에서 접근 가능한 주소(예: `https` 터널 또는 배포)가 필요합니다.

## 운영 구조

- **메인 기기 1대** (카메라 + 큰 화면): `/` 게임 앱. 대기열의 학생을 순서대로 진행.
- **학생 폰**: 우측 QR 코드로 `/join` 접속 → 정보 입력 → 대기열 등록.

## 화면 흐름

```
[학생 폰] /join  신청 (이름·학교·학년·현재등급·목표등급)
        │
        ▼
[메인]   대기 화면 → 👍 엄지척 유지로 게임 시작
        │
        ▼
        게임 (캠 배경 위 낙하 물체, 5스테이지)
          🟢 도움용어(질문·튜터링…) 집으면 +점수
          🔴 방해용어(유튜브·릴스…) 집으면 -감점
          조작: 손바닥→주먹(집기)
        │
        ▼
        결과 (달성등급 + 서강대 학과 합격) → 순위 등록
```

## 커스터마이징 (`lib/game-config.ts` 한 곳)

- `HELPFUL_TERMS` / `HARMFUL_TERMS` — 용어 세트
- `computeDifficulty` — 등급 차이·학년 기반 난이도 계수 D
- `stageParams` — 스테이지·난이도 → 낙하속도/방해비율/동시개수/목표점수
- `scoreToTier` — 점수 → 달성 등급 환산
- `SOGANG_DEPT_BANDS` — **달성 등급 → 서강대 학과 매핑 (현재 임시값, 실제 데이터로 교체 예정)**

## 미완/조정 예정

- 서강대 학과 매핑 실제 컷라인 데이터 반영
- 밸런스(난이도·점수) 실플레이 후 튜닝
- 사운드 이펙트(2차)
