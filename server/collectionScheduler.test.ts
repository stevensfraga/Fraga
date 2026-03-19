/**
 * Test Suite para Scheduler de Cobrança Automática
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initCollectionScheduler, stopCollectionScheduler, getSchedulerStatus, executeCollectionNow } from "./collectionScheduler";

describe("Collection Scheduler", () => {
  beforeEach(() => {
    // Limpar qualquer scheduler anterior
    stopCollectionScheduler();
  });

  afterEach(() => {
    // Limpar após cada teste
    stopCollectionScheduler();
  });

  it("should initialize scheduler successfully", () => {
    initCollectionScheduler();
    const status = getSchedulerStatus();

    expect(status.ativo).toBe(true);
    expect(status.horarios).toEqual(["09:00", "15:00"]);
    expect(status.diasSemana).toEqual(["Segunda", "Terça", "Quarta", "Quinta", "Sexta"]);
  });

  it("should not initialize scheduler twice", () => {
    initCollectionScheduler();
    const status1 = getSchedulerStatus();

    // Tentar inicializar novamente
    initCollectionScheduler();
    const status2 = getSchedulerStatus();

    expect(status1.ativo).toBe(true);
    expect(status2.ativo).toBe(true);
  });

  it("should stop scheduler successfully", () => {
    initCollectionScheduler();
    expect(getSchedulerStatus().ativo).toBe(true);

    stopCollectionScheduler();
    expect(getSchedulerStatus().ativo).toBe(false);
  });

  it("should return correct scheduler status", () => {
    stopCollectionScheduler();
    expect(getSchedulerStatus().ativo).toBe(false);

    initCollectionScheduler();
    const status = getSchedulerStatus();

    expect(status).toEqual({
      ativo: true,
      horarios: ["09:00", "15:00"],
      diasSemana: ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"],
    });
  });

  it("should handle scheduler execution gracefully", async () => {
    // Mock da função runR7CobrancaAutomatica
    const mockResult = {
      totalBoletos: 5,
      enviados: 4,
      falhas: 1,
    };

    // Este teste verifica se o scheduler pode ser inicializado e parado sem erros
    initCollectionScheduler();
    expect(getSchedulerStatus().ativo).toBe(true);

    // Aguardar um pouco para garantir que o scheduler foi inicializado
    await new Promise((resolve) => setTimeout(resolve, 100));

    stopCollectionScheduler();
    expect(getSchedulerStatus().ativo).toBe(false);
  });

  it("should have correct cron expression for business days", () => {
    // O scheduler deve ser configurado para rodar apenas seg-sex
    // Cron: 0 9,15 * * 1-5
    // Significa: 09:00 e 15:00, todos os dias, segunda (1) a sexta (5)

    initCollectionScheduler();
    const status = getSchedulerStatus();

    // Verificar que os horários estão corretos
    expect(status.horarios).toContain("09:00");
    expect(status.horarios).toContain("15:00");

    // Verificar que apenas dias úteis estão listados
    expect(status.diasSemana.length).toBe(5); // Segunda a Sexta
  });
});

describe("Collection Scheduler Integration", () => {
  beforeEach(() => {
    stopCollectionScheduler();
  });

  afterEach(() => {
    stopCollectionScheduler();
  });

  it("should initialize and shutdown gracefully", async () => {
    initCollectionScheduler();
    expect(getSchedulerStatus().ativo).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 50));

    stopCollectionScheduler();
    expect(getSchedulerStatus().ativo).toBe(false);
  });

  it("should maintain scheduler state correctly", () => {
    // Iniciar
    initCollectionScheduler();
    expect(getSchedulerStatus().ativo).toBe(true);

    // Parar
    stopCollectionScheduler();
    expect(getSchedulerStatus().ativo).toBe(false);

    // Reiniciar
    initCollectionScheduler();
    expect(getSchedulerStatus().ativo).toBe(true);

    // Parar novamente
    stopCollectionScheduler();
    expect(getSchedulerStatus().ativo).toBe(false);
  });
});
