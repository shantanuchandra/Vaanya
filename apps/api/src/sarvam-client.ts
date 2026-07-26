export type SarvamLanguageCode = "unknown" | "hi-IN" | "kn-IN" | "en-IN";

export type TranscriptionInput = {
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
  languageCode: SarvamLanguageCode;
};

export type TranscriptionResult = {
  requestId: string | null;
  transcript: string;
  languageCode: string | null;
  languageProbability: number | null;
};

export type PacSuggestion = {
  field: "medications" | "allergies" | "prior_anesthesia" | "fasting" | "open_items";
  state: "captured" | "uncertain" | "missing";
  value: string;
  sourceTurnIds: string[];
};

type Fetcher = typeof fetch;

export class SarvamClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: Fetcher = fetch
  ) {}

  async extractPacSuggestions(input: {
    turnId: string;
    transcript: string;
  }): Promise<PacSuggestion[]> {
    const response = await this.fetcher(
      "https://api.sarvam.ai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "api-subscription-key": this.apiKey,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: "sarvam-30b",
          temperature: 0,
          reasoning_effort: "low",
          max_tokens: 4096,
          messages: [
            {
              role: "system",
              content:
                "You extract documentation suggestions for clinician review in a pre-anesthetic check-up. Never diagnose, grade ASA, choose anesthesia, infer a medicine identity, or give medication/fasting instructions. Preserve uncertainty. Use only the supplied turn ID as evidence. Return no suggestion when the utterance contains no PAC fact."
            },
            {
              role: "user",
              content: JSON.stringify(input)
            }
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "pac_suggestions",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["suggestions"],
                properties: {
                  suggestions: {
                    type: "array",
                    maxItems: 5,
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: [
                        "field",
                        "state",
                        "value",
                        "source_turn_ids"
                      ],
                      properties: {
                        field: {
                          type: "string",
                          enum: [
                            "medications",
                            "allergies",
                            "prior_anesthesia",
                            "fasting",
                            "open_items"
                          ]
                        },
                        state: {
                          type: "string",
                          enum: ["captured", "uncertain", "missing"]
                        },
                        value: { type: "string", minLength: 1 },
                        source_turn_ids: {
                          type: "array",
                          minItems: 1,
                          maxItems: 1,
                          items: { type: "string", enum: [input.turnId] }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        })
      }
    );
    if (!response.ok)
      throw new Error(`Sarvam extraction failed (${response.status}).`);
    const payload: any = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string")
      throw new Error("Sarvam returned an invalid extraction response.");
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed?.suggestions))
      throw new Error("Sarvam returned an invalid extraction response.");
    return parsed.suggestions.map((item: any) => ({
      field: item.field,
      state: item.state,
      value: item.value,
      sourceTurnIds: item.source_turn_ids
    }));
  }

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    const form = new FormData();
    form.set(
      "file",
      new Blob([Uint8Array.from(input.bytes).buffer], { type: input.mimeType }),
      input.filename
    );
    form.set("model", "saaras:v3");
    form.set("mode", "codemix");
    form.set("language_code", input.languageCode);

    const response = await this.fetcher(
      "https://api.sarvam.ai/speech-to-text",
      {
        method: "POST",
        headers: { "api-subscription-key": this.apiKey },
        body: form
      }
    );

    if (!response.ok) {
      throw new Error(`Sarvam transcription failed (${response.status}).`);
    }

    const payload: unknown = await response.json();
    if (
      !payload ||
      typeof payload !== "object" ||
      !("transcript" in payload) ||
      typeof payload.transcript !== "string"
    ) {
      throw new Error("Sarvam returned an invalid transcription response.");
    }

    return {
      requestId:
        "request_id" in payload && typeof payload.request_id === "string"
          ? payload.request_id
          : null,
      transcript: payload.transcript,
      languageCode:
        "language_code" in payload && typeof payload.language_code === "string"
          ? payload.language_code
          : null,
      languageProbability:
        "language_probability" in payload &&
        typeof payload.language_probability === "number"
          ? payload.language_probability
          : null
    };
  }

  async translateToKannada(
    input: string
  ): Promise<{ requestId: string | null; translatedText: string }> {
    const response = await this.fetcher("https://api.sarvam.ai/translate", {
      method: "POST",
      headers: {
        "api-subscription-key": this.apiKey,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        input,
        source_language_code: "en-IN",
        target_language_code: "kn-IN",
        model: "sarvam-translate:v1",
        mode: "formal"
      })
    });
    if (!response.ok) {
      throw new Error(`Sarvam translation failed (${response.status}).`);
    }
    const payload: unknown = await response.json();
    if (
      !payload ||
      typeof payload !== "object" ||
      !("translated_text" in payload) ||
      typeof payload.translated_text !== "string"
    ) {
      throw new Error("Sarvam returned an invalid translation response.");
    }
    return {
      requestId:
        "request_id" in payload && typeof payload.request_id === "string"
          ? payload.request_id
          : null,
      translatedText: payload.translated_text
    };
  }

  async synthesizeKannada(
    text: string
  ): Promise<{ requestId: string | null; audioBase64: string }> {
    const response = await this.fetcher(
      "https://api.sarvam.ai/text-to-speech",
      {
        method: "POST",
        headers: {
          "api-subscription-key": this.apiKey,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          text,
          target_language_code: "kn-IN",
          model: "bulbul:v3",
          speaker: "kavitha",
          output_audio_codec: "mp3"
        })
      }
    );
    if (!response.ok) {
      throw new Error(`Sarvam speech synthesis failed (${response.status}).`);
    }
    const payload: unknown = await response.json();
    if (
      !payload ||
      typeof payload !== "object" ||
      !("audios" in payload) ||
      !Array.isArray(payload.audios) ||
      typeof payload.audios[0] !== "string"
    ) {
      throw new Error("Sarvam returned an invalid speech response.");
    }
    return {
      requestId:
        "request_id" in payload && typeof payload.request_id === "string"
          ? payload.request_id
          : null,
      audioBase64: payload.audios[0]
    };
  }
}
