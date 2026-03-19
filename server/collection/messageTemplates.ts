/**
 * BLOCO 11 — Templates de mensagem por faixa de atraso
 * 
 * Variáveis disponíveis:
 * {{nome}} — Nome do cliente
 * {{valor}} — Valor formatado (R$ X.XXX,XX)
 * {{vencimento}} — Data de vencimento (DD/MM/YYYY)
 * {{diasAtraso}} — Dias em atraso
 * {{link}} — Link da fatura
 * {{correlationId}} — ID de rastreamento
 */

import { BucketCode } from './buckets';

export interface MessageTemplate {
  bucket: BucketCode | 'D1'; // D1 = primeiro toque na faixa D
  name: string;
  template: string;
}

export interface ConsolidatedMessageTemplate {
  bucket: BucketCode;
  name: string;
  template: string;
}

/**
 * Templates de mensagem por faixa
 * D1 = Template especial para primeiro toque na faixa D (dispatchCount=0)
 * D = Template pré-jurídico para faixa D (dispatchCount>=1)
 */
export const MESSAGE_TEMPLATES: Record<BucketCode | 'D1', MessageTemplate> = {
  // Faixa A: D+1 a D+3 — Lembrete leve
  A: {
    bucket: 'A',
    name: 'lembrete_leve',
    template: [
      'Olá, {{nome}}.',
      '',
      'Identificamos que a fatura com vencimento em {{vencimento}} ainda consta em aberto.',
      '',
      'Segue novamente o link para pagamento:',
      '{{link}}',
      '(Escolha Pix ou Boleto dentro da página)',
      '',
      'Caso já tenha realizado o pagamento, por favor desconsidere esta mensagem.',
      '',
      'Qualquer dúvida, estamos à disposição.',
    ].join('\n'),
  },

  // Faixa B: D+4 a D+15 — Cobrança formal
  B: {
    bucket: 'B',
    name: 'cobranca_formal',
    template: [
      'Olá, {{nome}}.',
      '',
      'Identificamos que a fatura com vencimento em {{vencimento}} ainda consta em aberto.',
      '',
      'Segue novamente o link para pagamento:',
      '{{link}}',
      '(Escolha Pix ou Boleto dentro da página)',
      '',
      'Caso já tenha realizado o pagamento, por favor desconsidere esta mensagem.',
      '',
      'Qualquer dúvida, estamos à disposição.',
    ].join('\n'),
  },

  // Faixa C: D+16 a D+30 — Cobrança firme
  C: {
    bucket: 'C',
    name: 'cobranca_firme',
    template: [
      'Olá, {{nome}}.',
      '',
      'Gostaríamos de informar que a fatura com vencimento em {{vencimento}}, no valor de {{valor}}, encontra-se em atraso há {{diasAtraso}} dias.',
      '',
      'Solicitamos a regularização o mais breve possível para evitar restrições em seu cadastro.',
      '',
      'Link para pagamento:',
      '{{link}}',
      '(Escolha Pix ou Boleto dentro da página)',
      '',
      'Caso já tenha realizado o pagamento, por favor desconsidere esta mensagem.',
      '',
      'Qualquer dúvida, estamos à disposição.',
    ].join('\n'),
  },

  // Faixa D1: +30 dias — Primeiro toque (tom suave)
  D1: {
    bucket: 'D1',
    name: 'd1_suave',
    template: [
      'Prezado(a) {{nome}},',
      '',
      'Identificamos pendência referente à fatura com vencimento em {{vencimento}}, no valor de {{valor}}.',
      '',
      'Segue o link para regularização:',
      '{{link}}',
      '(Escolha Pix ou Boleto dentro da página)',
      '',
      'Caso já tenha realizado o pagamento, por favor desconsidere esta mensagem.',
      '',
      'Se houver necessidade de negociação, responda esta mensagem que entraremos em contato.',
      '',
      'Atenciosamente,',
      'Fraga Contabilidade',
    ].join('\n'),
  },

  // Faixa D: +30 dias — Segundo toque ou mais (pré-jurídico)
  D: {
    bucket: 'D',
    name: 'pre_juridico',
    template: [
      'Prezado(a) {{nome}},',
      '',
      'Informamos que a fatura com vencimento em {{vencimento}}, no valor de {{valor}}, encontra-se em atraso há {{diasAtraso}} dias.',
      '',
      'Caso o pagamento não seja regularizado em até 5 dias úteis, seremos obrigados a encaminhar o débito para cobrança administrativa.',
      '',
      'Link para pagamento:',
      '{{link}}',
      '',
      'Caso já tenha realizado o pagamento, por favor entre em contato para que possamos atualizar seu cadastro.',
      '',
      'Atenciosamente,',
      'Fraga Contabilidade',
    ].join('\n'),
  },
};

