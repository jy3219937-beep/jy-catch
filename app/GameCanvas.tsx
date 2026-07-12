"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  HELPFUL_TERMS,
  HARMFUL_TERMS,
  SCORE,
  STAGE_DURATION_SEC,
  TOTAL_STAGES,
  stageParams,
  scoreToTier,
} from "@/lib/game-config";
import { useHandTracking, type TrackedHand } from "@/lib/useHandTracking";

type FallingItem = {
  id: number;
  text: string;
  harmful: boolean;
  x: number; // 0~1
  y: number; // 0~1 (위 0 → 아래 1)
  vy: number; // 0~1/sec
  popped: boolean;
  spawnFrame: number;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
};

type Props = {
  difficulty: number; // 난이도 계수 D
  onFinish: (finalScore: number) => void;
};

// 게임 진행(5스테이지) + 캠 배경 위 낙하 물체 + 손인식 집기.
export default function GameCanvas({ difficulty, onFinish }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { videoRef, ready, detect, handsRef } = useHandTracking();

  const [stage, setStage] = useState(1);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(STAGE_DURATION_SEC);
  const [combo, setCombo] = useState(0);

  // 게임 상태 refs (렌더 루프에서 사용)
  const itemsRef = useRef<FallingItem[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const scoreRef = useRef(0);
  const comboRef = useRef(0);
  const stageRef = useRef(1);
  const idRef = useRef(0);
  const frameRef = useRef(0);
  const lastSpawnRef = useRef(0);
  const lastTsRef = useRef(0);
  const rafRef = useRef(0);
  const shakeRef = useRef(0);
  const finishedRef = useRef(false);

  const spawnItem = useCallback(() => {
    const p = stageParams(stageRef.current, difficulty);
    const harmful = Math.random() < p.harmfulRatio;
    const pool = harmful ? HARMFUL_TERMS : HELPFUL_TERMS;
    const text = pool[Math.floor(Math.random() * pool.length)];
    itemsRef.current.push({
      id: idRef.current++,
      text,
      harmful,
      x: 0.1 + Math.random() * 0.7,
      y: -0.05,
      vy: p.fallSpeed / 600, // px/sec → 0~1/sec (기준 높이 600 가정)
      popped: false,
      spawnFrame: frameRef.current,
    });
  }, [difficulty]);

  const burst = useCallback((x: number, y: number, harmful: boolean) => {
    const n = harmful ? 14 : 20;
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + Math.random();
      const sp = 0.15 + Math.random() * 0.35;
      particlesRef.current.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 1,
        color: harmful
          ? `hsl(${350 + Math.random() * 15}, 80%, 60%)`
          : `hsl(${140 + Math.random() * 80}, 85%, 65%)`,
      });
    }
  }, []);

  // 집기 판정: 손이 justPinched인 순간, 손 위치와 겹친 아이템을 터트림
  const tryPop = useCallback(
    (hands: TrackedHand[], W: number, H: number) => {
      for (const h of hands) {
        if (!h.detected || !h.justPinched) continue;
        const hx = h.palm.x;
        const hy = h.palm.y;
        // 가장 가까운(겹친) 미터짐 아이템 하나
        let hit: FallingItem | null = null;
        let best = 0.12; // 판정 반경(정규화)
        for (const it of itemsRef.current) {
          if (it.popped) continue;
          const dx = it.x - hx;
          const dy = it.y - hy;
          const d = Math.hypot(dx, dy);
          if (d < best) {
            best = d;
            hit = it;
          }
        }
        if (hit) {
          hit.popped = true;
          burst(hit.x, hit.y, hit.harmful);
          if (hit.harmful) {
            // 방해용어 집음 → 감점 + 콤보 리셋 + 흔들림
            scoreRef.current += SCORE.harmfulPenalty;
            comboRef.current = 0;
            shakeRef.current = 1;
          } else {
            // 도움용어 집음 → 가점 + 콤보
            comboRef.current += 1;
            const bonus = Math.min(
              SCORE.maxComboBonus,
              comboRef.current * SCORE.comboStep
            );
            scoreRef.current += SCORE.helpfulBase + bonus;
          }
          if (scoreRef.current < 0) scoreRef.current = 0;
          setScore(scoreRef.current);
          setCombo(comboRef.current);
        }
      }
    },
    [burst]
  );

  const nextStageOrFinish = useCallback(() => {
    if (stageRef.current >= TOTAL_STAGES) {
      if (!finishedRef.current) {
        finishedRef.current = true;
        cancelAnimationFrame(rafRef.current);
        onFinish(scoreRef.current);
      }
      return;
    }
    stageRef.current += 1;
    setStage(stageRef.current);
    itemsRef.current = [];
    stageTimeRef.current = 0; // 다음 스테이지 타이머 리셋
    lastSpawnRef.current = 0;
  }, [onFinish]);

  const loop = useCallback(
    (ts: number) => {
      frameRef.current++;
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
        canvas.width = W * dpr;
        canvas.height = H * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const dt = lastTsRef.current ? (ts - lastTsRef.current) / 1000 : 0;
      lastTsRef.current = ts;

      // 손 인식
      const hands = detect();

      // 화면 흔들림 감쇠
      if (shakeRef.current > 0) {
        shakeRef.current = Math.max(0, shakeRef.current - dt * 3);
      }
      const sx = shakeRef.current ? (Math.random() - 0.5) * 16 * shakeRef.current : 0;
      const sy = shakeRef.current ? (Math.random() - 0.5) * 16 * shakeRef.current : 0;
      ctx.save();
      ctx.translate(sx, sy);

      // 배경: 캠 영상 선명하게 (거울)
      ctx.fillStyle = "#000";
      ctx.fillRect(-20, -20, W + 40, H + 40);
      if (ready && video && video.readyState >= 2) {
        ctx.save();
        ctx.translate(W, 0);
        ctx.scale(-1, 1);
        // cover 방식으로 꽉 채우기
        const vw = video.videoWidth || 1280;
        const vh = video.videoHeight || 720;
        const scale = Math.max(W / vw, H / vh);
        const dw = vw * scale;
        const dh = vh * scale;
        ctx.drawImage(video, (W - dw) / 2, (H - dh) / 2, dw, dh);
        ctx.restore();
        // 살짝 어둡게 (물체 가독성)
        ctx.fillStyle = "rgba(10,10,25,0.35)";
        ctx.fillRect(-20, -20, W + 40, H + 40);
      }

      // 스폰
      const p = stageParams(stageRef.current, difficulty);
      const alive = itemsRef.current.filter((i) => !i.popped && i.y < 1.1);
      if (
        ts - lastSpawnRef.current > p.spawnIntervalMs &&
        alive.length < p.maxConcurrent
      ) {
        spawnItem();
        lastSpawnRef.current = ts;
      }

      // 아이템 이동 + 그리기
      for (const it of itemsRef.current) {
        if (it.popped) continue;
        it.y += it.vy * dt;
        const px = it.x * W;
        const py = it.y * H;
        drawItem(ctx, px, py, it);
      }
      // 화면 밖(놓친 것) + 터진 것 정리
      itemsRef.current = itemsRef.current.filter(
        (i) => !i.popped && i.y < 1.15
      );

      // 집기 판정
      tryPop(hands, W, H);

      // 파티클
      for (const pt of particlesRef.current) {
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        pt.vy += 0.4 * dt;
        pt.life -= dt * 1.6;
      }
      particlesRef.current = particlesRef.current.filter((pt) => pt.life > 0);
      for (const pt of particlesRef.current) {
        ctx.globalAlpha = Math.max(0, pt.life);
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(pt.x * W, pt.y * H, 4 + pt.life * 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // 손 골격
      for (const h of hands) {
        if (!h.detected) continue;
        drawHand(ctx, h, W, H);
      }

      ctx.restore();

      // 스테이지 타이머
      const elapsed = (ts - (stageTimeRef.current || ts)) / 1000;
      if (!stageTimeRef.current) stageTimeRef.current = ts;
      const remain = Math.max(0, STAGE_DURATION_SEC - elapsed);
      setTimeLeft(Math.ceil(remain));
      if (remain <= 0) {
        stageTimeRef.current = 0;
        nextStageOrFinish();
      }

      rafRef.current = requestAnimationFrame(loop);
    },
    [detect, difficulty, nextStageOrFinish, ready, spawnItem, tryPop, videoRef]
  );

  const stageTimeRef = useRef(0);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [loop]);

  const p = stageParams(stage, difficulty);
  const stageProgress = Math.min(1, score / p.targetScore);
  const liveTier = scoreToTier(score, difficulty);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <video ref={videoRef} style={{ display: "none" }} playsInline muted />
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
      {/* 상단 HUD */}
      <div style={hud}>
        <div style={hudChip}>스테이지 {stage}/{TOTAL_STAGES}</div>
        <div style={hudChip}>
          점수 <b style={{ color: "#7cf" }}>{score.toLocaleString()}</b>
        </div>
        <div style={hudChip}>⏱ {timeLeft}s</div>
        <div style={{ ...hudChip, color: "#9f9", borderColor: "#3a6" }}>
          실시간 <b>{liveTier.toFixed(1)}</b>등급
        </div>
        {combo > 1 && (
          <div style={{ ...hudChip, color: "#fd6", borderColor: "#a85" }}>
            🔥 {combo} COMBO
          </div>
        )}
      </div>
      {/* 목표 게이지 */}
      <div style={gaugeWrap}>
        <div
          style={{
            ...gaugeFill,
            width: `${stageProgress * 100}%`,
            background:
              stageProgress >= 1
                ? "linear-gradient(90deg,#3fd68a,#7cf)"
                : "linear-gradient(90deg,#4a6cf7,#7cf)",
          }}
        />
      </div>
    </div>
  );
}

