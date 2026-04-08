import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * OAuth callback handler.
 * Called at /api/oauth/callback with ?code=...&state=...
 * The `state` param is base64(redirectUri) as set by getLoginUrl() in const.ts.
 */
async function handleOAuthCallback(req: Request, res: Response) {
  const code = getQueryParam(req, "code");
  const state = getQueryParam(req, "state");
  const errorParam = getQueryParam(req, "error");

  console.log("[OAuth] Callback received", {
    code: code ? `${code.substring(0, 8)}...` : undefined,
    state: state ? `${state.substring(0, 20)}...` : undefined,
    error: errorParam,
    query: req.query,
    host: req.hostname,
    headers: {
      "x-forwarded-proto": req.headers["x-forwarded-proto"],
      "x-forwarded-host": req.headers["x-forwarded-host"],
      origin: req.headers.origin,
    },
  });

  if (errorParam) {
    console.error("[OAuth] OAuth error from provider:", errorParam);
    return res.status(400).send(`Erro ao processar autorização: ${errorParam}`);
  }

  if (!code || !state) {
    console.error("[OAuth] Missing code or state", { code: !!code, state: !!state });
    return res.status(400).send("Erro ao processar autorização: parâmetros ausentes (code/state)");
  }

  // Decode the redirect URI from state (base64)
  let redirectUri: string;
  try {
    redirectUri = atob(state);
    console.log("[OAuth] Decoded redirectUri from state:", redirectUri);
  } catch (e) {
    console.error("[OAuth] Failed to decode state:", state, e);
    return res.status(400).send("Erro ao processar autorização: state inválido");
  }

  try {
    // Exchange code for token
    console.log("[OAuth] Exchanging code for token...");
    const tokenResponse = await sdk.exchangeCodeForToken(code, state);
    console.log("[OAuth] Token exchange success, accessToken present:", !!tokenResponse?.accessToken);

    // Get user info
    console.log("[OAuth] Fetching user info...");
    const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
    console.log("[OAuth] User info received:", {
      openId: userInfo.openId,
      name: userInfo.name,
      email: userInfo.email,
    });

    // Upsert user in DB
    const signedInAt = new Date();
    await db.upsertUser({
      openId: userInfo.openId,
      name: userInfo.name || null,
      email: userInfo.email ?? null,
      loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
      lastSignedIn: signedInAt,
    });

    // Create session JWT
    const sessionToken = await sdk.createSessionToken(userInfo.openId, {
      expiresInMs: ONE_YEAR_MS,
      name: userInfo.name || "",
    });

    // Set session cookie
    const cookieOptions = getSessionCookieOptions(req);
    console.log("[OAuth] Setting cookie", {
      name: COOKIE_NAME,
      options: cookieOptions,
    });
    res.cookie(COOKIE_NAME, sessionToken, {
      ...cookieOptions,
      maxAge: ONE_YEAR_MS,
    });

    // Determine where to redirect after login
    // The redirectUri is the full callback URL; we redirect to the app root
    let appOrigin: string;
    try {
      appOrigin = new URL(redirectUri).origin;
    } catch {
      appOrigin = redirectUri;
    }

    console.log("[OAuth] Login successful, redirecting to:", appOrigin);
    return res.redirect(appOrigin);
  } catch (error: any) {
    console.error("[OAuth] Callback error:", {
      message: error?.message,
      status: error?.response?.status,
      data: error?.response?.data,
      stack: error?.stack?.substring(0, 500),
    });
    return res.status(400).send(
      `Erro ao processar autorização: ${error?.response?.data?.message || error?.message || "erro desconhecido"}`
    );
  }
}

export function registerOAuthRoutes(app: Express) {
  // OAuth callback — MUST be registered BEFORE any Conta Azul callback handlers
  // that also listen on /api/oauth/callback
  app.get("/api/oauth/callback", handleOAuthCallback);
  console.log("[OAuth] ✅ /api/oauth/callback registered");
}
