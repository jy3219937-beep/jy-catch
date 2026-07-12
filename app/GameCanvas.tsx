"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  HELPFUL_TERMS,
  HARMFUL_TERMS,
  SCORE,
  stageParams,
  colorReliability,
  semestersForGrade,
  stageDurationSec,
  accuracyToSemesterGrade,
  finalTierFromSemesters,
  type GameSettings,
} from "@/lib/game-config";
import type { TrackedHand } from "@/lib/useHandTracking";

type Shape = "circle" | "square" | "hexagon" | "triangle" | "diamond";

type FallingItem = {
  id: number;
  text: string;
  harmful: boolean;
  x: number; // 0~1
  y: number; // 0~1 (위 0 → 아래 1)
  vy: number; // 0~1/sec
  popped: boolean;
  spawnFrame: number;
  shape: Shape;
  hue: number; // 표시 색상(색 랜덤화 시 실제 종류와 무관)
  rot: number; // 회전 각(모양 장식)
  drift: number; // 좌우 흔들림 속도
  wobblePhase: number;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
  kind: "dot" | "star" | "ring";
};

// 점수/콤보 팝업 등 떠오르는 텍스트
type FloatText = {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  size: number;
  vy: number;
};

const SHAPES: Shape[] = ["circle", "square", "hexagon", "triangle", "diamond"];

// 콤보 단계별 색/라벨 — 높을수록 뜨겁게.
function comboTier(combo: number): { color: string; label: string; glow: string } {
  if (combo >= 15)
    return { color: "#ff4d4d", label: "UNSTOPPABLE", glow: "rgba(255,80,80,0.5)" };
  if (combo >= 10)
    return { color: "#ff8a3d", label: "ON FIRE", glow: "rgba(255,140,60,0.45)" };
  if (combo >= 6)
    return { color: "#ffd23d", label: "GREAT", glow: "rgba(255,210,60,0.4)" };
  if (combo >= 3)
    return { color: "#9fe8ff", label: "NICE", glow: "rgba(150,220,255,0.35)" };
  return { color: "#ffffff", label: "", glow: "rgba(255,255,255,0.25)" };
}
// 도움/방해의 "진짜" 색상 계열(hue). 초록 vs 빨강.
const HELPFUL_HUE = 145;
const HARMFUL_HUE = 355;

type Props = {
  difficulty: number; // 난이도 계수 D
  grade: number; // 학년 (스테이지 수·학기 라벨·시간 결정)
  currentTier: number; // 현재 등급 (최종등급 출발점)
  targetTier: number; // 목표 등급
  settings: GameSettings; // 관리자 조절 설정 (게임 시작 시점 스냅샷)
  onFinish: (result: {
    finalScore: number;
    semesterGrades: number[]; // 학기별 등급
    finalTier: number; // 최종 등급
  }) => void;
  // 손 인식은 부모(MainApp)에서 생성해 공유 — 카메라 스트림/권한을 대기화면과 공유.
  videoRef: React.RefObject<HTMLVideoElement | null>;
  ready: boolean;
  detect: () => TrackedHand[];
};

