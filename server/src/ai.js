import OpenAI from "openai";

// Fall back to a placeholder so the module can load even without a key set;
// actual API calls will fail with a clear error, caught by the callers below.
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "missing-api-key" });

const STT_MODEL = process.env.STT_MODEL || "whisper-1";
const LLM_MODEL = process.env.LLM_MODEL || "gpt-4o-mini";
const TTS_MODEL = process.env.TTS_MODEL || "tts-1";
const TTS_VOICE = process.env.TTS_VOICE || "alloy";

/**
 * Transcribe a base64-encoded audio clip.
 * Returns { text, language } — text is "" if nothing usable was heard.
 */
export async function transcribeAudio(base64Audio, mimeType = "audio/webm") {
  const buffer = Buffer.from(base64Audio, "base64");

  // Guard against near-empty clips (silence / accidental taps) without
  // burning an API call.
  if (buffer.length < 2000) {
    return { text: "", language: null };
  }

  const ext = mimeType.includes("mp4") ? "mp4" : mimeType.includes("wav") ? "wav" : "webm";
  const file = await OpenAI.toFile(buffer, `clip.${ext}`);

  try {
    const result = await client.audio.transcriptions.create({
      file,
      model: STT_MODEL,
      response_format: "verbose_json",
    });
    const text = (result.text || "").trim();
    return { text, language: result.language || null };
  } catch (err) {
    console.error("[STT] transcription failed:", err.message);
    throw new Error("stt_failed");
  }
}

const CONVERSATION_TOOL = {
  type: "function",
  function: {
    name: "advance_screening",
    description:
      "Produce the next spoken reply in a health-screening intake call and report any new structured " +
      "information learned from the caller's last message. Always call this function.",
    parameters: {
      type: "object",
      properties: {
        spoken_reply: {
          type: "string",
          description:
            "What the AI screener says next, in the same language the caller is speaking (English or Hindi). " +
            "One short, natural, spoken-style turn — a single question or acknowledgement plus a question. " +
            "Never re-ask something already answered.",
        },
        updated_fields: {
          type: "object",
          description: "Any fields newly learned or clarified this turn. Omit fields with no new information.",
          properties: {
            name: { type: "string" },
            main_concern: { type: "string" },
            duration: { type: "string" },
            severity: { type: "string" },
            related_symptoms: { type: "array", items: { type: "string" } },
            flags: {
              type: "array",
              items: { type: "string" },
              description: "Anything worth a clinician's attention, e.g. red-flag symptoms, escalating severity.",
            },
          },
        },
        screening_complete: {
          type: "boolean",
          description:
            "True once name, main concern, duration, and severity have all been collected and the AI is " +
            "wrapping up (thanking the caller / telling them a report is being prepared).",
        },
      },
      required: ["spoken_reply", "updated_fields", "screening_complete"],
    },
  },
};

function systemPrompt() {
  return `You are Ava, a calm, friendly AI health-intake screener conducting a brief voice call, similar to a nurse's intake call before a doctor's visit.

Goals, in rough order, adapting to what the caller actually says:
1. Get the caller's name.
2. Understand their main concern or symptom.
3. Find out how long it has been going on.
4. Understand severity (mild/moderate/severe, or impact on daily life).
5. Ask about any other related symptoms.
6. If an answer is vague ("it hurts sometimes"), ask ONE natural follow-up before moving on — don't interrogate.
7. If the caller mentions something that sounds urgent or serious (e.g. chest pain, difficulty breathing, severe bleeding, suicidal thoughts), gently note that this is worth prompt medical attention, add it to "flags", and continue the intake calmly — you are not a diagnostic or emergency service.

Style:
- Speak like a real person on a phone call: short sentences, warm, unhurried. This is TTS output — no markdown, no lists, no headings.
- Ask ONE question at a time. Never dump multiple questions in one turn.
- Never repeat a question whose answer is already in the conversation history.
- Mirror the caller's language (English or Hindi) and keep using it unless they switch, in which case switch with them.
- Keep each reply to 1-3 sentences.
- When you have name, main concern, duration, and severity, wrap up warmly, let them know their summary is being prepared, and set screening_complete to true.

You are not diagnosing anything and must not give medical advice, medication suggestions, or a diagnosis. You are only gathering information for a human clinician to review later.`;
}

/**
 * Run one conversation turn: given history so far (including the caller's
 * newest message already appended), get the AI's next spoken reply plus
 * structured field updates.
 */
