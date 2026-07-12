// 게임 밸런스 · 등급 환산 · 학과 매핑 · 용어 목록을 한곳에 모은 설정 파일.
// 실제 데이터(서강대 학과 컷, 용어 세트, 밸런스 수치)는 여기만 고치면 됨.

// ---------- 용어 목록 ----------
// 학습에 "도움"이 되는 용어 (집으면 +점수)
export const HELPFUL_TERMS = [
  "질문",
  "답변",
  "튜터링",
  "복습",
  "예습",
  "오답노트",
  "개념정리",
  "집중",
  "계획표",
  "정독",
  "필기",
  "암기",
  "문제풀이",
  "요약",
  "메모",
  "몰입",
  "끈기",
  "자기주도",
  "아하포인트",
  "단권화",
  "출석",
  "질의응답",
  "스터디",
  "목표설정",
  "루틴",
  "정리노트",
  "심화학습",
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
  "야식",
  "낮잠",
  "카톡",
  "틱톡",
  "넷플릭스",
  "쇼핑",
  "치지직",
  "롤",
  "배그",
  "잡담",
  "미루기",
  "핸드폰",
  "밤새우기",
  "폭식",
  "멍때리기",
];

// ---------- 점수 ----------
export const SCORE = {
  helpfulBase: 100, // 도움용어 집기 기본 점수
  // (도움용어를 놓쳐도 점수 감점은 없음 — 등급은 "집은 비율"로만 계산)
  harmfulPenalty: -80, // 방해용어를 집었을 때 점수 감점
  comboStep: 20, // 콤보 1당 추가 점수
  maxComboBonus: 200, // 콤보 보너스 상한
};

// ---------- 학기(스테이지) 구조 ----------
// 학년과 무관하게 고등학교 6개 학기(1-1 ~ 3-2)로 통일.
const ALL_SEMESTERS: { key: string; label: string }[] = [
  { key: "1-1", label: "1학년 1학기" },
  { key: "1-2", label: "1학년 2학기" },
  { key: "2-1", label: "2학년 1학기" },
  { key: "2-2", label: "2학년 2학기" },
  { key: "3-1", label: "3학년 1학기" },
  { key: "3-2", label: "3학년 2학기" },
];

// 학기 목록 (스테이지 순서대로) — 모든 학년 동일하게 6학기.
export function semestersForGrade(_grade: number): { key: string; label: string }[] {
  return ALL_SEMESTERS;
}

// 스테이지(학기) 개수 — 항상 6.
export function totalStagesForGrade(_grade: number): number {
  return ALL_SEMESTERS.length;
}

// 학기당 게임 시간(초).
export function stageDurationSec(_grade: number): number {
  return 25;
}

// ---------- 난이도 계수 D ----------
// 목표가 빡셀수록(남은 학기당 올려야 할 양이 클수록) D가 커진다. 0~1로 정규화.
export function computeDifficulty(
  currentTier: number,
  targetTier: number,
  grade: number
): number {
  const gap = Math.max(0, currentTier - targetTier); // 올려야 할 양
  const remaining = totalStagesForGrade(grade); // 남은 학기 수
  const burdenPerSemester = gap / remaining; // 학기당 부담

  // 학기당 0.5등급이면 최대 난이도(1.0). 그 이상은 1.0으로 clamp.
  const MAX_BURDEN = 0.5;
  const d = Math.min(1, burdenPerSemester / MAX_BURDEN);
  return Number(d.toFixed(3));
}

// ---------- 관리자 조절 게임 설정 ----------
export type GameSettings = {
  difficultyMult: number; // 전체 난이도 배율
  highCatch: number; // 기준점1 잡기율
  highGrade: number; // 그때 등급
  lowCatch: number; // 기준점2 잡기율
  lowGrade: number; // 그때 등급
  wrongPenalty: number; // 방해 오터치 페널티
};

export const DEFAULT_SETTINGS: GameSettings = {
  difficultyMult: 1.0,
  highCatch: 0.9,
  highGrade: 1.1,
  lowCatch: 0.4,
  lowGrade: 3.0,
  wrongPenalty: 0.5,
};

// ---------- 스테이지 & 난이도 → 게임 파라미터 ----------
// stage: 1부터, total: 그 학년의 총 스테이지 수, d: 난이도 계수, mult: 관리자 난이도 배율.
export function stageParams(stage: number, total: number, d: number, mult = 1) {
  // stageFactor: 첫 스테이지 0 → 마지막 스테이지 1 (단일 스테이지면 0.5로 중간 난이도)
  const stageFactor = total <= 1 ? 0.5 : (stage - 1) / (total - 1);
  // level: 스테이지 비중을 키워 뒤로 갈수록 확실히 어려워지게. (0~1)
  const level = Math.min(1, 0.35 * d + 0.65 * stageFactor);
  // 난이도 배율은 "증가분"에만 곱해 기본선은 유지하되 어려움을 스케일.
  const m = Math.max(0.5, Math.min(2, mult));

  return {
    fallSpeed: 120 + level * 200 * m,
    harmfulRatio: Math.min(0.75, 0.28 + level * 0.32 * m),
    maxConcurrent: Math.round(4 + level * 4 * m),
    spawnIntervalMs: Math.max(300, 950 - level * 500 * m),
  };
}

