import { describe, expect, it, vi } from "vitest";
import { SarvamClient } from "./sarvam-client";

describe("SarvamClient", () => {
  it("requests strict source-linked PAC suggestions from sarvam-30b", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chat-1",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  suggestions: [
                    {
                      field: "medications",
                      state: "uncertain",
                      value:
                        "Patient describes a blood-thinning tablet; name unknown; last use yesterday.",
                      source_turn_ids: ["t9"]
                    }
                  ]
                })
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const client = new SarvamClient("secret-key", fetcher);

    const suggestions = await client.extractPacSuggestions({
      turnId: "t9",
      transcript:
        "Woh khoon patla karne wali goli leta hoon, naam yaad nahi, kal li thi."
    });

    expect(suggestions[0]).toMatchObject({
      field: "medications",
      state: "uncertain",
      sourceTurnIds: ["t9"]
    });
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.sarvam.ai/v1/chat/completions");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: "sarvam-30b",
      temperature: 0,
      reasoning_effort: "low",
      max_tokens: 4096,
      response_format: {
        type: "json_schema",
        json_schema: { strict: true }
      }
    });
  });

  it("sends audio to Saaras v3 without exposing the key in the payload", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          request_id: "req-1",
          transcript: "Woh khoon patla karne wali goli leta hoon.",
          language_code: "hi-IN",
          language_probability: 0.96
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const client = new SarvamClient("secret-key", fetcher);

    const result = await client.transcribe({
      bytes: Buffer.from("audio"),
      filename: "pac.webm",
      mimeType: "audio/webm",
      languageCode: "hi-IN"
    });

    expect(result.transcript).toContain("khoon patla");
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.sarvam.ai/speech-to-text");
    expect(init.headers).toEqual({ "api-subscription-key": "secret-key" });
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("model")).toBe("saaras:v3");
    expect((init.body as FormData).get("mode")).toBe("codemix");
    expect((init.body as FormData).get("language_code")).toBe("hi-IN");
  });

  it("returns a safe integration error without leaking the upstream body", async () => {
    const client = new SarvamClient(
      "secret-key",
      vi.fn().mockResolvedValue(new Response("account detail", { status: 403 }))
    );

    await expect(
      client.transcribe({
        bytes: Buffer.from("audio"),
        filename: "pac.webm",
        mimeType: "audio/webm",
        languageCode: "unknown"
      })
    ).rejects.toThrow("Sarvam transcription failed (403).");
  });

  it("translates approved English text into Kannada", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          request_id: "req-kn",
          translated_text: "ನಿಮ್ಮ ಅರಿವಳಿಕೆ ಪೂರ್ವ ತಪಾಸಣೆ ಪೂರ್ಣಗೊಂಡಿದೆ.",
          source_language_code: "en-IN"
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const client = new SarvamClient("secret-key", fetcher);

    const result = await client.translateToKannada(
      "Your pre-anesthetic check-up is complete."
    );

    expect(result.translatedText).toContain("ತಪಾಸಣೆ");
    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      source_language_code: "en-IN",
      target_language_code: "kn-IN",
      model: "sarvam-translate:v1"
    });
  });

  it("synthesizes approved Kannada text with Bulbul v3", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ request_id: "req-tts", audios: ["UklGRg=="] }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const client = new SarvamClient("secret-key", fetcher);

    const result = await client.synthesizeKannada("ತಪಾಸಣೆ ಪೂರ್ಣಗೊಂಡಿದೆ.");

    expect(result.audioBase64).toBe("UklGRg==");
    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      target_language_code: "kn-IN",
      model: "bulbul:v3",
      output_audio_codec: "mp3"
    });
  });
});
