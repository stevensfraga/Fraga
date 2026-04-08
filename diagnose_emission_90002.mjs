import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

try {
  console.log('='.repeat(80));
  console.log('DIAGNÓSTICO DA EMISSÃO 90002');
  console.log('='.repeat(80));
  console.log('');

  // 1. Status da emissão no banco
  console.log('1️⃣  STATUS DA EMISSÃO NO BANCO:');
  const [emissoes] = await conn.execute(
    `SELECT id, configId, tomadorId, tomadorNome, tomadorCpfCnpj, 
            descricaoServico, valor, competencia, numeroNf, codigoVerificacao,
            status, pdfUrl, pdfStorageKey, erroDetalhes, solicitadoPor, solicitadoVia,
            processadoEm, createdAt, updatedAt 
     FROM nfse_emissoes WHERE id = 90002`
  );

  if (!Array.isArray(emissoes) || emissoes.length === 0) {
    console.log('❌ Emissão 90002 não encontrada no banco');
    process.exit(1);
  }

  const emissao = emissoes[0];
  console.log(`   ID: ${emissao.id}`);
  console.log(`   Config ID: ${emissao.configId}`);
  console.log(`   Tomador: ${emissao.tomadorNome} (${emissao.tomadorCpfCnpj})`);
  console.log(`   Descrição: ${emissao.descricaoServico}`);
  console.log(`   Valor: R$ ${emissao.valor}`);
  console.log(`   Competência: ${emissao.competencia}`);
  console.log(`   Status: ${emissao.status}`);
  console.log(`   Número NF: ${emissao.numeroNf || 'não capturado'}`);
  console.log(`   Código Verificação: ${emissao.codigoVerificacao || 'não gerado'}`);
  console.log(`   PDF URL: ${emissao.pdfUrl || 'não disponível'}`);
  console.log(`   PDF Storage Key: ${emissao.pdfStorageKey || 'não salvo'}`);
  console.log(`   Solicitado por: ${emissao.solicitadoPor}`);
  console.log(`   Solicitado via: ${emissao.solicitadoVia}`);
  console.log(`   Processado em: ${emissao.processadoEm || 'não processado'}`);
  console.log(`   Criado em: ${emissao.createdAt}`);
  console.log(`   Atualizado em: ${emissao.updatedAt}`);
  console.log('');

  // 2. Mensagem de erro completa
  console.log('2️⃣  MENSAGEM DE ERRO COMPLETA:');
  if (emissao.erroDetalhes) {
    try {
      const erro = JSON.parse(emissao.erroDetalhes);
      console.log(JSON.stringify(erro, null, 2));
    } catch {
      console.log(emissao.erroDetalhes);
    }
  } else {
    console.log('   (nenhum erro registrado)');
  }
  console.log('');

  // 3. Buscar logs na tabela nfse_emission_logs (estrutura diferente)
  console.log('3️⃣  LOGS DETALHADOS POR ETAPA:');
  const [logsTable] = await conn.execute(
    `SELECT cnpj, company_name, status, nfse_number, service_description, 
            service_value, client_name, client_cnpj, logs, error_message, 
            error_stack, started_at, completed_at, duration_ms
     FROM nfse_emission_logs 
     WHERE cnpj = '07838084000186' OR company_name LIKE '%Fraga%'
     ORDER BY created_at DESC LIMIT 1`
  );

  if (Array.isArray(logsTable) && logsTable.length > 0) {
    const logEntry = logsTable[0];
    console.log(`   CNPJ: ${logEntry.cnpj}`);
    console.log(`   Empresa: ${logEntry.company_name}`);
    console.log(`   Status: ${logEntry.status}`);
    console.log(`   Número NFS-e: ${logEntry.nfse_number || 'não capturado'}`);
    console.log(`   Descrição: ${logEntry.service_description}`);
    console.log(`   Valor: ${logEntry.service_value}`);
    console.log(`   Cliente: ${logEntry.client_name} (${logEntry.client_cnpj})`);
    console.log(`   Duração: ${logEntry.duration_ms}ms`);
    console.log(`   Iniciado em: ${logEntry.started_at}`);
    console.log(`   Concluído em: ${logEntry.completed_at}`);
    console.log('');
    
    // Exibir logs estruturados
    if (logEntry.logs) {
      try {
        const logsArray = JSON.parse(logEntry.logs);
        console.log('   Etapas executadas:');
        logsArray.forEach((log, idx) => {
          const statusIcon = log.status === 'ok' ? '✅' : '❌';
          console.log(`      ${idx + 1}. ${statusIcon} [${log.stage}] ${log.message}`);
          if (log.details) {
            console.log(`         Detalhes: ${JSON.stringify(log.details).substring(0, 150)}`);
          }
        });
      } catch {
        console.log(`   Logs (raw): ${logEntry.logs}`);
      }
    }
    console.log('');

    // 4. Identificar em qual etapa parou
    console.log('4️⃣  ETAPA ONDE PAROU:');
    if (logEntry.logs) {
      try {
        const logsArray = JSON.parse(logEntry.logs);
        if (logsArray.length > 0) {
          const lastLog = logsArray[logsArray.length - 1];
          console.log(`   Última etapa: ${lastLog.stage}`);
          console.log(`   Status: ${lastLog.status}`);
          console.log(`   Mensagem: ${lastLog.message}`);
          console.log('');
          
          // Mapear para as 5 etapas críticas
          const etapas = ['LOGIN_OK', 'EMPRESA_OK', 'FORM_OK', 'SUBMIT_OK', 'NFSE_CAPTURED'];
          const etapasCompletadas = logsArray
            .filter(l => l.status === 'ok')
            .map(l => l.stage);
          
          console.log(`   Etapas completadas: ${etapasCompletadas.join(', ') || 'nenhuma'}`);
          console.log(`   Etapas faltando: ${etapas.filter(e => !etapasCompletadas.some(c => c.includes(e))).join(', ')}`);
        }
      } catch {
        console.log('   (não foi possível parsear logs)');
      }
    }
    console.log('');

    // 5. Classificar tipo de erro
    console.log('5️⃣  CLASSIFICAÇÃO DO ERRO:');
    const erroStr = (logEntry.error_message || '').toLowerCase();
    
    let tipoErro = 'desconhecido';
    
    if (erroStr.includes('captcha')) {
      tipoErro = 'CAPTCHA';
    } else if (erroStr.includes('login') || erroStr.includes('autenticação') || erroStr.includes('unauthorized')) {
      tipoErro = 'LOGIN';
    } else if (erroStr.includes('empresa') || erroStr.includes('cnpj') || erroStr.includes('seleção')) {
      tipoErro = 'SELEÇÃO_EMPRESA';
    } else if (erroStr.includes('campo') || erroStr.includes('obrigatório') || erroStr.includes('required')) {
      tipoErro = 'CAMPO_OBRIGATÓRIO';
    } else if (erroStr.includes('validação') || erroStr.includes('validation')) {
      tipoErro = 'VALIDAÇÃO_PORTAL';
    } else if (erroStr.includes('submit') || erroStr.includes('envio')) {
      tipoErro = 'SUBMIT';
    } else if (erroStr.includes('número') || erroStr.includes('nfse') || erroStr.includes('captura')) {
      tipoErro = 'CAPTURA_NÚMERO';
    } else if (erroStr.includes('timeout') || erroStr.includes('timed out')) {
      tipoErro = 'TIMEOUT_NAVEGADOR';
    } else if (erroStr.includes('sessão') || erroStr.includes('session') || erroStr.includes('expirado')) {
      tipoErro = 'SESSÃO_EXPIRADA';
    } else if (erroStr.includes('falha ao concluir')) {
      tipoErro = 'FALHA_PORTAL (Procure o Suporte Técnico)';
    }
    
    console.log(`   Tipo de erro: ${tipoErro}`);
    console.log('');

    // 6. Mensagem de erro detalhada
    console.log('6️⃣  MENSAGEM DE ERRO DETALHADA:');
    if (logEntry.error_message) {
      console.log(logEntry.error_message);
    }
    console.log('');

    // 7. Stack trace
    console.log('7️⃣  STACK TRACE:');
    if (logEntry.error_stack) {
      console.log(logEntry.error_stack);
    } else {
      console.log('   (não disponível)');
    }
    console.log('');

    // 8. Resumo técnico
    console.log('8️⃣  RESUMO TÉCNICO:');
    console.log(`   Status final: ${logEntry.status}`);
    console.log(`   Duração total: ${logEntry.duration_ms}ms (${(logEntry.duration_ms / 1000).toFixed(2)}s)`);
    console.log(`   Número NFS-e capturado: ${logEntry.nfse_number ? 'SIM' : 'NÃO'}`);
    console.log('');

  } else {
    console.log('   (nenhum log encontrado para esta empresa)');
    console.log('');
    console.log('   Buscando todos os logs recentes...');
    const [allLogs] = await conn.execute(
      `SELECT cnpj, company_name, status, error_message, created_at 
       FROM nfse_emission_logs 
       ORDER BY created_at DESC LIMIT 5`
    );
    
    if (Array.isArray(allLogs) && allLogs.length > 0) {
      console.log(`   Encontrados ${allLogs.length} logs recentes:`);
      allLogs.forEach((log, idx) => {
        console.log(`   ${idx + 1}. ${log.company_name} (${log.cnpj}) - Status: ${log.status}`);
      });
    }
  }

  console.log('='.repeat(80));
  console.log('FIM DO DIAGNÓSTICO');
  console.log('='.repeat(80));

} catch (err) {
  console.error('❌ Erro durante diagnóstico:', err.message);
  console.error(err);
} finally {
  await conn.end();
}
