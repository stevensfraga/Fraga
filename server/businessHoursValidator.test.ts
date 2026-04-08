import { describe, it, expect } from "vitest";
import {
  isBusinessHours,
  getNextBusinessHours,
  getMinutesUntilBusinessHours,
  formatNextSendTime,
  getBusinessHoursInfo,
} from "./businessHoursValidator";

describe("Business Hours Validator", () => {
  // Segunda-feira 10:00 (dentro do horário)
  const mondayMorning = new Date(2026, 1, 9, 10, 0, 0); // 9 de fevereiro de 2026 é segunda

  // Sexta-feira 17:00 (dentro do horário)
  const fridayAfternoon = new Date(2026, 1, 13, 17, 0, 0); // 13 de fevereiro de 2026 é sexta

  // Sábado 10:00 (fora do horário)
  const saturdayMorning = new Date(2026, 1, 14, 10, 0, 0); // 14 de fevereiro de 2026 é sábado

  // Domingo 10:00 (fora do horário)
  const sundayMorning = new Date(2026, 1, 8, 10, 0, 0); // 8 de fevereiro de 2026 é domingo

  // Segunda-feira 07:00 (antes do horário)
  const mondayEarlyMorning = new Date(2026, 1, 9, 7, 0, 0);

  // Segunda-feira 19:00 (depois do horário)
  const mondayEvening = new Date(2026, 1, 9, 19, 0, 0);

  describe("isBusinessHours", () => {
    it("deve retornar true para segunda-feira às 10:00", () => {
      expect(isBusinessHours(mondayMorning)).toBe(true);
    });

    it("deve retornar true para sexta-feira às 17:00", () => {
      expect(isBusinessHours(fridayAfternoon)).toBe(true);
    });

    it("deve retornar false para sábado às 10:00", () => {
      expect(isBusinessHours(saturdayMorning)).toBe(false);
    });

    it("deve retornar false para domingo às 10:00", () => {
      expect(isBusinessHours(sundayMorning)).toBe(false);
    });

    it("deve retornar false para segunda-feira às 07:00 (antes do horário)", () => {
      expect(isBusinessHours(mondayEarlyMorning)).toBe(false);
    });

    it("deve retornar false para segunda-feira às 19:00 (depois do horário)", () => {
      expect(isBusinessHours(mondayEvening)).toBe(false);
    });
  });

  describe("getNextBusinessHours", () => {
    it("deve retornar a mesma data se já está em horário comercial", () => {
      const result = getNextBusinessHours(mondayMorning);
      expect(result.getTime()).toBe(mondayMorning.getTime());
    });

    it("deve retornar segunda-feira às 8h se for domingo", () => {
      const result = getNextBusinessHours(sundayMorning);
      expect(result.getDay()).toBe(1); // Segunda
      expect(result.getHours()).toBe(8);
    });

    it("deve retornar segunda-feira às 8h se for sábado", () => {
      const result = getNextBusinessHours(saturdayMorning);
      expect(result.getDay()).toBe(1); // Segunda
      expect(result.getHours()).toBe(8);
    });

    it("deve retornar mesmo dia às 8h se for antes do horário", () => {
      const result = getNextBusinessHours(mondayEarlyMorning);
      expect(result.getDay()).toBe(1); // Segunda
      expect(result.getHours()).toBe(8);
    });

    it("deve retornar próximo dia útil às 8h se for depois do horário", () => {
      const result = getNextBusinessHours(mondayEvening);
      expect(result.getDay()).toBe(2); // Terça
      expect(result.getHours()).toBe(8);
    });

    it("deve retornar segunda-feira às 8h se for sexta-feira depois do horário", () => {
      const fridayEvening = new Date(2026, 1, 13, 19, 0, 0);
      const result = getNextBusinessHours(fridayEvening);
      expect(result.getDay()).toBe(1); // Segunda
      expect(result.getHours()).toBe(8);
    });
  });

  describe("getMinutesUntilBusinessHours", () => {
    it("deve retornar 0 se já está em horário comercial", () => {
      expect(getMinutesUntilBusinessHours(mondayMorning)).toBe(0);
    });

    it("deve retornar valor positivo se fora do horário", () => {
      const minutes = getMinutesUntilBusinessHours(mondayEarlyMorning);
      expect(minutes).toBeGreaterThan(0);
      expect(minutes).toBeLessThanOrEqual(60); // Menos de 1 hora
    });
  });

  describe("formatNextSendTime", () => {
    it("deve retornar mensagem de agora se está em horário comercial", () => {
      const result = formatNextSendTime(mondayMorning);
      expect(result).toContain("Agora");
    });

    it("deve retornar mensagem com tempo futuro se fora do horário", () => {
      const result = formatNextSendTime(mondayEarlyMorning);
      expect(result).toContain("Em");
    });
  });

  describe("getBusinessHoursInfo", () => {
    it("deve retornar informações corretas", () => {
      const info = getBusinessHoursInfo();
      expect(info.schedule).toBe("8h às 18h");
      expect(info.days).toContain("Segunda");
      expect(info.days).toContain("Sexta");
      expect(info.timezone).toBe("America/Sao_Paulo");
    });
  });
});
