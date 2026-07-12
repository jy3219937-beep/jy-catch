import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// PATCH /api/players/:id/status — 학생 상태 변경 (waiting → playing → done)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { status } = await req.json();

  if (!["waiting", "playing", "done"].includes(status)) {
    return NextResponse.json({ error: "잘못된 상태" }, { status: 400 });
  }

  const player = await prisma.player.update({
    where: { id },
    data: { status },
  });
  return NextResponse.json({ player });
}
