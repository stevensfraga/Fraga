import { describe, it, expect, vi } from "vitest";
import { isNfseRequest } from "./services/nfseWhatsAppHandler";

describe("NFS-e WhatsApp Handler", () => {
  describe("isNfseRequest", () => {
    it("should detect 'nota fiscal' as NFS-e request", () => {
      expect(isNfseRequest("Preciso emitir uma nota fiscal de R$ 1500")).toBe(true);
    });

    it("should detect 'nfs-e' as NFS-e request", () => {
      expect(isNfseRequest("Emitir nfs-e valor 2000")).toBe(true);
    });

    it("should detect 'nfse' as NFS-e request", () => {
      expect(isNfseRequest("nfse para empresa XYZ")).toBe(true);
    });

    it("should detect 'emitir nota' as NFS-e request", () => {
      expect(isNfseRequest("Quero emitir nota para o cliente")).toBe(true);
    });

    it("should detect 'gerar nota' as NFS-e request", () => {
      expect(isNfseRequest("Preciso gerar nota fiscal de serviço")).toBe(true);
    });

    it("should detect 'nota de serviço' as NFS-e request", () => {
      expect(isNfseRequest("Emitir nota de serviço R$ 3000")).toBe(true);
    });

    it("should NOT detect unrelated messages", () => {
      expect(isNfseRequest("Bom dia, preciso de ajuda com o boleto")).toBe(false);
    });

    it("should NOT detect payment-related messages", () => {
      expect(isNfseRequest("Quero pagar minha fatura")).toBe(false);
    });

    it("should NOT detect greeting messages", () => {
      expect(isNfseRequest("Olá, tudo bem?")).toBe(false);
    });

    it("should handle accented characters", () => {
      expect(isNfseRequest("Emissão de nota fiscal eletrônica")).toBe(true);
    });

    it("should be case insensitive", () => {
      expect(isNfseRequest("EMITIR NOTA FISCAL")).toBe(true);
      expect(isNfseRequest("Nota Fiscal")).toBe(true);
    });
  });
});
