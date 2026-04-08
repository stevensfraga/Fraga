/**
 * NFS-e CAPTCHA Solver — Resolução automática via 2captcha (primário) + LLM Vision (fallback)
 *
 * Estratégia:
 * 1. Capturar screenshot apenas da área do CAPTCHA
 * 2. Tentar resolver via 2captcha (serviço especializado, mais preciso)
 * 3. Fallback: enviar imagem para LLM Vision (base64)
 * 4. Preencher no campo do formulário
 * 5. Tentar login
 *
 * Logs esperados:
 *   LOGIN_CAPTCHA_DETECTED → CAPTCHA_SENT_TO_LLM → CAPTCHA_SOLVED (method: 2captcha|llm_vision) → LOGIN_OK
 *   ou
 *   CAPTCHA_FAIL → (fallback para sessão persistente)
 */

import Anthropic from "@anthropic-ai/sdk";
import { Solver } from "2captcha";

/**
 * Resolve CAPTCHA de imagem via serviço 2captcha.
 * Usa a chave CAPTCHA_API_KEY do ambiente.
 * Retorna o texto do CAPTCHA ou null em caso de falha.
 */
async function solveCaptchaWith2captcha(base64Image: string): Promise<string | null> {
  const apiKey = process.env.CAPTCHA_API_KEY;
  if (!apiKey) {
    console.warn("[CaptchaSolver] CAPTCHA_API_KEY não configurada — pulando 2captcha");
    return null;
  }
  try {
    const solver = new Solver(apiKey);
    const result = await solver.imageCaptcha(base64Image, {
      numeric: 0,
      min_len: 4,
      max_len: 8,
      lang: "en",
    });
    const text = (result?.data ?? "").trim();
    console.log(`[CaptchaSolver] 2captcha resolveu: "${text}" (id=${result?.id})`);
    return text || null;
  } catch (err: any) {
    console.warn("[CaptchaSolver] Erro no 2captcha:", err.message);
    return null;
  }
}

export interface CaptchaAttemptResult {
  success: boolean;
  captchaText?: string;
  error?: string;
  attempts: number;
  logs: Array<{ step: string; status: "OK" | "FAIL" | "WARN"; details?: any }>;
}

/**
 * Captura screenshot da área do CAPTCHA e retorna como base64.
 * Tenta capturar apenas o elemento da imagem do CAPTCHA.
 * Se não encontrar o elemento, captura a tela inteira.
 */
async function captureCaptchaImage(page: any): Promise<{ base64: string; mimeType: string } | null> {
  try {
    // Tentar capturar apenas o elemento do CAPTCHA
    const captchaImg = await page.$("img[src*='getCaptcha'], img[src*='captcha'], #captchaImg, .captcha-img").catch(() => null);
    if (captchaImg) {
      const buffer = await captchaImg.screenshot();
      return {
        base64: buffer.toString("base64"),
        mimeType: "image/png",
      };
    }

    // Fallback: capturar tela inteira (LLM vai identificar o CAPTCHA)
    const buffer = await page.screenshot({ fullPage: false });
    return {
      base64: buffer.toString("base64"),
      mimeType: "image/png",
    };
  } catch (err: any) {
    console.warn("[CaptchaSolver] Erro ao capturar imagem do CAPTCHA:", err.message);
    return null;
  }
}

/**
 * Envia imagem do CAPTCHA para Claude Haiku (Anthropic) e retorna o texto extraído.
 * Usa visão nativa do Claude — mais preciso que DeepSeek para OCR de CAPTCHA.
 * Fallback quando 2captcha não consegue resolver.
 */
async function solveCaptchaWithClaudeVision(base64Image: string, mimeType: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[CaptchaSolver] ANTHROPIC_API_KEY não configurada — pulando Claude Vision");
    return null;
  }
  try {
    const client = new Anthropic({ apiKey, timeout: 20_000 });
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 64,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mimeType as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
                data: base64Image,
              },
            },
            {
              type: "text",
              text:
                "This is a CAPTCHA image. Read ALL characters from left to right. " +
                "CAPTCHA is CASE-SENSITIVE. Return ONLY the characters, no spaces, no explanations. " +
                "Pay attention to similar chars: 0 vs O, 1 vs l vs I. " +
                "Include the FIRST and LAST characters. Return only the raw text.",
            },
          ],
        },
      ],
    });

    const content = response.content?.[0]?.type === "text" ? response.content[0].text : "";
    const cleaned = content
      .trim()
      .replace(/['"`.]/g, "")
      .replace(/\s+/g, "")
      .substring(0, 20);

    console.log(`[CaptchaSolver] Claude Vision resolveu: "${cleaned}"`);
    return cleaned || null;
  } catch (err: any) {
    console.warn("[CaptchaSolver] Erro ao chamar Claude Vision:", err.message);
    return null;
  }
}

