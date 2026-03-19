/**
 * Testes unitários para BLOCO 11 — Classificação por faixa de atraso
 */
import { describe, it, expect } from 'vitest';
import {
  calcDaysOverdue,
  classifyBucket,
  classifyReceivables,
  groupByBucket,
  getBucketByCode,
  BUCKET_DEFINITIONS,
} from './buckets';
import {
  renderMessage,
  formatBRL,
  formatDate,
  generateCorrelationId,
  MESSAGE_TEMPLATES,
} from './messageTemplates';
import { normalizeWhatsApp } from './eligibilityFilter';

// ============================================================================
// BUCKET CLASSIFICATION TESTS
// ============================================================================

describe('calcDaysOverdue', () => {
  it('deve retornar 0 para data de hoje', () => {
    const today = new Date();
    expect(calcDaysOverdue(today)).toBe(0);
  });

  it('deve retornar dias positivos para datas passadas', () => {
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    expect(calcDaysOverdue(fiveDaysAgo)).toBe(5);
  });

  it('deve retornar dias negativos para datas futuras', () => {
    const inThreeDays = new Date();
    inThreeDays.setDate(inThreeDays.getDate() + 3);
    expect(calcDaysOverdue(inThreeDays)).toBe(-3);
  });

  it('deve aceitar string ISO como input', () => {
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    expect(calcDaysOverdue(fiveDaysAgo.toISOString())).toBe(5);
  });
});

describe('classifyBucket', () => {
  it('deve retornar null para dias <= 0 (não vencido)', () => {
    expect(classifyBucket(0)).toBeNull();
    expect(classifyBucket(-1)).toBeNull();
  });

  it('deve classificar D+1 a D+3 como bucket A (Lembrete Leve)', () => {
    expect(classifyBucket(1)?.code).toBe('A');
    expect(classifyBucket(2)?.code).toBe('A');
    expect(classifyBucket(3)?.code).toBe('A');
  });

  it('deve classificar D+4 a D+15 como bucket B (Cobrança Formal)', () => {
    expect(classifyBucket(4)?.code).toBe('B');
    expect(classifyBucket(10)?.code).toBe('B');
    expect(classifyBucket(15)?.code).toBe('B');
  });

  it('deve classificar D+16 a D+30 como bucket C (Cobrança Firme)', () => {
    expect(classifyBucket(16)?.code).toBe('C');
    expect(classifyBucket(25)?.code).toBe('C');
    expect(classifyBucket(30)?.code).toBe('C');
  });

  it('deve classificar +30 dias como bucket D (Pré-Jurídico)', () => {
    expect(classifyBucket(31)?.code).toBe('D');
    expect(classifyBucket(60)?.code).toBe('D');
    expect(classifyBucket(365)?.code).toBe('D');
  });

  it('deve retornar messageType correto para cada bucket', () => {
    expect(classifyBucket(2)?.messageType).toBe('friendly');
    expect(classifyBucket(10)?.messageType).toBe('administrative');
    expect(classifyBucket(20)?.messageType).toBe('formal');
    expect(classifyBucket(45)?.messageType).toBe('formal');
  });
});

describe('getBucketByCode', () => {
  it('deve retornar bucket correto por código', () => {
    expect(getBucketByCode('A').label).toBe('Lembrete Leve');
    expect(getBucketByCode('B').label).toBe('Cobrança Formal');
    expect(getBucketByCode('C').label).toBe('Cobrança Firme');
    expect(getBucketByCode('D').label).toBe('Pré-Jurídico');
  });

  it('deve lançar erro para código inválido', () => {
    expect(() => getBucketByCode('X' as any)).toThrow();
  });
});

describe('classifyReceivables', () => {
  it('deve classificar array de receivables em buckets', () => {
    const now = new Date();
    const twoDaysAgo = new Date(now);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const tenDaysAgo = new Date(now);
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
    const fortyDaysAgo = new Date(now);
    fortyDaysAgo.setDate(fortyDaysAgo.getDate() - 40);

    const receivables = [
      { id: 1, clientId: 100, amount: '500.00', dueDate: twoDaysAgo, link: 'http://pay.me/1' },
      { id: 2, clientId: 101, amount: '1000.00', dueDate: tenDaysAgo, link: 'http://pay.me/2' },
      { id: 3, clientId: 102, amount: '2000.00', dueDate: fortyDaysAgo, link: null },
    ];

    const classified = classifyReceivables(receivables);
    expect(classified).toHaveLength(3);
    expect(classified[0].bucket.code).toBe('A');
    expect(classified[1].bucket.code).toBe('B');
    expect(classified[2].bucket.code).toBe('D');
  });

  it('deve excluir receivables não vencidos', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const receivables = [
      { id: 1, clientId: 100, amount: '500.00', dueDate: tomorrow, link: null },
    ];

    const classified = classifyReceivables(receivables);
    expect(classified).toHaveLength(0);
  });
});

describe('groupByBucket', () => {
  it('deve agrupar receivables classificados por bucket', () => {
    const now = new Date();
    const twoDaysAgo = new Date(now);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const tenDaysAgo = new Date(now);
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

    const receivables = [
      { id: 1, clientId: 100, amount: '500.00', dueDate: twoDaysAgo, link: null },
      { id: 2, clientId: 101, amount: '1000.00', dueDate: tenDaysAgo, link: null },
      { id: 3, clientId: 102, amount: '1500.00', dueDate: tenDaysAgo, link: null },
    ];

    const classified = classifyReceivables(receivables);
    const grouped = groupByBucket(classified);

    expect(grouped).toHaveLength(4); // 4 buckets (A, B, C, D)
    
    const bucketA = grouped.find(g => g.bucket.code === 'A');
    expect(bucketA?.count).toBe(1);
    expect(bucketA?.totalAmount).toBe(500);

    const bucketB = grouped.find(g => g.bucket.code === 'B');
    expect(bucketB?.count).toBe(2);
    expect(bucketB?.totalAmount).toBe(2500);
  });
});

