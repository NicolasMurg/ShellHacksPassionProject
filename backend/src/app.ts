import express from "express";
import cors from "cors";
import apiRoutes from "./routes";
import { errorHandler, notFound } from "./middleware/errors";

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: ["http://localhost:5173", "http://localhost:8080"] }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.get("/", (_req, res) => {
  res.json({ message: "Express API is running", api: "/api" });
});
app.use("/api", apiRoutes);
app.use(notFound);
app.use(errorHandler);

export default app;
