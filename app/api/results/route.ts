import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  computeDifficulty,
  scoreToTier,
  tierToDepartment,
} from "@/lib/game-config";

// POST /api/results — 게임 종료 후 결과 저장 (달성등급/학과는 서버에서 산출)
export async function POST(req: NextRequest) {
  try {
    const { playerId, finalScore } = await req.json();
    if (!playerId || finalScore == null) {
      return NextResponse.json({ error: "필수 값 누락" }, { status: 400 });
    }

    const player = await prisma.player.findUnique({ where: { id: playerId } });
    if (!player) {
      return NextResponse.json(
        { error: "참가자를 찾을 수 없음" },
        { status: 404 }
      );
    }

    const difficulty = computeDifficulty(
      player.currentTier,
      player.targetTier,
      player.grade
    );
    const achievedTier = scoreToTier(Number(finalScore), difficulty);
    const department = tierToDepartment(achievedTier);

    // upsert: 같은 player가 다시 저장하면 갱신
    const result = await prisma.gameResult.upsert({
      where: { playerId },
      create: {
        playerId,
        name: player.name,
        school: player.school,
        finalScore: Number(finalScore),
        achievedTier,
        department,
        difficulty,
      },
      update: {
        finalScore: Number(finalScore),
        achievedTier,
        department,
        difficulty,
      },
    });

    // 참가자 완료 처리
    await prisma.player.update({
      where: { id: playerId },
      data: { status: "done" },
    });

    // 내 순위 계산 (달성등급이 더 좋은=낮은 사람 수 + 1)
    const rank =
      (await prisma.gameResult.count({
        where: { achievedTier: { lt: achievedTier } },
      })) + 1;

    return NextResponse.json({ result, rank });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "결과 저장 실패" }, { status: 500 });
  }
}

// GET /api/results — 리더보드 (달성등급 좋은 순)
export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "100");
  const results = await prisma.gameResult.findMany({
    orderBy: [{ achievedTier: "asc" }, { finalScore: "desc" }],
    take: limit,
  });
  return NextResponse.json({ results });
}
