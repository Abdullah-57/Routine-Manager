import { apiFetch } from "@/api/client";

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  timezone: string;
  createdAt?: string;
  updatedAt?: string;
};

type AuthResponse = {
  token: string;
  user: AuthUser;
};

type MeResponse = {
  user: AuthUser;
};

export function signup(input: {
  email: string;
  password: string;
  displayName?: string;
  timezone?: string;
}) {
  return apiFetch<AuthResponse>("/auth/signup", {
    method: "POST",
    body: input,
  });
}

export function login(input: { email: string; password: string }) {
  return apiFetch<AuthResponse>("/auth/login", {
    method: "POST",
    body: input,
  });
}

export function fetchMe(token: string) {
  return apiFetch<MeResponse>("/auth/me", { token });
}
