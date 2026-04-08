import { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle, AlertTriangle, Bell, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export interface Alert {
  id: string;
  type: 'low_response_rate' | 'low_conversion_rate' | 'high_overdue' | 'stage_performance';
  severity: 'info' | 'warning' | 'critical';
  stage: string;
  currentValue: number;
  threshold: number;
  message: string;
  createdAt: Date;
  actionTaken?: string;
}

interface AlertNotificationsProps {
  alerts: Alert[];
  onDismiss?: (alertId: string) => void;
  onAction?: (alertId: string) => void;
}

export function AlertNotifications({ alerts, onDismiss, onAction }: AlertNotificationsProps) {
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set());

  const handleDismiss = (alertId: string) => {
    setDismissedAlerts(prev => new Set(prev).add(alertId));
    onDismiss?.(alertId);
  };

  const visibleAlerts = alerts.filter(alert => !dismissedAlerts.has(alert.id));

  if (visibleAlerts.length === 0) {
    return null;
  }

  return (
    <div className="fixed top-4 right-4 z-50 space-y-3 max-w-md">
      {visibleAlerts.map(alert => (
        <AlertCard
          key={alert.id}
          alert={alert}
          onDismiss={() => handleDismiss(alert.id)}
          onAction={() => onAction?.(alert.id)}
        />
      ))}
    </div>
  );
}

interface AlertCardProps {
  alert: Alert;
  onDismiss: () => void;
  onAction: () => void;
}

function AlertCard({ alert, onDismiss, onAction }: AlertCardProps) {
  const severityConfig = {
    info: {
      bg: 'bg-blue-50',
      border: 'border-blue-200',
      icon: Bell,
      iconColor: 'text-blue-600',
      title: 'Informação'
    },
    warning: {
      bg: 'bg-amber-50',
      border: 'border-amber-200',
      icon: AlertTriangle,
      iconColor: 'text-amber-600',
      title: 'Aviso'
    },
    critical: {
      bg: 'bg-red-50',
      border: 'border-red-200',
      icon: AlertCircle,
      iconColor: 'text-red-600',
      title: 'Crítico'
    }
  };

  const config = severityConfig[alert.severity];
  const Icon = config.icon;

  return (
    <div className={`${config.bg} border ${config.border} rounded-lg p-4 shadow-lg`}>
      <div className="flex items-start gap-3">
        <Icon className={`h-5 w-5 ${config.iconColor} flex-shrink-0 mt-0.5`} />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-900">
            {config.title}
          </h3>
          <p className="text-sm text-slate-700 mt-1">
            {alert.message}
          </p>
          {alert.actionTaken && (
            <p className="text-xs text-slate-600 mt-2 italic">
              💡 {alert.actionTaken}
            </p>
          )}
          <div className="flex gap-2 mt-3">
            <Button
              size="sm"
              variant="outline"
              onClick={onAction}
              className="text-xs"
            >
              Ver Detalhes
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onDismiss}
              className="text-xs"
            >
              Descartar
            </Button>
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="flex-shrink-0 text-slate-400 hover:text-slate-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// Alert Center Component
interface AlertCenterProps {
  alerts: Alert[];
  onClearAll?: () => void;
}

export function AlertCenter({ alerts, onClearAll }: AlertCenterProps) {
  const criticalCount = alerts.filter(a => a.severity === 'critical').length;
  const warningCount = alerts.filter(a => a.severity === 'warning').length;
  const infoCount = alerts.filter(a => a.severity === 'info').length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">Centro de Alertas</CardTitle>
        {alerts.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onClearAll}
            className="text-xs"
          >
            Limpar Tudo
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <div className="text-center py-8">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-2" />
            <p className="text-slate-600">Nenhum alerta ativo</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary */}
            <div className="grid grid-cols-3 gap-2">
              {criticalCount > 0 && (
                <div className="bg-red-50 border border-red-200 rounded p-2 text-center">
                  <div className="text-lg font-bold text-red-600">{criticalCount}</div>
                  <div className="text-xs text-red-700">Crítico</div>
                </div>
              )}
              {warningCount > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded p-2 text-center">
                  <div className="text-lg font-bold text-amber-600">{warningCount}</div>
                  <div className="text-xs text-amber-700">Aviso</div>
                </div>
              )}
              {infoCount > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded p-2 text-center">
                  <div className="text-lg font-bold text-blue-600">{infoCount}</div>
                  <div className="text-xs text-blue-700">Info</div>
                </div>
              )}
            </div>

            {/* Alert List */}
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {alerts.map(alert => (
                <div
                  key={alert.id}
                  className="p-2 border rounded text-sm hover:bg-slate-50"
                >
                  <div className="flex items-start gap-2">
                    <div
                      className="w-2 h-2 rounded-full mt-1 flex-shrink-0"
                      style={{
                        backgroundColor:
                          alert.severity === 'critical'
                            ? '#ef4444'
                            : alert.severity === 'warning'
                            ? '#f59e0b'
                            : '#3b82f6'
                      }}
                    ></div>
                    <div className="flex-1">
                      <p className="font-medium text-slate-900">{alert.message}</p>
                      <p className="text-xs text-slate-500 mt-1">
                        {new Date(alert.createdAt).toLocaleString('pt-BR')}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