/**
 * Templates CONSOLIDADOS por faixa (1 msg por cliente, múltiplos títulos)
 * 
 * Variáveis:
 * {{nome}} — Primeiro nome do cliente
 * {{qtd}} — Quantidade de títulos em aberto
 * {{total}} — Valor total consolidado (R$ X.XXX,XX)
 * {{maisAntigo}} — Data do vencimento mais antigo (DD/MM/YYYY)
 * {{maisRecente}} — Data do vencimento mais recente (DD/MM/YYYY)
 * {{diasAtraso}} — Máximo de dias em atraso
 * {{link}} — Link de pagamento (do título mais antigo) — LEGADO, use {{listaBoletos}}
 * {{listaBoletos}} — Lista de boletos por mês/ano com link individual
 * {{correlationId}} — ID de rastreamento
 */
export const CONSOLIDATED_TEMPLATES: Record<BucketCode, ConsolidatedMessageTemplate> = {
  A: {
    bucket: 'A',
    name: 'consolidado_lembrete_v2',
    template: [
      'Olá, {{nome}}! 👋',
      '',
      'Aqui é da *Fraga Contabilidade*.',
      '',
      'Identificamos mensalidade(s) em aberto. Para sua comodidade, segue o link de cada uma:',
      '',
      '{{listaBoletos}}',
      '',
      'Caso já tenha pago alguma, nos avise para atualizar o cadastro. 😊',
      'Se precisar negociar ou parcelar, é só responder aqui.',
      '',
      '*Fraga Contabilidade*',
    ].join('\n'),
  },
  B: {
    bucket: 'B',
    name: 'consolidado_formal_v2',
    template: [
      'Olá, {{nome}}! 👋',
      '',
      'Aqui é da *Fraga Contabilidade*.',
      '',
      'Identificamos mensalidade(s) em aberto. Para sua comodidade, segue o link de cada uma:',
      '',
      '{{listaBoletos}}',
      '',
      'Caso já tenha pago alguma, nos avise para atualizar o cadastro. 😊',
      'Se precisar negociar ou parcelar, é só responder aqui.',
      '',
      '*Fraga Contabilidade*',
    ].join('\n'),
  },
  C: {
    bucket: 'C',
    name: 'consolidado_firme_v2',
    template: [
      'Olá, {{nome}}! 👋',
      '',
      'Aqui é da *Fraga Contabilidade*.',
      '',
      'Identificamos mensalidade(s) em aberto. Para sua comodidade, segue o link de cada uma:',
      '',
      '{{listaBoletos}}',
      '',
      'Caso já tenha pago alguma, nos avise para atualizar o cadastro. 😊',
      'Se precisar negociar ou parcelar, é só responder aqui.',
      '',
      '*Fraga Contabilidade*',
    ].join('\n'),
  },
  D: {
    bucket: 'D',
    name: 'consolidado_pre_juridico_v2',
    template: [
      'Olá, {{nome}}! 👋',
      '',
      'Aqui é da *Fraga Contabilidade*.',
      '',
      'Identificamos mensalidade(s) em aberto. Para sua comodidade, segue o link de cada uma:',
      '',
      '{{listaBoletos}}',
      '',
      'Caso já tenha pago alguma, nos avise para atualizar o cadastro. 😊',
      'Se precisar negociar ou parcelar, é só responder aqui.',
      '',
      '*Fraga Contabilidade*',
    ].join('\n'),
  },
};

/**
 * Meses em português para formatação da lista de boletos
 */
const MESES_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

/**
 * Formatar data de vencimento como "Mês/Ano" (ex: "Janeiro/2026")
 */
export function formatMonthYear(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  // Usar UTC para evitar drift de timezone ao interpretar datas YYYY-MM-DD
  const month = d.getUTCMonth(); // 0-indexed
  const year = d.getUTCFullYear();
  return `${MESES_PT[month]}/${year}`;
}

/**
 * Gerar lista de boletos por mês/ano com link individual
 * Formato: 📄 *Mês/Ano*: https://...
 * Títulos sem link são omitidos. Ordenados por data de vencimento (mais antigo primeiro).
 */
