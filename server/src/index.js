import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import { WebSocketServer } from "ws";
import { transcribeAudio, runConversationTurn, synthesizeSpeech, generateReport } from "./ai.js";
import { CallSession } from "./session.js";

const PORT = process.env.PORT || 8787;

if (!process.env.OPENAI_API_KEY) {
  console.warn(
    "[startup] OPENAI_API_KEY is not set. Set it in server/.env before starting a call — see server/.env.example."
  );
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/call" });

const GREETINGS = {
  en: "Hi, I'm Ava, a quick health check-in assistant. This will just take a couple of minutes. Could I start with your name?",
  hi: "\u0928\u092e\u0938\u094d\u0924\u0947, \u092e\u0948\u0902 \u090f\u0935\u093e \u0939\u0942\u0902, \u090f\u0915 \u0938\u0902\u0915\u094d\u0937\u093f\u092a\u094d\u0924 \u0938\u094d\u0935\u093e\u0938\u094d\u0925\u094d\u092f \u091c\u093e\u0902\u091a \u0938\u0939\u093e\u092f\u0915\u0964 \u0907\u0938\u092e\u0947\u0902 \u092c\u0938 \u0926\u094b \u092e\u093f\u0928\u091f \u0932\u0917\u0947\u0902\u0917\u0947\u0964 \u0915\u094d\u092f\u093e \u092e\u0948\u0902 \u0906\u092a\u0915\u093e \u0928\u093e\u092e \u091c\u093e\u0928 \u0938\u0915\u0924\u0940 \u0939\u0942\u0902?",
};

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

wss.on("connection", (ws) => {
  const session = new CallSession();
  console.log("[ws] call connected");

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return send(ws, { type: "error", message: "Malformed message." });
    }

    try {
      switch (msg.type) {
        case "start_call": {
          const lang = msg.language === "hi" ? "hi" : "en";
          const greetingText = GREETINGS[lang];
          session.addAssistantTurn(greetingText);

          let audio = null;
          try {
            audio = await synthesizeSpeech(greetingText);
          } catch {
            // Text-only fallback if TTS is unavailable.
          }

          send(ws, { type: "call_started", text: greetingText, audio });
          break;
        }

        case "user_audio": {
          if (session.ended) break;

          let transcript;
          try {
            transcript = await transcribeAudio(msg.audio, msg.mime);
          } catch {
            send(ws, {
              type: "assistant_reply",
              text: "Sorry, I couldn't process that audio. Could you try again?",
              audio: null,
              fields: session.fields,
              screeningComplete: false,
              recoverable: true,
            });
            break;
          }

          if (!transcript.text) {
            const fallbackText = "I didn't quite catch that — could you say it again?";
            let audio = null;
            try {
              audio = await synthesizeSpeech(fallbackText);
            } catch {
              /* text-only fallback below */
            }
            send(ws, {
              type: "assistant_reply",
              text: fallbackText,
              audio,
              fields: session.fields,
              screeningComplete: false,
              recoverable: true,
              heardNothing: true,
            });
            break;
          }

          send(ws, { type: "transcript", role: "user", text: transcript.text });
          session.addUserTurn(transcript.text);

          let turn;
          try {
            turn = await runConversationTurn(session.history);
          } catch {
            const fallbackText = "Sorry, I'm having a little trouble on my end. Could you repeat that?";
            let audio = null;
            try {
              audio = await synthesizeSpeech(fallbackText);
            } catch {
              /* text-only fallback below */
            }
            // Don't leave a dangling user turn with no reply recorded.
            session.history.pop();
            send(ws, {
              type: "assistant_reply",
              text: fallbackText,
              audio,
              fields: session.fields,
              screeningComplete: false,
              recoverable: true,
            });
            break;
          }

          session.mergeFields(turn.updatedFields);
          session.addAssistantTurn(turn.reply);

          let audio = null;
          try {
            audio = await synthesizeSpeech(turn.reply);
          } catch {
            /* text-only fallback */
          }

          send(ws, {
            type: "assistant_reply",
            text: turn.reply,
            audio,
            fields: session.fields,
            screeningComplete: turn.screeningComplete,
            recoverable: false,
          });
          break;
        }

        case "end_call": {
          session.ended = true;
          const report = await generateReport(session.history, session.fields);
          send(ws, { type: "report", report });
          break;
        }

        default:
          send(ws, { type: "error", message: `Unknown message type: ${msg.type}` });
      }
    } catch (err) {
      console.error("[ws] unhandled error:", err);
      send(ws, { type: "error", message: "Something went wrong. You can keep talking or end the call." });
    }
  });

  ws.on("close", () => console.log("[ws] call disconnected"));
});

server.listen(PORT, () => {
  console.log(`Health-screening server listening on http://localhost:${PORT} (WS path /call)`);
});
