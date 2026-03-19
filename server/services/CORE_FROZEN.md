# ⛔ CORE CONGELADO — Motor de Emissão NFS-e

## Baseline Oficial

| Campo | Valor |
|---|---|
| **Checkpoint de referência** | `b1a85c9f` |
| **Data de congelamento** | 14/03/2026 |
| **Portal** | Vila Velha (SMARAPD) — tributacao.vilavelha.es.gov.br |
| **Empresa** | S.T. FRAGA CONTABILIDADE LTDA (CCM 43902) |
| **CNPJ** | 07.838.084/0001-86 |
| **NFS-e de referência** | 1012 |
| **Resultado** | SUCCESS |

Este checkpoint é o **padrão ouro** do motor. Qualquer regressão deve ser comparada contra este baseline.

---

## Arquivos Protegidos

Não alterar sem criar branch separada e validar com emissão real:

| Arquivo | Responsabilidade |
|---|---|
| `nfseEmissionEngine.ts` | Motor principal — login, preenchimento, submit, captura |
| `vilavelha.selectors.ts` | Seletores CSS/XPath do portal Vila Velha |

---

## WARNs Aceitáveis (não são falhas)

Os seguintes WARNs fazem parte do comportamento normal do motor e **não indicam regressão**:

| WARN | Motivo |
|---|---|
| `SESSION_EXPIRED` | Sessão persistida expirou — motor reautentica automaticamente |
| `NBS_AUTOCOMPLETE_NO_ITEM` | Autocomplete do portal não retorna itens via DOM — normal, usa API direta |
| `NBS_API_PARSE` | Parse parcial da resposta HTML do autoSuggest — ID extraído por fallback |
| `PDF_DOWNLOAD` | Download do PDF ainda não implementado — próxima evolução |

Qualquer outro WARN ou FAIL fora desta lista deve ser investigado como possível regressão.

---

## Fluxo Validado (sequência de referência)

O motor executa as seguintes etapas em sequência. Todos os steps abaixo devem estar OK para considerar o fluxo saudável:

```
✅ INIT
✅ PORTAL_LOADED
✅ AUTH_STRATEGY
✅ NAVIGATE
⚠️ SESSION_EXPIRED          ← WARN aceitável
✅ LOGIN_CAPTCHA_DETECTED
✅ CAPTCHA_SOLVED
✅ LOGIN_OK
✅ SESSION_RENEWED
✅ CLICK_NOTA_FISCAL
✅ EMPRESA_GRID_VISIBLE
✅ SELECT_EMPRESA
✅ NAVIGATE_EMISSION
✅ NFSE_MENU_VISIBLE
✅ TOMADOR_CNPJ_FILL
✅ TOMADOR_CEP_FILL
✅ ATIVIDADE_OK
✅ NBS_START
⚠️ NBS_AUTOCOMPLETE_NO_ITEM ← WARN aceitável
✅ NBS_API_PROBE
⚠️ NBS_API_PARSE             ← WARN aceitável
✅ NBS_FILLED
✅ PAIS_FILLED
✅ MUNICIPIO_FILLED
✅ ESTADO_FILLED
✅ ITEM_ADDED
✅ ATIVIDADE_PRE_SUBMIT
✅ NBS_PRE_SUBMIT
✅ SUBMIT_SUCCESS_MODAL
✅ SUBMIT                    ← numeroNfse capturado aqui
⚠️ PDF_DOWNLOAD              ← WARN aceitável (próxima evolução)
✅ EMISSAO_COMPLETED
```

---

## Decisões Técnicas Críticas (não reverter)

### 1. NBS via API direta do portal
O campo NBS usa `initAutoSuggest` (sistema proprietário SMARAPD). O autocomplete não é ativado por eventos DOM padrão. A solução é fazer um POST direto ao portal:

```
POST /tbw/servlet/controle
cmd=autoSuggest&submitedType=fastSubmit&vlrComparacao=1.1302&objFast=qynbsdescricao&obj=RBJGYHOTBU&win=XEFSDOQNWJ
```

O servidor retorna HTML com `<table class="autoSuggest">`. O ID interno (ex: `697`) é extraído e preenchido diretamente em `qyidnbs`.

### 2. ATIVIDADE_PRE_SUBMIT sem disparar eventos
`qyidatividade_onchange` faz `fastSubmit` que recarrega o formulário inteiro, limpando NBS, País, Município e todos os outros campos. Por isso, o valor de `qyidatividade` é forçado via `nativeInputValueSetter` **sem** disparar `change`.

### 3. NBS_PRE_SUBMIT após ATIVIDADE_PRE_SUBMIT
A mudança de atividade (mesmo sem disparar `change`) pode limpar o NBS em algumas situações. Por isso, o NBS é repreenchido via API direta **depois** do ATIVIDADE_PRE_SUBMIT, imediatamente antes do clique em "Confirmar Nota".

### 4. Detecção de sucesso antes de erros
O portal exibe um modal de sucesso com `×` para fechar. O seletor `div.alert-danger` capturava esse `×` como erro. A lógica verifica o texto "nota fiscal número X foi gerada com sucesso" **antes** de verificar erros.

### 5. Nomes de colunas no banco
A tabela `nfse_emissoes` usa `numeroNf` (não `numeroNfse`) e `processadoEm` (não `dataEmissao`). O SQL do UPDATE deve usar esses nomes exatos.

---

## Evoluções Permitidas (fora do core)

As seguintes funcionalidades podem ser desenvolvidas **sem tocar** nos arquivos congelados:

- **PDF_DOWNLOAD** — capturar link "Clique aqui" do modal de sucesso antes de fechá-lo
- **Histórico de emissões** — tabela no dashboard com status, número, data, valor, PDF
- **UI de emissão manual** — formulário no dashboard para disparar emissão
- **Observabilidade** — painel de logs por emissão, timeline de steps
- **Retry automático** — retentar em caso de falha de captcha ou sessão expirada
- **Operação assistida** — emissão em lote com aprovação manual

---

## Protocolo para Alterar o Core (se necessário)

1. Criar branch: `git checkout -b feature/nfse-core-v2`
2. Fazer as alterações e testar com emissão real no portal de Vila Velha
3. Comparar o log de steps com o reference log (`CORE_REFERENCE_LOG.txt`)
4. Só fazer merge após validação em produção com NFS-e real emitida
5. Atualizar este arquivo e o `CORE_REFERENCE_LOG.txt` com o novo baseline
6. Criar novo checkpoint e registrar como novo padrão ouro

**Nunca alterar o core diretamente na branch principal sem teste real.**
