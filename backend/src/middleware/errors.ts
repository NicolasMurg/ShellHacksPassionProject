import type { ErrorRequestHandler, RequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { HttpError } from "../lib/validation";

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: "Route not found" });
};
export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) { next(err); return; }
  if (err instanceof ZodError) {
    res.status(400).json({ error: err.issues.map(i => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") });
    return;
  }
  if (err instanceof HttpError) { res.status(err.status).json({ error: err.message }); return; }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") { res.status(409).json({ error: "Record already exists" }); return; }
    if (err.code === "P2025") { res.status(404).json({ error: "Record not found" }); return; }
  }
  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) console.error("Request failed:", err instanceof Error ? err.name : "Unknown error");
  res.status(status).json({ error: status === 500 ? "Internal server error" : err.message || "Bad request" });
};