// 게임 진행(학기별 스테이지) + 캠 배경 위 낙하 물체 + 손인식 집기.
export default function GameCanvas({
  difficulty,
  grade,
  currentTier,
  targetTier,
  settings,
  onFinish,
  videoRef,
  ready,
  detect,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 이 학년의 학기 목록 (스테이지)
  const semesters = semestersForGrade(grade);
  const totalStages = semesters.length;
  const durationSec = stageDurationSec(grade);

  const [stage, setStage] = useState(1);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(durationSec);
  const [combo, setCombo] = useState(0);
  // 스테이지 전환 연출: null이면 진행 중, 값 있으면 전환 화면 표시
  const [transition, setTransition] = useState<{
    label: string;
    subtitle: string;
  } | null>({
    label: semesters[0]?.label ?? "",
    subtitle: "준비하세요!",
  });

  // 게임 상태 refs (렌더 루프에서 사용)
  const itemsRef = useRef<FallingItem[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const floatsRef = useRef<FloatText[]>([]);
  const comboFlashRef = useRef(0); // 콤보 달성 순간 화면 전체 플래시 강도
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
  const pausedRef = useRef(true); // 전환 화면 동안 게임 일시정지
  // 정확도(학기등급) 집계: 도움용어를 얼마나 잘 잡았나.
  //   caught  = 집은 도움용어 수
  //   spawned = 이번 학기에 등장한 도움용어 총수
  // 정확도 = caught / spawned. 단, 스테이지 종료 시 아직 화면에서 떨어지는 중인
  //   (시간에 쫓겨 못 만난) 도움용어는 분모에서 제외한다.
  // 방해용어를 잘못 집으면 정확도 분자에서 0.5개씩 차감(페널티) → 긴장감.
  const caughtRef = useRef(0);
  const spawnedRef = useRef(0);
  const wrongRef = useRef(0); // 잘못 집은 방해용어 수
  const semesterGradesRef = useRef<number[]>([]);

  const spawnItem = useCallback(() => {
    const stage = stageRef.current;
    const p = stageParams(stage, totalStages, difficulty, settings.difficultyMult);
    const harmful = Math.random() < p.harmfulRatio;
    const pool = harmful ? HARMFUL_TERMS : HELPFUL_TERMS;
    const text = pool[Math.floor(Math.random() * pool.length)];

    // 도움용어가 등장할 때마다 정확도 분모(등장 총수) 누적.
    if (!harmful) spawnedRef.current += 1;

    // 색 결정: 신뢰도가 높으면 진짜 색(초록/빨강), 낮으면 랜덤 색으로 흐트러뜨림.
    const rel = colorReliability(stage, totalStages);
    const trueHue = harmful ? HARMFUL_HUE : HELPFUL_HUE;
    let hue: number;
    if (Math.random() < rel) {
      hue = trueHue;
    } else {
      // 색을 신뢰 못 하게 — 아무 색이나. (단어로 판단해야 함)
      hue = Math.floor(Math.random() * 360);
    }

    itemsRef.current.push({
      id: idRef.current++,
      text,
      harmful,
      x: 0.14 + Math.random() * 0.68,
      y: -0.08,
      vy: p.fallSpeed / 600, // px/sec → 0~1/sec (기준 높이 600 가정)
      popped: false,
      spawnFrame: frameRef.current,
      shape: SHAPES[Math.floor(Math.random() * SHAPES.length)],
      hue,
      rot: Math.random() * Math.PI,
      drift: (Math.random() - 0.5) * 0.06, // 좌우 흔들림 강도
      wobblePhase: Math.random() * Math.PI * 2,
    });
  }, [difficulty, totalStages, settings]);

  const burst = useCallback(
    (x: number, y: number, harmful: boolean, combo = 0) => {
      // 정답(도움) 성공은 화사한 별+링 폭발, 오답(방해)은 붉은 파편.
      // 콤보가 높을수록 파티클이 더 많고 빠르게 터진다.
      const boost = harmful ? 0 : Math.min(24, combo * 2);
      const n = (harmful ? 16 : 26) + boost;
      const speedBoost = harmful ? 1 : 1 + Math.min(0.6, combo * 0.05);
      for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 * i) / n + Math.random() * 0.5;
        const sp = (0.15 + Math.random() * (harmful ? 0.4 : 0.5)) * speedBoost;
        const roll = Math.random();
        const kind: Particle["kind"] = harmful
          ? "dot"
          : roll < 0.5
            ? "star"
            : roll < 0.8
              ? "dot"
              : "ring";
        // 콤보가 높으면 도움 파티클 색이 점점 뜨거운(노랑→주황) 쪽으로
        const helpfulHue = combo >= 10 ? 30 + Math.random() * 40 : 90 + Math.random() * 160;
        particlesRef.current.push({
          x,
          y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - (harmful ? 0 : 0.1),
          life: 1,
          size: 3 + Math.random() * (harmful ? 4 : 6),
          kind,
          color: harmful
            ? `hsl(${350 + Math.random() * 20}, 85%, ${55 + Math.random() * 15}%)`
            : `hsl(${helpfulHue}, 90%, ${60 + Math.random() * 20}%)`,
        });
      }
    },
    []
  );

  // 떠오르는 텍스트(점수/콤보 팝업) 추가
  const addFloat = useCallback(
    (x: number, y: number, text: string, color: string, size: number) => {
      floatsRef.current.push({ x, y, text, color, size, life: 1, vy: 0.12 });
    },
    []
  );

  // 집기 판정: 손이 justPinched인 순간, 손 위치와 겹친 아이템을 터트림
  const tryPop = useCallback(
    (hands: TrackedHand[], W: number, H: number) => {
      for (const h of hands) {
        if (!h.detected || !h.justPinched) continue;
        const hx = h.palm.x;
        const hy = h.palm.y;
        // 가장 가까운(겹친) 미터짐 아이템 하나
        let hit: FallingItem | null = null;
        let best = 0.15; // 판정 반경(정규화) — 물체가 커진 만큼 여유 있게
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
          if (hit.harmful) {
            // 방해용어 집음 → 점수 감점 + 콤보 리셋 + 흔들림 + 정확도 페널티(0.5개 차감)
            burst(hit.x, hit.y, true);
            scoreRef.current += SCORE.harmfulPenalty;
            wrongRef.current += 1;
            comboRef.current = 0;
            shakeRef.current = 1;
            addFloat(hit.x, hit.y, `${SCORE.harmfulPenalty}`, "#ff6b6b", 26);
          } else {
            // 도움용어 집음 → 정확도 정답 + 가점 + 콤보
            caughtRef.current += 1;
            comboRef.current += 1;
            const combo = comboRef.current;
            const bonus = Math.min(SCORE.maxComboBonus, combo * SCORE.comboStep);
            const gained = SCORE.helpfulBase + bonus;
            scoreRef.current += gained;

            burst(hit.x, hit.y, false, combo);
            // 획득 점수 팝업 (콤보 높을수록 크게/뜨겁게)
            const ct = comboTier(combo);
            addFloat(
              hit.x,
              hit.y,
              `+${gained}`,
              combo >= 3 ? ct.color : "#8fffb0",
              22 + Math.min(18, combo * 1.5)
            );
            // 콤보 팝업 (3콤보부터)
            if (combo >= 3) {
              addFloat(
                hit.x,
                hit.y - 0.05,
                `${combo} COMBO ${ct.label}`,
                ct.color,
                20 + Math.min(20, combo)
              );
              // 마일스톤(3/6/10/15)에서 화면 플래시
              if ([3, 6, 10, 15].includes(combo)) comboFlashRef.current = 1;
            }
          }
          if (scoreRef.current < 0) scoreRef.current = 0;
          setScore(scoreRef.current);
          setCombo(comboRef.current);
        }
      }
    },
    [burst, addFloat]
  );

  const nextStageOrFinish = useCallback(() => {
    // 이번 학기 정확도 = (집은 도움 - 방해오터치 페널티) / 등장한 도움용어.
    // 단, 종료 시점에 아직 화면에서 떨어지는 중인(못 만난) 도움용어는 분모에서 제외.
    const stillFalling = itemsRef.current.filter(
      (it) => !it.popped && !it.harmful && it.y < 1.15
    ).length;
    const denom = Math.max(0, spawnedRef.current - stillFalling);
    const effective = caughtRef.current - settings.wrongPenalty * wrongRef.current;
    const acc = denom > 0 ? Math.max(0, effective) / denom : 0;
    const prog = totalStages > 1 ? (stageRef.current - 1) / (totalStages - 1) : 0;
    const semGrade = accuracyToSemesterGrade(acc, difficulty, prog, settings);
    semesterGradesRef.current.push(semGrade);

    const finishedStage = stageRef.current;
    itemsRef.current = [];
    floatsRef.current = [];

    if (finishedStage >= totalStages) {
      // 마지막 학기 → 최종 등급 산출 후 종료
      if (!finishedRef.current) {
        finishedRef.current = true;
        cancelAnimationFrame(rafRef.current);
        const finalTier = finalTierFromSemesters(
          currentTier,
          targetTier,
          semesterGradesRef.current
        );
        onFinish({
          finalScore: scoreRef.current,
          semesterGrades: [...semesterGradesRef.current],
          finalTier,
        });
      }
      return;
    }

    // 다음 학기로 전환 — 연출 화면 띄우고 게임 일시정지
    const nextStage = finishedStage + 1;
    stageRef.current = nextStage;
    setStage(nextStage);
    caughtRef.current = 0;
    spawnedRef.current = 0;
    wrongRef.current = 0;
    lastSpawnRef.current = 0;
    stageTimeRef.current = 0;
    pausedRef.current = true;
    setTransition({
      label: semesters[nextStage - 1]?.label ?? "",
      subtitle: `직전 학기 ${semGrade.toFixed(1)}등급 · 계속 올려보자!`,
    });
  }, [
    onFinish,
    currentTier,
    targetTier,
    totalStages,
    semesters,
    difficulty,
    settings,
  ]);

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

      // 스폰 (전환 화면 중에는 멈춤)
      const p = stageParams(
        stageRef.current,
        totalStages,
        difficulty,
        settings.difficultyMult
      );
      if (!pausedRef.current) {
        const alive = itemsRef.current.filter((i) => !i.popped && i.y < 1.1);
        if (
          ts - lastSpawnRef.current > p.spawnIntervalMs &&
          alive.length < p.maxConcurrent
        ) {
          spawnItem();
          lastSpawnRef.current = ts;
        }
      }

      // 아이템 이동 + 그리기 (전환 중엔 이동 정지)
      for (const it of itemsRef.current) {
        if (it.popped) continue;
        if (!pausedRef.current) {
          it.y += it.vy * dt;
          it.wobblePhase += dt * 2;
          it.rot += dt * 0.6;
        }
        const wobbleX = Math.sin(it.wobblePhase) * it.drift;
        const px = (it.x + wobbleX) * W;
        const py = it.y * H;
        drawItem(ctx, px, py, it);
      }
      // 화면 밖(바닥) 처리 — 도움용어를 못 잡고 놓침(콤보만 리셋).
      // 정확도 분모는 등장 시 이미 셌으므로, 놓친 건 자동으로 잡기율에 반영됨.
      let missed = false;
      for (const it of itemsRef.current) {
        if (it.popped || it.y < 1.15) continue;
        if (!it.harmful) {
          comboRef.current = 0;
          missed = true;
        }
      }
      if (missed) {
        setCombo(0);
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
        const a = Math.max(0, pt.life);
        ctx.globalAlpha = a;
        const cx = pt.x * W;
        const cy = pt.y * H;
        const r = pt.size * (0.4 + pt.life * 0.6);
        if (pt.kind === "ring") {
          ctx.strokeStyle = pt.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx, cy, r * 2.2 * (1.2 - pt.life), 0, Math.PI * 2);
          ctx.stroke();
        } else if (pt.kind === "star") {
          drawStar(ctx, cx, cy, r, pt.color);
        } else {
          ctx.fillStyle = pt.color;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      // 손 골격
      for (const h of hands) {
        if (!h.detected) continue;
        drawHand(ctx, h, W, H);
      }

      // 떠오르는 텍스트(점수/콤보 팝업)
      for (const f of floatsRef.current) {
        f.y -= f.vy * dt;
        f.life -= dt * 1.1;
      }
      floatsRef.current = floatsRef.current.filter((f) => f.life > 0);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      for (const f of floatsRef.current) {
        const a = Math.max(0, Math.min(1, f.life * 1.4));
        ctx.globalAlpha = a;
        const pop = f.life > 0.8 ? 1 + (f.life - 0.8) * 1.5 : 1; // 등장 순간 살짝 크게
        const fs = f.size * pop;
        ctx.font = `900 ${fs}px "Pretendard", system-ui, sans-serif`;
        ctx.lineWidth = 5;
        ctx.strokeStyle = "rgba(10,10,20,0.75)";
        ctx.strokeText(f.text, f.x * W, f.y * H);
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, f.x * W, f.y * H);
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = "start";

      // 콤보 마일스톤 화면 플래시 (테두리 발광)
      if (comboFlashRef.current > 0) {
        comboFlashRef.current = Math.max(0, comboFlashRef.current - dt * 2.5);
        const fa = comboFlashRef.current;
        const ct = comboTier(comboRef.current);
        const vig = ctx.createRadialGradient(
          W / 2,
          H / 2,
          Math.min(W, H) * 0.3,
          W / 2,
          H / 2,
          Math.max(W, H) * 0.75
        );
        vig.addColorStop(0, "transparent");
        vig.addColorStop(1, ct.glow.replace(/[\d.]+\)$/, `${(0.55 * fa).toFixed(2)})`));
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, W, H);
      }

      ctx.restore();

      // 스테이지 타이머 (전환 중에는 멈춤)
      if (!pausedRef.current) {
        const elapsed = (ts - (stageTimeRef.current || ts)) / 1000;
        if (!stageTimeRef.current) stageTimeRef.current = ts;
        const remain = Math.max(0, durationSec - elapsed);
        setTimeLeft(Math.ceil(remain));
        if (remain <= 0) {
          stageTimeRef.current = 0;
          nextStageOrFinish();
        }
      }

      rafRef.current = requestAnimationFrame(loop);
    },
    [
      detect,
      difficulty,
      durationSec,
      totalStages,
      nextStageOrFinish,
      ready,
      spawnItem,
      tryPop,
      addFloat,
      videoRef,
      settings,
    ]
  );

  const stageTimeRef = useRef(0);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [loop]);

  // 실시간 학기 등급: (집은 도움 - 방해오터치 페널티) / 등장한 도움.
  const liveAcc =
    spawnedRef.current > 0
      ? Math.max(0, caughtRef.current - settings.wrongPenalty * wrongRef.current) /
        spawnedRef.current
      : 0;
  const liveProg = totalStages > 1 ? (stage - 1) / (totalStages - 1) : 0;
  const liveTier = accuracyToSemesterGrade(liveAcc, difficulty, liveProg, settings);
  const currentLabel = semesters[stage - 1]?.label ?? "";

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {/* <video>는 부모(MainApp)가 소유 — 여기선 videoRef.current를 캔버스에 그리기만 함 */}
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
      {/* 상단 HUD */}
      <div style={hud}>
        <div style={hudChip}>
          {currentLabel}{" "}
          <span style={{ color: "#89a", fontSize: 16 }}>
            ({stage}/{totalStages})
          </span>
        </div>
        <div style={hudChip}>
          점수 <b style={{ color: "#7cf" }}>{score.toLocaleString()}</b>
        </div>
        <div style={hudChip}>⏱ {timeLeft}s</div>
        <div style={{ ...hudChip, color: "#9f9", borderColor: "#3a6" }}>
          이번 학기 <b style={{ fontSize: 26 }}>{liveTier.toFixed(1)}</b>등급
        </div>
        {combo > 1 && (
          <div
            style={{
              ...hudChip,
              color: comboTier(combo).color,
              borderColor: comboTier(combo).color,
              fontSize: 22 + Math.min(14, combo),
              fontWeight: 800,
              boxShadow: `0 0 ${Math.min(24, combo * 1.8)}px ${comboTier(combo).glow}`,
              transform: `scale(${1 + Math.min(0.25, combo * 0.02)})`,
              transformOrigin: "left center",
            }}
          >
            🔥 {combo} COMBO{" "}
            {comboTier(combo).label && (
              <b style={{ marginLeft: 4 }}>{comboTier(combo).label}</b>
            )}
          </div>
        )}
      </div>

      {/* 정확도 게이지 (이번 학기) */}
      <div style={gaugeWrap}>
        <div
          style={{
            ...gaugeFill,
            width: `${liveAcc * 100}%`,
            background:
              liveAcc >= 0.8
                ? "linear-gradient(90deg,#3fd68a,#7cf)"
                : "linear-gradient(90deg,#4a6cf7,#7cf)",
          }}
        />
      </div>

      {/* 스테이지 전환 연출 */}
      {transition && (
        <StageTransition
          label={transition.label}
          subtitle={transition.subtitle}
          onDone={() => {
            pausedRef.current = false;
            stageTimeRef.current = 0;
            lastSpawnRef.current = 0;
            lastTsRef.current = 0;
            setTimeLeft(durationSec);
            setTransition(null);
          }}
        />
      )}
    </div>
  );
}

