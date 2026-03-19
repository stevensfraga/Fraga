import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, Send, CheckCircle, Clock, Users } from "lucide-react";
import axios from "axios";

interface Client {
  id: string;
  nome: string;
  email: string;
  valor_atraso: number;
  dias_atraso: number;
}

interface BulkSendConfig {
  messageType: "friendly" | "administrative" | "formal";
  minDaysOverdue: number;
  messageTemplate: string;
  selectedClients: string[];
  nextTrigger?: "administrative" | "formal" | "none";
  nextTriggerDays?: number;
}

const MESSAGE_TEMPLATES = {
  friendly: {
    title: "Amigável",
    description: "Primeira abordagem - tom amigável e consultivo",
    default: `Olá, tudo bem?
Estamos fazendo uma revisão interna e identificamos honorários em aberto referentes aos últimos meses.
Gostaria de confirmar se existe alguma pendência ou dificuldade para regularização, para que possamos alinhar da melhor forma e evitar impactos na continuidade dos serviços.
Fico no aguardo do seu retorno.`,
  },
  administrative: {
    title: "Administrativa",
    description: "Segunda abordagem - tom mais formal e administrativo",
    default: `Prezado Cliente,

Segue em anexo a relação de faturas em aberto referentes aos últimos meses.

Solicitamos a regularização do pagamento em até 5 dias úteis.

Qualquer dúvida, estamos à disposição.`,
  },
  formal: {
    title: "Formal",
    description: "Terceira abordagem - tom formal com aviso de consequências",
    default: `AVISO IMPORTANTE

Comunicamos que sua conta será bloqueada em 48 horas se não houver regularização dos pagamentos em aberto.

Para evitar interrupção dos serviços, favor regularizar o pagamento imediatamente.`,
  },
};

