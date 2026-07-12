// 게임 밸런스 · 등급 환산 · 학과 매핑 · 용어 목록을 한곳에 모은 설정 파일.
// 실제 데이터(서강대 학과 컷, 용어 세트, 밸런스 수치)는 여기만 고치면 됨.

// ---------- 용어 목록 ----------
// 학습에 "도움"이 되는 용어 (집으면 +점수)
export const HELPFUL_TERMS = [
  "질문",
  "답변",
  "튜터링",
  "복습",
  "오답노트",
  "개념정리",
  "집중",
  "계획표",
  "정독",
  "필기",
];

// 학습을 "방해"하는 용어 (집으면 -감점)
export const HARMFUL_TERMS = [
  "유튜브",
  "릴스",
  "인스타그램",
  "숏츠",
  "게임",
  "웹툰",
  "SNS",
  "딴짓",
];

// ---------- 점수 ----------
export const SCORE = {
  helpfulBase: 100, // 도움용어 기본 점수
  harmfulPenalty: -150, // 방해용어 집었을 때 감점
  comboStep: 20, // 콤보 1당 추가 점수
  maxComboBonus: 200, // 콤보 보너스 상한
};

// ---------- 학년별 남은 학기 ----------
// 사용자 예시: 1학년 → 4학기 남음 (현재 학기 종료 가정).
// 조정하기 쉽도록 명시적 테이블로 둠.
export const REMAINING_SEMESTERS: Record<number, number> = {
  1: 4, // 1학년: 4학기 남음
  2: 2, // 2학년: 2학기 남음
  3: 1, // 3학년: 1학기 남음
};

// ---------- 난이도 계수 D ----------
// 목표가 빡셀수록(학기당 부담이 클수록) D가 커진다. 0~1로 정규화.
export function computeDifficulty(
  currentTier: number,
  targetTier: number,
  grade: number
): number {
  const gap = Math.max(0, currentTier - targetTier); // 올려야 할 양
  const remaining = REMAINING_SEMESTERS[grade] ?? 4;
  const burdenPerSemester = gap / remaining; // 학기당 부담

  // 학기당 0.25등급이면 최대 난이도(1.0)로 본다. 그 이상은 1.0으로 clamp.
  const MAX_BURDEN = 0.25;
  const d = Math.min(1, burdenPerSemester / MAX_BURDEN);
  return Number(d.toFixed(3));
}

// ---------- 스테이지 & 난이도 → 게임 파라미터 ----------
export const TOTAL_STAGES = 5;
export const STAGE_DURATION_SEC = 25; // 스테이지당 제한 시간

// 스테이지(1~5)와 난이도 계수 D로 실제 게임 파라미터를 산출.
// 네 요소(낙하속도·방해비율·동시개수·목표점수선)를 균형 있게 함께 올린다.
export function stageParams(stage: number, d: number) {
  // stageFactor: 스테이지 1→5로 0 → 1
  const stageFactor = (stage - 1) / (TOTAL_STAGES - 1);
  // level: D와 스테이지를 합친 종합 난이도 (0~1 근처)
  const level = Math.min(1, 0.5 * d + 0.5 * stageFactor);

  return {
    fallSpeed: 60 + level * 120, // px/sec (60 → 180)
    harmfulRatio: 0.2 + level * 0.35, // 방해용어 비율 (0.2 → 0.55)
    maxConcurrent: Math.round(2 + level * 4), // 동시 등장 (2 → 6)
    spawnIntervalMs: 1300 - level * 700, // 등장 간격 (1300 → 600ms)
    // 이 스테이지 클리어(목표) 점수선 — 실시간 등급 계산의 기준.
    targetScore: Math.round((600 + level * 900) * (0.7 + 0.3 * stage)),
  };
}

// ---------- 점수 → 달성 등급 환산 ----------
// 게임 전체에서 얻을 수 있는 이론적 목표 점수 합을 기준으로,
// 달성률이 높을수록 좋은(낮은) 등급을 준다. 1.0(최상) ~ 5.0(하위).
export function scoreToTier(totalScore: number, d: number): number {
  // 난이도가 높을수록 같은 점수라도 더 좋은 등급을 인정.
  const base = 3000; // 기준 만점 점수(대략)
  const target = base * (0.7 + 0.6 * (1 - d)); // 난이도 보정된 기준선
  const ratio = Math.max(0, Math.min(1, totalScore / target));
  // ratio 1.0 → 1.0등급, ratio 0 → 5.0등급 (선형)
  const tier = 5.0 - ratio * 4.0;
  return Number(tier.toFixed(1));
}

// ---------- 달성 등급 → 서강대 학과 (임시 placeholder) ----------
// TODO: 사용자가 제공하는 실제 서강대 합격 컷라인 데이터로 교체.
export type DeptBand = { maxTier: number; department: string };

export const SOGANG_DEPT_BANDS: DeptBand[] = [
  { maxTier: 1.2, department: "경영학과 (임시)" },
  { maxTier: 1.5, department: "경제학과 (임시)" },
  { maxTier: 1.8, department: "컴퓨터공학과 (임시)" },
  { maxTier: 2.2, department: "커뮤니케이션학과 (임시)" },
  { maxTier: 2.8, department: "사회학과 (임시)" },
  { maxTier: 3.5, department: "물리학과 (임시)" },
  { maxTier: 99, department: "자유전공 (임시)" },
];

export function tierToDepartment(tier: number): string {
  for (const band of SOGANG_DEPT_BANDS) {
    if (tier <= band.maxTier) return band.department;
  }
  return SOGANG_DEPT_BANDS[SOGANG_DEPT_BANDS.length - 1].department;
}
