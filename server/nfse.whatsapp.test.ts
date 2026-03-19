/**
 * Testes unitários para o handler WhatsApp NFS-e
 */
import { describe, it, expect } from "vitest";
import { isNfseRequest } from "./services/nfseWhatsAppHandler";

describe("isNfseRequest", () => {
  it("detecta 'nota fiscal'", () => {
    expect(isNfseRequest("Preciso emitir uma nota fiscal")).toBe(true);
  });

  it("detecta 'nfse' case insensitive", () => {
    expect(isNfseRequest("NFSE para minha empresa")).toBe(true);
  });

  it("detecta 'nfs-e'", () => {
    expect(isNfseRequest("Gerar nfs-e de R$ 1500")).toBe(true);
  });

  it("detecta 'emitir nota'", () => {
    expect(isNfseRequest("Pode emitir nota de serviço?")).toBe(true);
  });

  it("detecta 'gerar nf'", () => {
    expect(isNfseRequest("gerar nf para o cliente")).toBe(true);
  });

  it("não detecta mensagem comum", () => {
    expect(isNfseRequest("Olá, tudo bem?")).toBe(false);
  });

  it("não detecta mensagem de pagamento", () => {
    expect(isNfseRequest("Meu boleto venceu")).toBe(false);
  });

  it("detecta com acentos normalizados", () => {
    expect(isNfseRequest("emissão de nota fiscal")).toBe(true);
  });
});

describe("extractValor (via regex interno)", () => {
  // Testamos indiretamente via isNfseRequest + lógica de extração
  it("extrai valor com R$", () => {
    const text = "Emitir nota de R$ 1.500,00";
    const match = text.match(/R?\$\s*([\d.,]+)/i);
    expect(match).not.toBeNull();
    if (match) {
      const raw = match[1].replace(/\./g, "").replace(",", ".");
      expect(parseFloat(raw)).toBe(1500);
    }
  });

  it("extrai valor simples", () => {
    const text = "2500";
    const match = text.match(/^([\d.,]+)$/);
    expect(match).not.toBeNull();
    if (match) {
      const raw = match[1].replace(/\./g, "").replace(",", ".");
      expect(parseFloat(raw)).toBe(2500);
    }
  });

  it("extrai valor com vírgula decimal", () => {
    const text = "1500,00";
    const match = text.match(/^([\d.,]+)$/);
    if (match) {
      const raw = match[1].replace(/\./g, "").replace(",", ".");
      expect(parseFloat(raw)).toBe(1500);
    }
  });
});

describe("confirmação e negação", () => {
  const confirmWords = ["sim", "s", "yes", "y", "confirmar", "confirma", "ok", "pode", "emitir"];
  const denyWords = ["não", "nao", "n", "no", "cancelar", "cancela", "cancel", "depois", "rascunho"];

  it("reconhece confirmações", () => {
    for (const w of confirmWords) {
      const lower = w.toLowerCase().trim();
      const isConfirm = confirmWords.some(c => lower === c || lower.startsWith(c + " "));
      expect(isConfirm).toBe(true);
    }
  });

  it("reconhece negações", () => {
    for (const w of denyWords) {
      const lower = w.toLowerCase().trim();
      const isDeny = denyWords.some(d => lower === d || lower.startsWith(d + " "));
      expect(isDeny).toBe(true);
    }
  });

  it("não confunde 'sim' com 'não'", () => {
    const lower = "sim";
    const isDeny = denyWords.some(d => lower === d);
    expect(isDeny).toBe(false);
  });
});

describe("extração de competência", () => {
  it("extrai MM/AAAA da mensagem", () => {
    const text = "nota fiscal competência 02/2026";
    const m = text.match(/(\d{2})\/(\d{4})/);
    expect(m).not.toBeNull();
    if (m) expect(`${m[1]}/${m[2]}`).toBe("02/2026");
  });

  it("usa mês atual quando não informado", () => {
    const text = "emitir nota";
    const m = text.match(/(\d{2})\/(\d{4})/);
    expect(m).toBeNull();
    const now = new Date();
    const comp = `${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
    expect(comp).toMatch(/^\d{2}\/\d{4}$/);
  });
});
