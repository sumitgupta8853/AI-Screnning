import React, { useCallback, useEffect, useRef, useState } from "react";
import Landing from "./components/Landing.jsx";
import CallScreen from "./components/CallScreen.jsx";
import ReportScreen from "./components/ReportScreen.jsx";

const WS_URL = import.meta.env.VITE_WS_URL || "wss://ai-screnning.onrender.com/call";

export default function App() {
  const [screen, setScreen] = useState("landing"); // landing | connecting | call | report
  const [language, setLanguage] = useState("en");
  const [messages, setMessages] = useState([]); // { role: 'user' | 'assistant', text }
  const [aiState, setAiState] = useState("idle"); // idle | speaking | thinking
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState(null);
  const [report, setReport] = useState(null);
  const [micError, setMicError] = useState(null);

  const wsRef = useRef(null);
  const audioElRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);

  const playAudio = useCallback((base64) => {
    if (!base64 || !audioElRef.current) return;
    audioElRef.current.src = `data:audio/mp3;base64,${base64}`;
    audioElRef.current.play().catch(() => {});
  }, []);

  const stopPlayback = useCallback(() => {
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.currentTime = 0;
    }
  }, []);

  const connect = useCallback(() => {
    setScreen("connecting");
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "start_call", language }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case "call_started": {
          setScreen("call");
          setAiState("speaking");
          setMessages([{ role: "assistant", text: msg.text }]);
          playAudio(msg.audio);
          break;
        }
        case "transcript": {
          setMessages((prev) => [...prev, { role: msg.role, text: msg.text }]);
          setAiState("thinking");
          break;
        }
        case "assistant_reply": {
          setMessages((prev) => [...prev, { role: "assistant", text: msg.text }]);
          setAiState("speaking");
          if (msg.heardNothing) setNotice("Didn't catch that — try again.");
          else setNotice(null);
          playAudio(msg.audio);
          break;
        }
        case "report": {
          setReport(msg.report);
          setScreen("report");
          break;
        }
        case "error": {
          setNotice(msg.message);
          setAiState("idle");
          break;
        }
        default:
          break;
      }
    };

    ws.onerror = () => setNotice("Connection trouble. Check the server is running.");
    ws.onclose = () => {
      if (screen === "call") setNotice("Call disconnected.");
    };
  }, [language, playAudio, screen]);

  const startCall = useCallback(() => {
    setMessages([]);
    setReport(null);
    setNotice(null);
    connect();
  }, [connect]);

  const endCall = useCallback(() => {
    stopPlayback();
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "end_call" }));
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, [stopPlayback]);

  const returnHome = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setScreen("landing");
    setMessages([]);
    setReport(null);
    setNotice(null);
  }, []);

  const startRecording = useCallback(async () => {
    setMicError(null);
    // Barge-in: cut the AI off if it's still talking when the user starts.
    stopPlayback();
    setAiState("idle");

    try {
      if (!streamRef.current) {
        streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(streamRef.current, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = reader.result.split(",")[1];
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "user_audio", audio: base64, mime: mimeType }));
            setAiState("thinking");
          }
        };
        reader.readAsDataURL(blob);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
    } catch (err) {
      console.error(err);
      setMicError("Microphone access is needed for the call. Please allow it and try again.");
    }
  }, [stopPlayback]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  }, []);

  useEffect(
    () => () => {
      wsRef.current?.close();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    []
  );

  return (
    <div className="app-shell">
      <audio ref={audioElRef} onEnded={() => setAiState("idle")} hidden />
      {screen === "landing" && (
        <Landing language={language} setLanguage={setLanguage} onStart={startCall} />
      )}
      {screen === "connecting" && (
        <div className="connecting-screen">
          <div className="pulse-ring" />
          <p>Connecting to Ava&hellip;</p>
        </div>
      )}
      {screen === "call" && (
        <CallScreen
          messages={messages}
          aiState={aiState}
          recording={recording}
          notice={notice}
          micError={micError}
          onRecordStart={startRecording}
          onRecordStop={stopRecording}
          onEndCall={endCall}
        />
      )}
      {screen === "report" && <ReportScreen report={report} onRestart={returnHome} />}
    </div>
  );
}
