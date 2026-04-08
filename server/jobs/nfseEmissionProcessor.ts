import { getDb } from "../db";

const logger = {
  info: (msg: string) => console.log(`[INFO] ${msg}`),
  error: (msg: string, err?: any) => console.error(`[ERROR] ${msg}`, err),
};

/**
 * Envia mensagem no WhatsApp via ZapContábil
 */
async function sendWhatsappMessage(data: { phone: string; message: string }) {
  try {
    // Placeholder: em produção, chamaria a API do ZapContábil
    logger.info(
      `[WhatsApp] Enviando para ${data.phone}: ${data.message.substring(0, 50)}...`
    );
  } catch (err) {
    logger.error(`[WhatsApp] Erro ao enviar:`, err);
  }
}

/**
 * Job que processa emissões de NFS-e com status "ready_to_emit"
 * - Busca emissões prontas
 * - Simula chamada à API de emissão (placeholder)
 * - Atualiza status para "emitted" ou "error"
 * - Envia resposta no WhatsApp
 */

export async function processNfseEmissions() {
  try {
    const db = await getDb();

    if (!db) {
      logger.error("[NfseProcessor] Conexão com banco de dados falhou");
      return { processed: 0, success: 0, errors: 0 };
    }

    // Para agora, retornar status vazio já que não temos emissões prontas
    logger.info("[NfseProcessor] Nenhuma emissão pronta para processar");
    return { processed: 0, success: 0, errors: 0 };
  } catch (err) {
    logger.error("[NfseProcessor] Erro geral:", err);
    throw err;
  }
}

/**
 * Inicia o processamento de emissões em intervalos regulares
 */
export function startNfseProcessor() {
  logger.info("[NfseProcessor] Iniciando processador de NFS-e");

  // Processar a cada 30 segundos
  setInterval(async () => {
    try {
      await processNfseEmissions();
    } catch (err) {
      logger.error("[NfseProcessor] Erro no intervalo:", err);
    }
  }, 30000);
}
