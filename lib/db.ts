import { PrismaClient } from "@prisma/client";

// 개발 중 HMR로 인스턴스가 여러 개 생기는 것을 방지하는 싱글턴 패턴.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
