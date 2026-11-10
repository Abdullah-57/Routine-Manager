import dns from "node:dns";
import mongoose from "mongoose";

export async function connectDb(): Promise<void> {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error(
      "MONGODB_URI is missing. Add it to backend/.env before starting the server.",
    );
  }

  // Some Windows DNS setups refuse Node's SRV lookups for mongodb+srv://
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
  dns.setDefaultResultOrder("ipv4first");

  mongoose.set("strictQuery", true);

  await mongoose.connect(uri, { family: 4 });
  console.log("MongoDB connected");
}