export function buildBoletoList(
  receivables: Array<{
    dueDate: Date | string;
    paymentLinkCanonical: string | null;
  }>
): string {
  // Ordenar por data de vencimento (mais antigo primeiro)
  const sorted = receivables
    .filter(r => r.paymentLinkCanonical)
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  if (sorted.length === 0) {
    return '(links não disponíveis)';
  }

  // Deduplicar por link: mesmo link = mesma fatura no Conta Azul (múltiplos títulos por vencimento)
  // Manter apenas a primeira ocorrência de cada link (data mais antiga)
  const seen = new Set<string>();
  const unique = sorted.filter(r => {
    const link = r.paymentLinkCanonical!;
    if (seen.has(link)) return false;
    seen.add(link);
    return true;
  });

  return unique
    .map(r => `📄 *${formatMonthYear(r.dueDate)}*: ${r.paymentLinkCanonical}`)
    .join('\n');
}

/**
 * Renderizar template CONSOLIDADO com lista de boletos por mês/ano
 * Substitui {{listaBoletos}} pela lista gerada por buildBoletoList.
 */
export function renderConsolidatedMessage(
  bucketCode: BucketCode,
  variables: {
    nome: string;
    qtd: number;
    total: string;
    maisAntigo: string;
    maisRecente: string;
    diasAtraso: number;
    link: string;
    correlationId: string;
    /** Lista de receivables com dueDate e paymentLinkCanonical para gerar {{listaBoletos}} */
    receivablesList?: Array<{ dueDate: Date | string; paymentLinkCanonical: string | null }>;
  }
): string {
  const template = CONSOLIDATED_TEMPLATES[bucketCode];
  if (!template) throw new Error(`Template consolidado para bucket ${bucketCode} não encontrado`);

  // Gerar lista de boletos por mês/ano
  const listaBoletos = variables.receivablesList && variables.receivablesList.length > 0
    ? buildBoletoList(variables.receivablesList)
    : variables.link || '(link não disponível)';

  let message = template.template;
  message = message.replace(/\{\{nome\}\}/g, variables.nome);
  message = message.replace(/\{\{qtd\}\}/g, String(variables.qtd));
  message = message.replace(/\{\{total\}\}/g, variables.total);
  message = message.replace(/\{\{maisAntigo\}\}/g, variables.maisAntigo);
  message = message.replace(/\{\{maisRecente\}\}/g, variables.maisRecente);
  message = message.replace(/\{\{diasAtraso\}\}/g, String(variables.diasAtraso));
  message = message.replace(/\{\{link\}\}/g, variables.link);
  message = message.replace(/\{\{listaBoletos\}\}/g, listaBoletos);
  message = message.replace(/\{\{correlationId\}\}/g, variables.correlationId);

  return message;
}

/**
 * Gerar correlationId para envio consolidado
 * Formato: [#FRAGA:C:clientId:receivableIds:timestamp]
 */
export function generateConsolidatedCorrelationId(
  clientId: number,
  receivableIds: number[]
): string {
  const ts = Date.now();
  const ids = receivableIds.slice(0, 3).join('+'); // Limitar a 3 IDs no correlationId
  return `#FRAGA:C:${clientId}:${ids}:${ts}`;
}

/**
 * Formatar valor em BRL
 */
export function formatBRL(amount: string | number): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Formatar data em DD/MM/YYYY
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/**
 * Gerar correlationId único
 * Formato: [#FRAGA:clientId:receivableId:timestamp]
 */
export function generateCorrelationId(clientId: number, receivableId: number): string {
  const ts = Date.now();
  return `#FRAGA:${clientId}:${receivableId}:${ts}`;
}

/**
 * Renderizar template com variáveis
 * @param bucketCode - Código do bucket (A, B, C, D, D1)
 * @param dispatchCount - Número de envios anteriores (usado para escolher D1 vs D)
 */
export function renderMessage(
  bucketCode: BucketCode,
  variables: {
    nome: string;
    valor: string;
    vencimento: string;
    diasAtraso: number;
    link: string;
    correlationId: string;
  },
  dispatchCount: number = 0
): string {
  // Se bucket D e primeiro envio (dispatchCount=0), usar D1 (tom suave)
  let templateKey: BucketCode | 'D1' = bucketCode;
  if (bucketCode === 'D' && dispatchCount === 0) {
    templateKey = 'D1';
  }

  const template = MESSAGE_TEMPLATES[templateKey];
  if (!template) throw new Error(`Template para bucket ${templateKey} não encontrado`);

  let message = template.template;
  message = message.replace(/\{\{nome\}\}/g, variables.nome);
  message = message.replace(/\{\{valor\}\}/g, variables.valor);
  message = message.replace(/\{\{vencimento\}\}/g, variables.vencimento);
  message = message.replace(/\{\{diasAtraso\}\}/g, String(variables.diasAtraso));
  message = message.replace(/\{\{link\}\}/g, variables.link);
  message = message.replace(/\{\{correlationId\}\}/g, variables.correlationId);

  return message;
}
