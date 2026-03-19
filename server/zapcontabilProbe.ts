import axios, { AxiosError } from "axios";
import { createLogger } from "./structuredLogger";

const ZAP_CONTABIL_API_URL = process.env.ZAP_CONTABIL_API_URL || "https://api-fraga.zapcontabil.chat";
const ZAP_CONTABIL_API_KEY = process.env.ZAP_CONTABIL_API_KEY || "";

interface ProbeResult {
  route: string;
  authMode: string;
  statusCode?: number;
  contentType?: string;
  responseBody?: string;
  success: boolean;
  error?: string;
  messageId?: string;
}

async function testRoute(
  route: string,
  payloadKey: "message" | "text",
  authMode: "Bearer" | "X-Api-Key"
): Promise<ProbeResult> {
  const fullUrl = `${ZAP_CONTABIL_API_URL}${route}`;
  const payload = {
    [payloadKey]: "PROBE FRAGA - ignore",
    sendWhatsAccountId: "424637541401104384",
    tenantId: "7700de71-9bff-448d-94ff-a6c48557af81",
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (authMode === "Bearer") {
    headers["Authorization"] = `Bearer ${ZAP_CONTABIL_API_KEY}`;
  } else {
    headers["X-Api-Key"] = ZAP_CONTABIL_API_KEY;
  }

  const result: ProbeResult = {
    route,
    authMode,
    success: false,
  };

  try {
    const response = await axios.post(fullUrl, payload, { headers, timeout: 10000 });

    result.statusCode = response.status;
    result.contentType = response.headers["content-type"];
    result.responseBody = JSON.stringify(response.data).substring(0, 2000);

    // Procurar por messageId em múltiplos formatos
    const messageId =
      response.data?.messageId ||
      response.data?.id ||
      response.data?.message_id ||
      response.data?.jobId ||
      response.data?.requestId ||
      response.headers["x-message-id"];

    if (messageId) {
      result.messageId = messageId;
      result.success = true;
    } else if (response.status >= 200 && response.status < 300) {
      // Status 2xx sem ID = ACK/queued, não é "sent real"
      result.success = false;
      result.error = "ACK_NO_ID (queued, não confirmado)";
    }

    const logger = createLogger(`probe-${Date.now()}`);
    logger.log(`[ProbeTest] ${route} [${authMode}] → ${response.status}`, {
      status: response.status,
      contentType: result.contentType,
    });
  } catch (error) {
    const axiosError = error as AxiosError;
    result.statusCode = axiosError.response?.status;
    result.contentType = axiosError.response?.headers["content-type"] as string;
    result.responseBody = JSON.stringify(axiosError.response?.data).substring(0, 2000);
    result.error = axiosError.message;

    const logger = createLogger(`probe-${Date.now()}`);
    logger.error(`[ProbeTest] ${route} [${authMode}] FAILED`, axiosError, {
      status: result.statusCode,
      contentType: result.contentType,
      errorMessage: axiosError.message,
    });
  }

  return result;
}

export async function runZapContabilProbe() {
  const routes = [
    "/api/send/5527995810001",
    "/api/v1/messages/send",
  ];

  const payloadConfigs = [
    { key: "message" as const, route: "/api/send/5527995810001" },
    { key: "text" as const, route: "/api/send/5527995810001" },
    { key: "message" as const, route: "/api/v1/messages/send" },
    { key: "text" as const, route: "/api/v1/messages/send" },
  ];

  const authModes: ("Bearer" | "X-Api-Key")[] = ["Bearer", "X-Api-Key"];

  const results: ProbeResult[] = [];

  const logger = createLogger(`probe-${Date.now()}`);
  logger.log("[ProbeTest] Starting ZapContábil matrix test...", {});

  for (const { route, key } of payloadConfigs) {
    for (const authMode of authModes) {
      const result = await testRoute(route, key, authMode);
      results.push(result);

      if (result.success) {
        logger.log(`[ProbeTest] ✅ WINNER FOUND!`, {
          status: 200,
        });
      }
    }
  }

  const winner = results.find((r) => r.success);

  return {
    totalTests: results.length,
    successCount: results.filter((r) => r.success).length,
    winner: winner
      ? {
          route: winner.route,
          authMode: winner.authMode,
          messageId: winner.messageId,
        }
      : null,
    allResults: results,
  };
}
