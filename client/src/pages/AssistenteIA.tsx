import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { MessageCircle, TrendingUp, Users, AlertCircle } from 'lucide-react';

interface ConversationLog {
  id: number;
  fromPhone: string;
  clientName: string | null;
  clientId: number | null;
  intent: string;
  response: string;
  handoffToHuman: boolean;
  handoffReason: string | null;
  createdAt: string;
}

interface Stats {
  totalInteractions: number;
  handoffCount: number;
  uniquePhones: number;
  uniqueClients: number;
}

interface IntentBreakdown {
  intent: string;
  count: number;
}

const INTENT_COLORS: Record<string, string> = {
  saldo: 'bg-blue-100 text-blue-800',
  link: 'bg-green-100 text-green-800',
  negociar: 'bg-yellow-100 text-yellow-800',
  paguei: 'bg-purple-100 text-purple-800',
  humano: 'bg-red-100 text-red-800',
};

export default function AssistenteIA() {
  const [conversations, setConversations] = useState<ConversationLog[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [intentBreakdown, setIntentBreakdown] = useState<IntentBreakdown[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterPhone, setFilterPhone] = useState('');
  const [filterIntent, setFilterIntent] = useState('');
  const [filterHandoff, setFilterHandoff] = useState('');

  const fetchData = async () => {
    try {
      setLoading(true);

      // Fetch conversations
      const convParams = new URLSearchParams();
      if (filterPhone) convParams.append('phone', filterPhone);
      if (filterIntent) convParams.append('intent', filterIntent);
      if (filterHandoff) convParams.append('handoff', filterHandoff);

      const convRes = await fetch(
        `/api/whatsapp/inbound/conversations?${convParams.toString()}`
      );
      const convData = await convRes.json();
      setConversations(convData.data || []);

      // Fetch stats
      const statsRes = await fetch('/api/whatsapp/inbound/stats');
      const statsData = await statsRes.json();
      setStats(statsData.stats);
      setIntentBreakdown(statsData.intentBreakdown || []);
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // Atualizar a cada 30s
    return () => clearInterval(interval);
  }, [filterPhone, filterIntent, filterHandoff]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold">Assistente IA - Inbound WhatsApp</h1>
        <p className="text-gray-600 mt-2">
          Monitore respostas automáticas a mensagens de clientes sobre dívidas
        </p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                Total de Interações (24h)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-3xl font-bold">{stats.totalInteractions}</div>
                <MessageCircle className="h-8 w-8 text-blue-500 opacity-50" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                Handoffs para Humano
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-3xl font-bold">{stats.handoffCount}</div>
                <AlertCircle className="h-8 w-8 text-red-500 opacity-50" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                Telefones Únicos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-3xl font-bold">{stats.uniquePhones}</div>
                <TrendingUp className="h-8 w-8 text-green-500 opacity-50" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                Clientes Identificados
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-3xl font-bold">{stats.uniqueClients}</div>
                <Users className="h-8 w-8 text-purple-500 opacity-50" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Intent Breakdown */}
      {intentBreakdown.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Distribuição de Intenções (24h)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {intentBreakdown.map((item) => (
                <div key={item.intent} className="text-center">
                  <div className="text-2xl font-bold">{item.count}</div>
                  <div className="text-sm text-gray-600 capitalize">{item.intent}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium">Telefone</label>
              <Input
                placeholder="Filtrar por telefone..."
                value={filterPhone}
                onChange={(e) => setFilterPhone(e.target.value)}
              />
            </div>

            <div>
              <label className="text-sm font-medium">Intenção</label>
              <Select value={filterIntent} onValueChange={setFilterIntent}>
                <SelectTrigger>
                  <SelectValue placeholder="Todas as intenções" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Todas</SelectItem>
                  <SelectItem value="saldo">Saldo</SelectItem>
                  <SelectItem value="link">Link</SelectItem>
                  <SelectItem value="negociar">Negociar</SelectItem>
                  <SelectItem value="paguei">Já Paguei</SelectItem>
                  <SelectItem value="humano">Humano</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium">Handoff</label>
              <Select value={filterHandoff} onValueChange={setFilterHandoff}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Todos</SelectItem>
                  <SelectItem value="true">Com Handoff</SelectItem>
                  <SelectItem value="false">Sem Handoff</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button onClick={fetchData} disabled={loading}>
            {loading ? 'Carregando...' : 'Atualizar'}
          </Button>
        </CardContent>
      </Card>

      {/* Conversations Table */}
      <Card>
        <CardHeader>
          <CardTitle>Conversas Recentes</CardTitle>
          <CardDescription>
            {conversations.length} conversas encontradas
          </CardDescription>
        </CardHeader>
        <CardContent>
          {conversations.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              Nenhuma conversa encontrada
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-2">Telefone</th>
                    <th className="text-left py-2 px-2">Cliente</th>
                    <th className="text-left py-2 px-2">Intenção</th>
                    <th className="text-left py-2 px-2">Resposta</th>
                    <th className="text-left py-2 px-2">Status</th>
                    <th className="text-left py-2 px-2">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {conversations.map((conv) => (
                    <tr key={conv.id} className="border-b hover:bg-gray-50">
                      <td className="py-2 px-2 font-mono text-xs">{conv.fromPhone}</td>
                      <td className="py-2 px-2">
                        {conv.clientName ? (
                          <span>{conv.clientName}</span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="py-2 px-2">
                        <Badge className={INTENT_COLORS[conv.intent] || 'bg-gray-100'}>
                          {conv.intent}
                        </Badge>
                      </td>
                      <td className="py-2 px-2 max-w-xs truncate text-gray-600">
                        {conv.response}
                      </td>
                      <td className="py-2 px-2">
                        {conv.handoffToHuman ? (
                          <Badge variant="destructive">
                            Handoff: {conv.handoffReason || 'N/A'}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Automático</Badge>
                        )}
                      </td>
                      <td className="py-2 px-2 text-xs text-gray-500">
                        {new Date(conv.createdAt).toLocaleString('pt-BR')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info Box */}
      <Card className="bg-blue-50 border-blue-200">
        <CardHeader>
          <CardTitle className="text-blue-900">Como funciona?</CardTitle>
        </CardHeader>
        <CardContent className="text-blue-800 space-y-2 text-sm">
          <p>
            • O assistente IA responde automaticamente a mensagens de clientes sobre dívidas
          </p>
          <p>
            • Detecta intenção: saldo, link de pagamento, negociação, confirmação de pagamento
          </p>
          <p>
            • Faz handoff para humano em casos de: ameaças legais, disputas, cancelamento
          </p>
          <p>
            • Todas as interações são auditadas e registradas no banco de dados
          </p>
          <p>
            • Taxa de limite: 1 resposta por 10 segundos por telefone (anti-spam)
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
