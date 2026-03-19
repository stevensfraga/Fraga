import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Bell, Mail, MessageCircle, AlertTriangle, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';

interface AlertRule {
  id: string;
  type: 'low_response_rate' | 'low_conversion_rate';
  severity: 'warning' | 'critical';
  stage: 'friendly' | 'administrative' | 'formal';
  threshold: number;
  enabled: boolean;
  notifyEmail: boolean;
  notifyWhatsApp: boolean;
  description: string;
}

const STAGE_LABELS = {
  friendly: '🟢 Amigável',
  administrative: '🟡 Administrativa',
  formal: '🔴 Formal'
};

const DEFAULT_RULES: AlertRule[] = [
  {
    id: 'friendly-response-warning',
    type: 'low_response_rate',
    severity: 'warning',
    stage: 'friendly',
    threshold: 25,
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
    enabled: true,
    notifyEmail: true,
    notifyWhatsApp: true,
    description: 'Taxa de conversão geral abaixo de 10%'
  }
];

export default function AlertSettings() {
  const [rules, setRules] = useState<AlertRule[]>(DEFAULT_RULES);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editThreshold, setEditThreshold] = useState<number>(0);

  const handleToggleRule = (id: string) => {
    setRules(rules.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r));
    toast.success('Regra atualizada');
  };

  const handleToggleNotification = (id: string, channel: 'email' | 'whatsapp') => {
    setRules(rules.map(r => {
      if (r.id === id) {
        return channel === 'email'
          ? { ...r, notifyEmail: !r.notifyEmail }
          : { ...r, notifyWhatsApp: !r.notifyWhatsApp };
      }
      return r;
    }));
  };

  const handleSaveThreshold = (id: string, newThreshold: number) => {
    if (newThreshold < 0 || newThreshold > 100) {
      toast.error('Valor deve estar entre 0 e 100');
      return;
    }
    setRules(rules.map(r => r.id === id ? { ...r, threshold: newThreshold } : r));
    setEditingId(null);
    toast.success('Limite atualizado');
  };

  const responseRateRules = rules.filter(r => r.type === 'low_response_rate');
  const conversionRateRules = rules.filter(r => r.type === 'low_conversion_rate');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">
            ⚙️ Configuração de Alertas
          </h1>
          <p className="text-slate-600">
            Personalize as regras de alerta para receber notificações quando as métricas estiverem abaixo do esperado
          </p>
        </div>

        {/* Notification Channels */}
        <Card className="mb-8 bg-blue-50 border-blue-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-blue-600" />
              Canais de Notificação
            </CardTitle>
            <CardDescription>
              Configure como você deseja receber alertas
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-white rounded border">
              <div className="flex items-center gap-3">
                <Mail className="h-5 w-5 text-blue-600" />
                <div>
                  <p className="font-semibold text-slate-900">Email</p>
                  <p className="text-sm text-slate-600">stevens@fragacontabilidade.com.br</p>
                </div>
              </div>
              <input type="checkbox" defaultChecked className="w-5 h-5" />
            </div>

            <div className="flex items-center justify-between p-4 bg-white rounded border">
              <div className="flex items-center gap-3">
                <MessageCircle className="h-5 w-5 text-green-600" />
                <div>
                  <p className="font-semibold text-slate-900">WhatsApp</p>
                  <p className="text-sm text-slate-600">27 98165-7804</p>
                </div>
              </div>
              <input type="checkbox" defaultChecked className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        {/* Alert Rules */}
        <Tabs defaultValue="response" className="space-y-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="response">Taxa de Resposta</TabsTrigger>
            <TabsTrigger value="conversion">Taxa de Conversão</TabsTrigger>
          </TabsList>

          <TabsContent value="response" className="space-y-4">
            <div className="space-y-4">
              {responseRateRules.map(rule => (
                <Card key={rule.id}>
                  <CardContent className="pt-6">
                    <div className="space-y-4">
                      {/* Rule Header */}
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <input
                              type="checkbox"
                              checked={rule.enabled}
                              onChange={() => handleToggleRule(rule.id)}
                              className="w-4 h-4"
                            />
                            <h3 className="font-semibold text-slate-900">
                              {STAGE_LABELS[rule.stage]}
                            </h3>
                            <span
                              className={`px-2 py-1 rounded text-xs font-semibold ${
                                rule.severity === 'critical'
                                  ? 'bg-red-100 text-red-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {rule.severity === 'critical' ? 'Crítico' : 'Aviso'}
                            </span>
                          </div>
                          <p className="text-sm text-slate-600">
                            {rule.description}
                          </p>
                        </div>
                      </div>

                      {/* Threshold Editor */}
                      <div className="bg-slate-50 p-4 rounded border">
                        <label className="block text-sm font-medium text-slate-900 mb-2">
                          Limite de Alerta: {editingId === rule.id ? '' : `${rule.threshold}%`}
                        </label>
                        {editingId === rule.id ? (
                          <div className="flex gap-2">
                            <Input
                              type="number"
                              min="0"
                              max="100"
                              value={editThreshold}
                              onChange={e => setEditThreshold(Number(e.target.value))}
                              className="flex-1"
                            />
                            <Button
                              size="sm"
                              onClick={() => handleSaveThreshold(rule.id, editThreshold)}
                            >
                              Salvar
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setEditingId(null)}
                            >
                              Cancelar
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingId(rule.id);
                              setEditThreshold(rule.threshold);
                            }}
                          >
                            Editar Limite
                          </Button>
                        )}
                      </div>

                      {/* Notification Channels */}
                      <div className="flex gap-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={rule.notifyEmail}
                            onChange={() => handleToggleNotification(rule.id, 'email')}
                            className="w-4 h-4"
                          />
                          <Mail className="h-4 w-4 text-blue-600" />
                          <span className="text-sm text-slate-700">Email</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={rule.notifyWhatsApp}
                            onChange={() => handleToggleNotification(rule.id, 'whatsapp')}
                            className="w-4 h-4"
                          />
                          <MessageCircle className="h-4 w-4 text-green-600" />
                          <span className="text-sm text-slate-700">WhatsApp</span>
                        </label>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="conversion" className="space-y-4">
            <div className="space-y-4">
              {conversionRateRules.map(rule => (
                <Card key={rule.id}>
                  <CardContent className="pt-6">
                    <div className="space-y-4">
                      {/* Rule Header */}
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <input
                              type="checkbox"
                              checked={rule.enabled}
                              onChange={() => handleToggleRule(rule.id)}
                              className="w-4 h-4"
                            />
                            <h3 className="font-semibold text-slate-900">
                              Taxa de Conversão Geral
                            </h3>
                            <span
                              className={`px-2 py-1 rounded text-xs font-semibold ${
                                rule.severity === 'critical'
                                  ? 'bg-red-100 text-red-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {rule.severity === 'critical' ? 'Crítico' : 'Aviso'}
                            </span>
                          </div>
                          <p className="text-sm text-slate-600">
                            {rule.description}
                          </p>
                        </div>
                      </div>

                      {/* Threshold Editor */}
                      <div className="bg-slate-50 p-4 rounded border">
                        <label className="block text-sm font-medium text-slate-900 mb-2">
                          Limite de Alerta: {editingId === rule.id ? '' : `${rule.threshold}%`}
                        </label>
                        {editingId === rule.id ? (
                          <div className="flex gap-2">
                            <Input
                              type="number"
                              min="0"
                              max="100"
                              value={editThreshold}
                              onChange={e => setEditThreshold(Number(e.target.value))}
                              className="flex-1"
                            />
                            <Button
                              size="sm"
                              onClick={() => handleSaveThreshold(rule.id, editThreshold)}
                            >
                              Salvar
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setEditingId(null)}
                            >
                              Cancelar
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingId(rule.id);
                              setEditThreshold(rule.threshold);
                            }}
                          >
                            Editar Limite
                          </Button>
                        )}
                      </div>

                      {/* Notification Channels */}
                      <div className="flex gap-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={rule.notifyEmail}
                            onChange={() => handleToggleNotification(rule.id, 'email')}
                            className="w-4 h-4"
                          />
                          <Mail className="h-4 w-4 text-blue-600" />
                          <span className="text-sm text-slate-700">Email</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={rule.notifyWhatsApp}
                            onChange={() => handleToggleNotification(rule.id, 'whatsapp')}
                            className="w-4 h-4"
                          />
                          <MessageCircle className="h-4 w-4 text-green-600" />
                          <span className="text-sm text-slate-700">WhatsApp</span>
                        </label>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>

        {/* Save Button */}
        <div className="mt-8 flex gap-4">
          <Button size="lg" className="flex-1">
            <CheckCircle className="h-5 w-5 mr-2" />
            Salvar Configurações
          </Button>
          <Button size="lg" variant="outline" className="flex-1">
            Restaurar Padrões
          </Button>
        </div>

        {/* Info Box */}
        <Card className="mt-8 bg-green-50 border-green-200">
          <CardContent className="pt-6">
            <div className="flex gap-3">
              <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-green-900">Dica</p>
                <p className="text-sm text-green-800 mt-1">
                  Você receberá alertas críticos via WhatsApp para ação imediata e avisos via email para acompanhamento.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
