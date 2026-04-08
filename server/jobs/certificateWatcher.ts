/**
 * Certificate Watcher — Monitora a pasta de certificados e dispara sync automático
 *
 * Monitora /data/certificados por novos arquivos .pfx/.p12
 * Dispara syncCertificatesToSieg() com debounce para evitar múltiplos disparos
 */

import { watch } from "fs";
import { join } from "path";

import { syncCertificatesToSieg } from "./syncCertificatesToSieg";

const CERTIFICATES_PATH = process.env.CERTIFICATES_PATH || "/data/certificados";
const DEBOUNCE_MS = 2000; // Aguarda 2s sem mudanças antes de disparar

let debounceTimer: NodeJS.Timeout | null = null;
let isWatcherActive = false;

export function startCertificateWatcher() {
  if (isWatcherActive) {
    console.warn("[CertificateWatcher] Watcher já está ativo");
    return;
  }

  try {
    const watcher = watch(CERTIFICATES_PATH, async (eventType, filename) => {
      // Ignorar arquivos temporários e não-certificados
      if (!filename || !filename.match(/\.(pfx|p12)$/i)) {
        return;
      }

      console.log(`[CertificateWatcher] Detectado evento '${eventType}' no arquivo: ${filename}`);

      // Limpar debounce anterior
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      // Disparar sync após debounce
      debounceTimer = setTimeout(async () => {
        console.log("[CertificateWatcher] 🔐 Disparando sincronização automática após detecção de novo certificado");
        try {
          const result = await syncCertificatesToSieg();
          if (result.success) {
            console.log(`[CertificateWatcher] ✅ Sincronização concluída: sent=${result.stats.sent}, failed=${result.stats.failed}`);
          } else {
            console.error(`[CertificateWatcher] ❌ Sincronização falhou: ${result.message}`);
          }
        } catch (error) {
          console.error(`[CertificateWatcher] ❌ Erro ao sincronizar: ${error instanceof Error ? error.message : String(error)}`);
        }
        debounceTimer = null;
      }, DEBOUNCE_MS);
    });

    watcher.on("error", (error) => {
      console.error(`[CertificateWatcher] Erro ao monitorar pasta: ${error instanceof Error ? error.message : String(error)}`);
    });

    isWatcherActive = true;
    console.log(`[CertificateWatcher] ✅ Watcher ativo para ${CERTIFICATES_PATH}`);

    // Retornar função para parar o watcher
    return () => {
      watcher.close();
      isWatcherActive = false;
      if (debounceTimer) clearTimeout(debounceTimer);
      console.log("[CertificateWatcher] Watcher parado");
    };
  } catch (error) {
    console.error(`[CertificateWatcher] Falha ao iniciar watcher: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export function stopCertificateWatcher() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  isWatcherActive = false;
  console.log("[CertificateWatcher] Watcher parado");
}

export function isCertificateWatcherActive(): boolean {
  return isWatcherActive;
}
