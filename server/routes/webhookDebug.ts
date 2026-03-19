import { Router } from "express";

const router = Router();

// Endpoint de debug que captura TUDO
router.post("/debug", (req, res) => {
  const timestamp = new Date().toISOString();
  
  console.log("\n");
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log(`[WEBHOOK-DEBUG] 🔔 REQUISIÇÃO RECEBIDA EM: ${timestamp}`);
  console.log("═══════════════════════════════════════════════════════════════════");
  
  console.log("\n📋 HEADERS:");
  console.log(JSON.stringify(req.headers, null, 2));
  
  console.log("\n📦 BODY:");
  console.log(JSON.stringify(req.body, null, 2));
  
  console.log("\n🔗 QUERY PARAMS:");
  console.log(JSON.stringify(req.query, null, 2));
  
  console.log("\n📍 URL COMPLETA:");
  console.log(`${req.protocol}://${req.get("host")}${req.originalUrl}`);
  
  console.log("\n📊 MÉTODO:");
  console.log(req.method);
  
  console.log("\n🌐 IP DO CLIENTE:");
  console.log(req.ip || req.connection.remoteAddress);
  
  console.log("═══════════════════════════════════════════════════════════════════\n");
  
  // Responder com sucesso
  res.status(200).json({
    success: true,
    message: "Webhook capturado com sucesso",
    timestamp,
    receivedAt: new Date().getTime()
  });
});

export const webhookDebugRouter = router;
export default router;
