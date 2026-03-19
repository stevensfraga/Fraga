/**
 * Meta Endpoints Router
 * GET /api/meta/endpoints
 * Retorna todos os endpoints em JSON (fonte única de verdade)
 */

import express, { Router } from 'express';

const router: Router = express.Router();

interface EndpointsMeta {
  zap: {
    apiBase: string;
    panelBase: string;
    auth: {
      endpoint: string;
      method: string;
      description: string;
    };
    messages: {
      endpoint: string;
      method: string;
      description: string;
    };
    signedUrl: {
      endpoint: string;
      method: string;
      description: string;
    };
    upload: {
      endpoint: string;
      method: string;
      description: string;
      status: string;
    };
    storage: {
      endpoint: string;
      method: string;
      description: string;
    };
  };
  contaAzul: {
    oauthEndpoints: {
      authUrl: string;
      tokenStatus: string;
      refreshToken: string;
      callback: string;
      clearToken: string;
    };
    apiV2Base: string;
    servicesBase: string;
    panelEndpoints: {
      financialEventSummary: string;
      chargeRequest: string;
      installmentView: string;
    };
    realIds: {
      financialEventId: string;
      chargeRequestId: string;
      ticketId: number;
      clientId: number;
      receivableId: number;
    };
  };
  fraga: {
    r7: {
      discoverTicket: string;
      sendReal: string;
      sendReceivable: string;
    };
    discover: {
      uploadEndpoint: string;
    };
    meta: {
      endpoints: string;
    };
  };
  proofRules: {
    httpStatus: string;
    messageInTicket: string;
    pdfOpens: string;
    correlationIdFormat: string;
  };
}

/**
 * GET /api/meta/endpoints
 * Retorna todos os endpoints em JSON
 */
router.get('/endpoints', (req, res) => {
  const meta: EndpointsMeta = {
    zap: {
      apiBase: 'https://api-fraga.zapcontabil.chat',
      panelBase: 'https://fraga.zapcontabil.chat',
      auth: {
        endpoint: 'POST /auth/login',
        method: 'POST',
        description: 'Autenticar e obter Bearer token',
      },
      messages: {
        endpoint: 'POST /messages/{ticketId}',
        method: 'POST',
        description: 'Enviar mensagem no ticket',
      },
      signedUrl: {
        endpoint: 'GET /storage/signedUrl/{filename}?expiresInSeconds=900',
        method: 'GET',
        description: 'Gerar URL assinada para acessar arquivo',
      },
      upload: {
        endpoint: 'POST /[DESCOBRIR VIA SCANNER]',
        method: 'POST',
        description: 'Upload de arquivo (endpoint variável - usar scanner)',
        status: 'PENDENTE - executar GET /api/discover/upload-endpoint',
      },
      storage: {
        endpoint: 'GET /storage/file/{filename}?expires=...&signature=...',
        method: 'GET',
        description: 'Validar PDF do storage (prova final)',
      },
    },
    contaAzul: {
      oauthEndpoints: {
        authUrl: 'GET /api/oauth/auth-url',
        tokenStatus: 'GET /api/oauth/token-status',
        refreshToken: 'POST /api/oauth/refresh-token',
        callback: 'GET /api/oauth/callback',
        clearToken: 'GET /api/oauth/clear-token',
      },
      apiV2Base: 'https://api-v2.contaazul.com',
      servicesBase: 'https://services.contaazul.com',
      panelEndpoints: {
        financialEventSummary: 'GET /contaazul-bff/finance/v1/financial-events/{financialEventId}/summary',
        chargeRequest: 'GET /finance-pro/v1/charge-requests/{chargeRequestId}',
        installmentView: 'GET /finance-pro-reader/v1/installment-view?page=1&page_size=10',
      },
      realIds: {
        financialEventId: 'ca248c7e-2045-4346-8d8d-9c4d70217f99',
        chargeRequestId: '84f71eca-0a9d-11f1-b160-d71ec57e576b',
        ticketId: 8019,
        clientId: 30004,
        receivableId: 60001,
      },
    },
    fraga: {
      r7: {
        discoverTicket: 'GET /api/test/r7/discover-ticket',
        sendReal: 'POST /api/test/r7/send-real',
        sendReceivable: 'POST /api/r7/send-receivable',
      },
      discover: {
        uploadEndpoint: 'GET /api/discover/upload-endpoint',
      },
      meta: {
        endpoints: 'GET /api/meta/endpoints',
      },
    },
    proofRules: {
      httpStatus: 'HTTP 200/201 na API',
      messageInTicket: 'Mensagem aparece no ticket do ZapContábil (painel)',
      pdfOpens: 'PDF abre no painel (GET /storage/file/... -> 200 application/pdf)',
      correlationIdFormat: '[#FRAGA:ticketId:clientId:receivableId:timestamp]',
    },
  };

  res.json(meta);
});

export default router;
