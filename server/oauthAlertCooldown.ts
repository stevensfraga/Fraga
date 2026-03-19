/**
 * Cooldown simples para alertas OAuth (24h entre notificacoes)
 * Usa memoria local + timestamp para evitar spam
 */

let lastAlertTime = 0;
const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 horas

export function shouldSendOAuthAlert(): boolean {
  const now = Date.now();
  if (now - lastAlertTime > COOLDOWN_MS) {
    lastAlertTime = now;
    return true;
  }
  
  const hoursLeft = Math.ceil((COOLDOWN_MS - (now - lastAlertTime)) / (60 * 60 * 1000));
  console.log(`[OAuthAlertCooldown] Proximo alerta em ~${hoursLeft}h`);
  return false;
}

export function resetAlertCooldown(): void {
  lastAlertTime = 0;
  console.log('[OAuthAlertCooldown] Cooldown resetado');
}
