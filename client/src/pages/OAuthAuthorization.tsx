import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, CheckCircle, Clock, ExternalLink, RefreshCw, Shield } from 'lucide-react';

interface TokenStatus {
  hasToken: boolean;
  isExpired: boolean;
  expiresAt?: string;
  lastUsedAt?: string;
  createdAt?: string;
  minutesUntilExpiry?: number;
}

interface AuthorizationState {
  loading: boolean;
  error?: string;
  success?: string;
  tokenStatus?: TokenStatus;
}

export default function OAuthAuthorization() {
  const [state, setState] = useState<AuthorizationState>({ loading: true });
  const [authUrl, setAuthUrl] = useState<string>('');
  const [showDetails, setShowDetails] = useState(false);

  // Buscar status do token e URL de autorização
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        setState({ loading: true });

        // Buscar URL de autorização
        const authResponse = await fetch('/api/oauth/auth-url');
        if (!authResponse.ok) {
          throw new Error('Falha ao gerar URL de autorização');
        }
        const authData = await authResponse.json();
        setAuthUrl(authData.authUrl || authData.url);

        // Buscar status do token
        const statusResponse = await fetch('/api/oauth/token-status');
        if (statusResponse.ok) {
          const statusData = await statusResponse.json();
          setState({
            loading: false,
            tokenStatus: statusData,
          });
        } else {
          setState({
            loading: false,
            tokenStatus: { hasToken: false, isExpired: true },
          });
        }
      } catch (err) {
        setState({
          loading: false,
          error: err instanceof Error ? err.message : 'Erro ao carregar status',
        });
      }
    };

    fetchStatus();
  }, []);

  const handleAuthorize = () => {
    if (authUrl) {
      window.open(authUrl, '_blank', 'width=600,height=700');
    }
  };

  const handleRefresh = async () => {
    try {
      setState({ ...state, loading: true });
      const response = await fetch('/api/oauth/refresh-token', { method: 'POST' });
      if (response.ok) {
        setState({
          loading: false,
          success: 'Token renovado com sucesso!',
        });
        // Recarregar status após 2 segundos
        setTimeout(() => window.location.reload(), 2000);
      } else {
        setState({
          loading: false,
          error: 'Falha ao renovar token. Faça login novamente.',
        });
      }
    } catch (err) {
      setState({
        loading: false,
        error: err instanceof Error ? err.message : 'Erro ao renovar token',
      });
    }
  };

  const getStatusColor = () => {
    if (!state.tokenStatus?.hasToken) return 'text-red-500';
    if (state.tokenStatus?.isExpired) return 'text-orange-500';
    if (state.tokenStatus?.minutesUntilExpiry && state.tokenStatus.minutesUntilExpiry < 30)
      return 'text-yellow-500';
    return 'text-green-500';
  };

  const getStatusMessage = () => {
    if (!state.tokenStatus?.hasToken) {
      return 'Não autorizado. Clique abaixo para autorizar.';
    }
    if (state.tokenStatus?.isExpired) {
      return 'Token expirado. Clique em "Renovar" ou faça login novamente.';
    }
    if (state.tokenStatus?.minutesUntilExpiry && state.tokenStatus.minutesUntilExpiry < 30) {
      return `Token expirará em ${state.tokenStatus.minutesUntilExpiry} minutos.`;
    }
    return `Token válido. Expira em ${state.tokenStatus?.minutesUntilExpiry} minutos.`;
  };

  if (state.loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Carregando...</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-center">
              <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Shield className="w-8 h-8 text-blue-600" />
            <h1 className="text-3xl font-bold text-slate-900">Autorização Conta Azul</h1>
          </div>
          <p className="text-slate-600">Gerencie a autorização OAuth para integração com Conta Azul</p>
        </div>

        {/* Status Card */}
        <Card className="mb-6 border-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Status da Autorização</CardTitle>
              <div className={`w-3 h-3 rounded-full ${getStatusColor().replace('text-', 'bg-')}`} />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className={`p-4 rounded-lg ${getStatusColor().replace('text-', 'bg-').replace('500', '50')} border ${getStatusColor().replace('text-', 'border-')}`}>
              <p className={`font-semibold ${getStatusColor()}`}>{getStatusMessage()}</p>
            </div>

            {state.tokenStatus && (
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-slate-600">Status</p>
                  <p className="font-semibold">
                    {state.tokenStatus.hasToken ? (
                      <span className="flex items-center gap-2 text-green-600">
                        <CheckCircle className="w-4 h-4" /> Autorizado
                      </span>
                    ) : (
                      <span className="flex items-center gap-2 text-red-600">
                        <AlertCircle className="w-4 h-4" /> Não Autorizado
                      </span>
                    )}
                  </p>
                </div>
                {state.tokenStatus.expiresAt && (
                  <div>
                    <p className="text-slate-600">Expira em</p>
                    <p className="font-semibold">{new Date(state.tokenStatus.expiresAt).toLocaleString('pt-BR')}</p>
                  </div>
                )}
              </div>
            )}

            {showDetails && state.tokenStatus && (
              <div className="mt-4 pt-4 border-t space-y-2 text-sm text-slate-600">
                {state.tokenStatus.createdAt && (
                  <p>
                    <span className="font-semibold">Criado:</span> {new Date(state.tokenStatus.createdAt).toLocaleString('pt-BR')}
                  </p>
                )}
                {state.tokenStatus.lastUsedAt && (
                  <p>
                    <span className="font-semibold">Último uso:</span> {new Date(state.tokenStatus.lastUsedAt).toLocaleString('pt-BR')}
                  </p>
                )}
              </div>
            )}

            <button
              onClick={() => setShowDetails(!showDetails)}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              {showDetails ? 'Ocultar' : 'Mostrar'} detalhes
            </button>
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <Button
            onClick={handleAuthorize}
            className="bg-blue-600 hover:bg-blue-700 text-white h-12 text-base font-semibold"
            disabled={state.loading}
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            {state.tokenStatus?.hasToken ? 'Reautorizar' : 'Autorizar Agora'}
          </Button>

          {state.tokenStatus?.hasToken && !state.tokenStatus?.isExpired && (
            <Button
              onClick={handleRefresh}
              variant="outline"
              className="h-12 text-base font-semibold"
              disabled={state.loading}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Renovar Token
            </Button>
          )}
        </div>

        {/* Messages */}
        {state.error && (
          <Card className="mb-6 border-red-200 bg-red-50">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-red-900">Erro</p>
                  <p className="text-red-700 text-sm">{state.error}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {state.success && (
          <Card className="mb-6 border-green-200 bg-green-50">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-green-900">Sucesso</p>
                  <p className="text-green-700 text-sm">{state.success}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Como Funciona</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2 text-slate-600">
              <p>1. Clique em "Autorizar Agora"</p>
              <p>2. Faça login com suas credenciais Conta Azul</p>
              <p>3. Autorize a aplicação</p>
              <p>4. Será redirecionado automaticamente</p>
              <p>5. Token será salvo no banco de dados</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Renovação Automática</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2 text-slate-600">
              <p>✓ Token renovado automaticamente</p>
              <p>✓ Verificação a cada 10 minutos</p>
              <p>✓ Renovação 5 min antes de expirar</p>
              <p>✓ Sem interrupção de serviço</p>
              <p>✓ Alertas se houver falhas</p>
            </CardContent>
          </Card>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-slate-600">
          <p>Sistema de autorização OAuth Conta Azul</p>
          <p className="text-xs mt-1">Renovação automática ativa • Cron job: a cada 10 minutos</p>
        </div>
      </div>
    </div>
  );
}
