import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { getDb } from "./db";
import { users } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import * as bcrypt from "bcrypt";
import { randomBytes } from "crypto";

export const authRouter = router({
  login: publicProcedure
    .input(z.object({
      email: z.string().email(),
      password: z.string().min(6)
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      const user = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
      
      if (!user || user.length === 0 || !user[0].passwordHash) {
        throw new Error("Email ou senha inválidos");
      }
      
      const isValid = await bcrypt.compare(input.password, user[0].passwordHash);
      if (!isValid) throw new Error("Email ou senha inválidos");
      
      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      
      // ✅ SETAR COOKIE
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, token, {
        ...cookieOptions,
        maxAge: 24 * 60 * 60 * 1000,
      });
      
      return {
        id: user[0].id,
        email: user[0].email,
        name: user[0].name,
        role: user[0].role,
        token,
        expiresAt
      };
    }),

  logout: publicProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true };
    }),

  me: protectedProcedure.query(async ({ ctx }) => ({
    id: ctx.user?.id,
    email: ctx.user?.email,
    name: ctx.user?.name,
    role: ctx.user?.role
  }))
});
