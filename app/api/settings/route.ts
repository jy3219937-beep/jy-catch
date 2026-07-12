import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const DEFAULTS = {
  difficultyMult: 1.0,
  highCatch: 0.9,
  highGrade: 1.1,
  lowCatch: 0.4,
  lowGrade: 3.0,
  wrongPenalty: 0.5,
};

// 단일 설정 행을 보장(없으면 기본값 생성).
async function getOrCreate() {
  const existing = await prisma.settings.findUnique({
    where: { id: "singleton" },
  });
  if (existing) return existing;
  return prisma.settings.create({ data: { id: "singleton", ...DEFAULTS } });
}

// GET /api/settings — 현재 설정 조회
export async function GET() {
  const s = await getOrCreate();
  return NextResponse.json({ settings: s });
}

// PATCH /api/settings — 설정 수정 (관리자)
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  // 허용된 필드만, 안전 범위로 clamp
  const clamp = (v: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, v));
  const data: Record<string, number> = {};
  if (body.difficultyMult != null)
    data.difficultyMult = clamp(Number(body.difficultyMult), 0.5, 2.0);
  if (body.highCatch != null)
    data.highCatch = clamp(Number(body.highCatch), 0.3, 1.0);
  if (body.highGrade != null)
    data.highGrade = clamp(Number(body.highGrade), 1.0, 5.0);
  if (body.lowCatch != null)
    data.lowCatch = clamp(Number(body.lowCatch), 0.05, 0.9);
  if (body.lowGrade != null)
    data.lowGrade = clamp(Number(body.lowGrade), 1.0, 5.0);
  if (body.wrongPenalty != null)
    data.wrongPenalty = clamp(Number(body.wrongPenalty), 0, 2);

  await getOrCreate(); // 행 보장
  const s = await prisma.settings.update({
    where: { id: "singleton" },
    data,
  });
  return NextResponse.json({ settings: s });
}