export default function BulkSendMessages() {
  const [clients, setClients] = useState<Client[]>([]);
  const [config, setConfig] = useState<BulkSendConfig>({
    messageType: "friendly",
    minDaysOverdue: 30,
    messageTemplate: MESSAGE_TEMPLATES.friendly.default,
    selectedClients: [],
  });
  const [loading, setLoading] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    loadClients();
  }, []);

  const loadClients = async () => {
    try {
      setLoading(true);
      const response = await axios.get("/clientes-atraso.json");
      const data = response.data;
      const clientList = data.clientes || data;
      setClients(clientList);
    } catch (error) {
      console.error("Error loading clients:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleMessageTypeChange = (type: "friendly" | "administrative" | "formal") => {
    setConfig({
      ...config,
      messageType: type,
      messageTemplate: MESSAGE_TEMPLATES[type].default,
    });
  };

  const handleMinDaysChange = (days: number) => {
    setConfig({ ...config, minDaysOverdue: days });
  };

  const handleClientToggle = (clientId: string) => {
    setConfig({
      ...config,
      selectedClients: config.selectedClients.includes(clientId)
        ? config.selectedClients.filter((id) => id !== clientId)
        : [...config.selectedClients, clientId],
    });
  };

  const handleSelectAll = () => {
    if (config.selectedClients.length === filteredClients.length) {
      setConfig({ ...config, selectedClients: [] });
    } else {
      setConfig({
        ...config,
        selectedClients: filteredClients.map((c) => c.id),
      });
    }
  };

  const handleSend = async () => {
    if (config.selectedClients.length === 0) {
      alert("Selecione pelo menos um cliente");
      return;
    }

    setSending(true);
    try {
      // Simular envio em lote
      for (const clientId of config.selectedClients) {
        await axios.post("/api/trpc/collection.sendCollectionMessage", {
          clientId,
          messageType: config.messageType,
          message: config.messageTemplate,
        });
      }

      alert(`✅ ${config.selectedClients.length} mensagens enviadas com sucesso!`);
      setConfig({ ...config, selectedClients: [] });
      setShowPreview(false);
    } catch (error) {
      console.error("Error sending messages:", error);
      alert("Erro ao enviar mensagens");
    } finally {
      setSending(false);
    }
  };

  // Filtrar clientes por dias em atraso
  const filteredClients = clients.filter(
    (c) => c.dias_atraso >= config.minDaysOverdue
  );

  const totalValue = filteredClients
    .filter((c) => config.selectedClients.includes(c.id))
    .reduce((sum, c) => sum + c.valor_atraso, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">Carregando clientes...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold">Envio em Lote de Mensagens</h1>
          <p className="text-muted-foreground mt-2">
            Envie mensagens de cobrança para múltiplos clientes com autorização prévia
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Configuração */}
          <div className="lg:col-span-1 space-y-6">
            {/* Tipo de Mensagem */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Tipo de Mensagem</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {Object.entries(MESSAGE_TEMPLATES).map(([key, template]) => (
                  <button
                    key={key}
                    onClick={() => handleMessageTypeChange(key as any)}
                    className={`w-full text-left p-3 rounded-lg border-2 transition ${
                      config.messageType === key
                        ? "border-blue-500 bg-blue-50"
                        : "border-border hover:border-blue-300"
                    }`}
                  >
                    <p className="font-medium">{template.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {template.description}
                    </p>
                  </button>
                ))}
              </CardContent>
            </Card>

            {/* Filtro de Dias em Atraso */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Filtrar por Dias em Atraso</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label>Mínimo de dias em atraso</Label>
                  <Select
                    value={config.minDaysOverdue.toString()}
                    onValueChange={(v) => handleMinDaysChange(parseInt(v))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Qualquer atraso</SelectItem>
                      <SelectItem value="7">7+ dias</SelectItem>
                      <SelectItem value="15">15+ dias</SelectItem>
                      <SelectItem value="30">30+ dias</SelectItem>
                      <SelectItem value="60">60+ dias</SelectItem>
                      <SelectItem value="90">90+ dias</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="bg-blue-50 p-3 rounded-lg">
                  <p className="text-sm font-medium text-blue-900">
                    {filteredClients.length} cliente(s) correspondem aos critérios
                  </p>
                  <p className="text-sm text-blue-800 mt-1">
                    Valor total em atraso: R$ {filteredClients.reduce((sum, c) => sum + c.valor_atraso, 0).toFixed(2)}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Próximo Gatilho */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Próximo Gatilho</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label>Agendar próxima etapa automaticamente?</Label>
                  <Select
                    value={config.nextTrigger || "none"}
                    onValueChange={(v) =>
                      setConfig({
                        ...config,
                        nextTrigger: v === "none" ? undefined : (v as any),
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem gatilho automático</SelectItem>
                      {config.messageType !== "administrative" && (
                        <SelectItem value="administrative">
                          Administrativa (após X dias)
                        </SelectItem>
                      )}
                      {config.messageType !== "formal" && (
                        <SelectItem value="formal">
                          Formal (após X dias)
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>

                {config.nextTrigger && (
                  <div className="space-y-2">
                    <Label>Dias até próxima mensagem</Label>
                    <Input
                      type="number"
                      min="1"
                      max="90"
                      value={config.nextTriggerDays || 5}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          nextTriggerDays: parseInt(e.target.value),
                        })
                      }
                    />
                  </div>
                )}

                {config.nextTrigger && (
                  <div className="bg-amber-50 p-3 rounded-lg">
                    <p className="text-sm text-amber-900">
                      ⏰ Próxima mensagem ({config.nextTrigger}) será enviada automaticamente em {config.nextTriggerDays} dias
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Prévia e Clientes */}
          <div className="lg:col-span-2 space-y-6">
            {/* Prévia da Mensagem */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5" />
                  Prévia da Mensagem
                </CardTitle>
                <CardDescription>
                  Esta é a mensagem que será enviada para os clientes selecionados
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="bg-muted p-4 rounded-lg whitespace-pre-wrap font-mono text-sm">
                  {config.messageTemplate}
                </div>
              </CardContent>
            </Card>

            {/* Seleção de Clientes */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Users className="h-5 w-5" />
                      Selecionar Clientes
                    </CardTitle>
                    <CardDescription>
                      {config.selectedClients.length} de {filteredClients.length} selecionado(s)
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSelectAll}
                  >
                    {config.selectedClients.length === filteredClients.length
                      ? "Desselecionar Todos"
                      : "Selecionar Todos"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {filteredClients.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">
                      Nenhum cliente corresponde aos critérios
                    </p>
                  ) : (
                    filteredClients.map((client) => (
                      <div
                        key={client.id}
                        className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/50"
                      >
                        <Checkbox
                          checked={config.selectedClients.includes(client.id)}
                          onCheckedChange={() => handleClientToggle(client.id)}
                          className="mt-1"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{client.nome}</p>
                          <p className="text-sm text-muted-foreground">
                            {client.dias_atraso} dias em atraso • R$ {client.valor_atraso.toFixed(2)}
                          </p>
                        </div>
                        <Badge variant="outline">
                          {client.dias_atraso}d
                        </Badge>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Resumo e Ação */}
            {config.selectedClients.length > 0 && (
              <Card className="border-blue-200 bg-blue-50">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-blue-600" />
                    Resumo do Envio
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Clientes</p>
                      <p className="text-2xl font-bold">
                        {config.selectedClients.length}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Valor Total</p>
                      <p className="text-2xl font-bold">
                        R$ {totalValue.toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Tipo</p>
                      <p className="text-2xl font-bold">
                        {MESSAGE_TEMPLATES[config.messageType].title}
                      </p>
                    </div>
                  </div>

                  {config.nextTrigger && (
                    <div className="bg-white p-3 rounded-lg border border-blue-200">
                      <p className="text-sm font-medium flex items-center gap-2">
                        <Clock className="h-4 w-4" />
                        Gatilho automático configurado
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Próxima mensagem ({config.nextTrigger}) em {config.nextTriggerDays} dias
                      </p>
                    </div>
                  )}

                  <Button
                    onClick={() => setShowPreview(!showPreview)}
                    variant="outline"
                    className="w-full"
                  >
                    {showPreview ? "Ocultar Confirmação" : "Revisar Antes de Enviar"}
                  </Button>

                  {showPreview && (
                    <Button
                      onClick={handleSend}
                      disabled={sending}
                      className="w-full bg-green-600 hover:bg-green-700"
                    >
                      <Send className="h-4 w-4 mr-2" />
                      {sending
                        ? "Enviando..."
                        : `Confirmar e Enviar ${config.selectedClients.length} Mensagens`}
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
