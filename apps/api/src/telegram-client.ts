type Fetcher = typeof fetch;

export class TelegramClient {
  constructor(
    private readonly botToken: string,
    private readonly fetcher: Fetcher = fetch
  ) {}

  async sendPatientAudio(input: {
    chatId: string;
    caption: string;
    audioBase64: string;
  }): Promise<{ messageId: number }> {
    const form = new FormData();
    form.set("chat_id", input.chatId);
    form.set("caption", input.caption.slice(0, 1024));
    form.set("protect_content", "true");
    form.set("performer", "Vaanaya");
    form.set("title", "Clinician-approved patient handoff");
    form.set(
      "audio",
      new Blob(
        [Uint8Array.from(Buffer.from(input.audioBase64, "base64")).buffer],
        { type: "audio/mpeg" }
      ),
      "vaanaya-kannada-handoff.mp3"
    );

    const response = await this.fetcher(
      `https://api.telegram.org/bot${this.botToken}/sendAudio`,
      { method: "POST", body: form }
    );
    if (!response.ok) {
      throw new Error(`Telegram delivery failed (${response.status}).`);
    }
    const payload: unknown = await response.json();
    if (
      !payload ||
      typeof payload !== "object" ||
      !("ok" in payload) ||
      payload.ok !== true ||
      !("result" in payload) ||
      !payload.result ||
      typeof payload.result !== "object" ||
      !("message_id" in payload.result) ||
      typeof payload.result.message_id !== "number"
    ) {
      throw new Error("Telegram returned an invalid delivery response.");
    }
    return { messageId: payload.result.message_id };
  }
}