// 스테이지(학기) 전환 화면 — 큰 학기명 타이틀이 뜨고 카운트다운 후 시작.
function StageTransition({
  label,
  subtitle,
  onDone,
}: {
  label: string;
  subtitle: string;
  onDone: () => void;
}) {
  const [count, setCount] = useState(3);
  useEffect(() => {
    if (count <= 0) {
      onDone();
      return;
    }
    const t = setTimeout(() => setCount((c) => c - 1), 900);
    return () => clearTimeout(t);
  }, [count, onDone]);

  return (
    <div style={transitionOverlay}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 18, color: "#9cf", letterSpacing: 4, marginBottom: 8 }}>
          STAGE
        </div>
        <div
          style={{
            fontSize: 64,
            fontWeight: 900,
            textShadow: "0 4px 30px rgba(80,140,255,0.5)",
            marginBottom: 14,
          }}
        >
          {label}
        </div>
        <div style={{ fontSize: 17, color: "#cdd", marginBottom: 28 }}>
          {subtitle}
        </div>
        <div
          key={count}
          style={{
            fontSize: 90,
            fontWeight: 900,
            color: count === 0 ? "#3fd68a" : "#ffd54a",
            animation: "none",
          }}
        >
          {count > 0 ? count : "START!"}
        </div>
      </div>
    </div>
  );
}

