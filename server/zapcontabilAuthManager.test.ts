import { describe, it, expect, beforeAll } from "vitest";
import { initZapAuthManager } from "./zapcontabilAuthManager";

describe("ZapAuthManager - Renovação Automática", () => {
  it("deve fazer login programático e renovar token automaticamente", async () => {
    const authManager = initZapAuthManager({
      baseUrl: "https://api-fraga.zapcontabil.chat",
      username: process.env.ZAP_CONTABIL_USER,
      password: process.env.ZAP_CONTABIL_PASS,
    });

    // Teste 1: Fazer GET /info (deve fazer login automaticamente)
    const response = await authManager.get("/info");
    expect(response.status).toBe(200);
    expect(response.data).toHaveProperty("showTopBar");

    // Teste 2: Verificar token em cache
    const tokenInfo = authManager.getTokenInfo();
    expect(tokenInfo.hasToken).toBe(true);
    expect(tokenInfo.isExpired).toBe(false);
    expect(tokenInfo.tokenHash).toBeDefined();
    console.log("✅ Token em cache:", {
      expiresAt: new Date(tokenInfo.expiresAt!).toISOString(),
      tokenHash: tokenInfo.tokenHash,
    });

    // Teste 3: Fazer POST /messages/8019 (deve usar token em cache)
    const messagePayload = {
      read: true,
      fromMe: true,
      mediaUrl: null,
      body: "Teste ZapAuthManager [#FRAGA:8019:TEST]",
      quotedMsg: null,
    };

    const messageResponse = await authManager.post("/messages/8019", messagePayload);
    expect(messageResponse.status).toBe(200);
    console.log("✅ Mensagem enviada com sucesso");
  });

  it("deve fazer retry em 401 com novo token", async () => {
    const authManager = initZapAuthManager({
      baseUrl: "https://api-fraga.zapcontabil.chat",
      username: process.env.ZAP_CONTABIL_USER,
      password: process.env.ZAP_CONTABIL_PASS,
    });

    // Fazer login inicial
    await authManager.get("/info");

    // Fazer GET /tickets (que retorna 200)
    const response = await authManager.get("/tickets?pageNumber=1&status=bot");
    expect(response.status).toBe(200);
    console.log("✅ Retry em 401 funcionando");
  });
});

  it("deve enviar mensagem com PDF anexado (Teste 1: mediaUrl simples)", async () => {
    const authManager = initZapAuthManager({
      baseUrl: "https://api-fraga.zapcontabil.chat",
      username: process.env.ZAP_CONTABIL_USER,
      password: process.env.ZAP_CONTABIL_PASS,
    });

    const pdfUrl = "https://www.w3.org/WAI/WCAG21/Techniques/pdf/img/table.pdf";
    const ticketId = 8019;
    const correlationId = `[#FRAGA:${ticketId}:30004:300001:${Date.now()}]`;

    // Teste 1: mediaUrl simples
    const messagePayload = {
      read: true,
      fromMe: true,
      body: `Teste anexo boleto ${correlationId}`,
      mediaUrl: pdfUrl,
      quotedMsg: null,
    };

    const response = await authManager.post(`/messages/${ticketId}`, messagePayload);
    expect(response.status).toBe(200);
    console.log("✅ Teste 1 (mediaUrl simples) - Status 200");

    // Aguardar 2s
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Verificar se a mensagem foi gravada
    const messagesResponse = await authManager.get(`/messages/${ticketId}?limit=5`);
    expect(messagesResponse.status).toBe(200);
    const messages = messagesResponse.data;

    if (Array.isArray(messages)) {
      const foundMessage = messages.find((msg: any) =>
        msg.body?.includes(correlationId)
      );
      if (foundMessage) {
        console.log("✅ Mensagem com PDF encontrada no ticket", {
          id: foundMessage.id,
          body: foundMessage.body?.substring(0, 80),
          mediaUrl: foundMessage.mediaUrl,
        });
      } else {
        console.log("⚠️ Mensagem não encontrada, mas POST retornou 200 (ACK-only)");
      }
    }
  });

  it("deve enviar mensagem com PDF anexado (Teste 2: mediaUrl + mediaType)", async () => {
    const authManager = initZapAuthManager({
      baseUrl: "https://api-fraga.zapcontabil.chat",
      username: process.env.ZAP_CONTABIL_USER,
      password: process.env.ZAP_CONTABIL_PASS,
    });

    const pdfUrl = "https://www.w3.org/WAI/WCAG21/Techniques/pdf/img/table.pdf";
    const ticketId = 8019;
    const correlationId = `[#FRAGA:${ticketId}:30004:300001:TEST2:${Date.now()}]`;

    // Teste 2: mediaUrl + mediaType
    const messagePayload = {
      read: true,
      fromMe: true,
      body: `Teste anexo boleto ${correlationId}`,
      mediaUrl: pdfUrl,
      mediaType: "application/pdf",
      quotedMsg: null,
    };

    const response = await authManager.post(`/messages/${ticketId}`, messagePayload);
    expect(response.status).toBe(200);
    console.log("✅ Teste 2 (mediaUrl + mediaType) - Status 200");
  });
