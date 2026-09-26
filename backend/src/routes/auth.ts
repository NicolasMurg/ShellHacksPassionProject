import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { defaultProfile, HttpError, profile } from "../lib/validation";
import { createSession, publicUser, requireAuth } from "../middleware/auth";

export const authRoutes = Router();
authRoutes.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 30,
  standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many authentication attempts" } }));
const credentials = z.object({ email: z.email().max(254).transform(v => v.toLowerCase()),
  password: z.string().min(8).max(128) }).strict();
authRoutes.post("/register", async (req, res) => {
  const data = credentials.extend({ name: z.string().trim().min(1).max(100) }).parse(req.body);
  const passwordHash = await Bun.password.hash(data.password, { algorithm: "argon2id" });
  const user = await prisma.user.create({ data: { email: data.email, name: data.name,
    passwordHash, profile: defaultProfile }, select: publicUser });
  res.status(201).json({ user, ...await createSession(user.id) });
});
// A dummy hash keeps unknown-email and wrong-password verification work comparable.
const dummyHash = Bun.password.hash("unused-dummy-password", { algorithm: "argon2id" });
authRoutes.post("/login", async (req, res) => {
  const data = credentials.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: data.email } });
  const valid = await Bun.password.verify(data.password, user?.passwordHash ?? await dummyHash);
  if (!user?.passwordHash || !valid) throw new HttpError(401, "Invalid email or password");
  const { id, name, email, profile } = user;
  res.json({ user: { id, name, email, profile }, ...await createSession(id) });
});
authRoutes.post("/logout", requireAuth, async (_req, res) => {
  await prisma.session.deleteMany({ where: { id: res.locals.sessionId } });
  res.status(204).end();
});
export const meRoutes = Router();
meRoutes.use(requireAuth);
meRoutes.get("/", (_req, res) => res.json(res.locals.user));
meRoutes.patch("/", async (req, res) => {
  const data = z.object({ name: z.string().trim().min(1).max(100).optional(), profile: profile.optional() })
    .strict().refine(v => Object.keys(v).length > 0, "Provide an update").parse(req.body);
  res.json(await prisma.user.update({ where: { id: res.locals.user.id }, data, select: publicUser }));
});
