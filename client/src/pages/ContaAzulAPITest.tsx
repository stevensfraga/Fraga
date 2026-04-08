import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, AlertCircle, CheckCircle2, Copy } from 'lucide-react';
import { trpc } from '@/lib/trpc';

interface TestResult {
  status: 'loading' | 'success' | 'error';
  endpoint: string;
  statusCode?: number;
  data?: any;
  error?: string;
}

export default function ContaAzulAPITest() {
  const [results, setResults] = useState<TestResult[]>([]);
  const [loading, setLoading] = useState(false);

  // Query para verificar autenticação
  const authStatusQuery = trpc.contaAzulOAuth.isAuthenticated.useQuery();

  const testEndpoint = async (endpoint: string, description: string) => {
    const resultId = results.length;
    setResults((prev) => [
      ...prev,
      {
        status: 'loading',
        endpoint: description,
      },
    ]);

    try {
      setLoading(true);
      const response = await fetch(`/api/conta-azul/${endpoint}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (response.ok) {
        setResults((prev) => [
          ...prev.slice(0, resultId),
          {
            status: 'success',
            endpoint: description,
            statusCode: response.status,
            data,
          },
        ]);
      } else {
        setResults((prev) => [
          ...prev.slice(0, resultId),
          {
            status: 'error',
            endpoint: description,
            statusCode: response.status,
            error: data.error || 'Erro desconhecido',
          },
        ]);
      }
    } catch (error) {
      setResults((prev) => [
        ...prev.slice(0, resultId),
        {
          status: 'error',
          endpoint: description,
          error: error instanceof Error ? error.message : 'Erro desconhecido',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const isAuthenticated = authStatusQuery.data?.authenticated;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">
            Teste de APIs - Conta Azul
          </h1>
          <p className="text-lg text-slate-600">
            Teste chamadas à API do Conta Azul em tempo real
          </p>
        </div>

        {/* Authentication Status */}
        {authStatusQuery.isLoading ? (
          <Card className="mb-6">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-slate-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                Verificando autenticação...
              </div>
            </CardContent>
          </Card>
        ) : !isAuthenticated ? (
          <Alert className="mb-6 bg-red-50 border-red-200">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-800">
              ❌ Você não está autenticado. Faça login primeiro em{' '}
              <a href="/conta-azul-oauth" className="font-semibold underline">
                /conta-azul-oauth
              </a>
            </AlertDescription>
          </Alert>
        ) : (
          <Alert className="mb-6 bg-green-50 border-green-200">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800">
              ✅ Você está autenticado! Pode testar as APIs abaixo.
            </AlertDescription>
          </Alert>
        )}

        {/* Test Buttons */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>📋 Testes Disponíveis</CardTitle>
            <CardDescription>
              Clique em um botão para testar um endpoint da API
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Button
                onClick={() => testEndpoint('token', 'GET /api/conta-azul/token')}
                disabled={loading || !isAuthenticated}
                variant="outline"
                className="justify-start"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <span className="text-green-600 mr-2">✓</span>
                )}
                Token Válido
              </Button>

              <Button
                onClick={() => testEndpoint('boletos', 'GET /api/conta-azul/boletos')}
                disabled={loading || !isAuthenticated}
                variant="outline"
                className="justify-start"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <span className="text-green-600 mr-2">✓</span>
                )}
                Buscar Boletos
              </Button>

              <Button
                onClick={() => testEndpoint('clientes', 'GET /api/conta-azul/clientes')}
                disabled={loading || !isAuthenticated}
                variant="outline"
                className="justify-start"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <span className="text-green-600 mr-2">✓</span>
                )}
                Buscar Clientes
              </Button>

              <Button
                onClick={() =>
                  testEndpoint('contas-receber', 'GET /api/conta-azul/contas-receber')
                }
                disabled={loading || !isAuthenticated}
                variant="outline"
                className="justify-start"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <span className="text-green-600 mr-2">✓</span>
                )}
                Contas a Receber
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        {results.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold text-slate-900">📊 Resultados</h2>
            {results.map((result, index) => (
              <Card key={index}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {result.status === 'loading' && (
                        <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                      )}
                      {result.status === 'success' && (
                        <CheckCircle2 className="h-5 w-5 text-green-600" />
                      )}
                      {result.status === 'error' && (
                        <AlertCircle className="h-5 w-5 text-red-600" />
                      )}
                      <div>
                        <CardTitle className="text-lg">{result.endpoint}</CardTitle>
                        {result.statusCode && (
                          <CardDescription>
                            Status HTTP: {result.statusCode}
                          </CardDescription>
                        )}
                      </div>
                    </div>
                    {result.data && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          navigator.clipboard.writeText(JSON.stringify(result.data, null, 2));
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {result.status === 'loading' && (
                    <div className="text-slate-600">Carregando...</div>
                  )}
                  {result.status === 'success' && result.data && (
                    <div className="bg-slate-50 p-4 rounded-lg overflow-auto max-h-96">
                      <pre className="text-xs text-slate-700 font-mono">
                        {JSON.stringify(result.data, null, 2)}
                      </pre>
                    </div>
                  )}
                  {result.status === 'error' && (
                    <div className="bg-red-50 p-4 rounded-lg border border-red-200">
                      <p className="text-red-800 font-mono text-sm">{result.error}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Info */}
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>📖 Informações</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="font-semibold text-slate-900 mb-2">Endpoints disponíveis:</p>
              <ul className="space-y-2 text-sm text-slate-700">
                <li>
                  <code className="bg-slate-100 px-2 py-1 rounded">/api/conta-azul/token</code>
                  - Retorna o token de acesso válido
                </li>
                <li>
                  <code className="bg-slate-100 px-2 py-1 rounded">
                    /api/conta-azul/boletos
                  </code>
                  - Lista todos os boletos
                </li>
                <li>
                  <code className="bg-slate-100 px-2 py-1 rounded">
                    /api/conta-azul/clientes
                  </code>
                  - Lista todos os clientes
                </li>
                <li>
                  <code className="bg-slate-100 px-2 py-1 rounded">
                    /api/conta-azul/contas-receber
                  </code>
                  - Lista contas a receber
                </li>
              </ul>
            </div>

            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>💡 Dica:</strong> Use os resultados para entender a estrutura de dados
                da API do Conta Azul e integrar com seu sistema.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
