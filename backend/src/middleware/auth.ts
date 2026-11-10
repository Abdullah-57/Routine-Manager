import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

type JwtPayload = {
  sub: string;
  email: string;
};

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is missing from environment");
  }
  return secret;
}

export function signAuthToken(userId: string, email: string): string {
  return jwt.sign({ email }, getJwtSecret(), {
    subject: userId,
    expiresIn: "30d",
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  const token = header.slice("Bearer ".length).trim();

  try {
    const payload = jwt.verify(token, getJwtSecret()) as JwtPayload;
    const userId = typeof payload.sub === "string" ? payload.sub : undefined;

    if (!userId || !payload.email) {
      return res.status(401).json({ error: "Invalid token payload" });
    }

    req.user = { id: userId, email: payload.email };
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
