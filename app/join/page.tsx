"use client";

import { useState } from "react";

// 학생 폰에서 QR로 접속하는 신청 페이지
export default function JoinPage() {
  const [name, setName] = useState("");
  const [school, setSchool] = useState("");
  const [grade, setGrade] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ ahead: number; name: string } | null>(
    null
  );
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/players", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          school,
          grade,
          // 현재/목표 등급은 입력받지 않고 고정(현재 3.0 → 목표 1.3)
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "신청 실패");
      setDone({ ahead: data.ahead, name });
    } catch (err) {
      setError(err instanceof Error ? err.message : "신청 실패");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <main style={wrap}>
        <div style={card}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🎯</div>
          <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>신청 완료!</h1>
          <p style={{ color: "#aab", margin: "0 0 16px" }}>
            {done.name}님, 접수되었습니다.
          </p>
          <div style={badge}>
            앞에 <b style={{ color: "#7cf" }}>{done.ahead}명</b> 대기 중
          </div>
          <p style={{ color: "#889", fontSize: 13, marginTop: 20 }}>
            메인 화면에서 순서가 되면 호명됩니다. 화면 앞으로 와주세요!
          </p>
        </div>
      </main>
    );
  }

  return (
    <main style={wrap}>
      <form onSubmit={submit} style={card}>
        <h1 style={{ fontSize: 24, margin: "0 0 4px", textAlign: "center" }}>
          정율 캐치 🖐️
        </h1>
        <p
          style={{
            color: "#889",
            fontSize: 13,
            textAlign: "center",
            margin: "0 0 20px",
          }}
        >
          정보를 입력하고 게임에 참여하세요
        </p>

        <label style={label}>이름</label>
        <input
          style={input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="홍길동"
          required
        />

        <label style={label}>학교</label>
        <input
          style={input}
          value={school}
          onChange={(e) => setSchool(e.target.value)}
          placeholder="○○고등학교"
          required
        />

        <label style={label}>학년</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          {[1, 2, 3].map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGrade(g)}
              style={{
                ...pill,
                background: grade === g ? "#4a6cf7" : "#1a1a2e",
                borderColor: grade === g ? "#4a6cf7" : "#2a2a44",
              }}
            >
              {g}학년
            </button>
          ))}
        </div>

        <div
          style={{
            background: "#0d0d18",
            border: "1px solid #2a2a44",
            borderRadius: 10,
            padding: "12px 14px",
            marginBottom: 14,
            fontSize: 13,
            color: "#9ac",
            lineHeight: 1.6,
          }}
        >
          🎯 모두 <b style={{ color: "#cde" }}>현재 3등급</b>에서 시작합니다.
          <br />
          매 학기 열심히 잡아 <b style={{ color: "#8f8" }}>1등급</b>에 도전하세요!
        </div>

        {error && (
          <p style={{ color: "#f77", fontSize: 13, margin: "8px 0 0" }}>
            {error}
          </p>
        )}

        <button type="submit" disabled={submitting} style={submitBtn}>
          {submitting ? "신청 중..." : "게임 참여 신청"}
        </button>
      </form>
    </main>
  );
}

const wrap: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
};
const card: React.CSSProperties = {
  width: "100%",
  maxWidth: 380,
  background: "#12121f",
  border: "1px solid #24243a",
  borderRadius: 16,
  padding: 28,
};
const label: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  color: "#99a",
  margin: "0 0 6px",
};
const input: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "11px 14px",
  marginBottom: 14,
  borderRadius: 10,
  border: "1px solid #2a2a44",
  background: "#0d0d18",
  color: "#e8e8f0",
  fontSize: 15,
};
const pill: React.CSSProperties = {
  flex: 1,
  padding: "10px 0",
  borderRadius: 10,
  border: "1px solid",
  color: "#e8e8f0",
  fontSize: 14,
  cursor: "pointer",
};
const submitBtn: React.CSSProperties = {
  width: "100%",
  marginTop: 8,
  padding: "13px 0",
  borderRadius: 10,
  border: "none",
  background: "#4a6cf7",
  color: "#fff",
  fontSize: 16,
  fontWeight: 600,
  cursor: "pointer",
};
const badge: React.CSSProperties = {
  display: "inline-block",
  padding: "10px 18px",
  borderRadius: 10,
  background: "#1a1a2e",
  border: "1px solid #2a2a44",
  fontSize: 15,
};