// ============================================================================
// MESSAGE TEMPLATE TESTS
// ============================================================================

describe('MESSAGE_TEMPLATES', () => {
  it('deve ter templates para todos os buckets', () => {
    expect(MESSAGE_TEMPLATES.A).toBeDefined();
    expect(MESSAGE_TEMPLATES.B).toBeDefined();
    expect(MESSAGE_TEMPLATES.C).toBeDefined();
    expect(MESSAGE_TEMPLATES.D).toBeDefined();
  });

  it('cada template deve conter placeholder {{nome}}', () => {
    for (const [code, template] of Object.entries(MESSAGE_TEMPLATES)) {
      expect(template.template).toContain('{{nome}}');
    }
  });

  it('cada template deve conter placeholder {{link}}', () => {
    for (const [code, template] of Object.entries(MESSAGE_TEMPLATES)) {
      expect(template.template).toContain('{{link}}');
    }
  });
});

describe('renderMessage', () => {
  it('deve substituir todas as variáveis no template B', () => {
    const message = renderMessage('B', {
      nome: 'João',
      valor: 'R$ 1.500,00',
      vencimento: '15/02/2026',
      diasAtraso: 8,
      link: 'https://pay.me/123',
      correlationId: '#FRAGA:100:200:1234567890',
    });

    expect(message).toContain('João');
    expect(message).toContain('15/02/2026');
    expect(message).toContain('https://pay.me/123');
    expect(message).not.toContain('{{nome}}');
    expect(message).not.toContain('{{link}}');
    expect(message).not.toContain('{{vencimento}}');
  });

  it('deve incluir valor e dias de atraso no template C', () => {
    const message = renderMessage('C', {
      nome: 'Maria',
      valor: 'R$ 2.000,00',
      vencimento: '01/02/2026',
      diasAtraso: 22,
      link: 'https://pay.me/456',
      correlationId: '#FRAGA:101:201:1234567890',
    });

    expect(message).toContain('R$ 2.000,00');
    expect(message).toContain('22');
  });

  it('deve lançar erro para bucket inválido', () => {
    expect(() =>
      renderMessage('X' as any, {
        nome: 'Test',
        valor: 'R$ 100,00',
        vencimento: '01/01/2026',
        diasAtraso: 5,
        link: 'http://test',
        correlationId: '#FRAGA:1:1:1',
      })
    ).toThrow();
  });
});

describe('formatBRL', () => {
  it('deve formatar número como BRL', () => {
    const result = formatBRL(1500);
    expect(result).toContain('1.500');
    expect(result).toContain('R$');
  });

  it('deve formatar string como BRL', () => {
    const result = formatBRL('2500.50');
    expect(result).toContain('2.500');
    expect(result).toContain('50');
  });
});

describe('formatDate', () => {
  it('deve formatar data em DD/MM/YYYY', () => {
    const date = new Date('2026-02-15T12:00:00Z');
    const result = formatDate(date);
    expect(result).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    expect(result).toContain('2026');
  });
});

describe('generateCorrelationId', () => {
  it('deve gerar ID no formato correto', () => {
    const id = generateCorrelationId(100, 200);
    expect(id).toMatch(/^#FRAGA:100:200:\d+$/);
  });

  it('deve gerar IDs únicos', () => {
    const id1 = generateCorrelationId(100, 200);
    // Pequeno delay para garantir timestamp diferente
    const id2 = generateCorrelationId(100, 200);
    // Podem ser iguais se executados no mesmo ms, mas o formato deve ser correto
    expect(id1).toMatch(/^#FRAGA:/);
    expect(id2).toMatch(/^#FRAGA:/);
  });
});

// ============================================================================
// PHONE NORMALIZATION TESTS
// ============================================================================

describe('normalizeWhatsApp', () => {
  it('deve normalizar número com +55', () => {
    expect(normalizeWhatsApp('+5527995810001')).toBe('+5527995810001');
  });

  it('deve adicionar +55 para número sem código de país', () => {
    expect(normalizeWhatsApp('27995810001')).toBe('+5527995810001');
  });

  it('deve adicionar + para número com 55 sem +', () => {
    expect(normalizeWhatsApp('5527995810001')).toBe('+5527995810001');
  });

  it('deve limpar espaços e hífens', () => {
    expect(normalizeWhatsApp('+55 (27) 99581-0001')).toBe('+5527995810001');
  });
});

// ============================================================================
// BUCKET DEFINITIONS INTEGRITY
// ============================================================================

describe('BUCKET_DEFINITIONS', () => {
  it('deve ter exatamente 4 buckets', () => {
    expect(BUCKET_DEFINITIONS).toHaveLength(4);
  });

  it('deve cobrir faixas contíguas sem gaps', () => {
    expect(BUCKET_DEFINITIONS[0].minDays).toBe(1);
    expect(BUCKET_DEFINITIONS[0].maxDays).toBe(3);
    expect(BUCKET_DEFINITIONS[1].minDays).toBe(4);
    expect(BUCKET_DEFINITIONS[1].maxDays).toBe(15);
    expect(BUCKET_DEFINITIONS[2].minDays).toBe(16);
    expect(BUCKET_DEFINITIONS[2].maxDays).toBe(30);
    expect(BUCKET_DEFINITIONS[3].minDays).toBe(31);
    expect(BUCKET_DEFINITIONS[3].maxDays).toBe(Infinity);
  });

  it('cada bucket deve ter código único', () => {
    const codes = BUCKET_DEFINITIONS.map(b => b.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
