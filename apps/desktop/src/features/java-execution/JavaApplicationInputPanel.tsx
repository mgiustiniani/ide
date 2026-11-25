import React from "react";
import type { useJavaApplicationInput } from "./useJavaApplicationInput";

export function JavaApplicationInputPanel({ input }: { input: ReturnType<typeof useJavaApplicationInput> }) {
  if (!input.state) return null;
  return <section aria-label="Application input" className="flex flex-col gap-2">
    <h3 className="font-semibold">Application input (System.in)</h3>
    <p role="status">Input: {input.state}. Bytes accepted: {input.acceptedBytes}.
      {input.hasQueue && ` Pending bytes: ${input.pendingBytes}.`}</p>
    {input.reason && <p>{input.reason}</p>}
    <label>Application input text
      <textarea className="w-full rounded border p-1 font-mono" value={input.draft} maxLength={65536}
        disabled={!input.open || input.hasQueue || input.busy}
        onChange={(event) => input.setDraft(event.target.value)} />
    </label>
    <div className="flex gap-2">
      <button type="button" disabled={!input.open || input.hasQueue || input.busy} onClick={input.sendLine}>Send line</button>
      <button type="button" disabled={!input.open || !input.hasQueue || input.busy || input.uncertain} onClick={input.resume}>Resume input</button>
      <button type="button" disabled={!input.open || input.hasQueue || input.busy} onClick={input.close}>Close input (EOF)</button>
    </div>
    <p className="text-xs">Send line appends a newline and sends UTF-8 text to this application.
      Accepted bytes may still be waiting for the application to read them.</p>
    {input.error && <p role="alert">{input.error}</p>}
  </section>;
}
