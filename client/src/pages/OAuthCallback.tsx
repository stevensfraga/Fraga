/**
 * Página de callback OAuth
 * Processa o authorization code recebido do Conta Azul
 * e o troca por um access_token via tRPC
 */

import { useEffect, useState } from 'react';
import { useLocation, useRouter } from 'wouter';
import { trpc } from '@/lib/trpc';
import { Loader2 } from 'lucide-react';

export default function OAuthCallback() {
  const [location] = useLocation();
  const router = useRouter();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [message, setMessage] = useState('Processando autorização...');

  const processCallback = trpc.contaAzulOAuth.processCallbackCode.useMutation();

  useEffect(() => {
    const processOAuth = async () => {
      try {
        // Extrair code e state da URL
        const params = new URLSearchParams(location.split('?')[1]);
        const code = params.get('code');
        const error = params.get('error');
        const errorDescription = params.get('error_description');

        // Se houver erro do Conta Azul
        if (error) {
          setStatus('error');
          setMessage(`Erro do Conta Azul: ${errorDescription || error}`);
          console.error('[OAuth Callback] Erro:', error, errorDescription);
          return;
        }

        // Validar authorization code
        if (!code) {
          setStatus('error');
          setMessage('Authorization code não fornecido');
          console.error('[OAuth Callback] Authorization code não fornecido');
          return;
        }

        console.log('[OAuth Callback] Processando código:', code.substring(0, 10) + '...');

        // Processar callback via tRPC
        const result = await processCallback.mutateAsync({ code });

        if (result.success) {
          setStatus('success');
          setMessage('✅ Autenticação realizada com sucesso!');
          console.log('[OAuth Callback] ✅ Callback processado com sucesso');

      // Redirecionar para dashboard após 2 segundos
      setTimeout(() => {
        window.location.href = '/dashboard';
      }, 2000);
        } else {
          setStatus('error');
          setMessage(`Erro: ${result.error || 'Desconhecido'}`);
          console.error('[OAuth Callback] Erro ao processar:', result.error);
        }
      } catch (error) {
        setStatus('error');
        setMessage(`Erro ao processar autorização: ${error instanceof Error ? error.message : 'Desconhecido'}`);
        console.error('[OAuth Callback] Erro:', error);
      }
    };

    processOAuth();
  }, [location, processCallback, router]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
      <div className="text-center">
        {status === 'processing' && (
          <>
            <Loader2 className="w-12 h-12 text-blue-400 animate-spin mx-auto mb-4" />
            <p className="text-white text-lg">{message}</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-white text-2xl">✓</span>
            </div>
            <p className="text-white text-lg">{message}</p>
            <p className="text-gray-400 text-sm mt-2">Redirecionando para o dashboard...</p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="w-12 h-12 bg-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-white text-2xl">✕</span>
            </div>
            <p className="text-white text-lg">{message}</p>
            <button
              onClick={() => window.location.href = '/'}
              className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Voltar para o início
            </button>
          </>
        )}
      </div>
    </div>
  );
}
