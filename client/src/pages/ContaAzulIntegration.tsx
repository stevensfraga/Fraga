import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle, AlertCircle, ExternalLink } from "lucide-react";

export default function ContaAzulIntegration() {
  const [accessToken, setAccessToken] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState(false);

  // Queries
  const getAuthUrl = trpc.contaAzul.getAuthUrl.useQuery();
  const getContasReceber = trpc.contaAzul.getContasReceber.useQuery(
    { accessToken: accessToken || "" },
    { enabled: !!accessToken }
  );
  const getClientes = trpc.contaAzul.getClientes.useQuery(
    { accessToken: accessToken || "" },
    { enabled: !!accessToken }
  );

  // Mutations
  const handleCallback = trpc.contaAzul.handleCallback.useMutation();

  // Verificar se há código na URL (callback)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");

    if (code && !accessToken) {
      processCallback(code);
    }
  }, []);

  const processCallback = async (code: string) => {
    setLoading(true);
    setError("");

    try {
      const result = await handleCallback.mutateAsync({ code });

      if (result.success) {
        setAccessToken(result.token || "");
        setSuccess(true);
        setError("");

        // Limpar URL
        window.history.replaceState({}, document.title, window.location.pathname);
      } else {
        setError(result.error || "Erro ao processar autorização");
      }
    } catch (err: any) {
      setError(err.message || "Erro ao processar autorização");
    } finally {
      setLoading(false);
    }
  };

  const handleAuthorize = () => {
    if (getAuthUrl.data?.authUrl) {
      window.location.href = getAuthUrl.data.authUrl;
    }
  };

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Integração Conta Azul</h1>
        <p className="text-gray-500 mt-2">
          Conecte sua conta do Conta Azul para sincronizar clientes e contas a receber
        </p>
      </div>

      {/* Status de Autorização */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {success ? (
              <>
                <CheckCircle className="w-5 h-5 text-green-600" />
                Autorizado
              </>
            ) : (
              <>
                <AlertCircle className="w-5 h-5 text-yellow-600" />
                Não Autorizado
              </>
            )}
          </CardTitle>
          <CardDescription>
            {success
              ? "Sua conta foi autorizada com sucesso!"
              : "Clique no botão abaixo para autorizar a aplicação"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
              {error}
            </div>
          )}

          {!success ? (
            <Button
              onClick={handleAuthorize}
              disabled={loading || !getAuthUrl.data}
              className="w-full"
              size="lg"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processando...
                </>
              ) : (
                <>
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Autorizar com Conta Azul
                </>
              )}
            </Button>
          ) : (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-green-800">
              ✅ Pronto para sincronizar dados!
            </div>
          )}
        </CardContent>
      </Card>

      {/* Contas a Receber */}
      {accessToken && (
        <Card>
          <CardHeader>
            <CardTitle>Contas a Receber Vencidas</CardTitle>
            <CardDescription>
              {getContasReceber.isLoading
                ? "Carregando..."
                : `${getContasReceber.data?.vencidas || 0} de ${getContasReceber.data?.total || 0} contas vencidas`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {getContasReceber.isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : getContasReceber.error ? (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
                Erro ao carregar contas: {getContasReceber.error.message}
              </div>
            ) : getContasReceber.data?.contas && getContasReceber.data.contas.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b">
                    <tr>
                      <th className="text-left py-2 px-4">Cliente</th>
                      <th className="text-left py-2 px-4">Valor</th>
                      <th className="text-left py-2 px-4">Vencimento</th>
                      <th className="text-left py-2 px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {getContasReceber.data.contas.map((conta: any) => (
                      <tr key={conta.id} className="border-b hover:bg-gray-50">
                        <td className="py-2 px-4">{conta.cliente?.nome || "N/A"}</td>
                        <td className="py-2 px-4">
                          R$ {Number(conta.valor || 0).toFixed(2)}
                        </td>
                        <td className="py-2 px-4">
                          {new Date(conta.dataVencimento).toLocaleDateString("pt-BR")}
                        </td>
                        <td className="py-2 px-4">
                          <span className="bg-red-100 text-red-800 px-2 py-1 rounded text-xs font-medium">
                            Vencido
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                Nenhuma conta vencida encontrada
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Clientes */}
      {accessToken && (
        <Card>
          <CardHeader>
            <CardTitle>Clientes</CardTitle>
            <CardDescription>
              {getClientes.isLoading
                ? "Carregando..."
                : `${getClientes.data?.total || 0} clientes cadastrados`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {getClientes.isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : getClientes.error ? (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
                Erro ao carregar clientes: {getClientes.error.message}
              </div>
            ) : getClientes.data?.clientes && getClientes.data.clientes.length > 0 ? (
              <div className="grid gap-4">
                {getClientes.data.clientes.map((cliente: any) => (
                  <div
                    key={cliente.id}
                    className="border rounded-lg p-4 hover:bg-gray-50 transition"
                  >
                    <div className="font-semibold">{cliente.nome}</div>
                    <div className="text-sm text-gray-600 mt-1">
                      CNPJ/CPF: {cliente.cnpj || cliente.cpf || "N/A"}
                    </div>
                    {cliente.email && (
                      <div className="text-sm text-gray-600">Email: {cliente.email}</div>
                    )}
                    {cliente.telefone && (
                      <div className="text-sm text-gray-600">Telefone: {cliente.telefone}</div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                Nenhum cliente encontrado
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