// 스테이지 진행도(0~1)별 "색 힌트 신뢰도": 1이면 색으로 완벽 구분, 0이면 랜덤(단어로 판단).
// 앞 학기는 색 힌트 확실, 뒤 학기로 갈수록 색이 섞여 어려워진다.
export function colorReliability(stage: number, total: number): number {
  const f = total <= 1 ? 0.5 : (stage - 1) / (total - 1);
  if (f <= 0.25) return 1;
  if (f <= 0.5) return 0.6;
  if (f <= 0.75) return 0.3;
  return 0;
}

// ---------- 학기 정확도 → 학기 등급 ----------
// 관리자가 정한 두 기준점(highCatch→highGrade, lowCatch→lowGrade)을 지나는
// 선형 관계로 잡기율을 등급으로 변환. 그래서 "90% 잡으면 1.1등급" 같은 목표가 그대로 반영됨.
//   difficulty(D): 목표가 어려울수록 잡기율을 살짝 올려줘(유리) 컷을 완화.
//   stageProgress: 뒤 학기일수록 잡기율을 살짝 깎아(불리) 긴장감을 줌.
export function accuracyToSemesterGrade(
  accuracy: number,
  difficulty = 0,
  stageProgress = 0,
  settings: GameSettings = DEFAULT_SETTINGS
): number {
  // 관리자가 정한 기준점(예: 90%→1.1)이 결과에 거의 그대로 나오도록 보정폭을 작게.
  const RELIEF_MAX = 0.05; // D=1일 때 잡기율을 최대 +5%p 유리하게
  const TIGHTEN_MAX = 0.06; // 마지막 학기일 때 잡기율을 최대 -6%p 불리하게(약한 변별)
  const relief = Math.max(0, Math.min(1, difficulty)) * RELIEF_MAX;
  const tighten = Math.max(0, Math.min(1, stageProgress)) * TIGHTEN_MAX;
  // 유효 잡기율 (보정 적용)
  const acc = Math.max(0, Math.min(1, accuracy + relief - tighten));

  const { highCatch, highGrade, lowCatch, lowGrade } = settings;
  // 두 점을 지나는 직선: grade = highGrade + (acc - highCatch) * slope
  const slope = (lowGrade - highGrade) / (lowCatch - highCatch || 1);
  let grade = highGrade + (acc - highCatch) * slope;
  // 1.0~5.0으로 클램프
  grade = Math.max(1.0, Math.min(5.0, grade));
  return Number(grade.toFixed(2));
}

// ---------- 학기 등급들 → 최종 등급 ----------
// 최종 등급 = 6학기 학기등급의 단순 평균.
// (현재등급/목표등급은 게임 난이도 계수 D에만 쓰이고, 최종 산출엔 관여하지 않는다.)
// 인자 currentTier/targetTier는 호환성을 위해 남겨두되 사용하지 않음.
export function finalTierFromSemesters(
  _currentTier: number,
  _targetTier: number,
  semesterGrades: number[]
): number {
  if (semesterGrades.length === 0) return 5.0;
  const avg =
    semesterGrades.reduce((a, b) => a + b, 0) / semesterGrades.length;
  return Number(Math.max(1.0, Math.min(5.0, avg)).toFixed(1));
}

// ---------- 9등급제 → 5등급제 정규분포 환산 ----------
// 서강대 합격선은 9등급제(석차등급). 이를 정규분포를 경유해 5등급제로 환산한다.
//   9등급 등급 → (9등급제 누적비율) → 정규분포 z → (5등급제 누적비율) → 5등급 등급

// 표준정규 누적분포 (Zelen & Severo 근사)
function normalCDF(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}
// 역누적분포 (Acklam 근사): 누적확률 p → z
function normalInv(p: number): number {
  if (p <= 0) return -3.5;
  if (p >= 1) return 3.5;
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const pl = 0.02425;
  let q: number, r: number;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= 1 - pl) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

// 9등급제 등급경계 상위 누적비율 (1등급 4%, 2 11%, 3 23%, 4 40%, 5 60%, ...)
const NINE_CUM = [0, 0.04, 0.11, 0.23, 0.4, 0.6, 0.77, 0.89, 0.96, 1.0];
// 5등급제 등급경계 상위 누적비율 (1등급 10%, 2 34%, 3 66%, 4 90%, 5 100%)
const FIVE_CUM = [0, 0.1, 0.34, 0.66, 0.9, 1.0];

// 9등급제 연속 등급 → 상위 누적비율 (등급 구간 선형 보간)
function nineTierToPercentile(g: number): number {
  g = Math.max(1, Math.min(9, g));
  const lo = Math.floor(g);
  const hi = Math.ceil(g);
  if (lo === hi) return NINE_CUM[lo];
  return NINE_CUM[lo] + (NINE_CUM[hi] - NINE_CUM[lo]) * (g - lo);
}

