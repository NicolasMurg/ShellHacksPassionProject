import { createHash, randomBytes } from "node:crypto";
import type { RequestHandler } from "express";
import { prisma } from "../lib/prisma";
import { HttpError } from "../lib/validation";

export const publicUser = { id: true, name: true, email: true, profile: true } as const;
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt } });
  return { token, expiresAt };
}
export const requireAuth: RequestHandler = async (req, res, next) => {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? "");
  if (!match) throw new HttpError(401, "A valid bearer token is required");
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(match[1]!) }, include: { user: { select: publicUser } },
  });
  if (!session || session.expiresAt <= new Date()) throw new HttpError(401, "Session expired or invalid");
  res.locals.user = session.user;
  res.locals.sessionId = session.id;
  next();
};

export const optionalAuth: RequestHandler = (req, res, next) => {
  if (req.headers.authorization) return requireAuth(req, res, next);
  next();
};
