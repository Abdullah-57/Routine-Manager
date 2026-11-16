import "dotenv/config";
import cors from "cors";
import express from "express";
import { connectDb } from "./db/connect";
import { authRouter } from "./routes/auth";
import { devicesRouter } from "./routes/devices";
import { notificationsRouter } from "./routes/notifications";
import { remindersRouter } from "./routes/reminders";
import { routinesRouter } from "./routes/routines";
import { integrationsRouter } from "./routes/integrations";

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
app.use("/devices", devicesRouter);
app.use("/notifications", notificationsRouter);
app.use("/reminders", remindersRouter);
app.use("/routines", routinesRouter);
app.use("/integrations", integrationsRouter);

async function start() {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is missing. Add it to backend/.env before starting the server.");
  }

  await connectDb();

  app.listen(port, "0.0.0.0", () => {
    console.log(`routine-manager-api listening on http://0.0.0.0:${port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