// 상위 누적비율 → 5등급제 연속 등급 (1.0=최상)
function percentileToFiveTier(pct: number): number {
  pct = Math.max(0, Math.min(1, pct));
  for (let g = 1; g <= 5; g++) {
    if (pct <= FIVE_CUM[g]) {
      const frac = (pct - FIVE_CUM[g - 1]) / (FIVE_CUM[g] - FIVE_CUM[g - 1] || 1);
      return Number((g + frac).toFixed(2));
    }
  }
  return 5;
}

// 9등급제 석차등급 → 5등급제 등급 (정규분포 경유)
export function nineToFiveTier(nineTier: number): number {
  const pct = nineTierToPercentile(nineTier); // 9등급제 상위 누적비율
  const z = normalInv(1 - pct); // 정규분포 상 위치
  const pct5 = 1 - normalCDF(z); // 5등급제에서의 상위 누적비율(동일 z)
  return percentileToFiveTier(pct5);
}

// ---------- 서강대 학과 합격선 (2026 학생부교과 지역균형, 50%컷 9등급제) ----------
// 게임 달성등급(5등급제)이 해당 학과 컷(환산된 5등급제) 이하면 그 학과 "합격".
type SogangDept = { department: string; nineCut: number };
const SOGANG_DEPTS: SogangDept[] = [
  { department: "생명과학과", nineCut: 1.23 },
  { department: "화공생명공학과", nineCut: 1.27 },
  { department: "전자공학과", nineCut: 1.31 },
  { department: "기계공학과", nineCut: 1.38 },
  { department: "사회과학부", nineCut: 1.39 },
  { department: "AI기반자유전공학부", nineCut: 1.39 },
  { department: "인문학기반자유전공학부", nineCut: 1.42 },
  { department: "경영학부", nineCut: 1.46 },
  { department: "경제학과", nineCut: 1.5 },
  { department: "물리학과", nineCut: 1.5 },
  { department: "화학과", nineCut: 1.53 },
  { department: "수학과", nineCut: 1.56 },
  { department: "인문학부", nineCut: 1.57 },
  { department: "영문학부", nineCut: 1.57 },
  { department: "SCIENCE기반자유전공학부", nineCut: 1.39 },
  { department: "지식융합미디어학부", nineCut: 1.61 },
  { department: "유럽문화학과", nineCut: 1.64 },
  { department: "중국문화학과", nineCut: 1.64 },
  { department: "컴퓨터공학과", nineCut: 1.79 },
];

// 2.0등급을 초과(더 나쁨)하면 서강대 불합격.
export const SOGANG_FAIL_TIER = 2.0;

// 5등급제 컷으로 변환 → 좋은 순 정렬 → 겹치는 컷 제거 → 상위권 변별을 위해 리스케일.
// 환산 컷이 1.56~1.95에 촘촘히 몰려 있어, 최상위(생명과학)를 1.35로 낮추고
// 범위를 1.35~1.95로 넓혀 학과 간 간격을 벌린다.
export const SOGANG_DEPT_BANDS = (() => {
  const mapped = SOGANG_DEPTS.map((d) => ({
    department: d.department,
    maxTier: nineToFiveTier(d.nineCut),
  })).sort((a, b) => a.maxTier - b.maxTier);
  // 같은 maxTier(소수점 2자리)는 첫 번째(가장 상위 학과)만 유지
  const seen = new Set<number>();
  const deduped = mapped.filter((b) => {
    const key = Number(b.maxTier.toFixed(2));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // 선형 리스케일: [oldMin, oldMax] → [1.35, 1.95]
  const oldMin = deduped[0].maxTier;
  const oldMax = deduped[deduped.length - 1].maxTier;
  const NEW_MIN = 1.35;
  const NEW_MAX = 1.95;
  const span = oldMax - oldMin || 1;
  return deduped.map((b) => ({
    department: b.department,
    maxTier: Number(
      (NEW_MIN + ((b.maxTier - oldMin) / span) * (NEW_MAX - NEW_MIN)).toFixed(2)
    ),
  }));
})();

// 달성 등급(5등급제) → 합격 학과. 2.0 초과면 불합격.
// 달성등급이 컷 이하면 그 학과 합격 → 컷이 가장 낮은(어려운) 학과부터 확인.
export function tierToDepartment(tier: number): string | null {
  if (tier > SOGANG_FAIL_TIER) return null; // 서강대 불합격
  for (const band of SOGANG_DEPT_BANDS) {
    if (tier <= band.maxTier) return band.department;
  }
  // 2.0 이하지만 모든 컷보다 큰 경우(컷 최댓값~2.0 구간) → 가장 낮은 컷 학과.
  return SOGANG_DEPT_BANDS[SOGANG_DEPT_BANDS.length - 1].department;
}
