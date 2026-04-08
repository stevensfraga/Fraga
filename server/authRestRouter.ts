import { Router, Request, Response } from "express";
import { randomBytes } from "crypto";
import { getDb } from "./db";
import { users } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const router = Router();

// Armazenar sessões em memória (em produção, usar Redis)
const sessions = new Map<string, { userId: number; email: string; role: string; expiresAt: Date }>();

// Função auxiliar para validar senha
let bcryptModule: any = null;

async function validatePassword(password: string, hash: string): Promise<boolean> {
  try {
    // Lazy load bcrypt para evitar erro de bundling
    if (!bcryptModule) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      bcryptModule = await import("bcrypt");
    }
    console.log("[AUTH-REST] validatePassword: comparing", { passwordLen: password.length, hashLen: hash.length });
    const result = await bcryptModule.compare(password, hash);
    console.log("[AUTH-REST] validatePassword: result =", result);
    return result;
  } catch (error) {
    console.error("[AuthRestRouter] Erro ao validar senha:", error);
    return false;
  }
}

// POST /api/auth/login - Fazer login
router.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    console.log("[AUTH-REST] Login attempt:", { email, passwordLength: password?.length });

    if (!email || !password) {
      return res.status(400).json({
        error: "Email e senha são obrigatórios",
      });
    }

    // Buscar usuário no banco
    const db = await getDb();
    if (!db) {
      console.log("[AUTH-REST] DB connection failed");
      return res.status(500).json({ error: "Erro ao conectar ao banco" });
    }
    const userResult = await db.select().from(users).where(eq(users.email, email)).limit(1);
    console.log("[AUTH-REST] User query result:", { found: userResult.length > 0, user: userResult[0]?.email });

    if (!userResult || userResult.length === 0) {
      console.log("[AUTH-REST] User not found");
      return res.status(401).json({
        error: "Email ou senha inválidos",
      });
    }

     const user = userResult[0];

    // Validar senha com bcrypt
    // Nota: O campo no banco é 'password_hash' (snake_case), não 'passwordHash'
    const passwordHash = (user as any).password_hash || user.passwordHash;
    console.log("[AUTH-REST] Password hash found:", !!passwordHash, { hashLength: passwordHash?.length });
    if (!passwordHash) {
      console.log("[AUTH-REST] No password hash");
      return res.status(401).json({
        error: "Email ou senha inválidos",
      });
    }
    const passwordValid = await validatePassword(password, passwordHash);
    console.log("[AUTH-REST] Password validation:", passwordValid);
    if (!passwordValid) {
      console.log("[AUTH-REST] Password mismatch");
      return res.status(401).json({
        error: "Email ou senha inválidos",
      });
    }

    // Gerar token de sessão
    const sessionToken = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas

    // Armazenar sessão
    sessions.set(sessionToken, {
      userId: user.id,
      email: (user.email || "") as string,
      role: (user.role || "user") as string,
      expiresAt,
    });

    // Setar cookie com opções seguras
    res.cookie("fraga_session", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 24 * 60 * 60 * 1000, // 24 horas
    });

    return res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email || "",
        name: user.name || "",
        role: (user.role || "user") as string,
      },
    });
  } catch (error) {
    console.error("[AuthRestRouter] Login error:", error);
    return res.status(500).json({
      error: "Erro ao processar login",
    });
  }
});

// POST /api/auth/logout - Fazer logout
router.post("/logout", (req: Request, res: Response) => {
  try {
    const sessionToken = req.cookies.fraga_session;

    if (sessionToken) {
      sessions.delete(sessionToken);
    }

    res.clearCookie("fraga_session", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
    });

    return res.json({
      success: true,
    });
  } catch (error) {
    console.error("[AuthRestRouter] Logout error:", error);
    return res.status(500).json({
      error: "Erro ao processar logout",
    });
  }
});

// GET /api/auth/me - Obter usuário autenticado
router.get("/me", (req: Request, res: Response) => {
  try {
    const sessionToken = req.cookies.fraga_session;

    if (!sessionToken) {
      return res.status(401).json({
        error: "Não autenticado",
      });
    }

    const session = sessions.get(sessionToken);

    if (!session) {
      return res.status(401).json({
        error: "Sessão inválida ou expirada",
      });
    }

    // Verificar expiração
    if (new Date() > session.expiresAt) {
      sessions.delete(sessionToken);
      res.clearCookie("fraga_session");
      return res.status(401).json({
        error: "Sessão expirada",
      });
    }

    return res.json({
      user: {
        id: session.userId,
        email: session.email as string,
        role: (session.role || "user") as string,
      },
    });
  } catch (error) {
    console.error("[AuthRestRouter] Me error:", error);
    return res.status(500).json({
      error: "Erro ao obter usuário",
    });
  }
});

export default router;
