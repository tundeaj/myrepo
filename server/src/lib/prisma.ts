import { PrismaClient } from "@prisma/client";

// Single shared client. tsx --watch restarts the process on every file save,
// so no HMR-singleton dance is needed here (that's a Next.js concern).
export const prisma = new PrismaClient();
