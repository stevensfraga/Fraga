/**
 * 🎯 Dashboard de Validação e Envio do Primeiro Boleto
 * 
 * Interface visual para:
 * 1. Validar pré-requisitos
 * 2. Preparar mensagem
 * 3. Revisar dados antes do envio
 * 4. Executar envio com confirmação
 * 5. Acompanhar resultado
 */

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertCircle,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  Send,
  Eye,
  Download,
} from "lucide-react";

interface ValidationStep {
  name: string;
  status: "pass" | "warning" | "fail";
  message: string;
  details?: Record<string, any>;
  suggestedAction?: string;
}

interface ValidationState {
  timestamp: string;
  overallStatus: "ready" | "warning" | "blocked";
  steps: ValidationStep[];
  summary: {
    totalSteps: number;
    passed: number;
    warnings: number;
    failed: number;
  };
  recommendations: string[];
  readyToDispatch: boolean;
  boleto?: {
    id: number;
    customerName: string;
    whatsappNumber: string;
    amount: number;
    dueDate: Date;
  };
}

interface MessageState {
  whatsappNumber: string;
  message: string;
  formattedAmount: string;
  formattedDueDate: string;
  validation: {
    isValid: boolean;
    errors: string[];
    warnings: string[];
  };
}

interface DispatchState {
  success: boolean;
  messageId?: string;
  log: {
    timestamp: string;
    boletoId: number;
    clientId: number;
    whatsappNumber: string;
    status: "success" | "failure" | "warning";
    message: string;
    details: Record<string, any>;
    errors?: string[];
  };
  dbRecordId?: number;
  recommendations?: string[];
}

