import { useEffect, useState } from "react";
import { useLocation } from "wouter";

export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  role: string;
}

export function useAuth() {
  const [, setLocation] = useLocation();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const savedToken = localStorage.getItem("auth_token");
    const savedUser = localStorage.getItem("user");

    if (savedToken && savedUser) {
      try {
        setToken(savedToken);
        setUser(JSON.parse(savedUser));
      } catch (error) {
        console.error("Erro ao carregar dados de autenticação:", error);
        localStorage.removeItem("auth_token");
        localStorage.removeItem("user");
      }
    }

    setIsLoading(false);
  }, []);

  const logout = () => {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("user");
    setUser(null);
    setToken(null);
    setLocation("/login");
  };

  const isAuthenticated = !!token && !!user;

  return {
    user,
    token,
    isAuthenticated,
    isLoading,
    logout,
  };
}
