import { describe, it, expect } from "vitest";

describe("History Filters", () => {
  it("should filter messages by message type", () => {
    const messages = [
      {
        id: "1",
        messageType: "friendly" as const,
        sentAt: new Date("2026-01-30"),
      },
      {
        id: "2",
        messageType: "administrative" as const,
        sentAt: new Date("2026-02-03"),
      },
      {
        id: "3",
        messageType: "formal" as const,
        sentAt: new Date("2026-02-05"),
      },
    ];

    const filtered = messages.filter((m) => m.messageType === "friendly");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].messageType).toBe("friendly");
  });

  it("should filter messages by start date", () => {
    const messages = [
      { id: "1", sentAt: new Date("2026-01-30") },
      { id: "2", sentAt: new Date("2026-02-03") },
      { id: "3", sentAt: new Date("2026-02-05") },
    ];

    const startDate = new Date("2026-02-01");
    const filtered = messages.filter((m) => m.sentAt >= startDate);
    expect(filtered).toHaveLength(2);
  });

  it("should filter messages by end date", () => {
    const messages = [
      { id: "1", sentAt: new Date("2026-01-30") },
      { id: "2", sentAt: new Date("2026-02-03") },
      { id: "3", sentAt: new Date("2026-02-05") },
    ];

    const endDate = new Date("2026-02-04");
    endDate.setHours(23, 59, 59, 999);
    const filtered = messages.filter((m) => m.sentAt <= endDate);
    expect(filtered).toHaveLength(2);
  });

  it("should filter messages by period range", () => {
    const messages = [
      { id: "1", sentAt: new Date("2026-01-30") },
      { id: "2", sentAt: new Date("2026-02-03") },
      { id: "3", sentAt: new Date("2026-02-05") },
    ];

    const startDate = new Date("2026-02-01");
    const endDate = new Date("2026-02-04");
    endDate.setHours(23, 59, 59, 999);

    const filtered = messages.filter(
      (m) => m.sentAt >= startDate && m.sentAt <= endDate
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("2");
  });

  it("should combine multiple filters", () => {
    const messages = [
      {
        id: "1",
        messageType: "friendly" as const,
        sentAt: new Date("2026-01-30"),
      },
      {
        id: "2",
        messageType: "administrative" as const,
        sentAt: new Date("2026-02-03"),
      },
      {
        id: "3",
        messageType: "friendly" as const,
        sentAt: new Date("2026-02-05"),
      },
    ];

    const startDate = new Date("2026-02-01");
    const endDate = new Date("2026-02-10");
    endDate.setHours(23, 59, 59, 999);

    let filtered = messages.filter((m) => m.messageType === "friendly");
    filtered = filtered.filter((m) => m.sentAt >= startDate);
    filtered = filtered.filter((m) => m.sentAt <= endDate);

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("3");
  });

  it("should handle empty filter results", () => {
    const messages = [
      {
        id: "1",
        messageType: "friendly" as const,
        sentAt: new Date("2026-01-30"),
      },
    ];

    const filtered = messages.filter((m) => m.messageType === "formal");
    expect(filtered).toHaveLength(0);
  });

  it("should preserve message order after filtering", () => {
    const messages = [
      { id: "1", sentAt: new Date("2026-01-30") },
      { id: "2", sentAt: new Date("2026-02-03") },
      { id: "3", sentAt: new Date("2026-02-05") },
    ];

    const filtered = messages.filter((m) => m.sentAt >= new Date("2026-01-01"));
    expect(filtered.map((m) => m.id)).toEqual(["1", "2", "3"]);
  });
});
