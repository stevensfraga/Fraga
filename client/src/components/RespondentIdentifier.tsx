import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Phone, User, Mail, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";

interface RespondentIdentifierProps {
  phoneNumber?: string;
  onClientFound?: (client: any) => void;
}

export default function RespondentIdentifier({ phoneNumber: initialPhone, onClientFound }: RespondentIdentifierProps) {
  const [phoneNumber, setPhoneNumber] = useState(initialPhone || "");
  const [searchType, setSearchType] = useState<"exact" | "pattern">("exact");

  // Busca por telefone exato
  const { data: exactResult, isPending: loadingExact } = trpc.phoneNumber.findByExactPhone.useQuery(
    { phone: phoneNumber },
    { enabled: phoneNumber.length > 0 && searchType === "exact" }
  );

  // Busca por padrão
  const { data: patternResult, isPending: loadingPattern } = trpc.phoneNumber.findByPattern.useQuery(
    { pattern: phoneNumber },
    { enabled: phoneNumber.length > 0 && searchType === "pattern" }
  );

  // Formatar para WhatsApp
  const { data: formatResult } = trpc.phoneNumber.formatForWhatsApp.useQuery(
    { phone: phoneNumber },
    { enabled: phoneNumber.length > 0 }
  );

  const isLoading = loadingExact || loadingPattern;
  const result = searchType === "exact" ? exactResult : patternResult;
  const client = (searchType === "exact" ? exactResult?.client : patternResult?.clients?.[0]) || null;

  const handleSearch = () => {
    if (phoneNumber.trim()) {
      setSearchType("exact");
    }
  };

  const handlePatternSearch = () => {
    if (phoneNumber.trim()) {
      setSearchType("pattern");
    }
  };

  const handleClientSelect = (selectedClient: any) => {
    if (onClientFound) {
      onClientFound(selectedClient);
    }
  };

  return (
    <div className="space-y-4">
      {/* Entrada de Telefone */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            Identificar Respondente
          </CardTitle>
          <CardDescription>
            Digite o número de telefone para identificar o cliente que respondeu
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Digite o número de telefone (ex: 27 99999-9999)"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && handleSearch()}
            />
            <Button onClick={handleSearch} disabled={isLoading || !phoneNumber.trim()}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Buscar"}
            </Button>
          </div>

          {/* Informações de Formatação */}
          {formatResult && (
            <div className="bg-blue-50 p-3 rounded-lg space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Normalizado:</span>
                <code className="font-mono">{formatResult.normalized}</code>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Para WhatsApp:</span>
                <code className="font-mono">{formatResult.formatted}</code>
              </div>
              {formatResult.isValid ? (
                <div className="flex items-center gap-2 text-green-600 mt-2">
                  <CheckCircle className="h-4 w-4" />
                  <span>Número válido para WhatsApp</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-red-600 mt-2">
                  <AlertCircle className="h-4 w-4" />
                  <span>Número inválido</span>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Resultado da Busca */}
      {client && (
        <Card className="border-green-200 bg-green-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-900">
              <CheckCircle className="h-5 w-5 text-green-600" />
              Cliente Identificado
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <User className="h-5 w-5 text-gray-600" />
                <div>
                  <p className="text-sm text-gray-600">Nome</p>
                  <p className="font-semibold">{client.name}</p>
                </div>
              </div>

              {client.email && (
                <div className="flex items-center gap-3">
                  <Mail className="h-5 w-5 text-gray-600" />
                  <div>
                    <p className="text-sm text-gray-600">Email</p>
                    <p className="font-semibold">{client.email}</p>
                  </div>
                </div>
              )}

              {client.whatsappNumber && (
                <div className="flex items-center gap-3">
                  <Phone className="h-5 w-5 text-gray-600" />
                  <div>
                    <p className="text-sm text-gray-600">WhatsApp</p>
                    <p className="font-semibold">{client.whatsappNumber}</p>
                  </div>
                </div>
              )}

              {client.status && (
                <div className="flex items-center gap-3">
                  <div>
                    <p className="text-sm text-gray-600">Status</p>
                    <Badge variant={client.status === "active" ? "default" : "secondary"}>
                      {client.status === "active" ? "Ativo" : "Inativo"}
                    </Badge>
                  </div>
                </div>
              )}
            </div>

            <Button
              onClick={() => handleClientSelect(client)}
              className="w-full"
              variant="default"
            >
              Usar Este Cliente
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Múltiplos Resultados */}
      {patternResult?.clients && patternResult.clients.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>
              {patternResult.clients.length} Cliente(s) Encontrado(s)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {patternResult.clients.map((c: any) => (
                <div
                  key={c.id}
                  className="p-3 border rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => handleClientSelect(c)}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-semibold">{c.name}</p>
                      <p className="text-sm text-gray-600">{c.whatsappNumber || c.phone}</p>
                    </div>
                    <Badge variant={c.status === "active" ? "default" : "secondary"}>
                      {c.status === "active" ? "Ativo" : "Inativo"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Nenhum Resultado */}
      {result && !client && patternResult?.clients?.length === 0 && (
        <Card className="border-red-200 bg-red-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-900">
              <AlertCircle className="h-5 w-5 text-red-600" />
              Cliente Não Encontrado
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-red-800">
              Nenhum cliente encontrado para o número: <code className="font-mono">{phoneNumber}</code>
            </p>
            <Button
              onClick={handlePatternSearch}
              variant="outline"
              className="mt-4"
              disabled={isLoading}
            >
              Tentar Busca por Padrão
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
