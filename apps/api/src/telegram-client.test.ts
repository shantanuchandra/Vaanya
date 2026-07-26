import { describe, expect, it, vi } from "vitest";
import { TelegramClient } from "./telegram-client";

describe("TelegramClient", () => {
  it("sends protected Kannada audio with its approved text as one message", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, result: { message_id: 42 } }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const client = new TelegramClient("bot-secret", fetcher);

    const result = await client.sendPatientAudio({
      chatId: "12345",
      caption: "ವೈದ್ಯರು ಖಚಿತಪಡಿಸಿದ ಸೂಚನೆಗಳನ್ನು ಮಾತ್ರ ಅನುಸರಿಸಿ.",
      audioBase64: Buffer.from("mp3").toString("base64")
    });

    expect(result.messageId).toBe(42);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.telegram.org/botbot-secret/sendAudio"
    );
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get("chat_id")).toBe("12345");
    expect(form.get("protect_content")).toBe("true");
    expect(form.get("caption")).toContain("ವೈದ್ಯರು");
  });

  it("does not leak Telegram's upstream response on failure", async () => {
    const client = new TelegramClient(
      "bot-secret",
      vi.fn().mockResolvedValue(
        new Response('{"description":"private chat detail"}', { status: 400 })
      )
    );

    await expect(
      client.sendPatientAudio({
        chatId: "12345",
        caption: "Approved text",
        audioBase64: Buffer.from("mp3").toString("base64")
      })
    ).rejects.toThrow("Telegram delivery failed (400).");
  });
});
