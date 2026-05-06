"use client";

const TOKEN_KEY = "snappark.token";
const REFRESH_KEY = "snappark.refresh";
const USER_KEY = "snappark.user";

export type AuthUser = {
  id: string;
  email: string;
  role?: "citizen" | "admin";
  firstName?: string | null;
  lastName?: string | null;
  emailVerified?: boolean;
};

export const tokenStore = {
  getToken: (): string | null =>
    typeof window === "undefined" ? null : localStorage.getItem(TOKEN_KEY),

  getRefreshToken: (): string | null =>
    typeof window === "undefined" ? null : localStorage.getItem(REFRESH_KEY),

  getUser: (): AuthUser | null => {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthUser;
    } catch {
      return null;
    }
  },

  set: (token: string, refreshToken: string, user: AuthUser) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(REFRESH_KEY, refreshToken);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },

  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
  },
};
