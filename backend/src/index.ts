import "dotenv/config";
import cors from "cors";
import express from "express";
import { connectDb } from "./db/connect";
import { authRouter } from "./routes/auth";
import { remindersRouter } from "./routes/reminders";

const app = express();
const port = Number(process.env.PORT) || 4000;

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "routine-manager-api",
  });
});

app.use("/auth", authRouter);
app.use("/reminders", remindersRouter);

async function start() {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is missing. Add it to backend/.env before starting the server.");
  }

  await connectDb();

  app.listen(port, () => {
    console.log(`routine-manager-api listening on http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
