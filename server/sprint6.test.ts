import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

/**
 * Sprint 6 — Testes de integração para os novos routers:
 *   - clientsManager (list, stats)
 *   - contacts (list)
 *   - reguaPipeline (pipeline, blocked, timeline)
 *   - payments (recent, divergences, syncErrors)
 */

function createTestContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "test-user",
      email: "test@fraga.com",
      name: "Test User",
      loginMethod: "oauth",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

describe("clientsManager", () => {
  const caller = appRouter.createCaller(createTestContext());

  it("list retorna paginação e array de clientes", async () => {
    const result = await caller.clientsManager.list({ page: 1, perPage: 5 });
    expect(result).toHaveProperty("clients");
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("page", 1);
    expect(result).toHaveProperty("perPage", 5);
    expect(result).toHaveProperty("totalPages");
    expect(Array.isArray(result.clients)).toBe(true);
    if (result.clients.length > 0) {
      const c = result.clients[0];
      expect(c).toHaveProperty("id");
      expect(c).toHaveProperty("name");
      expect(c).toHaveProperty("document");
      expect(typeof c.optOut).toBe("boolean");
    }
  });

  it("list com busca retorna resultado filtrado", async () => {
    const result = await caller.clientsManager.list({ page: 1, perPage: 5, search: "fraga" });
    expect(result).toHaveProperty("clients");
    expect(result).toHaveProperty("total");
  });

  it("stats retorna contadores numéricos", async () => {
    const result = await caller.clientsManager.stats();
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("active");
    expect(result).toHaveProperty("optedOut");
    expect(result).toHaveProperty("overdueClients");
    expect(typeof result.total).toBe("number");
    expect(typeof result.active).toBe("number");
  });
});

describe("contacts", () => {
  const caller = appRouter.createCaller(createTestContext());

  it("list retorna array de contatos para clientId existente", async () => {
    const clients = await caller.clientsManager.list({ page: 1, perPage: 1 });
    if (clients.clients.length === 0) return;
    const clientId = clients.clients[0].id;
    const result = await caller.contacts.list({ clientId });
    expect(result).toHaveProperty("contacts");
    expect(Array.isArray(result.contacts)).toBe(true);
  });
});

describe("reguaPipeline", () => {
  const caller = appRouter.createCaller(createTestContext());

  it("pipeline retorna stages e summary", async () => {
    const result = await caller.reguaPipeline.pipeline({ days: 30 });
    expect(result).toHaveProperty("stages");
    expect(result).toHaveProperty("summary");
    expect(Array.isArray(result.stages)).toBe(true);
    expect(result.summary).toHaveProperty("totalClients");
    expect(result.summary).toHaveProperty("totalDebt");
    expect(result.summary).toHaveProperty("stageCount");
  });

  it("blocked retorna lista e contagem por motivo", async () => {
    const result = await caller.reguaPipeline.blocked({});
    expect(result).toHaveProperty("blocked");
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("byReason");
    expect(Array.isArray(result.blocked)).toBe(true);
  });

  it("timeline retorna entries", async () => {
    const result = await caller.reguaPipeline.timeline({ days: 7, limit: 10 });
    expect(result).toHaveProperty("entries");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.entries)).toBe(true);
  });
});

describe("payments", () => {
  const caller = appRouter.createCaller(createTestContext());

  it("recent retorna pagamentos e totais", async () => {
    const result = await caller.payments.recent({ days: 30, limit: 10 });
    expect(result).toHaveProperty("payments");
    expect(result).toHaveProperty("totals");
    expect(Array.isArray(result.payments)).toBe(true);
    expect(result.totals).toHaveProperty("count");
    expect(result.totals).toHaveProperty("totalAmount");
  });

  it("divergences retorna divergências e staleReceivables", async () => {
    const result = await caller.payments.divergences({ limit: 10 });
    expect(result).toHaveProperty("divergences");
    expect(result).toHaveProperty("unresolvedCount");
    expect(result).toHaveProperty("staleReceivables");
    expect(Array.isArray(result.divergences)).toBe(true);
  });

  it("syncErrors retorna cursors e errors", async () => {
    const result = await caller.payments.syncErrors({ days: 7 });
    expect(result).toHaveProperty("cursors");
    expect(result).toHaveProperty("errors");
    expect(Array.isArray(result.cursors)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
  });
});
