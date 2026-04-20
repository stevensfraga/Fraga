import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Bot,
  MessageCircle,
  ArrowRightLeft,
  Users,
  Activity,
  RefreshCw,
  CheckCircle2,
  XCircle,
  BarChart3,
  Trash2,
} from 'lucide-react';

// ─── TIPOS ────────────────────────────────────────────────────────────────────

interface StatusData {
  enabled: boolean;
  model: string;
  activeConversations: number;
  totalConversations: number;
  queues: Record<string, string>;
}

interface LogEntry {
  id: number;
  fromPhone: string;
  clientName: string | null;
  clientId: number | null;
  intent: string;
  response: string;
  handoffToHuman: boolean;
  handoffReason: string | null;
  correlationId: string;
  createdAt: string;
  meta: {
    source: string;
    userText: string;
    shouldTransfer: boolean;
    targetQueueId: number | null;
    targetQueueName: string | null;
    reasoning: string;
  };
}

interface StatsData {
  total: number;
  today: number;
  transfers: number;
  queueBreakdown: Array<{ queueName: string; count: number }>;
  liveConversations: { activeConversations: number };
}

// ─── CORES POR SETOR ──────────────────────────────────────────────────────────

const QUEUE_COLORS: Record<string, string> = {
  'Financeiro': 'bg-green-100 text-green-800',
  'Setor Fiscal': 'bg-blue-100 text-blue-800',
  'Departamento Pessoal': 'bg-purple-100 text-purple-800',
  'Nota Fiscal': 'bg-yellow-100 text-yellow-800',
  'Certificado Digital': 'bg-orange-100 text-orange-800',
  'IRPF / Imposto de Renda': 'bg-red-100 text-red-800',
  'Comercial': 'bg-pink-100 text-pink-800',
  'Fale com Contador': 'bg-indigo-100 text-indigo-800',
  'Cobrança': 'bg-gray-100 text-gray-800',
};

function queueColor(name: string | null): string {
  if (!name) return 'bg-gray-100 text-gray-600';
  for (const [key, color] of Object.entries(QUEUE_COLORS)) {
    if (name.includes(key)) return color;
  }
  return 'bg-slate-100 text-slate-700';
}

function formatPhone(phone: string): string {
  const d = phone.replace(/\D/g, '');
  if (d.length === 13) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  return phone;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min}min atrás`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.floor(h / 24)}d atrás`;
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────

