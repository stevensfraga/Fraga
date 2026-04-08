/**
 * Testes para o gerenciador de reset de clientes > 60 dias
 */

import { describe, it, expect } from "vitest";
import {
  shouldSendResetMessage,
  getResetStatus,
} from "./collectionResetManager";

describe("Collection Reset Manager", () => {
  describe("shouldSendResetMessage", () => {
    it("deve retornar false para clientes com 1 mês de atraso", () => {
      expect(shouldSendResetMessage(1)).toBe(false);
    });

    it("deve retornar false para clientes com 2 meses de atraso", () => {
      expect(shouldSendResetMessage(2)).toBe(false);
    });

    it("deve retornar true para clientes com 3 meses de atraso", () => {
      expect(shouldSendResetMessage(3)).toBe(true);
    });

    it("deve retornar true para clientes com 6 meses de atraso", () => {
      expect(shouldSendResetMessage(6)).toBe(true);
    });
  });

  describe("getResetStatus", () => {
    it("deve retornar status warning para 1 mês de atraso", () => {
      const status = getResetStatus(1);
      expect(status.status).toBe("warning");
      expect(status.isOverdue).toBe(true);
    });

    it("deve retornar status critical para 2 meses de atraso", () => {
      const status = getResetStatus(2);
      expect(status.status).toBe("critical");
      expect(status.isOverdue).toBe(true);
    });

    it("deve retornar status reset para 3 meses de atraso", () => {
      const status = getResetStatus(3);
      expect(status.status).toBe("reset");
      expect(status.isOverdue).toBe(true);
      expect(status.monthsUntilReset).toBe(0);
    });

    it("deve retornar status reset para 12 meses de atraso", () => {
      const status = getResetStatus(12);
      expect(status.status).toBe("reset");
      expect(status.isOverdue).toBe(true);
    });
  });
});
