import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// GET /api/players/next — 대기열 맨 앞(다음 진행할) 학생 조회
export async function GET() {
  const next = await prisma.player.findFirst({
    where: { status: "waiting" },
    orderBy: { createdAt: "asc" },
  });
  const waitingCount = await prisma.player.count({
    where: { status: "waiting" },
  });
  return NextResponse.json({ next, waitingCount });
}