export default function SecretariaVirtual() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterPhone, setFilterPhone] = useState('');
  const [resetPhone, setResetPhone] = useState('');
  const [resetMsg, setResetMsg] = useState('');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, statsRes, logsRes] = await Promise.all([
        fetch('/api/claude-secretary/status'),
        fetch('/api/claude-secretary/stats'),
        fetch(`/api/claude-secretary/logs?limit=50${filterPhone ? `&phone=${filterPhone}` : ''}`),
      ]);
      if (statusRes.ok) setStatus(await statusRes.json());
      if (statsRes.ok) setStats(await statsRes.json());
      if (logsRes.ok) {
        const data = await logsRes.json();
        setLogs(data.data || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [filterPhone]);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 30000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const handleResetConversation = async () => {
    if (!resetPhone.trim()) return;
    try {
      const res = await fetch('/api/claude-secretary/reset-conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: resetPhone.trim() }),
      });
      const data = await res.json();
      setResetMsg(data.cleared ? `✅ Conversa de ${resetPhone} limpa` : `⚠️ Nenhuma conversa ativa para ${resetPhone}`);
      setTimeout(() => setResetMsg(''), 4000);
    } catch {
      setResetMsg('❌ Erro ao limpar conversa');
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-100 rounded-lg">
            <Bot className="h-6 w-6 text-purple-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Secretária Virtual</h1>
            <p className="text-sm text-gray-500">Powered by Claude (Anthropic) · {status?.model || '—'}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {status && (
            <div className="flex items-center gap-2">
              {status.enabled ? (
                <span className="flex items-center gap-1.5 text-sm font-medium text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded-full">
                  <CheckCircle2 className="h-4 w-4" /> Ativa
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-sm font-medium text-gray-500 bg-gray-50 border border-gray-200 px-3 py-1.5 rounded-full">
                  <XCircle className="h-4 w-4" /> Inativa
                </span>
              )}
            </div>
          )}
          <Button variant="outline" size="sm" onClick={fetchAll} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Status de ativação */}
      {status && !status.enabled && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <p className="text-sm text-amber-800 font-medium">⚠️ Secretária Virtual está desativada</p>
          <p className="text-sm text-amber-700 mt-1">
            Para ativar, defina <code className="bg-amber-100 px-1 rounded">CLAUDE_SECRETARY_ENABLED=true</code> no <code className="bg-amber-100 px-1 rounded">.env</code> do servidor e reinicie o PM2.
          </p>
        </div>
      )}

      {/* Cards de stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <MessageCircle className="h-8 w-8 text-blue-500 shrink-0" />
            <div>
              <p className="text-2xl font-bold">{stats?.total ?? '—'}</p>
              <p className="text-xs text-gray-500">Total de atendimentos</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Activity className="h-8 w-8 text-green-500 shrink-0" />
            <div>
              <p className="text-2xl font-bold">{stats?.today ?? '—'}</p>
              <p className="text-xs text-gray-500">Hoje</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <ArrowRightLeft className="h-8 w-8 text-purple-500 shrink-0" />
            <div>
              <p className="text-2xl font-bold">{stats?.transfers ?? '—'}</p>
              <p className="text-xs text-gray-500">Transferências</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Users className="h-8 w-8 text-orange-500 shrink-0" />
            <div>
              <p className="text-2xl font-bold">{status?.activeConversations ?? '—'}</p>
              <p className="text-xs text-gray-500">Conversas ativas</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Breakdown por setor + Reset */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Transferências por setor */}
        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="h-4 w-4" /> Transferências por setor
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats?.queueBreakdown && stats.queueBreakdown.length > 0 ? (
              <div className="space-y-2">
                {stats.queueBreakdown.map((item) => {
                  const maxCount = Math.max(...stats.queueBreakdown.map(q => Number(q.count)));
                  const pct = Math.round((Number(item.count) / maxCount) * 100);
                  return (
                    <div key={item.queueName} className="flex items-center gap-2">
                      <span className="text-xs text-gray-600 w-40 shrink-0 truncate">{item.queueName || 'Sem setor'}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-2">
                        <div className="bg-purple-500 h-2 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs font-medium text-gray-700 w-6 text-right">{item.count}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-4">Nenhuma transferência registrada</p>
            )}
          </CardContent>
        </Card>

        {/* Reset de conversa */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Trash2 className="h-4 w-4" /> Limpar conversa
            </CardTitle>
            <CardDescription className="text-xs">
              Apaga o histórico em memória de um cliente (reinicia contexto)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input
              placeholder="+5527981657804"
              value={resetPhone}
              onChange={e => setResetPhone(e.target.value)}
              className="text-sm"
            />
            <Button size="sm" variant="outline" className="w-full" onClick={handleResetConversation}>
              Limpar
            </Button>
            {resetMsg && <p className="text-xs text-center text-gray-600">{resetMsg}</p>}
          </CardContent>
        </Card>
      </div>

      {/* Logs de conversas */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MessageCircle className="h-4 w-4" /> Histórico de atendimentos
              </CardTitle>
              <CardDescription>Últimas interações da Secretária Virtual</CardDescription>
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Filtrar por telefone..."
                value={filterPhone}
                onChange={e => setFilterPhone(e.target.value)}
                className="w-44 text-sm"
              />
              <Button size="sm" variant="outline" onClick={fetchAll}>
                Buscar
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="text-center py-10 text-gray-400 text-sm">Carregando...</div>
          ) : logs.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">
              Nenhum atendimento registrado ainda
            </div>
          ) : (
            <div className="divide-y">
              {logs.map(log => (
                <div key={log.id} className="p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {/* Linha 1: telefone + cliente + badge */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-gray-900">
                          {formatPhone(log.fromPhone)}
                        </span>
                        {log.clientName && (
                          <span className="text-xs text-gray-500">· {log.clientName}</span>
                        )}
                        {log.handoffToHuman ? (
                          <Badge className={`text-xs px-2 py-0 ${queueColor(log.handoffReason)}`}>
                            <ArrowRightLeft className="h-3 w-3 mr-1" />
                            {log.handoffReason || 'Transferido'}
                          </Badge>
                        ) : (
                          <Badge className="text-xs px-2 py-0 bg-blue-50 text-blue-700">
                            <Bot className="h-3 w-3 mr-1" />
                            Respondido
                          </Badge>
                        )}
                        <span className="text-xs text-gray-400 ml-auto">{timeAgo(log.createdAt)}</span>
                      </div>

                      {/* Linha 2: mensagem do cliente */}
                      {log.meta?.userText && (
                        <p className="text-xs text-gray-500 mt-1 italic">
                          Cliente: "{log.meta.userText.substring(0, 120)}{log.meta.userText.length > 120 ? '…' : ''}"
                        </p>
                      )}

                      {/* Linha 3: resposta do Claude */}
                      {log.response && (
                        <p className="text-xs text-gray-700 mt-1 bg-purple-50 rounded px-2 py-1">
                          Frag-IA: "{log.response.substring(0, 150)}{log.response.length > 150 ? '…' : ''}"
                        </p>
                      )}

                      {/* Reasoning */}
                      {log.meta?.reasoning && (
                        <p className="text-xs text-gray-400 mt-1">
                          💭 {log.meta.reasoning}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Setores disponíveis */}
      {status?.queues && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Setores configurados</CardTitle>
            <CardDescription className="text-xs">
              Departamentos para onde a Frag-IA pode direcionar clientes
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {Object.entries(status.queues).map(([id, name]) => (
                <span key={id} className={`text-xs px-2 py-1 rounded-full font-medium ${queueColor(name)}`}>
                  #{id} · {name}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