export async function runConversationTurn(history) {
  const messages = [{ role: "system", content: systemPrompt() }, ...history];

  try {
    const completion = await client.chat.completions.create({
      model: LLM_MODEL,
      messages,
      tools: [CONVERSATION_TOOL],
      tool_choice: { type: "function", function: { name: "advance_screening" } },
      temperature: 0.6,
    });

    const toolCall = completion.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("no_tool_call");

    const args = JSON.parse(toolCall.function.arguments);
    return {
      reply: args.spoken_reply?.trim() || "Sorry, could you say that again?",
      updatedFields: args.updated_fields || {},
      screeningComplete: Boolean(args.screening_complete),
    };
  } catch (err) {
    console.error("[LLM] turn failed:", err.message);
    throw new Error("llm_failed");
  }
}

/**
 * Text-to-speech. Returns base64-encoded mp3 audio.
 */
export async function synthesizeSpeech(text) {
  try {
    const response = await client.audio.speech.create({
      model: TTS_MODEL,
      voice: TTS_VOICE,
      input: text,
      format: "mp3",
    });
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer).toString("base64");
  } catch (err) {
    console.error("[TTS] synthesis failed:", err.message);
    throw new Error("tts_failed");
  }
}

const REPORT_TOOL = {
  type: "function",
  function: {
    name: "build_report",
    description: "Produce a structured clinical-intake summary from a screening call transcript.",
    parameters: {
      type: "object",
      properties: {
        caller_name: { type: "string" },
        main_concern: { type: "string" },
        key_symptoms: { type: "array", items: { type: "string" } },
        duration: { type: "string" },
        severity: { type: "string" },
        follow_up_flags: {
          type: "array",
          items: { type: "string" },
          description: "Anything a clinician should look into further, or an empty array if nothing stood out.",
        },
        summary: {
          type: "string",
          description: "2-4 sentence narrative summary a doctor could glance at before the visit.",
        },
        call_completeness: {
          type: "string",
          enum: ["complete", "partial", "minimal"],
          description:
            "'complete' if all core fields were collected, 'partial' if some were missing, " +
            "'minimal' if the call ended after only one or two exchanges.",
        },
      },
      required: ["main_concern", "key_symptoms", "summary", "call_completeness"],
    },
  },
};

/**
 * Build the final structured report from the full transcript and whatever
 * fields were accumulated live during the call.
 */
export async function generateReport(history, accumulatedFields) {
  if (history.length === 0) {
    return {
      caller_name: "",
      main_concern: "No conversation took place",
      key_symptoms: [],
      duration: "",
      severity: "",
      follow_up_flags: [],
      summary: "The call ended before any exchange took place, so no health information was collected.",
      call_completeness: "minimal",
    };
  }

  const transcriptText = history
    .map((m) => `${m.role === "user" ? "Caller" : "Screener"}: ${m.content}`)
    .join("\n");

  const messages = [
    {
      role: "system",
      content:
        "You are a clinical scribe. Turn the transcript of a health-intake voice call into a structured, " +
        "conservative summary for a doctor. Do not invent details that weren't said. If information is missing, " +
        "leave it blank or say so rather than guessing. Do not add diagnoses or treatment recommendations.",
    },
    {
      role: "user",
      content: `Transcript:\n${transcriptText}\n\nFields captured live during the call (may be incomplete): ${JSON.stringify(
        accumulatedFields
      )}\n\nBuild the report now.`,
    },
  ];

  try {
    const completion = await client.chat.completions.create({
      model: LLM_MODEL,
      messages,
      tools: [REPORT_TOOL],
      tool_choice: { type: "function", function: { name: "build_report" } },
      temperature: 0.2,
    });

    const toolCall = completion.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("no_tool_call");
    return JSON.parse(toolCall.function.arguments);
  } catch (err) {
    console.error("[Report] generation failed:", err.message);
    // Fall back to whatever we accumulated live so the UI never crashes.
    return {
      caller_name: accumulatedFields.name || "",
      main_concern: accumulatedFields.main_concern || "Not clearly established",
      key_symptoms: accumulatedFields.related_symptoms || [],
      duration: accumulatedFields.duration || "",
      severity: accumulatedFields.severity || "",
      follow_up_flags: accumulatedFields.flags || [],
      summary:
        "Automatic report generation failed; this summary was assembled from information captured live during the call.",
      call_completeness: "partial",
    };
  }
}
