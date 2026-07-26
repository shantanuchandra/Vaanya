import { describe, expect, it, vi } from "vitest";
import { SarvamClient } from "./sarvam-client";

describe("SarvamClient", () => {
  it("processes diarized translation through the Sarvam batch workflow", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://api.sarvam.ai/speech-to-text/job/v1") {
        return new Response(
          JSON.stringify({ job_id: "job-1", job_state: "Accepted" }),
          { status: 202, headers: { "content-type": "application/json" } }
        );
      }
      if (url === "https://api.sarvam.ai/speech-to-text/job/v1/upload-files") {
        return new Response(
          JSON.stringify({
            job_id: "job-1",
            upload_urls: {
              "pac.mp4": { url: "https://upload.sarvam.test/pac.mp4" }
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url === "https://upload.sarvam.test/pac.mp4") {
        expect(init?.method).toBe("PUT");
        expect(Buffer.from(init?.body as Uint8Array).toString("utf8")).toBe(
          "audio"
        );
        expect(init?.headers).toMatchObject({
          "x-ms-blob-type": "BlockBlob"
        });
        return new Response("", { status: 200 });
      }
      if (url === "https://api.sarvam.ai/speech-to-text/job/v1/job-1/start") {
        return new Response(
          JSON.stringify({ job_id: "job-1", job_state: "Running" }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url === "https://api.sarvam.ai/speech-to-text/job/v1/job-1/status") {
        return new Response(
          JSON.stringify({
            job_id: "job-1",
            job_state: "Completed",
            job_details: [
              {
                outputs: [{ file_name: "0.json", file_id: "out-1" }],
                state: "Success"
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url === "https://api.sarvam.ai/speech-to-text/job/v1/download-files") {
        return new Response(
          JSON.stringify({
            job_id: "job-1",
            job_state: "Completed",
            download_urls: {
              "0.json": { url: "https://download.sarvam.test/0.json" }
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url === "https://download.sarvam.test/0.json") {
        return new Response(
          JSON.stringify({
            request_id: "req-batch-1",
            transcript: "Full translated transcript",
            language_code: "hi-IN",
            diarized_transcript: {
              entries: [
                {
                  transcript: "Do you take regular medicines?",
                  speaker_id: "0",
                  start_time_seconds: 0,
                  end_time_seconds: 1.8
                },
                {
                  transcript: "I take a blood thinner but forgot the name.",
                  speaker_id: "1",
                  start_time_seconds: 2.1,
                  end_time_seconds: 4.2
                }
              ]
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const client = new SarvamClient("secret-key", fetcher);

    const result = await client.processDiarizedTranslation({
      bytes: Buffer.from("audio"),
      filename: "pac.mp4",
      mimeType: "audio/mp4",
      languageCode: "hi-IN"
    });

    expect(result.requestId).toBe("req-batch-1");
    expect(result.segments).toEqual([
      {
        id: "seg-1",
        speakerLabel: "Speaker 0",
        originalText: "Do you take regular medicines?",
        translatedText: "Do you take regular medicines?",
        startSeconds: 0,
        endSeconds: 1.8
      },
      {
        id: "seg-2",
        speakerLabel: "Speaker 1",
        originalText: "I take a blood thinner but forgot the name.",
        translatedText: "I take a blood thinner but forgot the name.",
        startSeconds: 2.1,
        endSeconds: 4.2
      }
    ]);
    const createBody = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(createBody).toMatchObject({
      job_parameters: {
        model: "saaras:v3",
        mode: "translate",
        language_code: "hi-IN",
        with_diarization: true,
        num_speakers: 2
      }
    });
  });

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
