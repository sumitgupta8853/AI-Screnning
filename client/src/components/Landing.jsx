import React from "react";

export default function Landing({ language, setLanguage, onStart }) {
  return (
    <div className="landing">
      <div className="landing-eyebrow">Voice health check-in</div>
      <h1 className="landing-title">
        A quick call with <span className="accent">Ava</span> before your visit.
      </h1>
      <p className="landing-copy">
        Ava will ask a few questions about how you're feeling &mdash; your main concern, how long
        it's been going on, and how it's affecting you. It takes a couple of minutes, and a
        clinician will review the summary afterwards.
      </p>

      <div className="lang-picker">
        <span className="lang-label">Speak in</span>
        <div className="lang-options">
          <button
            className={`lang-btn ${language === "en" ? "active" : ""}`}
            onClick={() => setLanguage("en")}
            type="button"
          >
            English
          </button>
          <button
            className={`lang-btn ${language === "hi" ? "active" : ""}`}
            onClick={() => setLanguage("hi")}
            type="button"
          >
            हिंदी
          </button>
        </div>
      </div>

      <button className="start-call-btn" onClick={onStart} type="button">
        <span className="dot" /> Start call
      </button>

      <p className="landing-footnote">
        You'll be asked to allow microphone access. Hold the talk button to speak, release to send.
      </p>
    </div>
  );
}
