export type SarvamLanguageCode = "unknown" | "hi-IN" | "kn-IN" | "en-IN";
export type SarvamTextLanguageCode =
  | "en-IN"
  | "hi-IN"
  | "kn-IN"
  | "ta-IN"
  | "te-IN";

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

export type DiarizedSegment = {
  id: string;
  speakerLabel: string;
  originalText: string;
  translatedText: string;
  startSeconds: number;
  endSeconds: number;
};

type Fetcher = typeof fetch;

function assertRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object") throw new Error(message);
  return value as Record<string, unknown>;
}

function getUrl(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "url" in value) {
    const url = (value as { url?: unknown }).url;
    return typeof url === "string" ? url : null;
  }
  if (value && typeof value === "object" && "file_url" in value) {
    const url = (value as { file_url?: unknown }).file_url;
    return typeof url === "string" ? url : null;
  }
  return null;
}

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

  async processDiarizedTranslation(input: TranscriptionInput): Promise<{
    requestId: string | null;
    segments: DiarizedSegment[];
  }> {
    const createResponse = await this.fetcher(
      "https://api.sarvam.ai/speech-to-text/job/v1",
      {
        method: "POST",
        headers: {
          "api-subscription-key": this.apiKey,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          job_parameters: {
            model: "saaras:v3",
            mode: "translate",
            language_code:
              input.languageCode === "unknown" ? "hi-IN" : input.languageCode,
            with_diarization: true,
            num_speakers: 2
          }
        })
      }
    );
    if (!createResponse.ok) {
      throw new Error(`Sarvam batch job creation failed (${createResponse.status}).`);
    }
    const createPayload = assertRecord(
      await createResponse.json(),
      "Sarvam returned an invalid batch job response."
    );
    const jobId = createPayload.job_id;
    if (typeof jobId !== "string") {
      throw new Error("Sarvam returned an invalid batch job response.");
    }

    const uploadResponse = await this.fetcher(
      "https://api.sarvam.ai/speech-to-text/job/v1/upload-files",
      {
        method: "POST",
        headers: {
          "api-subscription-key": this.apiKey,
          "content-type": "application/json"
        },
        body: JSON.stringify({ job_id: jobId, files: [input.filename] })
      }
    );
    if (!uploadResponse.ok) {
      throw new Error(`Sarvam batch upload URL failed (${uploadResponse.status}).`);
    }
    const uploadPayload = assertRecord(
      await uploadResponse.json(),
      "Sarvam returned an invalid upload URL response."
    );
    const uploadUrls = assertRecord(
      uploadPayload.upload_urls,
      "Sarvam returned an invalid upload URL response."
    );
    const uploadUrl = getUrl(uploadUrls[input.filename]);
    if (!uploadUrl) {
      throw new Error("Sarvam returned an invalid upload URL response.");
    }
    const putResponse = await this.fetcher(uploadUrl, {
      method: "PUT",
      headers: {
        "content-type": input.mimeType,
        "x-ms-blob-type": "BlockBlob"
      },
      body: Uint8Array.from(input.bytes)
    });
    if (!putResponse.ok) {
      throw new Error(`Sarvam batch file upload failed (${putResponse.status}).`);
    }

    const startResponse = await this.fetcher(
      `https://api.sarvam.ai/speech-to-text/job/v1/${jobId}/start`,
      {
        method: "POST",
        headers: {
          "api-subscription-key": this.apiKey,
          "content-type": "application/json"
        },
        body: JSON.stringify({})
      }
    );
    if (!startResponse.ok) {
      throw new Error(`Sarvam batch start failed (${startResponse.status}).`);
    }

    let statusPayload: Record<string, unknown> | null = null;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const statusResponse = await this.fetcher(
        `https://api.sarvam.ai/speech-to-text/job/v1/${jobId}/status`,
        {
          method: "GET",
          headers: {
            "api-subscription-key": this.apiKey,
            "content-type": "application/json"
          }
        }
      );
      if (!statusResponse.ok) {
        throw new Error(`Sarvam batch status failed (${statusResponse.status}).`);
      }
      statusPayload = assertRecord(
        await statusResponse.json(),
        "Sarvam returned an invalid batch status response."
      );
      const state = statusPayload.job_state;
      if (state === "Completed" || state === "PartiallyCompleted") break;
      if (state === "Failed") {
        throw new Error("Sarvam batch job failed.");
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    if (
      !statusPayload ||
      !["Completed", "PartiallyCompleted"].includes(
        String(statusPayload.job_state)
      )
    ) {
      throw new Error("Sarvam batch job timed out.");
    }

    const jobDetails = Array.isArray(statusPayload.job_details)
      ? statusPayload.job_details
      : [];
    const outputFile = jobDetails
      .flatMap(detail => {
        const outputs =
          detail && typeof detail === "object" && "outputs" in detail
            ? (detail as { outputs?: unknown }).outputs
            : [];
        return Array.isArray(outputs) ? outputs : [];
      })
      .map(output =>
        output && typeof output === "object" && "file_name" in output
          ? (output as { file_name?: unknown }).file_name
          : null
      )
      .find((fileName): fileName is string => typeof fileName === "string");
    if (!outputFile) {
      throw new Error("Sarvam returned no batch output file.");
    }

    const downloadResponse = await this.fetcher(
      "https://api.sarvam.ai/speech-to-text/job/v1/download-files",
      {
        method: "POST",
        headers: {
          "api-subscription-key": this.apiKey,
          "content-type": "application/json"
        },
        body: JSON.stringify({ job_id: jobId, files: [outputFile] })
      }
    );
    if (!downloadResponse.ok) {
      throw new Error(`Sarvam batch download URL failed (${downloadResponse.status}).`);
    }
    const downloadPayload = assertRecord(
      await downloadResponse.json(),
      "Sarvam returned an invalid download URL response."
    );
    const downloadUrls = assertRecord(
      downloadPayload.download_urls,
      "Sarvam returned an invalid download URL response."
    );
    const downloadUrl = getUrl(downloadUrls[outputFile]);
    if (!downloadUrl) {
      throw new Error("Sarvam returned an invalid download URL response.");
    }
    const resultResponse = await this.fetcher(downloadUrl);
    if (!resultResponse.ok) {
      throw new Error(`Sarvam batch result download failed (${resultResponse.status}).`);
    }
    const resultPayload = assertRecord(
      await resultResponse.json(),
      "Sarvam returned an invalid diarized transcription response."
    );
    const diarizedTranscript = assertRecord(
      resultPayload.diarized_transcript,
      "Sarvam returned an invalid diarized transcription response."
    );
    const entries = Array.isArray(diarizedTranscript.entries)
      ? diarizedTranscript.entries
      : [];
    return {
      requestId:
        typeof resultPayload.request_id === "string"
          ? resultPayload.request_id
          : null,
      segments: entries.map((entry, index) => {
        const row = assertRecord(
          entry,
          "Sarvam returned an invalid diarized segment."
        );
        const transcript =
          typeof row.transcript === "string" ? row.transcript : "";
        const speakerId =
          typeof row.speaker_id === "string" ? row.speaker_id : "unknown";
        return {
          id: `seg-${index + 1}`,
          speakerLabel:
            speakerId === "unknown" ? "Speaker unknown" : `Speaker ${speakerId}`,
          originalText: transcript,
          translatedText: transcript,
          startSeconds:
            typeof row.start_time_seconds === "number"
              ? row.start_time_seconds
              : 0,
          endSeconds:
            typeof row.end_time_seconds === "number"
              ? row.end_time_seconds
              : 0
        };
      })
    };
  }

  async translateText(input: {
    text: string;
    targetLanguageCode: SarvamTextLanguageCode;
  }): Promise<{ requestId: string | null; translatedText: string }> {
    if (input.targetLanguageCode === "en-IN") {
      return {
        requestId: null,
        translatedText: input.text
      };
    }
    const response = await this.fetcher("https://api.sarvam.ai/translate", {
      method: "POST",
      headers: {
        "api-subscription-key": this.apiKey,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        input: input.text,
        source_language_code: "en-IN",
        target_language_code: input.targetLanguageCode,
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

  async translateToKannada(
    input: string
  ): Promise<{ requestId: string | null; translatedText: string }> {
    return this.translateText({
      text: input,
      targetLanguageCode: "kn-IN"
    });
  }

  async synthesizeSpeech(input: {
    text: string;
    languageCode: SarvamTextLanguageCode;
  }): Promise<{ requestId: string | null; audioBase64: string }> {
    const response = await this.fetcher(
      "https://api.sarvam.ai/text-to-speech",
      {
        method: "POST",
        headers: {
          "api-subscription-key": this.apiKey,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          text: input.text,
          target_language_code: input.languageCode,
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

  async synthesizeKannada(
    text: string
  ): Promise<{ requestId: string | null; audioBase64: string }> {
    return this.synthesizeSpeech({
      text,
      languageCode: "kn-IN"
    });
  }
}
