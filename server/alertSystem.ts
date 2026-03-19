import { getDb } from './db';
import { collectionMessages } from '../drizzle/schema';
import { eq, and, gte, lte } from 'drizzle-orm';

export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertType = 'low_response_rate' | 'low_conversion_rate' | 'high_overdue' | 'stage_performance';

export interface AlertRule {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  stage: 'friendly' | 'administrative' | 'formal';
  threshold: number;
  operator: 'below' | 'above';
  enabled: boolean;
  notifyEmail: boolean;
  notifyWhatsApp: boolean;
  description: string;
}

export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  stage: string;
  currentValue: number;
  threshold: number;
  message: string;
  createdAt: Date;
  resolvedAt?: Date;
  actionTaken?: string;
}

// Default alert rules
export const DEFAULT_ALERT_RULES: AlertRule[] = [
  {
    id: 'friendly-response-warning',
    type: 'low_response_rate',
    severity: 'warning',
    stage: 'friendly',
    threshold: 25,
    operator: 'below',
    enabled: true,
    notifyEmail: true,
    notifyWhatsApp: false,
    description: 'Taxa de resposta da etapa Amigável abaixo de 25%'
  },
  {
    id: 'friendly-response-critical',
    type: 'low_response_rate',
    severity: 'critical',
    stage: 'friendly',
    threshold: 15,
    operator: 'below',
    enabled: true,
    notifyEmail: true,
    notifyWhatsApp: true,
    description: 'Taxa de resposta da etapa Amigável abaixo de 15%'
  },
  {
    id: 'administrative-response-warning',
    type: 'low_response_rate',
    severity: 'warning',
    stage: 'administrative',
    threshold: 30,
    operator: 'below',
    enabled: true,
    notifyEmail: true,
    notifyWhatsApp: false,
    description: 'Taxa de resposta da etapa Administrativa abaixo de 30%'
  },
  {
    id: 'administrative-response-critical',
    type: 'low_response_rate',
    severity: 'critical',
    stage: 'administrative',
    threshold: 20,
    operator: 'below',
    enabled: true,
    notifyEmail: true,
    notifyWhatsApp: true,
    description: 'Taxa de resposta da etapa Administrativa abaixo de 20%'
  },
  {
    id: 'formal-response-warning',
    type: 'low_response_rate',
    severity: 'warning',
    stage: 'formal',
    threshold: 30,
    operator: 'below',
    enabled: true,
    notifyEmail: true,
    notifyWhatsApp: false,
    description: 'Taxa de resposta da etapa Formal abaixo de 30%'
  },
  {
    id: 'formal-response-critical',
    type: 'low_response_rate',
    severity: 'critical',
    stage: 'formal',
    threshold: 20,
    operator: 'below',
    enabled: true,
    notifyEmail: true,
    notifyWhatsApp: true,
    description: 'Taxa de resposta da etapa Formal abaixo de 20%'
  },
  {
    id: 'conversion-warning',
    type: 'low_conversion_rate',
    severity: 'warning',
    stage: 'friendly',
    threshold: 15,
    operator: 'below',
    enabled: true,
    notifyEmail: true,
    notifyWhatsApp: false,
    description: 'Taxa de conversão geral abaixo de 15%'
  },
  {
    id: 'conversion-critical',
    type: 'low_conversion_rate',
    severity: 'critical',
    stage: 'friendly',
    threshold: 10,
    operator: 'below',
    enabled: true,
    notifyEmail: true,
    notifyWhatsApp: true,
    description: 'Taxa de conversão geral abaixo de 10%'
  }
];

export async function evaluateAlerts(metrics: {
  stage: string;
  responseRate: number;
  conversionRate: number;
  totalSent: number;
  responded: number;
}): Promise<Alert[]> {
  const triggeredAlerts: Alert[] = [];

  for (const rule of DEFAULT_ALERT_RULES) {
    if (!rule.enabled) continue;

    let shouldTrigger = false;
    let currentValue = 0;

    if (rule.type === 'low_response_rate' && rule.stage === metrics.stage) {
      currentValue = metrics.responseRate;
      shouldTrigger = rule.operator === 'below' ? currentValue < rule.threshold : currentValue > rule.threshold;
    } else if (rule.type === 'low_conversion_rate') {
      currentValue = metrics.conversionRate;
      shouldTrigger = rule.operator === 'below' ? currentValue < rule.threshold : currentValue > rule.threshold;
    }

    if (shouldTrigger) {
      triggeredAlerts.push({
        id: `${rule.id}-${Date.now()}`,
        type: rule.type,
        severity: rule.severity,
        stage: rule.stage,
        currentValue,
        threshold: rule.threshold,
        message: generateAlertMessage(rule, currentValue, metrics.stage),
        createdAt: new Date(),
        actionTaken: generateRecommendedAction(rule, metrics)
      });
    }
  }

  return triggeredAlerts;
}

function generateAlertMessage(rule: AlertRule, currentValue: number, stage: string): string {
  const stageLabel = {
    friendly: 'Amigável',
    administrative: 'Administrativa',
    formal: 'Formal'
  }[stage] || stage;

  if (rule.type === 'low_response_rate') {
    return `⚠️ Taxa de resposta da etapa ${stageLabel} está em ${currentValue.toFixed(1)}% (limite: ${rule.threshold}%)`;
  } else if (rule.type === 'low_conversion_rate') {
    return `⚠️ Taxa de conversão está em ${currentValue.toFixed(1)}% (limite: ${rule.threshold}%)`;
  }

  return `Alerta: ${rule.description}`;
}

function generateRecommendedAction(rule: AlertRule, metrics: any): string {
  if (rule.type === 'low_response_rate') {
    return `Considere revisar a mensagem da etapa ${rule.stage} ou aumentar a frequência de envios`;
  } else if (rule.type === 'low_conversion_rate') {
    return 'Analise o funil de conversão e identifique gargalos nas etapas';
  }

  return 'Revise as métricas e tome ações corretivas';
}

export function getAlertSeverityColor(severity: AlertSeverity): string {
  switch (severity) {
    case 'info':
      return '#3b82f6'; // blue
    case 'warning':
      return '#f59e0b'; // amber
    case 'critical':
      return '#ef4444'; // red
    default:
      return '#6b7280'; // gray
  }
}

export function getAlertSeverityLabel(severity: AlertSeverity): string {
  switch (severity) {
    case 'info':
      return 'Informação';
    case 'warning':
      return 'Aviso';
    case 'critical':
      return 'Crítico';
    default:
      return 'Desconhecido';
  }
}

export async function saveAlert(alert: Alert): Promise<void> {
  try {
    // Save to database if needed
    // await db.insert(collectionAlerts).values({...alert});
    console.log('[Alert] Saved:', alert.message);
  } catch (error) {
    console.error('[Alert] Error saving alert:', error);
  }
}

export async function getRecentAlerts(limit: number = 10): Promise<Alert[]> {
  // Mock implementation - replace with actual database query
  return [];
}
