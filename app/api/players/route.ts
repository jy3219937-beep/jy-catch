import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// POST /api/players — 학생 신청 (폰에서 QR로 접속 후 제출)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, school, grade } = body ?? {};

    if (!name?.trim() || !school?.trim() || grade == null) {
      return NextResponse.json(
        { error: "모든 항목을 입력해주세요." },
        { status: 400 }
      );
    }

    // 현재/목표 등급은 입력받지 않고 고정: 모두 현재 3등급 → 목표 1.3등급
    const START_TIER = 3.0;
    const GOAL_TIER = 1.3;

    const player = await prisma.player.create({
      data: {
        name: String(name).trim(),
        school: String(school).trim(),
        grade: Number(grade),
        currentTier: START_TIER,
        targetTier: GOAL_TIER,
        status: "waiting",
      },
    });

    // 내 앞에 대기 중인 인원 수
    const ahead = await prisma.player.count({
      where: {
        status: "waiting",
        createdAt: { lt: player.createdAt },
      },
    });

    return NextResponse.json({ player, ahead });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "신청 처리 실패" }, { status: 500 });
  }
}

// GET /api/players?status=waiting — 대기열 조회
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") ?? "waiting";
  const players = await prisma.player.findMany({
    where: { status },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ players });
}
