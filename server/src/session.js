/**
 * Per-call conversation state. One instance lives for the lifetime of a
 * single WebSocket connection (one call).
 */
export class CallSession {
  constructor() {
    this.history = []; // [{ role: 'user' | 'assistant', content: string }]
    this.fields = {
      name: "",
      main_concern: "",
      duration: "",
      severity: "",
      related_symptoms: [],
      flags: [],
    };
    this.ended = false;
  }

  addUserTurn(text) {
    this.history.push({ role: "user", content: text });
  }

  addAssistantTurn(text) {
    this.history.push({ role: "assistant", content: text });
  }

  mergeFields(update = {}) {
    for (const [key, value] of Object.entries(update)) {
      if (value === undefined || value === null || value === "") continue;
      if (Array.isArray(value)) {
        const existing = new Set(this.fields[key] || []);
        for (const v of value) existing.add(v);
        this.fields[key] = Array.from(existing);
      } else {
        this.fields[key] = value;
      }
    }
  }
}
