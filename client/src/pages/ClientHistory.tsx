import { useParams, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, MessageCircle, Phone, Mail, Calendar, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useEffect, useState } from "react";
import axios from "axios";
import { HistoryFilters, FilterOptions } from "@/components/HistoryFilters";
import { trpc } from "@/lib/trpc";

interface ClientData {
  id: string;
  nome: string;
  email: string;
  telefone: string;
  municipio: string;
  estado: string;
  valor_atraso: number;
  dias_atraso: number;
  faixa: string;
  num_parcelas: number;
  vencimento_mais_antigo: string;
}

interface Message {
  id: string;
  clientId: string;
  messageType: "friendly" | "administrative" | "formal";
  message: string;
  sentAt: Date;
  status: "sent" | "delivered" | "read" | "failed";
  response?: string;
  respondedAt?: Date;
}

export default function ClientHistory() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const [clientData, setClientData] = useState<ClientData | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [filteredMessages, setFilteredMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<FilterOptions>({});

  // Buscar histórico real via tRPC
  const { data: historyData, isLoading: historyLoading } = trpc.collection.getMessageHistory.useQuery(
    { clientId: parseInt(id || "0") },
    { enabled: !!id }
  );

  useEffect(() => {
    if (!id) return;

    const loadData = async () => {
      try {
        setLoading(true);
        // Buscar dados do cliente
        try {
          const response = await axios.get("/clientes-atraso.json");
          const data = response.data;
          const clients = data.clientes || data;
          const client = clients.find((c: any) => c.id === id);

          if (client) {
            setClientData(client);
          }
        } catch (error) {
          console.error("Erro ao buscar dados do cliente:", error);
        }
      } catch (error) {
        console.error("Erro ao carregar dados:", error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [id]);

  // Atualizar mensagens quando histórico for carregado
  useEffect(() => {
    if (historyData && historyData.length > 0) {
      const realMessages: Message[] = historyData.map((h: any) => ({
        id: h.id?.toString() || Math.random().toString(),
        clientId: id || "",
        messageType: h.messageType || "friendly",
        message: h.messageSent || h.messageTemplate || "",
        sentAt: new Date(h.sentAt || Date.now()),
        status: h.status || "sent",
        response: h.responseText,
        respondedAt: h.responseDate ? new Date(h.responseDate) : undefined,
      }));
      setMessages(realMessages);
    } else {
      setMessages([]);
    }
  }, [historyData, id]);

  // Aplicar filtros aos mensagens
  useEffect(() => {
    let filtered = [...messages];

    if (filters.messageType) {
      filtered = filtered.filter((m) => m.messageType === filters.messageType);
    }

    if (filters.startDate) {
      filtered = filtered.filter((m) => m.sentAt >= filters.startDate!);
    }

    if (filters.endDate) {
      const endDate = new Date(filters.endDate);
      endDate.setHours(23, 59, 59, 999);
      filtered = filtered.filter((m) => m.sentAt <= endDate);
    }

    setFilteredMessages(filtered);
  }, [messages, filters]);

  const handleFilterChange = (newFilters: FilterOptions) => {
    setFilters(newFilters);
  };

  if (loading || historyLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">Carregando...</p>
      </div>
    );
  }

  if (!clientData) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-500" />
              Cliente não encontrado
            </CardTitle>
            <CardDescription>O cliente solicitado não existe no sistema.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate("/")} className="w-full">
              Voltar ao Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const stats = {
    total: messages.length,
    sent: messages.filter((m) => m.status === "sent").length,
    delivered: messages.filter((m) => m.status === "delivered").length,
    read: messages.filter((m) => m.status === "read").length,
    responded: messages.filter((m) => m.response).length,
  };

  const messageTypeColors: Record<string, string> = {
    friendly: "bg-green-100 text-green-800",
    administrative: "bg-yellow-100 text-yellow-800",
    formal: "bg-red-100 text-red-800",
  };

  const messageTypeLabels: Record<string, string> = {
    friendly: "🟢 Amigável",
    administrative: "🟡 Administrativa",
    formal: "🔴 Formal",
  };

  const statusColors: Record<string, string> = {
    pending: "bg-gray-100 text-gray-800",
    sent: "bg-blue-100 text-blue-800",
    delivered: "bg-cyan-100 text-cyan-800",
    read: "bg-green-100 text-green-800",
    failed: "bg-red-100 text-red-800",
  };

  const statusLabels: Record<string, string> = {
    pending: "⏳ Pendente",
    sent: "📤 Enviada",
    delivered: "✓ Entregue",
    read: "✓✓ Lida",
    failed: "❌ Falha",
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/")}
            className="h-10 w-10"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">{clientData.nome}</h1>
            <p className="text-muted-foreground">ID: {clientData.id}</p>
          </div>
        </div>

        {/* Client Info */}
        <Card>
          <CardHeader>
            <CardTitle>Informações do Cliente</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Email</p>
                <p className="font-medium">{clientData.email || "N/A"}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Phone className="w-5 h-5 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Telefone</p>
                <p className="font-medium">{clientData.telefone || "N/A"}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-500" />
              <div>
                <p className="text-sm text-muted-foreground">Valor em Atraso</p>
                <p className="font-medium text-red-600">
                  R$ {clientData.valor_atraso?.toFixed(2) || "0,00"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Dias em Atraso</p>
                <p className="font-medium">{clientData.dias_atraso || 0} dias</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Statistics */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-3xl font-bold">{stats.total}</p>
                <p className="text-sm text-muted-foreground">Total de Mensagens</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-3xl font-bold text-blue-600">{stats.sent}</p>
                <p className="text-sm text-muted-foreground">Enviadas</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-3xl font-bold text-cyan-600">{stats.delivered}</p>
                <p className="text-sm text-muted-foreground">Entregues</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-3xl font-bold text-green-600">{stats.read}</p>
                <p className="text-sm text-muted-foreground">Lidas</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-3xl font-bold text-purple-600">{stats.responded}</p>
                <p className="text-sm text-muted-foreground">Respondidas</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filtros */}
        <HistoryFilters onFilterChange={handleFilterChange} isLoading={loading} />

        {/* Messages Timeline */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageCircle className="w-5 h-5" />
              Histórico de Mensagens ({filteredMessages.length})
            </CardTitle>
            <CardDescription>
              Timeline completa de todas as mensagens enviadas e respostas recebidas
            </CardDescription>
          </CardHeader>
          <CardContent>
            {filteredMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <MessageCircle className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
                <p className="text-muted-foreground">Nenhuma mensagem registrada para este cliente.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredMessages.map((message, index) => (
                  <div
                    key={message.id}
                    className="border border-border rounded-lg p-4 hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge className={messageTypeColors[message.messageType]}>
                            {messageTypeLabels[message.messageType]}
                          </Badge>
                          <Badge variant="outline">{statusLabels[message.status]}</Badge>
                          <span className="text-sm text-muted-foreground">
                            {format(message.sentAt, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                          </span>
                        </div>
                        <p className="text-sm mb-3">{message.message}</p>
                        {message.response && (
                          <div className="bg-muted p-3 rounded-md mt-3">
                            <p className="text-xs font-semibold text-muted-foreground mb-1">
                              ✓ Resposta do Cliente:
                            </p>
                            <p className="text-sm">{message.response}</p>
                            {message.respondedAt && (
                              <p className="text-xs text-muted-foreground mt-2">
                                {format(message.respondedAt, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
