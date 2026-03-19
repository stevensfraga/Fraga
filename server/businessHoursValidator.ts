/**
 * Validador de Horário Comercial
 * Verifica se o horário atual está dentro do horário comercial (8h-18h, seg-sex)
 */

export interface BusinessHoursConfig {
  startHour: number; // 8
  endHour: number; // 18
  startDay: number; // 1 (segunda)
  endDay: number; // 5 (sexta)
}

const DEFAULT_CONFIG: BusinessHoursConfig = {
  startHour: 8,
  endHour: 18,
  startDay: 1, // Segunda (0 = domingo)
  endDay: 5, // Sexta
};

/**
 * Verifica se o horário atual é horário comercial
 * @param date Data/hora a verificar (padrão: agora)
 * @param config Configuração de horário comercial
 * @returns true se está dentro do horário comercial
 */
export function isBusinessHours(
  date: Date = new Date(),
  config: BusinessHoursConfig = DEFAULT_CONFIG
): boolean {
  const dayOfWeek = date.getDay(); // 0 = domingo, 1 = segunda, ..., 5 = sexta
  const hour = date.getHours();

  // Verificar se é dia útil (segunda a sexta)
  const isWeekday = dayOfWeek >= config.startDay && dayOfWeek <= config.endDay;

  // Verificar se está dentro do horário
  const isWithinHours = hour >= config.startHour && hour < config.endHour;

  return isWeekday && isWithinHours;
}

/**
 * Calcula a próxima data/hora de horário comercial
 * Se já está em horário comercial, retorna a data atual
 * Se não está, retorna o próximo horário comercial disponível
 */
export function getNextBusinessHours(
  date: Date = new Date(),
  config: BusinessHoursConfig = DEFAULT_CONFIG
): Date {
  const result = new Date(date);

  // Se já está em horário comercial, retorna a mesma data
  if (isBusinessHours(result, config)) {
    return result;
  }

  // Caso contrário, calcula o próximo horário comercial
  const dayOfWeek = result.getDay();
  const hour = result.getHours();

  // Se é fim de semana (sábado ou domingo)
  if (dayOfWeek === 6 || dayOfWeek === 0) {
    // Próximo horário comercial é segunda-feira às 8h
    const daysUntilMonday = dayOfWeek === 6 ? 2 : 1;
    result.setDate(result.getDate() + daysUntilMonday);
    result.setHours(config.startHour, 0, 0, 0);
    return result;
  }

  // Se é dia útil mas fora do horário
  if (hour < config.startHour) {
    // Mesmo dia às 8h
    result.setHours(config.startHour, 0, 0, 0);
    return result;
  }

  if (hour >= config.endHour) {
    // Próximo dia útil às 8h
    const nextDay = dayOfWeek === 5 ? 3 : 1; // Se sexta, pula para segunda
    result.setDate(result.getDate() + nextDay);
    result.setHours(config.startHour, 0, 0, 0);
    return result;
  }

  return result;
}

/**
 * Retorna informações sobre o horário comercial
 */
export function getBusinessHoursInfo(config: BusinessHoursConfig = DEFAULT_CONFIG) {
  const days = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  const startDay = days[config.startDay];
  const endDay = days[config.endDay];

  return {
    schedule: `${config.startHour}h às ${config.endHour}h`,
    days: `${startDay} a ${endDay}`,
    timezone: "America/Sao_Paulo",
  };
}

/**
 * Calcula quantos minutos faltam para o próximo horário comercial
 */
export function getMinutesUntilBusinessHours(
  date: Date = new Date(),
  config: BusinessHoursConfig = DEFAULT_CONFIG
): number {
  if (isBusinessHours(date, config)) {
    return 0;
  }

  const nextBusinessHours = getNextBusinessHours(date, config);
  const diffMs = nextBusinessHours.getTime() - date.getTime();
  return Math.ceil(diffMs / (1000 * 60));
}

/**
 * Formata informações sobre quando será possível enviar a mensagem
 */
export function formatNextSendTime(
  date: Date = new Date(),
  config: BusinessHoursConfig = DEFAULT_CONFIG
): string {
  if (isBusinessHours(date, config)) {
    return "Agora (dentro do horário comercial)";
  }

  const nextTime = getNextBusinessHours(date, config);
  const minutes = getMinutesUntilBusinessHours(date, config);

  if (minutes < 60) {
    return `Em ${minutes} minutos (${nextTime.toLocaleString("pt-BR")})`;
  }

  const hours = Math.ceil(minutes / 60);
  return `Em ${hours} horas (${nextTime.toLocaleString("pt-BR")})`;
}
