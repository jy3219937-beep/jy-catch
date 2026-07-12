"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import GameCanvas from "./GameCanvas";
import QRPanel from "./QRPanel";
import { useHandTracking } from "@/lib/useHandTracking";
import { computeDifficulty } from "@/lib/game-config";

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
  const [leaderboard, setLeaderboard] = useState<ResultRow[]>([]);
  const [lastResult, setLastResult] = useState<{
    row: ResultRow;
    rank: number;
  } | null>(null);

  // ----- 데이터 폴링 -----
  const refreshQueue = useCallback(async () => {
    try {
      const res = await fetch("/api/players/next", { cache: "no-store" });
      const data = await res.json();
      setWaitingCount(data.waitingCount ?? 0);
      // 게임 중이 아닐 때만 다음 학생 후보 갱신
      setScreen((s) => {
        if (s === "waiting") setCurrent(data.next ?? null);
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

  useEffect(() => {
    refreshQueue();
    refreshLeaderboard();
    const t = setInterval(() => {
      refreshQueue();
      refreshLeaderboard();
    }, 2500);
    return () => clearInterval(t);
  }, [refreshQueue, refreshLeaderboard]);

  // ----- 게임 시작 (엄지척 확인 후) -----
  const startGame = useCallback(async () => {
    if (!current) return;
    await fetch(`/api/players/${current.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "playing" }),
    });
    setScreen("playing");
  }, [current]);

  // ----- 게임 종료 → 결과 저장 -----
  const onFinish = useCallback(
    async (finalScore: number) => {
      if (!current) return;
      try {
        const res = await fetch("/api/results", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerId: current.id, finalScore }),
        });
        const data = await res.json();
        setLastResult({ row: data.result, rank: data.rank });
      } catch {
        /* noop */
      }
      await refreshLeaderboard();
      setScreen("result");
    },
    [current, refreshLeaderboard]
  );

  const difficulty = current
    ? computeDifficulty(current.currentTier, current.targetTier, current.grade)
    : 0;

  const top5 = leaderboard.slice(0, 5);

  return (
    <main style={{ height: "100vh", display: "flex", overflow: "hidden" }}>
      {/* 좌: 메인 무대 */}
      <section style={{ flex: 1, position: "relative", minWidth: 0 }}>
        {screen === "waiting" && (
          <WaitingScreen
            current={current}
            waitingCount={waitingCount}
            difficulty={difficulty}
            onConfirm={startGame}
            onShowRanking={() => setScreen("ranking")}
          />
        )}
        {screen === "playing" && current && (
          <GameCanvas difficulty={difficulty} onFinish={onFinish} />
        )}
        {screen === "result" && lastResult && (
          <ResultScreen
            result={lastResult}
            onNext={() => {
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
                  {r.achievedTier.toFixed(1)}등급 · {r.department}
                </div>
              </div>
            </div>
          ))}
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
  onConfirm,
  onShowRanking,
}: {
  current: Player | null;
  waitingCount: number;
  difficulty: number;
  onConfirm: () => void;
  onShowRanking: () => void;
}) {
  const { videoRef, ready, loading, start, detect } = useHandTracking();
  const [holdPct, setHoldPct] = useState(0);
  const holdRef = useRef(0);
  const rafRef = useRef(0);
  const firedRef = useRef(false);

  // 대기 화면에서 카메라를 켜고 엄지척 유지 감지
  useEffect(() => {
    if (current) start();
  }, [current, start]);

  useEffect(() => {
    firedRef.current = false;
    holdRef.current = 0;
    setHoldPct(0);
  }, [current]);

  useEffect(() => {
    if (!current) return;
    const HOLD_SEC = 1.2;
    let last = 0;
    const tick = (ts: number) => {
      const dt = last ? (ts - last) / 1000 : 0;
      last = ts;
      const hands = detect();
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
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [current, detect, onConfirm]);

  return (
    <div style={center}>
      <video ref={videoRef} style={{ display: "none" }} playsInline muted />
      <h1 style={{ fontSize: 34, margin: "0 0 4px" }}>정율 캐치 🖐️</h1>
      <p style={{ color: "#889", margin: "0 0 28px" }}>
        학습 용어를 손으로 잡아라! 유혹은 흘려보내라.
      </p>

      {!current ? (
        <div style={waitCard}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>📱</div>
          <p style={{ fontSize: 18, margin: "0 0 6px" }}>
            대기 중인 학생이 없습니다
          </p>
          <p style={{ color: "#889", fontSize: 14 }}>
            우측 QR 코드로 참여를 신청해주세요
          </p>
        </div>
      ) : (
        <div style={waitCard}>
          <div style={{ fontSize: 13, color: "#9ac", marginBottom: 4 }}>
            다음 참가자
          </div>
          <div style={{ fontSize: 30, fontWeight: 700 }}>{current.name}</div>
          <div style={{ color: "#aab", margin: "6px 0 16px" }}>
            {current.school} · {current.grade}학년 · 현재 {current.currentTier}
            등급 → 목표 {current.targetTier}등급
          </div>
          <div style={{ fontSize: 12, color: "#778", marginBottom: 18 }}>
            난이도 계수 D = {difficulty.toFixed(2)} · 대기 {waitingCount}명
          </div>

          <div style={confirmBox}>
            <div style={{ fontSize: 15, marginBottom: 10 }}>
              👍 <b>엄지척</b>을 화면에 유지하면 시작!
            </div>
            <div style={holdBar}>
              <div
                style={{
                  ...holdBarFill,
                  width: `${holdPct * 100}%`,
                }}
              />
            </div>
            <div style={{ fontSize: 12, color: "#889", marginTop: 8 }}>
              {loading
                ? "카메라 준비 중..."
                : ready
                  ? holdPct > 0
                    ? "유지 중..."
                    : "손을 카메라에 보여주세요"
                  : "카메라 초기화 중..."}
            </div>
          </div>
        </div>
      )}

      <button onClick={onShowRanking} style={ghostBtn}>
        🏆 전체 순위 보기
      </button>
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
      <div style={congrats}>서강대 {row.department} 합격! 🎓</div>
      <div style={{ fontSize: 18, margin: "18px 0", color: "#fd6" }}>
        현재 <b>{rank}위</b>
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        <button onClick={onRanking} style={ghostBtn}>
          순위표 보기
        </button>
        <button onClick={onNext} style={primaryBtn}>
          다음 참가자 ▶
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
              <div style={{ fontSize: 13, color: "#9ac" }}>
                서강대 {r.department} 합격!
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
const waitCard: React.CSSProperties = {
  background: "#12121f",
  border: "1px solid #24243a",
  borderRadius: 16,
  padding: 32,
  minWidth: 420,
};
const confirmBox: React.CSSProperties = {
  background: "#0d0d18",
  border: "1px solid #2a2a44",
  borderRadius: 12,
  padding: 18,
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
const rankRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 0",
  borderBottom: "1px solid #1a1a2a",
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