/**
 * Tenta resolver o CAPTCHA e fazer login automaticamente.
 * Retorna resultado com logs estruturados.
 *
 * @param page - Página Playwright já na tela de login
 * @param usuario - CPF/CNPJ do contador
 * @param senha - Senha descriptografada
 * @param maxAttempts - Número máximo de tentativas (padrão: 3)
 */
export async function solveCaptchaAndLogin(
  page: any,
  usuario: string,
  senha: string,
  maxAttempts = 3
): Promise<CaptchaAttemptResult> {
  const logs: CaptchaAttemptResult["logs"] = [];
  const log = (step: string, status: "OK" | "FAIL" | "WARN", details?: any) => {
    logs.push({ step, status, details });
    console.log(`[CaptchaSolver] ${step}_${status}:`, JSON.stringify(details || {}).substring(0, 200));
  };

  let attempts = 0;

  // Aguardar carregamento da página antes de verificar
  await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // Verificar se estamos na tela de login
  // Portal Vila Velha usa: input#usuario (CNPJ/CPF do contador)
  // Fallback: qualquer campo de texto ou o campo de senha
  const loginField = await page.$(
    "input#usuario, input[name='usuario'], input[name='CPF_CGC'], input[type='text']:first-of-type, input#senha"
  ).catch(() => null);

  // Verificar URL também
  const currentPageUrl = page.url();
  const isLoginUrl = currentPageUrl.toLowerCase().includes("login");

  if (!loginField && !isLoginUrl) {
    log("LOGIN_CAPTCHA_DETECTED", "WARN", { note: "Campo de usuário não encontrado e URL não é de login", url: currentPageUrl });
    return { success: false, error: "Não está na tela de login", attempts: 0, logs };
  }

  // Se está na URL de login mas campo não foi encontrado ainda, aguardar mais
  if (!loginField && isLoginUrl) {
    log("LOGIN_CAPTCHA_DETECTED", "WARN", { note: "URL de login mas campo não encontrado, aguardando..." });
    await page.waitForTimeout(2000);
  }

  log("LOGIN_CAPTCHA_DETECTED", "OK", { url: page.url() });

  while (attempts < maxAttempts) {
    attempts++;
    log("CAPTCHA_ATTEMPT", "OK", { attempt: attempts, maxAttempts });

    try {
      // 1. Recarregar CAPTCHA se não for a primeira tentativa
      if (attempts > 1) {
        // Tentar clicar no CAPTCHA para recarregar (alguns portais fazem isso)
        const captchaImg = await page.$("img[src*='getCaptcha'], img[src*='captcha']").catch(() => null);
        if (captchaImg) {
          await captchaImg.click().catch(() => {});
          await page.waitForTimeout(800);
        }
        // Limpar campo do CAPTCHA
        await page.fill('input[name="imagem"], input[id*="captcha"], input[placeholder*="captcha"]', "").catch(() => {});
      }

      // 2. Capturar imagem do CAPTCHA
      const captchaImage = await captureCaptchaImage(page);
      if (!captchaImage) {
        log("CAPTCHA_SENT_TO_LLM", "FAIL", { attempt: attempts, error: "Não foi possível capturar imagem do CAPTCHA" });
        continue;
      }

      log("CAPTCHA_SENT_TO_LLM", "OK", { attempt: attempts, imageSize: captchaImage.base64.length });

      // 3. Resolver CAPTCHA: tenta 2captcha primeiro, fallback para DeepSeek Vision
      let captchaText: string | null = null;
      let captchaMethod = "2captcha";

      captchaText = await solveCaptchaWith2captcha(captchaImage.base64);
      if (!captchaText) {
        captchaMethod = "claude_vision";
        captchaText = await solveCaptchaWithClaudeVision(captchaImage.base64, captchaImage.mimeType);
      }

      if (!captchaText) {
        log("CAPTCHA_SOLVED", "FAIL", { attempt: attempts, error: "Nenhum método resolveu o CAPTCHA (2captcha + LLM Vision falharam)" });
        continue;
      }

      log("CAPTCHA_SOLVED", "OK", { attempt: attempts, captchaText, length: captchaText.length, method: captchaMethod });

      // 4. Preencher formulário de login
      // Usar triple-click + type para garantir que campos com máscara sejam preenchidos
      const usuarioEl = await page.$("#usuario").catch(() => null);
      if (usuarioEl) {
        await usuarioEl.click({ clickCount: 3 }); // Selecionar tudo
        await usuarioEl.fill(""); // Limpar
        await page.waitForTimeout(200);
        await usuarioEl.type(usuario, { delay: 50 }); // Digitar com delay
        await page.waitForTimeout(300);
      }

      const senhaEl = await page.$("#senha").catch(() => null);
      if (senhaEl) {
        await senhaEl.click({ clickCount: 3 });
        await senhaEl.fill("");
        await page.waitForTimeout(200);
        await senhaEl.type(senha, { delay: 50 });
        await page.waitForTimeout(300);
      }

      const captchaEl = await page.$('input[name="imagem"]').catch(() => null);
      if (captchaEl) {
        await captchaEl.click({ clickCount: 3 });
        await captchaEl.fill("");
        await page.waitForTimeout(200);
        await captchaEl.type(captchaText, { delay: 50 });
      } else {
        await page.fill('input[id*="captcha"]', captchaText).catch(() => {});
      }

      await page.waitForTimeout(500);

      // Verificar se campos foram preenchidos
      const usuarioVal = await page.$("#usuario") ? await page.$eval("#usuario", (el: HTMLInputElement) => el.value).catch(() => "") : "";
      const captchaVal = captchaEl ? await captchaEl.inputValue().catch(() => "") : "";
      log("FORM_FILLED", "OK", { attempt: attempts, usuarioFilled: usuarioVal.length > 0, captchaFilled: captchaVal.length > 0, captchaText });

      // 5. Clicar no botão de login
      const btnEntrar = await page.$("a#btnEntrar, button[type='submit'], input[type='submit'], a:has-text('Entrar')").catch(() => null);
      if (btnEntrar) {
        await btnEntrar.click();
      } else {
        await page.keyboard.press("Enter");
      }

      // 6. Aguardar resposta do servidor
      await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2000);

      const currentUrl = page.url();

      // 7. Verificar se login foi bem-sucedido
      // Sucesso: URL mudou para fora do login OU menu principal está visível
      const isStillOnLogin = await page.$("input#usuario, input[name='usuario']").catch(() => null);
      const hasMenu = await page.$("div#divnotafiscalouter, div[id*='outer']").catch(() => null);

      // Verificar mensagem de erro de CAPTCHA
      const errorMsg = await page.$(".erro, .alert-danger, #mensagemErro, span.error").catch(() => null);
      const errorText = errorMsg ? await errorMsg.textContent().catch(() => "") : "";

      if (hasMenu && !isStillOnLogin) {
        log("LOGIN_OK", "OK", {
          attempt: attempts,
          captchaText,
          url: currentUrl,
          method: "captcha_llm",
        });
        return { success: true, captchaText, attempts, logs };
      }

      if (errorText?.toLowerCase().includes("captcha") || errorText?.toLowerCase().includes("imagem")) {
        log("CAPTCHA_WRONG", "WARN", { attempt: attempts, captchaText, errorText: errorText?.trim() });
        // Continuar tentando
        continue;
      }

      if (isStillOnLogin) {
        log("LOGIN_FAIL", "WARN", { attempt: attempts, captchaText, url: currentUrl, errorText: errorText?.trim() });
        continue;
      }

      // URL mudou mas sem menu visível — pode ser outra tela pós-login
      if (!currentUrl.includes("login") && !currentUrl.includes("Login")) {
        log("LOGIN_OK", "OK", {
          attempt: attempts,
          captchaText,
          url: currentUrl,
          method: "captcha_llm_url_changed",
        });
        return { success: true, captchaText, attempts, logs };
      }

    } catch (err: any) {
      log("CAPTCHA_ATTEMPT_ERROR", "WARN", { attempt: attempts, error: err.message });
    }
  }

  log("CAPTCHA_FAIL", "FAIL", {
    attempts,
    error: `CAPTCHA não resolvido após ${attempts} tentativas`,
  });

  return {
    success: false,
    error: `CAPTCHA não resolvido após ${attempts} tentativas`,
    attempts,
    logs,
  };
}