function drawItem(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  it: FallingItem
) {
  const r = 34;
  const grad = ctx.createRadialGradient(x, y, 2, x, y, r);
  if (it.harmful) {
    grad.addColorStop(0, "rgba(255,120,120,0.95)");
    grad.addColorStop(1, "rgba(200,50,60,0.75)");
  } else {
    grad.addColorStop(0, "rgba(130,240,170,0.95)");
    grad.addColorStop(1, "rgba(60,180,120,0.75)");
  }
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = it.harmful ? "rgba(255,180,180,0.8)" : "rgba(200,255,220,0.8)";
  ctx.stroke();

  ctx.fillStyle = "#0a0a14";
  ctx.font = 'bold 14px "Pretendard", system-ui, sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(it.text, x, y);
  ctx.textAlign = "start";
}

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

function drawHand(
  ctx: CanvasRenderingContext2D,
  h: TrackedHand,
  W: number,
  H: number
) {
  if (h.landmarks.length !== 21) return;
  const lm = h.landmarks;
  const color =
    h.gesture === "Closed_Fist" ? "rgba(120,200,255,0.9)" : "rgba(255,200,120,0.9)";
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  for (const [i, j] of HAND_CONNECTIONS) {
    ctx.beginPath();
    ctx.moveTo(lm[i].x * W, lm[i].y * H);
    ctx.lineTo(lm[j].x * W, lm[j].y * H);
    ctx.stroke();
  }
  for (let i = 0; i < 21; i++) {
    ctx.beginPath();
    ctx.arc(lm[i].x * W, lm[i].y * H, i === 0 ? 6 : 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
}

const hud: React.CSSProperties = {
  position: "absolute",
  top: 14,
  left: 14,
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
};
const hudChip: React.CSSProperties = {
  padding: "7px 13px",
  borderRadius: 10,
  background: "rgba(12,12,26,0.72)",
  border: "1px solid rgba(255,255,255,0.12)",
  fontSize: 14,
  backdropFilter: "blur(6px)",
};
const gaugeWrap: React.CSSProperties = {
  position: "absolute",
  bottom: 0,
  left: 0,
  right: 0,
  height: 6,
  background: "rgba(255,255,255,0.08)",
};
const gaugeFill: React.CSSProperties = {
  height: "100%",
  transition: "width 0.2s",
};
