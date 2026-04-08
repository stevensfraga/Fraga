import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, CheckCircle2, AlertCircle, Send, Eye } from 'lucide-react';
import { trpc } from '@/lib/trpc';

interface Boleto {
  id: string;
  customer_id: string;
  due_date: string;
  amount: number;
  status: string;
  boleto_url?: string;
  document_number?: string;
}

export default function R7GeradorasCollection() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [boletos, setBoletos] = useState<Boleto[]>([]);
  const [previewBoletoId, setPreviewBoletoId] = useState<string | null>(null);
  const [previewMensagem, setPreviewMensagem] = useState<string | null>(null);

  // Queries
  const buscarBoletosQuery = trpc.r7Geradores.buscarBoletos.useQuery();

  // Mutations
  const enviarCobrancaMutation = trpc.r7Geradores.enviarCobranca.useMutation();
  const processarTodasMutation = trpc.r7Geradores.processarTodas.useMutation();
  const previewMensagemQuery = trpc.r7Geradores.previewMensagem.useQuery(
    { boletoId: previewBoletoId || '' },
    { enabled: !!previewBoletoId }
  );

  // Carregar boletos
  useEffect(() => {
    if (buscarBoletosQuery.data?.boletos) {
      setBoletos(buscarBoletosQuery.data.boletos);
    }
  }, [buscarBoletosQuery.data]);

  // Atualizar prévia de mensagem
  useEffect(() => {
    if (previewMensagemQuery.data?.mensagem) {
      setPreviewMensagem(previewMensagemQuery.data.mensagem);
    }
  }, [previewMensagemQuery.data]);

  const handleRecarregarBoletos = async () => {
    setError(null);
    setSuccess(null);
    await buscarBoletosQuery.refetch();
  };

  const handleEnviarCobranca = async (boletoId: string) => {
    try {
      setLoading(true);
      setError(null);
      setSuccess(null);

      await enviarCobrancaMutation.mutateAsync({ boletoId });
      setSuccess('✅ Cobrança enviada com sucesso!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar cobrança');
    } finally {
      setLoading(false);
    }
  };

  const handleProcessarTodas = async () => {
    try {
      setLoading(true);
      setError(null);
      setSuccess(null);

      const resultado = await processarTodasMutation.mutateAsync();

      setSuccess(
        `✅ Processamento concluído! Enviados: ${resultado.enviados}/${resultado.total}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao processar cobranças');
    } finally {
      setLoading(false);
    }
  };

  const formatarMoeda = (valor: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(valor);
  };

  const formatarData = (data: string) => {
    return new Date(data).toLocaleDateString('pt-BR');
  };

  const calcularDiasAtraso = (dataVencimento: string) => {
    const vencimento = new Date(dataVencimento);
    const hoje = new Date();
    const diffTime = hoje.getTime() - vencimento.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return Math.max(0, diffDays);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">
            🎯 Cobrança R7 GERADORES
          </h1>
          <p className="text-lg text-slate-600">
            Buscar boletos e enviar cobranças via WhatsApp
          </p>
        </div>

        {/* Success Alert */}
        {success && (
          <Alert className="mb-6 bg-green-50 border-green-200">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800">{success}</AlertDescription>
          </Alert>
        )}

        {/* Error Alert */}
        {error && (
          <Alert className="mb-6 bg-red-50 border-red-200">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-800">❌ {error}</AlertDescription>
          </Alert>
        )}

        {/* Ações */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>📋 Ações</CardTitle>
            <CardDescription>Gerencie o envio de cobranças</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Button
                onClick={handleRecarregarBoletos}
                disabled={buscarBoletosQuery.isLoading || loading}
                variant="outline"
                className="justify-start"
              >
                {buscarBoletosQuery.isLoading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <span className="text-blue-600 mr-2">🔄</span>
                )}
                Recarregar Boletos
              </Button>

              <Button
                onClick={handleProcessarTodas}
                disabled={loading || boletos.length === 0}
                className="justify-start bg-green-600 hover:bg-green-700"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                Enviar Todas as Cobranças
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Status */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>📊 Status</CardTitle>
          </CardHeader>
          <CardContent>
            {buscarBoletosQuery.isLoading ? (
              <div className="flex items-center gap-2 text-slate-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando boletos...
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm text-blue-600 font-medium">Total de Boletos</p>
                  <p className="text-3xl font-bold text-blue-900 mt-2">{boletos.length}</p>
                </div>

                <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-600 font-medium">Em Atraso</p>
                  <p className="text-3xl font-bold text-red-900 mt-2">
                    {boletos.filter((b) => calcularDiasAtraso(b.due_date) > 0).length}
                  </p>
                </div>

                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-sm text-yellow-600 font-medium">Valor Total</p>
                  <p className="text-2xl font-bold text-yellow-900 mt-2">
                    {formatarMoeda(boletos.reduce((sum, b) => sum + b.amount, 0))}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Lista de Boletos */}
        {boletos.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold text-slate-900">💳 Boletos</h2>
            {boletos.map((boleto) => {
              const diasAtraso = calcularDiasAtraso(boleto.due_date);
              const isPreview = previewBoletoId === boleto.id;

              return (
                <Card key={boleto.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-lg">
                          {diasAtraso > 0 ? '⚠️' : '📌'} {boleto.document_number || boleto.id}
                        </CardTitle>
                        <CardDescription>
                          Vencimento: {formatarData(boleto.due_date)}
                          {diasAtraso > 0 && (
                            <span className="ml-2 text-red-600 font-medium">
                              ({diasAtraso} dias em atraso)
                            </span>
                          )}
                        </CardDescription>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-bold text-slate-900">
                          {formatarMoeda(boleto.amount)}
                        </p>
                        <p className="text-sm text-slate-600">{boleto.status}</p>
                      </div>
                    </div>
                  </CardHeader>

                  {isPreview && previewMensagem && (
                    <CardContent className="pt-0 pb-4">
                      <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 mb-4">
                        <p className="text-xs text-slate-600 font-semibold mb-2">PRÉVIA DA MENSAGEM:</p>
                        <div className="bg-white p-3 rounded border border-slate-300 text-sm whitespace-pre-wrap text-slate-700">
                          {previewMensagem}
                        </div>
                      </div>
                    </CardContent>
                  )}

                  <CardContent className="pt-0">
                    <div className="flex gap-2">
                      <Button
                        onClick={() => {
                          if (isPreview) {
                            setPreviewBoletoId(null);
                            setPreviewMensagem(null);
                          } else {
                            setPreviewBoletoId(boleto.id);
                          }
                        }}
                        disabled={loading}
                        variant="outline"
                        size="sm"
                      >
                        <Eye className="h-4 w-4 mr-2" />
                        {isPreview ? 'Ocultar' : 'Prévia'}
                      </Button>

                      <Button
                        onClick={() => handleEnviarCobranca(boleto.id)}
                        disabled={loading}
                        size="sm"
                        className="bg-green-600 hover:bg-green-700"
                      >
                        {loading ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4 mr-2" />
                        )}
                        Enviar Cobrança
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Empty State */}
        {!buscarBoletosQuery.isLoading && boletos.length === 0 && (
          <Card>
            <CardContent className="pt-12 pb-12 text-center">
              <p className="text-slate-600 mb-4">Nenhum boleto encontrado para a R7 GERADORES</p>
              <Button onClick={handleRecarregarBoletos} variant="outline">
                Tentar Novamente
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Info */}
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>📖 Informações</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="font-semibold text-slate-900 mb-2">Como funciona:</p>
              <ol className="space-y-2 text-sm text-slate-700 list-decimal list-inside">
                <li>Clique em "Recarregar Boletos" para buscar boletos da R7 no Conta Azul</li>
                <li>Clique em "Prévia" para ver como a mensagem ficará</li>
                <li>Clique em "Enviar Cobrança" para enviar via WhatsApp</li>
                <li>Ou clique em "Enviar Todas as Cobranças" para enviar tudo de uma vez</li>
              </ol>
            </div>

            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>⏰ Job Automático:</strong> As cobranças são enviadas automaticamente
                diariamente às 09:00 (segunda a sexta).
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