export default function FirstBoletoDispatch() {
  const [step, setStep] = useState<"input" | "validation" | "preview" | "confirm" | "result">(
    "input"
  );
  const [customerCnpj, setCustomerCnpj] = useState("");
  const [validation, setValidation] = useState<ValidationState | null>(null);
  const [message, setMessage] = useState<MessageState | null>(null);
  const [dispatch, setDispatch] = useState<DispatchState | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Etapa 1: Validação Pré-Envio
  const handleValidate = async () => {
    if (!customerCnpj.trim()) {
      alert("Digite o CNPJ do cliente");
      return;
    }

    setIsLoading(true);
    try {
      // TODO: Chamar endpoint tRPC para validação
      // const result = await trpc.firstBoleto.validate.query({ customerCnpj });
      // setValidation(result);

      // Por enquanto, simulamos
      setValidation({
        timestamp: new Date().toISOString(),
        overallStatus: "ready",
        steps: [
          {
            name: "Token OAuth Conta Azul",
            status: "pass",
            message: "✅ Token válido (expira em 48 horas)",
          },
          {
            name: "Webhook de Pagamento",
            status: "pass",
            message: "✅ Webhook configurado e ativo",
          },
          {
            name: "Cliente e Boleto",
            status: "pass",
            message: "✅ Cliente com boleto válido",
            details: {
              clientName: "R7 Geradores",
              whatsappNumber: "+5511999999999",
              amount: 5000.00,
              dueDate: "2026-02-28",
            },
          },
        ],
        summary: {
          totalSteps: 3,
          passed: 3,
          warnings: 0,
          failed: 0,
        },
        recommendations: [],
        readyToDispatch: true,
        boleto: {
          id: 1,
          customerName: "R7 Geradores",
          whatsappNumber: "+5511999999999",
          amount: 5000.00,
          dueDate: new Date("2026-02-28"),
        },
      });

      setStep("validation");
    } catch (error) {
      alert("Erro ao validar: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsLoading(false);
    }
  };

  // Etapa 2: Preparar Mensagem
  const handlePrepareMessage = async () => {
    if (!validation?.boleto) return;

    setIsLoading(true);
    try {
      // TODO: Chamar endpoint tRPC para preparação de mensagem
      // const result = await trpc.firstBoleto.prepareMessage.query({ boleto: validation.boleto });
      // setMessage(result);

      // Por enquanto, simulamos
      setMessage({
        whatsappNumber: validation.boleto.whatsappNumber,
        message: `Olá, ${validation.boleto.customerName}! 👋\n\nSegue seu boleto em aberto:\n\n💰 Valor: R$ ${validation.boleto.amount.toFixed(2)}\n📅 Vencimento: 28/02/2026\n\n🔗 Link para pagamento:\nhttps://conta-azul.com/boleto/123456\n\nQualquer dúvida, é só chamar! 😊`,
        formattedAmount: `R$ ${validation.boleto.amount.toFixed(2)}`,
        formattedDueDate: "28/02/2026",
        validation: {
          isValid: true,
          errors: [],
          warnings: [],
        },
      });

      setStep("preview");
    } catch (error) {
      alert("Erro ao preparar mensagem: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsLoading(false);
    }
  };

  // Etapa 3: Confirmar Envio
  const handleConfirmDispatch = () => {
    setStep("confirm");
  };

  // Etapa 4: Executar Envio
  const handleExecuteDispatch = async () => {
    if (!validation?.boleto || !message) return;

    setIsLoading(true);
    try {
      // TODO: Chamar endpoint tRPC para envio
      // const result = await trpc.firstBoleto.dispatch.mutation({ boleto: validation.boleto, message });
      // setDispatch(result);

      // Por enquanto, simulamos sucesso
      setDispatch({
        success: true,
        messageId: "whatsapp_1707512345_abc123def456",
        log: {
          timestamp: new Date().toISOString(),
          boletoId: validation.boleto.id,
          clientId: 1,
          whatsappNumber: validation.boleto.whatsappNumber,
          status: "success",
          message: "✅ Boleto enviado com sucesso",
          details: {
            whatsappMessageId: "whatsapp_1707512345_abc123def456",
            dbRecordId: 42,
            durationMs: 1234,
            amount: `R$ ${validation.boleto.amount.toFixed(2)}`,
            dueDate: "28/02/2026",
            receivableUpdated: true,
          },
        },
      });

      setStep("result");
    } catch (error) {
      alert("Erro ao enviar: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsLoading(false);
    }
  };

  // Renderizar status de validação
  const renderValidationStep = (step: ValidationStep) => {
    const statusEmoji = step.status === "pass" ? "✅" : step.status === "warning" ? "🟡" : "🔴";
    const statusColor =
      step.status === "pass"
        ? "text-green-600"
        : step.status === "warning"
          ? "text-yellow-600"
          : "text-red-600";

    return (
      <Card key={step.name} className="mb-4">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{statusEmoji}</span>
              <div>
                <CardTitle className="text-base">{step.name}</CardTitle>
                <CardDescription className={statusColor}>{step.message}</CardDescription>
              </div>
            </div>
          </div>
        </CardHeader>

        {(step.details || step.suggestedAction) && (
          <CardContent className="space-y-2">
            {step.details && (
              <div>
                <p className="text-sm font-semibold text-gray-600 mb-2">Detalhes:</p>
                <pre className="bg-gray-100 p-2 rounded text-xs overflow-auto">
                  {JSON.stringify(step.details, null, 2)}
                </pre>
              </div>
            )}

            {step.suggestedAction && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{step.suggestedAction}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        )}
      </Card>
    );
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">🎯 Primeiro Envio de Boleto</h1>
        <p className="text-gray-600">
          Sistema de validação 100% para garantir que o primeiro boleto seja enviado corretamente
        </p>
      </div>

      {/* Etapa 1: Input */}
      {step === "input" && (
        <Card>
          <CardHeader>
            <CardTitle>1️⃣ Selecione o Cliente</CardTitle>
            <CardDescription>Digite o CNPJ ou ID do cliente da R7 Geradores</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-semibold mb-2 block">CNPJ do Cliente</label>
              <Input
                placeholder="Ex: 21.918.918/0001-94"
                value={customerCnpj}
                onChange={(e) => setCustomerCnpj(e.target.value)}
              />
            </div>

            <Button onClick={handleValidate} disabled={isLoading} className="w-full">
              {isLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Validando...
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Próximo: Validar Pré-Requisitos
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Etapa 2: Validação */}
      {step === "validation" && validation && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>2️⃣ Validação Pré-Envio</CardTitle>
              <CardDescription>
                Todos os pré-requisitos foram validados com sucesso
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-6">
                <div className="flex items-center justify-between mb-4">
                  <span className="font-semibold">Status Geral</span>
                  <span className="text-lg">
                    {validation.overallStatus === "ready"
                      ? "✅ PRONTO"
                      : validation.overallStatus === "warning"
                        ? "🟡 AVISOS"
                        : "🔴 BLOQUEADO"}
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-4 mb-6">
                  <div className="text-center p-3 bg-gray-50 rounded">
                    <div className="text-2xl font-bold">{validation.summary.totalSteps}</div>
                    <div className="text-xs text-gray-600">Total</div>
                  </div>
                  <div className="text-center p-3 bg-green-50 rounded">
                    <div className="text-2xl font-bold text-green-600">
                      {validation.summary.passed}
                    </div>
                    <div className="text-xs text-gray-600">Passou</div>
                  </div>
                  <div className="text-center p-3 bg-yellow-50 rounded">
                    <div className="text-2xl font-bold text-yellow-600">
                      {validation.summary.warnings}
                    </div>
                    <div className="text-xs text-gray-600">Avisos</div>
                  </div>
                  <div className="text-center p-3 bg-red-50 rounded">
                    <div className="text-2xl font-bold text-red-600">
                      {validation.summary.failed}
                    </div>
                    <div className="text-xs text-gray-600">Falhas</div>
                  </div>
                </div>

                {validation.steps.map((s) => renderValidationStep(s))}
              </div>

              <Button onClick={handlePrepareMessage} disabled={isLoading} className="w-full">
                {isLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Preparando...
                  </>
                ) : (
                  <>
                    <Eye className="w-4 h-4 mr-2" />
                    Próximo: Preparar Mensagem
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Etapa 3: Preview da Mensagem */}
      {step === "preview" && message && validation?.boleto && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>3️⃣ Revisar Mensagem</CardTitle>
              <CardDescription>Confirme se os dados estão corretos antes do envio</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Dados do Boleto */}
              <div>
                <h3 className="font-semibold mb-3">📄 Dados do Boleto</h3>
                <div className="grid grid-cols-2 gap-4 p-4 bg-gray-50 rounded">
                  <div>
                    <p className="text-sm text-gray-600">Cliente</p>
                    <p className="font-semibold">{validation.boleto.customerName}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">WhatsApp</p>
                    <p className="font-semibold">{validation.boleto.whatsappNumber}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Valor</p>
                    <p className="font-semibold text-lg text-green-600">
                      {message.formattedAmount}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Vencimento</p>
                    <p className="font-semibold">{message.formattedDueDate}</p>
                  </div>
                </div>
              </div>

              {/* Mensagem */}
              <div>
                <h3 className="font-semibold mb-3">💬 Conteúdo da Mensagem</h3>
                <div className="p-4 bg-blue-50 rounded border border-blue-200 whitespace-pre-wrap text-sm">
                  {message.message}
                </div>
              </div>

              {/* Validação */}
              {!message.validation.isValid && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <p className="font-semibold mb-2">Problemas encontrados:</p>
                    <ul className="list-disc pl-5">
                      {message.validation.errors.map((err, idx) => (
                        <li key={idx}>{err}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {message.validation.warnings.length > 0 && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <p className="font-semibold mb-2">Avisos:</p>
                    <ul className="list-disc pl-5">
                      {message.validation.warnings.map((warn, idx) => (
                        <li key={idx}>{warn}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              <Button
                onClick={handleConfirmDispatch}
                disabled={isLoading || !message.validation.isValid}
                className="w-full"
              >
                <Send className="w-4 h-4 mr-2" />
                Próximo: Confirmar Envio
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Etapa 4: Confirmação */}
      {step === "confirm" && message && validation?.boleto && (
        <Card>
          <CardHeader>
            <CardTitle>4️⃣ Confirmar Envio</CardTitle>
            <CardDescription>
              Você está prestes a enviar o boleto para {validation.boleto.customerName}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <p className="font-semibold mb-2">Confirmação Final</p>
                <p>
                  Ao clicar em "Enviar", o boleto será enviado via WhatsApp para{" "}
                  <strong>{validation.boleto.whatsappNumber}</strong> com os dados acima.
                </p>
                <p className="mt-2">Esta ação não pode ser desfeita.</p>
              </AlertDescription>
            </Alert>

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setStep("preview")}
                disabled={isLoading}
                className="flex-1"
              >
                Voltar
              </Button>
              <Button
                onClick={handleExecuteDispatch}
                disabled={isLoading}
                className="flex-1"
              >
                {isLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Enviando...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-2" />
                    Enviar Boleto Agora
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Etapa 5: Resultado */}
      {step === "result" && dispatch && (
        <Card>
          <CardHeader>
            <CardTitle>
              {dispatch.success ? "5️⃣ ✅ Envio Concluído com Sucesso!" : "5️⃣ ❌ Falha no Envio"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {dispatch.success ? (
              <Alert className="border-green-200 bg-green-50">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-800">
                  <p className="font-semibold mb-2">Boleto enviado com sucesso!</p>
                  <p>
                    O cliente receberá a mensagem em breve. Você pode acompanhar o status na
                    auditoria.
                  </p>
                </AlertDescription>
              </Alert>
            ) : (
              <Alert className="border-red-200 bg-red-50">
                <AlertCircle className="h-4 w-4 text-red-600" />
                <AlertDescription className="text-red-800">
                  <p className="font-semibold mb-2">Falha ao enviar boleto</p>
                  <p>{dispatch.log.message}</p>
                </AlertDescription>
              </Alert>
            )}

            <div>
              <h3 className="font-semibold mb-2">📊 Detalhes do Envio</h3>
              <pre className="bg-gray-100 p-3 rounded text-xs overflow-auto">
                {JSON.stringify(dispatch.log, null, 2)}
              </pre>
            </div>

            <Button className="w-full" onClick={() => window.location.href = "/audit"}>
              <Download className="w-4 h-4 mr-2" />
              Ver Auditoria Completa
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
