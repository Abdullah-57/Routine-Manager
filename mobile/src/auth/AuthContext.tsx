import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ApiError } from "@/api/client";
import {
  fetchMe,
  login as loginRequest,
  signup as signupRequest,
  type AuthUser,
} from "@/api/auth";
import { tokenStorage } from "@/auth/token-storage";

type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  isHydrated: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (input: {
    email: string;
    password: string;
    displayName?: string;
    timezone?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        const stored = await tokenStorage.getToken();
        if (!stored) {
          if (!cancelled) {
            setToken(null);
            setUser(null);
          }
          return;
        }

        const { user: me } = await fetchMe(stored);
        if (!cancelled) {
          setToken(stored);
          setUser(me);
        }
      } catch (error) {
        const stored = await tokenStorage.getToken();

        if (error instanceof ApiError && error.status === 401) {
          await tokenStorage.removeToken();
          if (!cancelled) {
            setToken(null);
            setUser(null);
          }
        } else if (stored) {
          // Network/other errors: keep token so reload still counts as signed in
          if (!cancelled) {
            setToken(stored);
            setUser(null);
          }
          if (__DEV__) {
            console.warn("Auth hydrate could not validate /auth/me", error);
          }
        } else if (!cancelled) {
          setToken(null);
          setUser(null);
        }
      } finally {
        if (!cancelled) {
          setIsHydrated(true);
        }
      }
    }

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, []);

  const persistSession = useCallback(async (nextToken: string, nextUser: AuthUser) => {
    await tokenStorage.setToken(nextToken);
    setToken(nextToken);
    setUser(nextUser);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await loginRequest({ email, password });
      await persistSession(result.token, result.user);
    },
    [persistSession],
  );

  const signup = useCallback(
    async (input: {
      email: string;
      password: string;
      displayName?: string;
      timezone?: string;
    }) => {
      const result = await signupRequest(input);
      await persistSession(result.token, result.user);
    },
    [persistSession],
  );

  const logout = useCallback(async () => {
    await tokenStorage.removeToken();
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      token,
      isHydrated,
      login,
      signup,
      logout,
    }),
    [user, token, isHydrated, login, signup, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return value;
}
