import { useCallback, useEffect, useState } from "react";
import { getAuthStatus, login, type AuthStatus } from "../../api";

type AuthGateState = {
  auth: AuthStatus | null;
  checking: boolean;
  error: string;
  loginWithPassword: (password: string) => Promise<void>;
};

export function useAuthGate(): AuthGateState {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;
    getAuthStatus()
      .then((status) => {
        if (disposed) return;
        setAuth(status);
        setError("");
      })
      .catch((unknownError) => {
        if (disposed) return;
        setError(
          unknownError instanceof Error
            ? unknownError.message
            : "auth status failed",
        );
      })
      .finally(() => {
        if (!disposed) setChecking(false);
      });
    return () => {
      disposed = true;
    };
  }, []);

  const loginWithPassword = useCallback(async (password: string) => {
    setChecking(true);
    try {
      setAuth(await login(password));
      setError("");
    } catch (unknownError) {
      setError(
        unknownError instanceof Error ? unknownError.message : "login failed",
      );
    } finally {
      setChecking(false);
    }
  }, []);

  return { auth, checking, error, loginWithPassword };
}
