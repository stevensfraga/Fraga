import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, CheckCircle2, AlertCircle, LogOut, RefreshCw } from 'lucide-react';
import { trpc } from '@/lib/trpc';

export default function ContaAzulOAuth() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Queries
  const authStatusQuery = trpc.contaAzulOAuth.isAuthenticated.useQuery();
  const getAuthUrlQuery = trpc.contaAzulOAuth.getAuthUrl.useQuery();

  // Mutations
  const logoutMutation = trpc.contaAzulOAuth.logout.useMutation();

  // Verificar se veio de callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('oauth') === 'success') {
      setSuccess(true);
      // Limpar URL
      window.history.replaceState({}, document.title, window.location.pathname);
      // Revalidar status
      authStatusQuery.refetch();
    }
  }, []);

  const handleLogin = async () => {
    try {
      setLoading(true);
      setError(null);

      if (!getAuthUrlQuery.data?.authUrl) {
        setError('URL de autorização não disponível');
        return;
      }

      // Redirecionar para Conta Azul
      window.location.href = getAuthUrlQuery.data.authUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao iniciar login');
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      setLoading(true);
      await logoutMutation.mutateAsync();
      setSuccess(false);
      authStatusQuery.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao fazer logout');
    } finally {
      setLoading(false);
    }
  };

  const isAuthenticated = authStatusQuery.data?.authenticated;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">
            Integração Conta Azul
          </h1>
          <p className="text-lg text-slate-600">
            Gerencie sua autenticação OAuth 2.0 com o Conta Azul
          </p>
        </div>

        {/* Success Alert */}
        {success && (
          <Alert className="mb-6 bg-green-50 border-green-200">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800">
              ✅ Autenticação realizada com sucesso! Seu token foi salvo.
            </AlertDescription>
          </Alert>
        )}

        {/* Error Alert */}
        {error && (
          <Alert className="mb-6 bg-red-50 border-red-200">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-800">
              ❌ {error}
            </AlertDescription>
          </Alert>
        )}

        {/* Status Card */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${isAuthenticated ? 'bg-green-500' : 'bg-red-500'}`} />
              Status de Autenticação
            </CardTitle>
            <CardDescription>
              {authStatusQuery.isLoading
                ? 'Verificando status...'
                : isAuthenticated
                  ? 'Você está autenticado no Conta Azul'
                  : 'Você não está autenticado'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {authStatusQuery.isLoading ? (
              <div className="flex items-center gap-2 text-slate-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando...
              </div>
            ) : isAuthenticated ? (
              <div className="space-y-4">
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-green-800 font-medium">✅ Token válido armazenado</p>
                  <p className="text-sm text-green-700 mt-1">
                    Você pode usar a API do Conta Azul para buscar dados
                  </p>
                </div>
                <Button
                  onClick={handleLogout}
                  disabled={loading}
                  variant="outline"
                  className="w-full"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Desconectando...
                    </>
                  ) : (
                    <>
                      <LogOut className="h-4 w-4 mr-2" />
                      Desconectar
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-red-800 font-medium">❌ Não autenticado</p>
                  <p className="text-sm text-red-700 mt-1">
                    Clique no botão abaixo para iniciar o fluxo OAuth
                  </p>
                </div>
                <Button
                  onClick={handleLogin}
                  disabled={loading || getAuthUrlQuery.isLoading}
                  className="w-full bg-blue-600 hover:bg-blue-700"
                >
                  {loading || getAuthUrlQuery.isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Iniciando...
                    </>
                  ) : (
                    <>
                      🔐 Conectar com Conta Azul
                    </>
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Info Card */}
        <Card>
          <CardHeader>
            <CardTitle>📋 Como funciona</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center font-semibold text-blue-700">
                  1
                </div>
                <div>
                  <p className="font-medium text-slate-900">Clique em "Conectar com Conta Azul"</p>
                  <p className="text-sm text-slate-600">Você será redirecionado para o Conta Azul</p>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center font-semibold text-blue-700">
                  2
                </div>
                <div>
                  <p className="font-medium text-slate-900">Faça login com suas credenciais</p>
                  <p className="text-sm text-slate-600">Use seu e-mail e senha do Conta Azul</p>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center font-semibold text-blue-700">
                  3
                </div>
                <div>
                  <p className="font-medium text-slate-900">Autorize a aplicação</p>
                  <p className="text-sm text-slate-600">Conceda permissão para acessar seus dados</p>
                </div>
              </div>

              <div className="flex gap-3">
                <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center font-semibold text-blue-700">
                  4
                </div>
                <div>
                  <p className="font-medium text-slate-900">Redirecionado de volta</p>
                  <p className="text-sm text-slate-600">Seu token será salvo automaticamente</p>
                </div>
              </div>
            </div>

            <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>🔒 Segurança:</strong> Seus tokens são armazenados de forma segura no servidor. Nunca compartilhamos suas credenciais.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Debug Info */}
        {isAuthenticated && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4" />
                Ações Disponíveis
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <p className="text-sm text-slate-600 mb-4">
                  Com sua autenticação ativa, você pode:
                </p>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center gap-2">
                    <span className="text-green-600">✅</span>
                    Buscar clientes do Conta Azul
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-green-600">✅</span>
                    Buscar contas a receber
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-green-600">✅</span>
                    Enviar cobranças automáticas
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-green-600">✅</span>
                    Receber webhooks de pagamento
                  </li>
                </ul>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
