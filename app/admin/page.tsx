"use client";

import { useCallback, useEffect, useState } from "react";
import {
  computeDifficulty,
  accuracyToSemesterGrade,
  finalTierFromSemesters,
  tierToDepartment,
  totalStagesForGrade,
  DEFAULT_SETTINGS,
  type GameSettings,
} from "@/lib/game-config";

// 관리자 페이지: 난이도·등급 기준을 실시간 조절. "다음 참가자부터" 반영.
export default function AdminPage() {
  const [s, setS] = useState<GameSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string>("");

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.settings) setS(d.settings);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      });
      const d = await res.json();
      if (d.settings) setS(d.settings);
      const now = new Date();
      setSavedAt(
        `${now.getHours().toString().padStart(2, "0")}:${now
          .getMinutes()
          .toString()
          .padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`
      );
    } finally {
      setSaving(false);
    }
  }, [s]);

  const reset = () => setS(DEFAULT_SETTINGS);

  // 미리보기: 고정 케이스(현재 3.0→목표 1.3, 1학년 6학기)로 잡기율별 최종등급 계산
  const D = computeDifficulty(3.0, 1.3, 1);
  const total = totalStagesForGrade(1);
  const preview = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2].map((acc) => {
    const grades: number[] = [];
    for (let st = 1; st <= total; st++) {
      grades.push(
        accuracyToSemesterGrade(acc, D, (st - 1) / (total - 1), s)
      );
    }
    const finalTier = finalTierFromSemesters(3.0, 1.3, grades);
    const dept = tierToDepartment(finalTier);
    return { acc, finalTier, dept };
  });

  if (!loaded)
    return (
      <main style={wrap}>
        <p style={{ color: "#889" }}>불러오는 중...</p>
      </main>
    );

  return (
    <main style={wrap}>
      <div style={{ width: "100%", maxWidth: 900 }}>
        <h1 style={{ fontSize: 26, margin: "0 0 4px" }}>⚙️ 관리자 — 난이도 설정</h1>
        <p style={{ color: "#889", fontSize: 13, margin: "0 0 24px" }}>
          변경 후 저장하면 <b style={{ color: "#7cf" }}>다음 참가자부터</b> 적용됩니다.
          (현재 플레이 중인 학생은 기존 값 유지)
        </p>

        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          {/* 좌: 조절 패널 */}
          <div style={{ flex: "1 1 380px" }}>
            <Section title="🎮 전체 난이도 배율">
              <Slider
                label="난이도"
                value={s.difficultyMult}
                min={0.5}
                max={2.0}
                step={0.05}
                fmt={(v) => `×${v.toFixed(2)}`}
                hint={
                  s.difficultyMult < 0.95
                    ? "쉬움 (느리게)"
                    : s.difficultyMult > 1.05
                      ? "어려움 (빠르게)"
                      : "보통"
                }
                onChange={(v) => setS({ ...s, difficultyMult: v })}
              />
            </Section>

            <Section title="🎯 등급 기준 (두 점으로 곡선 결정)">
              <p style={hintP}>
                "이만큼 잡으면 이 등급"을 두 점 정하면 나머지가 비율로 채워집니다.
              </p>
              <div style={{ marginBottom: 14 }}>
                <div style={pairLabel}>상위 기준점 (잘했을 때)</div>
                <Slider
                  label="잡기율"
                  value={s.highCatch}
                  min={0.5}
                  max={1.0}
                  step={0.05}
                  fmt={(v) => `${(v * 100).toFixed(0)}%`}
                  onChange={(v) => setS({ ...s, highCatch: v })}
                />
                <Slider
                  label="→ 등급"
                  value={s.highGrade}
                  min={1.0}
                  max={3.0}
                  step={0.1}
                  fmt={(v) => `${v.toFixed(1)}등급`}
                  onChange={(v) => setS({ ...s, highGrade: v })}
                />
              </div>
              <div>
                <div style={pairLabel}>하위 기준점 (못했을 때)</div>
                <Slider
                  label="잡기율"
                  value={s.lowCatch}
                  min={0.1}
                  max={0.6}
                  step={0.05}
                  fmt={(v) => `${(v * 100).toFixed(0)}%`}
                  onChange={(v) => setS({ ...s, lowCatch: v })}
                />
                <Slider
                  label="→ 등급"
                  value={s.lowGrade}
                  min={2.0}
                  max={5.0}
                  step={0.1}
                  fmt={(v) => `${v.toFixed(1)}등급`}
                  onChange={(v) => setS({ ...s, lowGrade: v })}
                />
              </div>
            </Section>

            <Section title="🔴 방해용어 오터치 페널티">
              <Slider
                label="페널티"
                value={s.wrongPenalty}
                min={0}
                max={1.5}
                step={0.1}
                fmt={(v) => `도움 ${v.toFixed(1)}개 차감`}
                hint={
                  s.wrongPenalty === 0
                    ? "페널티 없음"
                    : s.wrongPenalty >= 1
                      ? "매우 엄격"
                      : "적당"
                }
                onChange={(v) => setS({ ...s, wrongPenalty: v })}
              />
            </Section>

            <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
              <button onClick={save} disabled={saving} style={saveBtn}>
                {saving ? "저장 중..." : "💾 저장"}
              </button>
              <button onClick={reset} style={resetBtn}>
                기본값으로
              </button>
              {savedAt && (
                <span style={{ color: "#8f8", fontSize: 13, alignSelf: "center" }}>
                  ✓ {savedAt} 저장됨
                </span>
              )}
            </div>
          </div>

          {/* 우: 실시간 미리보기 */}
          <div style={{ flex: "1 1 320px" }}>
            <Section title="📊 미리보기 (현재 3등급 기준, 6학기)">
              <p style={hintP}>잡기율(도움용어를 얼마나 잡나) → 예상 최종등급</p>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ color: "#89a", textAlign: "left" }}>
                    <th style={th}>잡기율</th>
                    <th style={th}>최종등급</th>
                    <th style={th}>합격 학과</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((p) => (
                    <tr key={p.acc} style={{ borderTop: "1px solid #1e1e30" }}>
                      <td style={td}>{(p.acc * 100).toFixed(0)}%</td>
                      <td style={{ ...td, fontWeight: 700, color: "#7cf" }}>
                        {p.finalTier.toFixed(1)}
                      </td>
                      <td style={{ ...td, fontSize: 12, color: p.dept ? "#9ac" : "#a66" }}>
                        {p.dept ?? "불합격"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          </div>
        </div>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={section}>
      <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>{title}</h2>
      {children}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  fmt,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
  hint?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
        <span style={{ color: "#aab" }}>{label}</span>
        <span style={{ color: "#e8e8f0", fontWeight: 600 }}>
          {fmt(value)}
          {hint && <span style={{ color: "#778", fontWeight: 400 }}> · {hint}</span>}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: "#4a6cf7" }}
      />
    </div>
  );
}

const wrap: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  justifyContent: "center",
  padding: 32,
};
const section: React.CSSProperties = {
  background: "#12121f",
  border: "1px solid #24243a",
  borderRadius: 14,
  padding: 20,
  marginBottom: 16,
};
const hintP: React.CSSProperties = {
  color: "#778",
  fontSize: 12,
  margin: "0 0 12px",
  lineHeight: 1.5,
};
const pairLabel: React.CSSProperties = {
  fontSize: 12,
  color: "#9ac",
  marginBottom: 6,
  fontWeight: 600,
};
const th: React.CSSProperties = { padding: "6px 8px", fontWeight: 600 };
const td: React.CSSProperties = { padding: "7px 8px" };
const saveBtn: React.CSSProperties = {
  padding: "11px 26px",
  borderRadius: 10,
  border: "none",
  background: "#4a6cf7",
  color: "#fff",
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
};
const resetBtn: React.CSSProperties = {
  padding: "11px 18px",
  borderRadius: 10,
  border: "1px solid #2a2a44",
  background: "transparent",
  color: "#aab",
  fontSize: 14,
  cursor: "pointer",
};
