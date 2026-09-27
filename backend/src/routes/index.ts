import { Router } from "express";
import exampleRoutes from "./examples";
import { authRoutes, meRoutes } from "./auth";
import { dataRoutes } from "./data";
import { zoneRoutes } from "./zones";
import { closureRoutes } from "./closures";
import { googleRoutes } from "./google";

import { arrivalRoutes } from "./arrivals";
import { aiRoutes } from "./ai";

const router = Router();
router.get("/", (_req, res) => { res.json({ message: "Welcome to the API" }); });
router.get("/health", (_req, res) => { res.json({ status: "ok" }); });
router.use("/examples", exampleRoutes);
router.use(dataRoutes);
router.use("/auth", authRoutes);
router.use("/me/zones", zoneRoutes);
router.use("/me", meRoutes);
router.use("/closures", closureRoutes);
router.use(googleRoutes);
router.use(arrivalRoutes);
router.use("/ai", aiRoutes);
export default router;