// 모양별 경로를 현재 좌표(중심 x,y)에 그린다.
function shapePath(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  r: number,
  rot: number
) {
  ctx.beginPath();
  if (shape === "circle") {
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    return;
  }
  const sides =
    shape === "triangle"
      ? 3
      : shape === "diamond"
        ? 4
        : shape === "square"
          ? 4
          : 6; // hexagon
  const start = shape === "square" ? Math.PI / 4 : shape === "diamond" ? 0 : -Math.PI / 2;
  for (let i = 0; i < sides; i++) {
    const a = start + rot * 0.4 + (Math.PI * 2 * i) / sides;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drawItem(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  it: FallingItem
) {
  const label = it.text;
  // 글자 수에 맞춰 물체 크기를 키움 — 긴 단어도 넉넉히 들어가게.
  const fontSize = label.length >= 6 ? 20 : label.length >= 4 ? 22 : 26;
  const r = Math.max(52, label.length * 8 + 34);
  ctx.save();
  ctx.translate(x, y);

  // 색: 아이템의 hue 기반(색 랜덤화 반영). 밝은 중심 → 어두운 가장자리.
  const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, r);
  grad.addColorStop(0, `hsla(${it.hue}, 85%, 70%, 0.97)`);
  grad.addColorStop(1, `hsla(${it.hue}, 70%, 44%, 0.88)`);

  shapePath(ctx, it.shape, r, it.rot);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = `hsla(${it.hue}, 90%, 84%, 0.9)`;
  ctx.stroke();

  // 텍스트: 흰 글씨 + 진한 불투명 검정 외곽선 → 어떤 배경색에서도 또렷
  // (별도 배경 원반 없이 두꺼운 테두리만으로 가독성 확보)
  ctx.font = `900 ${fontSize}px "Pretendard", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#0a0a14";
  ctx.strokeText(label, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(label, 0, 0);

  ctx.restore();
  ctx.textAlign = "start";
}

function drawStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = (Math.PI * i) / 5 - Math.PI / 2;
    const px = Math.cos(a) * rad;
    const py = Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// 손 뼈대 대신 손 중심(palm)에 "조준점"만 표시 — 마우스 커서 역할.
// 주먹(집기)일 때는 색·크기가 바뀌고 조준 링이 조여들어 집는 순간을 알려줌.
function drawHand(
  ctx: CanvasRenderingContext2D,
  h: TrackedHand,
  W: number,
  H: number
) {
  const cx = h.palm.x * W;
  const cy = h.palm.y * H;
  const fist = h.gesture === "Closed_Fist";
  const color = fist ? "rgba(120,200,255,0.95)" : "rgba(255,205,120,0.95)";
  const glow = fist ? "rgba(120,200,255,0.35)" : "rgba(255,205,120,0.3)";

  // 바깥 조준 링 (집을 때 조여듦)
  ctx.beginPath();
  ctx.arc(cx, cy, fist ? 18 : 28, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.stroke();

  // 은은한 글로우
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 40);
  g.addColorStop(0, glow);
  g.addColorStop(1, "transparent");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, 40, 0, Math.PI * 2);
  ctx.fill();

  // 중심 점
  ctx.beginPath();
  ctx.arc(cx, cy, fist ? 8 : 6, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // 십자 조준선
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 14, cy);
  ctx.lineTo(cx - 6, cy);
  ctx.moveTo(cx + 6, cy);
  ctx.lineTo(cx + 14, cy);
  ctx.moveTo(cx, cy - 14);
  ctx.lineTo(cx, cy - 6);
  ctx.moveTo(cx, cy + 6);
  ctx.lineTo(cx, cy + 14);
  ctx.stroke();
}

const transitionOverlay: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background:
    "radial-gradient(circle at center, rgba(10,14,30,0.82) 0%, rgba(6,8,18,0.94) 100%)",
  backdropFilter: "blur(4px)",
  zIndex: 10,
};
const hud: React.CSSProperties = {
  position: "absolute",
  top: 18,
  left: 18,
  right: 18,
  display: "flex",
  gap: 14,
  flexWrap: "wrap",
  alignItems: "center",
};
const hudChip: React.CSSProperties = {
  padding: "12px 20px",
  borderRadius: 14,
  background: "rgba(12,12,26,0.72)",
  border: "1px solid rgba(255,255,255,0.15)",
  fontSize: 22,
  fontWeight: 700,
  lineHeight: 1,
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
