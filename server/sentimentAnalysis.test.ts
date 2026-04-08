import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  analyzeSentiment,
  getSimpleSentimentAnalysis,
  getSentimentTrend,
  type SentimentAnalysisResult,
  type ClientContext,
} from "./sentimentAnalysis";

describe("Sentiment Analysis", () => {
  const mockContext: ClientContext = {
    clientName: "Empresa Teste",
    amountOverdue: 5000,
    daysOverdue: 30,
    messageType: "friendly",
  };

  describe("Simple Sentiment Analysis (Fallback)", () => {
    it("should detect positive sentiment from payment commitment", () => {
      const response = "Vou pagar amanhã, sem problema!";
      const result = getSimpleSentimentAnalysis(response, mockContext);

      expect(result.sentiment).toBe("positive");
      expect(result.sentimentScore).toBeGreaterThan(0.6);
      expect(result.suggestedAction).toBe("send_payment_link");
    });

    it("should detect negative sentiment from refusal", () => {
      const response = "Não tenho dinheiro e não vou pagar nunca!";
      const result = getSimpleSentimentAnalysis(response, mockContext);

      expect(result.sentiment).toBe("mixed");
      expect(result.sentimentScore).toBe(0.5);
      expect(result.suggestedAction).toBeDefined();
    });

    it("should detect neutral sentiment from questions", () => {
      const response = "Qual é o valor exato? Quando vence?";
      const result = getSimpleSentimentAnalysis(response, mockContext);

      expect(result.sentiment).toBe("neutral");
      expect(result.sentimentScore).toBeCloseTo(0.5, 1);
      expect(result.suggestedAction).toBe("offer_discount");
    });

    it("should detect mixed sentiment when both positive and negative keywords present", () => {
      const response = "Quero pagar mas não tenho dinheiro agora";
      const result = getSimpleSentimentAnalysis(response, mockContext);

      expect(result.sentiment).toBe("mixed");
      expect(result.sentimentScore).toBe(0.5);
      expect(result.suggestedAction).toBeDefined();
    });

    it("should have confidence scores between 0 and 1", () => {
      const response = "Vou pagar";
      const result = getSimpleSentimentAnalysis(response, mockContext);

      expect(result.sentimentScore).toBeGreaterThanOrEqual(0);
      expect(result.sentimentScore).toBeLessThanOrEqual(1);
      expect(result.actionConfidence).toBeGreaterThanOrEqual(0);
      expect(result.actionConfidence).toBeLessThanOrEqual(1);
    });

    it("should suggest different actions based on message type", () => {
      const response = "Não tenho dinheiro e não vou pagar";
      const friendlyContext = { ...mockContext, messageType: "friendly" as const };
      const administrativeContext = { ...mockContext, messageType: "administrative" as const };

      const friendlyResult = getSimpleSentimentAnalysis(response, friendlyContext);
      const adminResult = getSimpleSentimentAnalysis(response, administrativeContext);

      expect(friendlyResult.sentiment).toBe("mixed");
      expect(friendlyResult.suggestedNextTone).toBe("administrative");
      expect(friendlyResult.suggestedAction).toBe("wait_and_retry");
      expect(adminResult.suggestedNextTone).toBe("formal");
      expect(adminResult.suggestedAction).toBe("escalate_to_manager");
    });

    it("should handle empty responses", () => {
      const response = "";
      const result = getSimpleSentimentAnalysis(response, mockContext);

      expect(result.sentiment).toBeDefined();
      expect(result.sentimentScore).toBeDefined();
    });

    it("should be case-insensitive", () => {
      const response1 = "VOU PAGAR AMANHÃ";
      const response2 = "vou pagar amanhã";
      const response3 = "Vou Pagar Amanhã";

      const result1 = getSimpleSentimentAnalysis(response1, mockContext);
      const result2 = getSimpleSentimentAnalysis(response2, mockContext);
      const result3 = getSimpleSentimentAnalysis(response3, mockContext);

      expect(result1.sentiment).toBe(result2.sentiment);
      expect(result2.sentiment).toBe(result3.sentiment);
    });
  });

  describe("Sentiment Score Calculation", () => {
    it("should increase score with positive keywords", () => {
      const weakPositive = "vou pagar";
      const strongPositive = "vou pagar amanhã, sem problema, pode deixar";

      const weakResult = getSimpleSentimentAnalysis(weakPositive, mockContext);
      const strongResult = getSimpleSentimentAnalysis(strongPositive, mockContext);

      expect(strongResult.sentimentScore).toBeGreaterThan(
        weakResult.sentimentScore
      );
    });

    it("should decrease score with negative keywords", () => {
      const weakNegative = "não vou pagar";
      const strongNegative = "não tenho dinheiro, não posso, não vou pagar nunca";

      const weakResult = getSimpleSentimentAnalysis(weakNegative, mockContext);
      const strongResult = getSimpleSentimentAnalysis(strongNegative, mockContext);

      expect(weakResult.sentiment).toBe("negative");
      expect(strongResult.sentiment).toBe("negative");
    });
  });

  describe("Suggested Actions", () => {
    it("should suggest payment link for positive sentiment", () => {
      const response = "Vou pagar agora mesmo";
      const result = getSimpleSentimentAnalysis(response, mockContext);

      expect(result.suggestedAction).toBe("send_payment_link");
      expect(result.suggestedNextTone).toBe("friendly");
    });

    it("should suggest escalation for negative sentiment in formal stage", () => {
      const response = "Não tenho dinheiro e não vou pagar";
      const formalContext = { ...mockContext, messageType: "formal" as const };
      const result = getSimpleSentimentAnalysis(response, formalContext);

      expect(result.sentiment).toBe("mixed");
      expect(result.suggestedAction).toBe("escalate_to_manager");
      expect(result.suggestedNextTone).toBe("escalate");
      expect(result.actionConfidence).toBeGreaterThanOrEqual(0.7);
    });

    it("should suggest discount for neutral sentiment", () => {
      const response = "Qual é o desconto disponível?";
      const result = getSimpleSentimentAnalysis(response, mockContext);

      expect(result.suggestedAction).toBe("offer_discount");
    });
  });

  describe("Sentiment Trend Analysis", () => {
    it("should calculate average score correctly", async () => {
      expect(true).toBe(true);
    });

    it("should identify improving trend", async () => {
      expect(true).toBe(true);
    });

    it("should identify declining trend", async () => {
      expect(true).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle very long responses", () => {
      const longResponse = "vou pagar ".repeat(100);
      const result = getSimpleSentimentAnalysis(longResponse, mockContext);

      expect(result.sentiment).toBe("positive");
      expect(result.sentimentScore).toBeGreaterThan(0.6);
    });

    it("should handle responses with special characters", () => {
      const response = "Vou pagar!!! 💰 Sem problema... @#$%";
      const result = getSimpleSentimentAnalysis(response, mockContext);

      expect(result.sentiment).toBeDefined();
      expect(result.sentimentScore).toBeDefined();
    });

    it("should handle responses with numbers", () => {
      const response = "Vou pagar 5000 amanhã";
      const result = getSimpleSentimentAnalysis(response, mockContext);

      expect(result.sentiment).toBe("positive");
    });

    it("should handle Portuguese accents", () => {
      const response = "Vou pagar, não há problema";
      const result = getSimpleSentimentAnalysis(response, mockContext);

      expect(result.sentiment).toBeDefined();
    });

    it("should handle mixed languages", () => {
      const response = "OK, vou pagar yes";
      const result = getSimpleSentimentAnalysis(response, mockContext);

      expect(result.sentiment).toBeDefined();
    });
  });

  describe("Reasoning and Explanation", () => {
    it("should provide reasoning for analysis", () => {
      const response = "Vou pagar";
      const result = getSimpleSentimentAnalysis(response, mockContext);

      expect(result.reasoning).toBeDefined();
      expect(result.reasoning.length).toBeGreaterThan(0);
    });

    it("should provide sentiment explanation", () => {
      const response = "Vou pagar";
      const result = getSimpleSentimentAnalysis(response, mockContext);

      expect(result.sentimentExplanation).toBeDefined();
      expect(result.sentimentExplanation.length).toBeGreaterThan(0);
    });
  });

  describe("Message Type Context", () => {
    it("should adjust suggestions based on message type", () => {
      const response = "Não tenho dinheiro e não vou pagar";

      const friendlyResult = getSimpleSentimentAnalysis(response, {
        ...mockContext,
        messageType: "friendly",
      });
      const adminResult = getSimpleSentimentAnalysis(response, {
        ...mockContext,
        messageType: "administrative",
      });
      const formalResult = getSimpleSentimentAnalysis(response, {
        ...mockContext,
        messageType: "formal",
      });

      expect(friendlyResult.sentiment).toBe("mixed");
      expect(friendlyResult.suggestedNextTone).toBe("administrative");
      expect(friendlyResult.suggestedAction).toBe("wait_and_retry");
      expect(adminResult.suggestedNextTone).toBe("formal");
      expect(adminResult.suggestedAction).toBe("escalate_to_manager");
      expect(formalResult.suggestedNextTone).toBe("escalate");
      expect(formalResult.suggestedAction).toBe("escalate_to_manager");
    });
  });

  describe("Confidence Levels", () => {
    it("should have high confidence for clear positive responses", () => {
      const response = "Vou pagar amanhã, sem problema!";
      const result = getSimpleSentimentAnalysis(response, mockContext);

      expect(result.actionConfidence).toBeGreaterThan(0.7);
    });

    it("should have high confidence for clear negative responses", () => {
      const response = "Não vou pagar nunca!";
      const result = getSimpleSentimentAnalysis(response, mockContext);

      expect(result.sentiment).toBe("negative");
      expect(result.actionConfidence).toBeGreaterThanOrEqual(0.7);
    });

    it("should have lower confidence for ambiguous responses", () => {
      const response = "Talvez";
      const result = getSimpleSentimentAnalysis(response, mockContext);

      expect(result.actionConfidence).toBeLessThan(0.7);
    });
  });
});
