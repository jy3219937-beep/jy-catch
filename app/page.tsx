"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import GameCanvas from "./GameCanvas";
import QRPanel from "./QRPanel";
import { useHandTracking } from "@/lib/useHandTracking";
import {
  computeDifficulty,
  tierToDepartment,
  DEFAULT_SETTINGS,
  type GameSettings,
} from "@/lib/game-config";

type Player = {
  id: string;
  name: string;
  school: string;
  grade: number;
  currentTier: number;
  targetTier: number;
};

type ResultRow = {
  id: string;
  name: string;
  school: string;
  achievedTier: number;
  department: string;
  finalScore: number;
};

type Screen = "waiting" | "playing" | "result" | "ranking";

export default function MainApp() {
  const [screen, setScreen] = useState<Screen>("waiting");
  const [current, setCurrent] = useState<Player | null>(null);
  const [waitingCount, setWaitingCount] = useState(0);
  const [waitingList, setWaitingList] = useState<Player[]>([]);
  const [leaderboard, setLeaderboard] = useState<ResultRow[]>([]);
  const [lastResult, setLastResult] = useState<{
    row: ResultRow;
    rank: number;
  } | null>(null);
  // 최신 설정(관리자 조절값). 계속 폴링해두고, 게임 시작 순간 스냅샷해서 넘긴다.
  const latestSettingsRef = useRef<GameSettings>(DEFAULT_SETTINGS);
  const [activeSettings, setActiveSettings] =
    useState<GameSettings>(DEFAULT_SETTINGS);

  // 손 인식은 앱 전체에서 단 하나만 생성 — 대기·게임 화면이 같은 카메라를 공유.
  const { videoRef, ready, loading, error, start, detect } = useHandTracking();

  // 앱 진입 시 카메라 한 번 시작 (권한 프롬프트도 여기서 한 번만).
  // 브라우저 자동재생 정책상 사용자 상호작용이 필요할 수 있어, 실패 시 버튼으로 재시도.
  const [camAsked, setCamAsked] = useState(false);
  useEffect(() => {
    if (!camAsked) return;
    start();
  }, [camAsked, start]);

  // ----- 데이터 폴링 -----
  const refreshQueue = useCallback(async () => {
    try {
      const res = await fetch("/api/players?status=waiting", {
        cache: "no-store",
      });
      const data = await res.json();
      const list: Player[] = data.players ?? [];
      setWaitingList(list);
      setWaitingCount(list.length);
      // 게임 중이 아닐 때만 다음 학생(맨 앞) 후보 갱신
      setScreen((s) => {
        if (s === "waiting") setCurrent(list[0] ?? null);
        return s;
      });
    } catch {
      /* noop */
    }
  }, []);

  const refreshLeaderboard = useCallback(async () => {
    try {
      const res = await fetch("/api/results?limit=100", { cache: "no-store" });
      const data = await res.json();
      setLeaderboard(data.results ?? []);
    } catch {
      /* noop */
    }
  }, []);

  const refreshSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      const data = await res.json();
      if (data.settings) latestSettingsRef.current = data.settings;
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    refreshQueue();
    refreshLeaderboard();
    refreshSettings();
    const t = setInterval(() => {
      refreshQueue();
      refreshLeaderboard();
      refreshSettings();
    }, 2500);
    return () => clearInterval(t);
  }, [refreshQueue, refreshLeaderboard, refreshSettings]);

  // 테스트 모드: 신청 없이 바로 플레이. 결과는 순위에 저장하지 않음.
  const [isTest, setIsTest] = useState(false);

  // ----- 게임 시작 (엄지척 확인 후) -----
  const startGame = useCallback(async () => {
    if (!current) return;
    await fetch(`/api/players/${current.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "playing" }),
    });
    setActiveSettings(latestSettingsRef.current); // 시작 순간 설정 스냅샷
    setIsTest(false);
    setScreen("playing");
  }, [current]);

  // ----- 테스트 시작 (가상 참가자, 순위 미저장) -----
  const startTest = useCallback(() => {
    setCurrent({
      id: "__test__",
      name: "테스트",
      school: "테스트",
      grade: 1,
      currentTier: 3.0, // 고정: 현재 3등급 → 목표 1.3
      targetTier: 1.3,
    });
    setActiveSettings(latestSettingsRef.current); // 시작 순간 설정 스냅샷
    setIsTest(true);
    setScreen("playing");
  }, []);

  // ----- 게임 종료 → 결과 저장(테스트면 건너뜀) -----
  const onFinish = useCallback(
    async (r: {
      finalScore: number;
      semesterGrades: number[];
      finalTier: number;
    }) => {
      if (!current) return;
      // 테스트 플레이: 순위(DB)에는 저장하지 않되 결과 화면은 보여준다.
      if (isTest) {
        setLastResult({
          row: {
            id: "__test__",
            name: current.name,
            school: current.school,
            achievedTier: r.finalTier,
            department: tierToDepartment(r.finalTier) ?? "",
            finalScore: r.finalScore,
          },
          rank: 0, // 0 = 테스트(순위 미반영)
        });
        setScreen("result");
        return;
      }
      try {
        const res = await fetch("/api/results", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            playerId: current.id,
            finalScore: r.finalScore,
            finalTier: r.finalTier,
            semesterGrades: r.semesterGrades,
          }),
        });
        const data = await res.json();
        setLastResult({ row: data.result, rank: data.rank });
      } catch {
        /* noop */
      }
      await refreshLeaderboard();
      setScreen("result");
    },
    [current, isTest, refreshLeaderboard, refreshQueue]
  );

  const difficulty = current
    ? computeDifficulty(current.currentTier, current.targetTier, current.grade)
    : 0;

  const top5 = leaderboard.slice(0, 5);

  return (
    <main style={{ height: "100vh", display: "flex", overflow: "hidden" }}>
      {/* 앱 전체에서 단 하나의 카메라 <video> — 대기·게임 화면이 공유 */}
      <video ref={videoRef} style={{ display: "none" }} playsInline muted />

      {/* 좌: 메인 무대 */}
      <section style={{ flex: 1, position: "relative", minWidth: 0 }}>
        {screen === "waiting" && (
          <WaitingScreen
            current={current}
            waitingCount={waitingCount}
            difficulty={difficulty}
            camReady={ready}
            camLoading={loading}
            camError={error}
            camAsked={camAsked}
            onStartCamera={() => setCamAsked(true)}
            detect={detect}
            videoRef={videoRef}
            onConfirm={startGame}
            onTest={startTest}
            onShowRanking={() => setScreen("ranking")}
          />
        )}
        {screen === "playing" && current && (
          <GameCanvas
            difficulty={difficulty}
            grade={current.grade}
            currentTier={current.currentTier}
            targetTier={current.targetTier}
            settings={activeSettings}
            onFinish={onFinish}
            videoRef={videoRef}
            ready={ready}
            detect={detect}
          />
        )}
        {screen === "result" && lastResult && (
          <ResultScreen
            result={lastResult}
            onNext={() => {
              setIsTest(false);
              setCurrent(null);
              setLastResult(null);
              setScreen("waiting");
              refreshQueue();
            }}
            onRanking={() => setScreen("ranking")}
          />
        )}
        {screen === "ranking" && (
          <RankingScreen
            rows={leaderboard}
            onBack={() => setScreen("waiting")}
          />
        )}
      </section>

      {/* 우: TOP5 + QR 상시 패널 */}
      <aside style={sidePanel}>
        <div>
          <h2 style={{ fontSize: 16, margin: "0 0 12px" }}>🏆 TOP 5</h2>
          {top5.length === 0 && (
            <div style={{ color: "#778", fontSize: 13, lineHeight: 1.6 }}>
              아직 기록이 없어요.
              <br />
              1등의 주인공이 되어보세요!
            </div>
          )}
          {top5.map((r, i) => (
            <div key={r.id} style={rankRow}>
              <span style={rankNum}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{r.name}</div>
                <div style={{ fontSize: 11, color: "#9ac" }}>
                  {r.achievedTier.toFixed(1)}등급
                  {r.department ? ` · ${r.department}` : ""}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* 대기 학생 명단 (TOP5 아래, QR 위) */}
        <div style={{ marginTop: 20, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <h2 style={{ fontSize: 15, margin: "0 0 10px" }}>
            ⏳ 대기 명단{" "}
            <span style={{ color: "#7cf", fontSize: 13 }}>({waitingCount})</span>
          </h2>
          {waitingList.length === 0 ? (
            <div style={{ color: "#667", fontSize: 12 }}>대기 중인 학생 없음</div>
          ) : (
            <div style={{ overflowY: "auto", maxHeight: 220 }}>
              {waitingList.map((p, i) => (
                <div key={p.id} style={waitRow}>
                  <span
                    style={{
                      ...rankNum,
                      color: i === 0 ? "#8f8" : "#667",
                      fontSize: 13,
                    }}
                  >
                    {i === 0 ? "▶" : i + 1}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: i === 0 ? 700 : 500,
                        color: i === 0 ? "#dfe" : "#bcd",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {p.name}
                    </div>
                    <div style={{ fontSize: 10, color: "#778" }}>
                      {p.school} · {p.grade}학년
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ marginTop: "auto", paddingTop: 16 }}>
          <QRPanel size={130} />
        </div>
      </aside>
    </main>
  );
}

// ---------- 대기 화면 (엄지척 확인) ----------
function WaitingScreen({
  current,
  waitingCount,
  difficulty,
  camReady,
  camLoading,
  camError,
  camAsked,
  onStartCamera,
  detect,
  videoRef,
  onConfirm,
  onTest,
  onShowRanking,
}: {
  current: Player | null;
  waitingCount: number;
  difficulty: number;
  camReady: boolean;
  camLoading: boolean;
  camError: string;
  camAsked: boolean;
  onStartCamera: () => void;
  detect: () => import("@/lib/useHandTracking").TrackedHand[];
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onConfirm: () => void;
  onTest: () => void;
  onShowRanking: () => void;
}) {
  const [holdPct, setHoldPct] = useState(0);
  const holdRef = useRef(0);
  const rafRef = useRef(0);
  const firedRef = useRef(false);
  const previewRef = useRef<HTMLCanvasElement>(null);

  // 참가자가 바뀌면 홀드 상태 리셋
  useEffect(() => {
    firedRef.current = false;
    holdRef.current = 0;
    setHoldPct(0);
  }, [current]);

  // 카메라 준비 시 루프 시작: 캠 프리뷰 그리기 + (참가자 있으면) 엄지척 감지
  useEffect(() => {
    if (!camReady) return;
    const HOLD_SEC = 1.2;
    let last = 0;
    const tick = (ts: number) => {
      const dt = last ? (ts - last) / 1000 : 0;
      last = ts;
      const hands = detect();

      // 캠 프리뷰 (거울)
      const video = videoRef.current;
      const pc = previewRef.current;
      if (video && pc && video.readyState >= 2) {
        const cctx = pc.getContext("2d");
        if (cctx) {
          const W = pc.width;
          const H = pc.height;
          cctx.save();
          cctx.translate(W, 0);
          cctx.scale(-1, 1);
          const vw = video.videoWidth || 1280;
          const vh = video.videoHeight || 720;
          const scale = Math.max(W / vw, H / vh);
          cctx.drawImage(
            video,
            (W - vw * scale) / 2,
            (H - vh * scale) / 2,
            vw * scale,
            vh * scale
          );
          cctx.restore();
          // 손 위치 점 표시
          for (const h of hands) {
            if (!h.detected) continue;
            cctx.fillStyle =
              h.gesture === "Thumb_Up"
                ? "rgba(255,213,74,0.95)"
                : "rgba(120,200,255,0.9)";
            cctx.beginPath();
            cctx.arc(h.palm.x * W, h.palm.y * H, 8, 0, Math.PI * 2);
            cctx.fill();
          }
        }
      }

      // 엄지척 감지는 참가자가 있을 때만
      if (current) {
        const thumbUp = hands.some(
          (h) => h.detected && h.gesture === "Thumb_Up"
        );
        if (thumbUp) holdRef.current += dt;
        else holdRef.current = Math.max(0, holdRef.current - dt * 2);
        const pct = Math.min(1, holdRef.current / HOLD_SEC);
        setHoldPct(pct);
        if (pct >= 1 && !firedRef.current) {
          firedRef.current = true;
          onConfirm();
          return;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [current, camReady, detect, onConfirm, videoRef]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
      {/* 배경: 캠 화면 전체 (거울). 준비 전에는 어두운 배경. */}
      <canvas
        ref={previewRef}
        width={1280}
        height={720}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: camReady ? "block" : "none",
        }}
      />
      {/* 가독성용 반투명 오버레이 */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: camReady
            ? "linear-gradient(180deg, rgba(10,10,20,0.55) 0%, rgba(10,10,20,0.35) 40%, rgba(10,10,20,0.7) 100%)"
            : "#0a0a14",
        }}
      />

      {/* 콘텐츠 레이어 */}
      <div style={waitOverlay}>
        {/* 상단: 타이틀 + 안내 */}
        <div style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: 34, margin: "0 0 4px" }}>정율 캐치 🖐️</h1>
          <p style={{ color: "#cdd", margin: "0 0 16px", fontSize: 15 }}>
            학습 용어는 손으로 잡고, 유혹은 흘려보내라!
          </p>
          <div style={guideChips}>
            <span style={guideChip}>✋ 손바닥→주먹으로 집기</span>
            <span style={{ ...guideChip, color: "#8f8" }}>
              🟢 도움 용어 잡기 (놓치면 감점)
            </span>
            <span style={{ ...guideChip, color: "#f88" }}>
              🔴 방해 용어 건드리지 않기
            </span>
            <span style={{ ...guideChip, color: "#fd6" }}>🔥 콤보 보너스</span>
            <span style={guideChip}>
              📈 남은 학기별 스테이지 · 매 학기 등급을 쌓아 최종 등급 완성
            </span>
          </div>
        </div>

        {/* 중앙: 참가자 카드 / 카메라 시작 */}
        <div style={{ display: "flex", justifyContent: "center", flex: 1, alignItems: "center" }}>
          {!camReady ? (
            <div style={waitCardGlass}>
              {!camAsked ? (
                <>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>📷</div>
                  <p style={{ margin: "0 0 16px", color: "#cdd" }}>
                    게임을 하려면 카메라를 켜주세요
                  </p>
                  <button onClick={onStartCamera} style={primaryBtn}>
                    카메라 시작하기
                  </button>
                </>
              ) : camError ? (
                <>
                  <p style={{ color: "#f88", fontSize: 14 }}>{camError}</p>
                  <button onClick={onStartCamera} style={ghostBtn}>
                    다시 시도
                  </button>
                </>
              ) : (
                <p style={{ color: "#cdd", fontSize: 15 }}>
                  {camLoading ? "카메라/모델 로딩 중..." : "카메라 준비 중..."}
                </p>
              )}
            </div>
          ) : !current ? (
            <div style={waitCardGlass}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>📱</div>
              <p style={{ fontSize: 18, margin: "0 0 6px" }}>
                대기 중인 학생이 없습니다
              </p>
              <p style={{ color: "#bcd", fontSize: 14 }}>
                오른쪽 QR 코드로 참여를 신청해주세요
              </p>
            </div>
          ) : (
            <div style={waitCardGlass}>
              <div style={{ fontSize: 13, color: "#9ac", marginBottom: 4 }}>
                다음 참가자
              </div>
              <div style={{ fontSize: 32, fontWeight: 700 }}>{current.name}</div>
              <div style={{ color: "#cdd", margin: "6px 0 14px" }}>
                {current.school} · {current.grade}학년 · 현재{" "}
                {current.currentTier}등급 → 목표 {current.targetTier}등급
              </div>
              <div style={confirmBoxGlass}>
                <div style={{ fontSize: 15, marginBottom: 10 }}>
                  👍 <b>엄지척</b>을 화면에 유지하면 시작!
                </div>
                <div style={holdBar}>
                  <div style={{ ...holdBarFill, width: `${holdPct * 100}%` }} />
                </div>
                <div style={{ fontSize: 12, color: "#bcd", marginTop: 8 }}>
                  {holdPct > 0 ? "유지 중..." : "손을 카메라에 보여주세요"}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 하단: 버튼 */}
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <button
            onClick={onTest}
            disabled={!camReady}
            style={{
              ...ghostBtn,
              marginTop: 0,
              background: "rgba(12,12,26,0.6)",
              borderColor: camReady ? "#3a5" : "#2a2a44",
              color: camReady ? "#9f9" : "#556",
              cursor: camReady ? "pointer" : "not-allowed",
            }}
            title={camReady ? "" : "먼저 카메라를 시작해주세요"}
          >
            🧪 테스트 플레이 (순위 미반영)
          </button>
          <button
            onClick={onShowRanking}
            style={{ ...ghostBtn, marginTop: 0, background: "rgba(12,12,26,0.6)" }}
          >
            🏆 전체 순위 보기
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- 결과 화면 ----------
function ResultScreen({
  result,
  onNext,
  onRanking,
}: {
  result: { row: ResultRow; rank: number };
  onNext: () => void;
  onRanking: () => void;
}) {
  const { row, rank } = result;
  return (
    <div style={center}>
      <div style={{ fontSize: 56, marginBottom: 8 }}>🎉</div>
      <div style={{ color: "#9ac", fontSize: 16 }}>{row.name}님의 결과</div>
      <div style={{ fontSize: 22, margin: "10px 0 4px" }}>
        최종 점수 <b style={{ color: "#7cf" }}>{row.finalScore.toLocaleString()}</b>
      </div>
      <div style={{ fontSize: 40, fontWeight: 800, margin: "4px 0" }}>
        달성 {row.achievedTier.toFixed(1)}등급
      </div>
      {row.department ? (
        <div style={congrats}>서강대 {row.department} 합격! 🎓</div>
      ) : (
        <div style={{ ...congrats, background: "linear-gradient(90deg,#3a3f4a,#565c6b)" }}>
          아쉽게 서강대 불합격 😢 다음엔 더 잡아보자!
        </div>
      )}
      <div style={{ fontSize: 18, margin: "18px 0", color: "#fd6" }}>
        {rank > 0 ? (
          <>
            현재 <b>{rank}위</b>
          </>
        ) : (
          <span style={{ color: "#9f9" }}>🧪 테스트 결과 (순위 미반영)</span>
        )}
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        {rank > 0 && (
          <button onClick={onRanking} style={ghostBtn}>
            순위표 보기
          </button>
        )}
        <button onClick={onNext} style={primaryBtn}>
          {rank > 0 ? "다음 참가자 ▶" : "대기 화면으로 ▶"}
        </button>
      </div>
    </div>
  );
}

// ---------- 순위 화면 ----------
function RankingScreen({
  rows,
  onBack,
}: {
  rows: ResultRow[];
  onBack: () => void;
}) {
  return (
    <div style={{ ...center, justifyContent: "flex-start", paddingTop: 40 }}>
      <h1 style={{ fontSize: 30, margin: "0 0 20px" }}>🏆 전체 순위</h1>
      <div style={{ width: "100%", maxWidth: 620, overflowY: "auto" }}>
        {rows.length === 0 && (
          <p style={{ color: "#889", textAlign: "center" }}>
            아직 기록이 없습니다.
          </p>
        )}
        {rows.map((r, i) => (
          <div key={r.id} style={fullRankRow}>
            <span
              style={{
                ...rankNum,
                width: 40,
                fontSize: i < 3 ? 22 : 16,
                color: ["#ffd54a", "#c9d2e0", "#d69a5a"][i] ?? "#7788aa",
              }}
            >
              {i + 1}
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 17, fontWeight: 600 }}>
                {r.name}{" "}
                <span style={{ fontSize: 13, color: "#889" }}>{r.school}</span>
              </div>
              <div style={{ fontSize: 13, color: r.department ? "#9ac" : "#889" }}>
                {r.department ? `서강대 ${r.department} 합격!` : "서강대 불합격"}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>
                {r.achievedTier.toFixed(1)}등급
              </div>
              <div style={{ fontSize: 12, color: "#778" }}>
                {r.finalScore.toLocaleString()}점
              </div>
            </div>
          </div>
        ))}
      </div>
      <button onClick={onBack} style={{ ...primaryBtn, marginTop: 24 }}>
        ← 대기 화면으로
      </button>
    </div>
  );
}

// ---------- styles ----------
const sidePanel: React.CSSProperties = {
  width: 260,
  flexShrink: 0,
  background: "#0d0d18",
  borderLeft: "1px solid #1e1e30",
  padding: 20,
  display: "flex",
  flexDirection: "column",
};
const center: React.CSSProperties = {
  height: "100%",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  textAlign: "center",
};
const holdBar: React.CSSProperties = {
  height: 12,
  borderRadius: 6,
  background: "rgba(255,255,255,0.08)",
  overflow: "hidden",
};
const holdBarFill: React.CSSProperties = {
  height: "100%",
  background: "linear-gradient(90deg,#ffd54a,#ff9f43)",
  transition: "width 0.08s",
};
const waitOverlay: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  padding: "28px 24px",
  gap: 8,
};
const guideChips: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  justifyContent: "center",
  maxWidth: 720,
  margin: "0 auto",
};
const guideChip: React.CSSProperties = {
  fontSize: 13,
  color: "#dde",
  background: "rgba(12,12,26,0.6)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 20,
  padding: "6px 14px",
  backdropFilter: "blur(4px)",
};
const waitCardGlass: React.CSSProperties = {
  background: "rgba(14,14,28,0.72)",
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: 18,
  padding: 30,
  minWidth: 400,
  textAlign: "center",
  backdropFilter: "blur(10px)",
  boxShadow: "0 12px 48px rgba(0,0,0,0.5)",
};
const confirmBoxGlass: React.CSSProperties = {
  background: "rgba(8,8,18,0.6)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 12,
  padding: 18,
};
const rankRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 0",
  borderBottom: "1px solid #1a1a2a",
};
const waitRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 0",
  borderBottom: "1px solid #16162400",
};
const fullRankRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  padding: "12px 8px",
  borderBottom: "1px solid #1a1a2a",
};
const rankNum: React.CSSProperties = {
  fontWeight: 800,
  fontSize: 16,
  color: "#7cf",
  width: 24,
  textAlign: "center",
};
const congrats: React.CSSProperties = {
  marginTop: 8,
  padding: "12px 22px",
  borderRadius: 12,
  background: "linear-gradient(90deg,#7a1f2b,#a4373f)",
  fontSize: 20,
  fontWeight: 700,
};
const primaryBtn: React.CSSProperties = {
  padding: "12px 24px",
  borderRadius: 10,
  border: "none",
  background: "#4a6cf7",
  color: "#fff",
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
};
const ghostBtn: React.CSSProperties = {
  marginTop: 20,
  padding: "11px 22px",
  borderRadius: 10,
  border: "1px solid #2a2a44",
  background: "transparent",
  color: "#aab",
  fontSize: 14,
  cursor: "pointer",
};
