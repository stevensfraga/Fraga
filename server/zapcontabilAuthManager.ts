import axios, { AxiosInstance, AxiosError } from 'axios';
import crypto from 'crypto';

interface TokenCache {
  accessToken: string;
  expiresAt: number;
  tokenHash: string;
}

interface AuthConfig {
  baseUrl: string;
  jrtCookie?: string;
  username?: string;
  password?: string;
}

export class ZapAuthManager {
  private tokenCache: TokenCache | null = null;
  private axiosInstance: AxiosInstance;
  private config: AuthConfig;
  private isRefreshing = false;
  private refreshQueue: Array<() => void> = [];

  constructor(config: AuthConfig) {
    this.config = config;
    this.axiosInstance = axios.create({
      baseURL: config.baseUrl,
      timeout: 30000,
      withCredentials: true,
    });

    // Interceptor para adicionar Authorization header
    this.axiosInstance.interceptors.request.use((req) => {
      if (this.tokenCache && !this.isTokenExpired()) {
        req.headers.Authorization = `Bearer ${this.tokenCache.accessToken}`;
      }
      return req;
    });

    // Interceptor para retry em 401
    this.axiosInstance.interceptors.response.use(
      (res) => res,
      async (error: AxiosError) => {
        const originalRequest = error.config as any;

        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;

          if (!this.isRefreshing) {
            this.isRefreshing = true;
            try {
              await this.refreshOrLogin();
              this.isRefreshing = false;
              this.processQueue();
            } catch (err) {
              this.isRefreshing = false;
              this.refreshQueue = [];
              console.error("[ZapAuthManager] Refresh failed", err);
              throw err;
            }
          }

          // Aguardar refresh completar
          return new Promise((resolve) => {
            this.refreshQueue.push(() => {
              if (this.tokenCache) {
                originalRequest.headers.Authorization = `Bearer ${this.tokenCache.accessToken}`;
              }
              resolve(this.axiosInstance(originalRequest));
            });
          });
        }

        return Promise.reject(error);
      }
    );
  }

  private isTokenExpired(): boolean {
    if (!this.tokenCache) return true;
    return Date.now() >= this.tokenCache.expiresAt - 60000; // 1 min buffer
  }

  private decodeJwt(token: string): any {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) throw new Error("Invalid JWT");
      const decoded = JSON.parse(
        Buffer.from(parts[1], "base64").toString("utf-8")
      );
      return decoded;
    } catch (err) {
      console.error("[ZapAuthManager] JWT decode failed", err);
      throw err;
    }
  }

  private getTokenHash(token: string): string {
    
    return crypto.createHash("sha256").update(token).digest("hex").substring(0, 16);
  }

  async refreshOrLogin(): Promise<void> {
    try {
      // Prioridade 1: Tentar refresh com cookie jrt
      if (this.config.jrtCookie) {
        try {
          console.log("[ZapAuthManager] Tentando refresh com jrt cookie");
          const response = await axios.post(
            `${this.config.baseUrl}/auth/refresh_token`,
            {},
            {
              headers: {
                Cookie: `jrt=${this.config.jrtCookie}`,
              },
              timeout: 10000,
            }
          );

          if (response.data?.token) {
            this.setToken(response.data.token);
            console.log("[ZapAuthManager] Refresh com jrt bem-sucedido", {
              tokenExp: this.tokenCache?.expiresAt,
              tokenHash: this.tokenCache?.tokenHash,
            });
            return;
          }
        } catch (err) {
          console.warn("[ZapAuthManager] Refresh com jrt falhou", err);
        }
      }

      // Prioridade 2: Login programático
      if (this.config.username && this.config.password) {
        console.log("[ZapAuthManager] Tentando login programático", {
          baseUrl: this.config.baseUrl,
          username: this.config.username,
          hasPassword: !!this.config.password,
        });
        const response = await axios.post(
          `${this.config.baseUrl}/auth/login`,
          {
            email: this.config.username,
            password: this.config.password,
          },
          { timeout: 10000 }
        );

        if (response.data?.token) {
          this.setToken(response.data.token);

          // Capturar novo jrt cookie se disponível
          const setCookieHeader = response.headers["set-cookie"];
          if (setCookieHeader) {
            const jrtMatch = setCookieHeader
              .join(";")
              .match(/jrt=([^;]+)/);
            if (jrtMatch) {
              this.config.jrtCookie = jrtMatch[1];
              console.log("[ZapAuthManager] Novo jrt cookie capturado");
            }
          }

          console.log("[ZapAuthManager] Login programático bem-sucedido", {
            tokenExp: this.tokenCache?.expiresAt,
            tokenHash: this.tokenCache?.tokenHash,
          });
          return;
        }
      }

      throw new Error(
        "Nenhum método de autenticação disponível (jrt ou credentials)"
      );
    } catch (err) {
      console.error("[ZapAuthManager] refreshOrLogin falhou", err);
      throw err;
    }
  }

  private setToken(token: string): void {
    const decoded = this.decodeJwt(token);
    const expiresAt = (decoded.exp || 0) * 1000; // Convert to ms
    const tokenHash = this.getTokenHash(token);

    this.tokenCache = {
      accessToken: token,
      expiresAt,
      tokenHash,
    };

    console.log("[ZapAuthManager] Token armazenado em cache", {
      expiresIn: Math.round((expiresAt - Date.now()) / 1000),
      tokenHash,
    });
  }

  private processQueue(): void {
    this.refreshQueue.forEach((cb) => cb());
    this.refreshQueue = [];
  }

  async request(method: string, url: string, data?: any, headers?: any) {
    // Garantir que temos um token válido
    if (!this.tokenCache || this.isTokenExpired()) {
      await this.refreshOrLogin();
    }

    return this.axiosInstance({
      method,
      url,
      data,
      headers,
    });
  }

  async get(url: string, headers?: any) {
    return this.request("GET", url, undefined, headers);
  }

  async post(url: string, data?: any, headers?: any) {
    return this.request("POST", url, data, headers);
  }

  getTokenInfo() {
    return {
      hasToken: !!this.tokenCache,
      isExpired: this.isTokenExpired(),
      expiresAt: this.tokenCache?.expiresAt,
      tokenHash: this.tokenCache?.tokenHash,
    };
  }
}

// Singleton instance
let authManager: ZapAuthManager | null = null;

export function initZapAuthManager(config: AuthConfig): ZapAuthManager {
  authManager = new ZapAuthManager(config);
  return authManager;
}

export function getZapAuthManager(): ZapAuthManager {
  if (!authManager) {
    throw new Error(
      "ZapAuthManager não foi inicializado. Chame initZapAuthManager() primeiro."
    );
  }
  return authManager;
}
