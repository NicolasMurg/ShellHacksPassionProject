import { Router } from "express";

const router = Router();
router.get("/", (_req, res) => {
  res.json({ data: [{ id: "1", name: "Example item" }] });
});

// Demonstrates validation and a JSON response; nothing is persisted.
router.post("/echo", (req, res) => {
  const message = req.body?.message;
  if (typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "message must be a non-empty string" });
    return;
  }
  res.json({ message: message.trim() });
});

export default router;
