import React, { useState, useRef } from "react";

const FIELDS = [
  { key: "name", label: "Name" },
  { key: "company", label: "Company" },
  { key: "title", label: "Designation" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "address_1", label: "Address 1" },
  { key: "address_2", label: "Address 2" },
  { key: "website", label: "Website" },
];

const DEFAULT_WA_MESSAGE =
  "Hi {name}, great meeting you at the expo. Sharing our product catalog as promised - let us know if you'd like a quote.";
const EMAIL_SUBJECT = "Great meeting you at the expo";
const DEFAULT_EMAIL_MESSAGE =
  "Hi {name},\n\nGreat meeting you at the expo. Sharing our product catalog as promised - happy to answer any questions or put together a quote.\n\nBest regards";

function waLink(contact, template) {
  const digits = (contact.phone || "").replace(/[^0-9]/g, "");
  if (!digits) return null;
  const text = encodeURIComponent((template || DEFAULT_WA_MESSAGE).replace("{name}", contact.name || "there"));
  return `https://wa.me/${digits}?text=${text}`;
}

function mailtoLink(contact, template) {
  if (!contact.email) return null;
  const subject = encodeURIComponent(EMAIL_SUBJECT);
  const body = encodeURIComponent((template || DEFAULT_EMAIL_MESSAGE).replace("{name}", contact.name || "there"));
  return `mailto:${contact.email}?subject=${subject}&body=${body}`;
}

function findDuplicateIndex(list, contact) {
  return list.findIndex((c) => {
    const sameEmail = c.email && contact.email && c.email.toLowerCase() === contact.email.toLowerCase();
    const samePhone = c.phone && contact.phone && c.phone.replace(/\D/g, "") === contact.phone.replace(/\D/g, "");
    return sameEmail || samePhone;
  });
}

function resizeAndEncode(file, maxDimension = 1200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDimension) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else if (height > maxDimension) {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export default function App() {
  const [contacts, setContacts] = useState([]);
  const [frontImg, setFrontImg] = useState(null);
  const [backImg, setBackImg] = useState(null);
  const [status, setStatus] = useState("idle");
  const [errorMsg, setErrorMsg] = useState(null);
  const [editingIndex, setEditingIndex] = useState(null);
  const [duplicateNotice, setDuplicateNotice] = useState(null);
  const [waQueue, setWaQueue] = useState(null);
  const [emailQueue, setEmailQueue] = useState(null);
  const [commentStatus, setCommentStatus] = useState({}); // { [contactId]: "saving" | "saved" | "error" }
  const frontInputRef = useRef(null);
  const backInputRef = useRef(null);

  // --- Access code gate ---
  const [accessCode, setAccessCode] = useState(null);
  const [codeInput, setCodeInput] = useState("");
  const [codeError, setCodeError] = useState(null);
  const [codeChecking, setCodeChecking] = useState(false);
  const [messages, setMessages] = useState({ whatsappMessage: "", emailMessage: "" });

  async function submitCode(e) {
    e.preventDefault();
    if (!codeInput.trim()) return;
    setCodeChecking(true);
    setCodeError(null);
    try {
      const res = await fetch("/api/validate-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: codeInput.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.valid) {
        throw new Error(body.error || "Code is not valid");
      }
      setAccessCode(codeInput.trim());
      setMessages({ whatsappMessage: body.whatsappMessage, emailMessage: body.emailMessage });
    } catch (err) {
      setCodeError(err.message || "Could not check code");
    } finally {
      setCodeChecking(false);
    }
  }

  async function handleFile(e, which) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const dataUrl = await resizeAndEncode(file);
    if (which === "front") setFrontImg(dataUrl);
    else setBackImg(dataUrl);
  }

  function clearUpload() {
    setFrontImg(null);
    setBackImg(null);
    if (frontInputRef.current) frontInputRef.current.value = "";
    if (backInputRef.current) backInputRef.current.value = "";
  }

  async function runExtraction() {
    if (!frontImg || !accessCode) return;
    setStatus("scanning");
    setErrorMsg(null);
    setDuplicateNotice(null);
    try {
      const res = await fetch("/api/extract-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ front: frontImg, back: backImg, code: accessCode }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Request failed (${res.status})`);
      }
      const extracted = await res.json();
      if (extracted._savedToSheet === false) {
        setErrorMsg("Card was read, but could not be saved to the sheet: " + (extracted._saveError || "unknown error"));
      }
      // extracted already carries _rowNumber and _sheetId from the backend
      // (when the sheet write succeeded) -- these are needed to save comments later.
      const newContact = { ...extracted, comment: "", id: Date.now() };

      setContacts((prev) => {
        const dupIdx = findDuplicateIndex(prev, newContact);
        if (dupIdx !== -1) {
          setDuplicateNotice(prev[dupIdx].name || prev[dupIdx].company);
          return prev;
        }
        return [...prev, newContact];
      });
      clearUpload();
    } catch (err) {
      setErrorMsg(err.message || "Something went wrong reading that card.");
    } finally {
      setStatus("idle");
    }
  }

  function updateField(idx, key, value) {
    setContacts((prev) => prev.map((c, i) => (i === idx ? { ...c, [key]: value } : c)));
    if (key === "comment") {
      const contact = contacts[idx];
      if (contact) {
        setCommentStatus((prev) => {
          const next = { ...prev };
          delete next[contact.id];
          return next;
        });
      }
    }
  }

  async function saveComment(contactId) {
    const contact = contacts.find((c) => c.id === contactId);
    if (!contact) return;
    if (!contact._sheetId || !contact._rowNumber) {
      setCommentStatus((prev) => ({ ...prev, [contactId]: "error" }));
      return;
    }
    setCommentStatus((prev) => ({ ...prev, [contactId]: "saving" }));
    try {
      const res = await fetch("/api/update-comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sheetId: contact._sheetId,
          rowNumber: contact._rowNumber,
          comment: contact.comment || "",
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Could not save comment");
      }
      setCommentStatus((prev) => ({ ...prev, [contactId]: "saved" }));
    } catch (err) {
      setCommentStatus((prev) => ({ ...prev, [contactId]: "error" }));
    }
  }

  function removeContact(idx) {
    setContacts((prev) => prev.filter((_, i) => i !== idx));
  }

  function startWaQueue() {
    const withPhone = contacts.filter((c) => waLink(c, messages.whatsappMessage));
    if (withPhone.length === 0) return;
    setWaQueue({ ids: withPhone.map((c) => c.id), pos: 0 });
    window.location.href = waLink(withPhone[0], messages.whatsappMessage);
  }

  function advanceWaQueue() {
    if (!waQueue) return;
    const nextPos = waQueue.pos + 1;
    if (nextPos >= waQueue.ids.length) {
      setWaQueue(null);
      return;
    }
    const nextContact = contacts.find((c) => c.id === waQueue.ids[nextPos]);
    if (nextContact) window.location.href = waLink(nextContact, messages.whatsappMessage);
    setWaQueue({ ...waQueue, pos: nextPos });
  }

  function startEmailQueue() {
    const withEmail = contacts.filter((c) => mailtoLink(c, messages.emailMessage));
    if (withEmail.length === 0) return;
    setEmailQueue({ ids: withEmail.map((c) => c.id), pos: 0 });
    window.location.href = mailtoLink(withEmail[0], messages.emailMessage);
  }

  function advanceEmailQueue() {
    if (!emailQueue) return;
    const nextPos = emailQueue.pos + 1;
    if (nextPos >= emailQueue.ids.length) {
      setEmailQueue(null);
      return;
    }
    const nextContact = contacts.find((c) => c.id === emailQueue.ids[nextPos]);
    if (nextContact) window.location.href = mailtoLink(nextContact, messages.emailMessage);
    setEmailQueue({ ...emailQueue, pos: nextPos });
  }

  function exportCSV() {
    const headers = [...FIELDS.map((f) => f.label), "Comments", "WhatsApp link", "Email draft link"];
    const rows = contacts.map((c) => [
      ...FIELDS.map((f) => (c[f.key] || "").replace(/"/g, '""')),
      (c.comment || "").replace(/"/g, '""'),
      waLink(c, messages.whatsappMessage) || "",
      mailtoLink(c, messages.emailMessage) || "",
    ]);
    const csv = [headers, ...rows].map((r) => r.map((cell) => `"${cell}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "expo-contacts.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const sharedStyles = `
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600&display=swap');
    * { box-sizing: border-box; }
    body { margin: 0; }
    .ecs-sans { font-family: 'Inter', sans-serif; }
    .ecs-btn {
      font-family: 'Inter', sans-serif;
      font-weight: 500;
      font-size: 13px;
      padding: 9px 16px;
      border-radius: 6px;
      border: 1px solid #1C2128;
      background: transparent;
      color: #1C2128;
      cursor: pointer;
      transition: all 0.12s ease;
    }
    .ecs-btn:hover { background: #1C2128; color: #F7F5F2; }
    .ecs-btn:disabled { opacity: 0.35; cursor: not-allowed; background: transparent; color: #1C2128; }
    .ecs-btn-primary { background: #3D5A80; border-color: #3D5A80; color: #fff; }
    .ecs-btn-primary:hover { background: #2E4863; }
    .ecs-btn-primary:disabled { background: #3D5A80; opacity: 0.35; }
    .ecs-input {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12.5px;
      border: none;
      border-bottom: 1px dashed #B4B2A9;
      background: transparent;
      color: #1C2128;
      padding: 2px 0;
      width: 100%;
    }
    .ecs-input:focus { outline: none; border-bottom: 1px solid #3D5A80; }
    .ecs-textarea {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12.5px;
      border: 1px solid #D3D1C7;
      border-radius: 6px;
      background: #fff;
      color: #1C2128;
      padding: 8px;
      width: 100%;
      resize: vertical;
    }
    .ecs-textarea:focus { outline: none; border-color: #3D5A80; }
    .ecs-tile {
      border: 1.5px dashed #B4B2A9;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: border-color 0.12s ease;
      overflow: hidden;
      background: #fff;
    }
    .ecs-tile:hover { border-color: #3D5A80; }
  `;

  if (!accessCode) {
    return (
      <div
        style={{
          fontFamily: "'JetBrains Mono', 'Courier New', monospace",
          background: "#F7F5F2",
          color: "#1C2128",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
          boxSizing: "border-box",
        }}
      >
        <style>{sharedStyles}</style>
        <form
          onSubmit={submitCode}
          style={{ background: "#fff", border: "1px solid #D3D1C7", borderRadius: 10, padding: 28, width: "100%", maxWidth: 340 }}
        >
          <div className="ecs-sans" style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "#5F5E5A", marginBottom: 6 }}>
            Expo intake
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 18 }}>Enter your access code</div>
          <input
            autoFocus
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            placeholder="e.g. EXPO-ARVIND"
            style={{
              width: "100%",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 14,
              padding: "10px 12px",
              border: "1px solid #D3D1C7",
              borderRadius: 6,
              marginBottom: 12,
            }}
          />
          {codeError && (
            <div className="ecs-sans" style={{ fontSize: 12, color: "#A32D2D", background: "#FCEBEB", padding: "8px 12px", borderRadius: 6, marginBottom: 12 }}>
              {codeError}
            </div>
          )}
          <button
            type="submit"
            disabled={codeChecking || !codeInput.trim()}
            className="ecs-sans"
            style={{
              width: "100%",
              fontWeight: 500,
              fontSize: 14,
              padding: "10px 16px",
              borderRadius: 6,
              border: "1px solid #3D5A80",
              background: "#3D5A80",
              color: "#fff",
              cursor: codeChecking ? "wait" : "pointer",
              opacity: codeChecking || !codeInput.trim() ? 0.6 : 1,
            }}
          >
            {codeChecking ? "Checking..." : "Continue"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div
      style={{
        fontFamily: "'JetBrains Mono', 'Courier New', monospace",
        background: "#F7F5F2",
        color: "#1C2128",
        padding: "28px 20px",
        minHeight: "100vh",
        boxSizing: "border-box",
        maxWidth: 760,
        margin: "0 auto",
      }}
    >
      <style>{sharedStyles}</style>

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
        <div className="ecs-sans" style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "#5F5E5A" }}>
          Expo intake &middot; {accessCode}
        </div>
        <div className="ecs-sans" style={{ fontSize: 11, color: "#5F5E5A" }}>
          {contacts.length} logged
        </div>
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>Card &rarr; contact ledger</div>

      <div style={{ background: "#fff", border: "1px solid #D3D1C7", borderRadius: 10, padding: 18, marginBottom: 24 }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 180px" }}>
            <div className="ecs-sans" style={{ fontSize: 11, color: "#5F5E5A", marginBottom: 6 }}>
              Front (required)
            </div>
            <input
              ref={frontInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: "none" }}
              onChange={(e) => handleFile(e, "front")}
            />
            <div className="ecs-tile" style={{ height: 110 }} onClick={() => frontInputRef.current && frontInputRef.current.click()}>
              {frontImg ? (
                <img src={frontImg} alt="front of card" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <span className="ecs-sans" style={{ fontSize: 12, color: "#888780" }}>
                  <i className="ti ti-camera" style={{ marginRight: 6 }} aria-hidden="true"></i>
                  Tap to photograph
                </span>
              )}
            </div>
          </div>
          <div style={{ flex: "1 1 180px" }}>
            <div className="ecs-sans" style={{ fontSize: 11, color: "#5F5E5A", marginBottom: 6 }}>
              Back (optional)
            </div>
            <input
              ref={backInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: "none" }}
              onChange={(e) => handleFile(e, "back")}
            />
            <div className="ecs-tile" style={{ height: 110 }} onClick={() => backInputRef.current && backInputRef.current.click()}>
              {backImg ? (
                <img src={backImg} alt="back of card" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <span className="ecs-sans" style={{ fontSize: 12, color: "#888780" }}>
                  <i className="ti ti-camera" style={{ marginRight: 6 }} aria-hidden="true"></i>
                  Tap to photograph
                </span>
              )}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 8, minWidth: 130 }}>
            <button className="ecs-btn ecs-btn-primary" disabled={!frontImg || status === "scanning"} onClick={runExtraction}>
              {status === "scanning" ? "Reading card..." : "Extract fields"}
            </button>
            <button className="ecs-btn" disabled={!frontImg && !backImg} onClick={clearUpload}>
              Clear
            </button>
          </div>
        </div>
        {duplicateNotice && (
          <div className="ecs-sans" style={{ marginTop: 12, fontSize: 12, color: "#854F0B", background: "#FAEEDA", padding: "8px 12px", borderRadius: 6 }}>
            <i className="ti ti-alert-triangle" style={{ marginRight: 6 }} aria-hidden="true"></i>
            Looks like a duplicate of {duplicateNotice} (matching email or phone) &mdash; not added again.
          </div>
        )}
        {errorMsg && (
          <div className="ecs-sans" style={{ marginTop: 12, fontSize: 12, color: "#A32D2D", background: "#FCEBEB", padding: "8px 12px", borderRadius: 6 }}>
            <i className="ti ti-alert-circle" style={{ marginRight: 6 }} aria-hidden="true"></i>
            {errorMsg}
          </div>
        )}
      </div>

      {contacts.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
            background: "#fff",
            border: "1px solid #D3D1C7",
            borderRadius: 8,
            padding: "12px 16px",
            marginBottom: 16,
          }}
        >
          <span className="ecs-sans" style={{ fontSize: 11, color: "#5F5E5A", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Bulk send
          </span>
          {waQueue ? (
            <>
              <span className="ecs-sans" style={{ fontSize: 12 }}>
                WhatsApp {waQueue.pos + 1} of {waQueue.ids.length} opened
              </span>
              <button className="ecs-btn" style={{ padding: "6px 12px", fontSize: 12 }} onClick={advanceWaQueue}>
                Send next &rarr;
              </button>
              <button className="ecs-btn" style={{ padding: "6px 12px", fontSize: 12, borderColor: "#E24B4A", color: "#A32D2D" }} onClick={() => setWaQueue(null)}>
                Stop
              </button>
            </>
          ) : (
            <button className="ecs-btn" style={{ padding: "6px 12px", fontSize: 12 }} onClick={startWaQueue} disabled={!contacts.some((c) => waLink(c, messages.whatsappMessage))}>
              <i className="ti ti-brand-whatsapp" style={{ marginRight: 6, verticalAlign: "-2px" }} aria-hidden="true"></i>
              Send WhatsApp to all ({contacts.filter((c) => waLink(c, messages.whatsappMessage)).length})
            </button>
          )}
          <span style={{ width: 1, height: 20, background: "#D3D1C7" }} />
          {emailQueue ? (
            <>
              <span className="ecs-sans" style={{ fontSize: 12 }}>
                Email {emailQueue.pos + 1} of {emailQueue.ids.length} opened
              </span>
              <button className="ecs-btn" style={{ padding: "6px 12px", fontSize: 12 }} onClick={advanceEmailQueue}>
                Send next &rarr;
              </button>
              <button className="ecs-btn" style={{ padding: "6px 12px", fontSize: 12, borderColor: "#E24B4A", color: "#A32D2D" }} onClick={() => setEmailQueue(null)}>
                Stop
              </button>
            </>
          ) : (
            <button className="ecs-btn" style={{ padding: "6px 12px", fontSize: 12 }} onClick={startEmailQueue} disabled={!contacts.some((c) => mailtoLink(c, messages.emailMessage))}>
              <i className="ti ti-mail" style={{ marginRight: 6, verticalAlign: "-2px" }} aria-hidden="true"></i>
              Email all ({contacts.filter((c) => mailtoLink(c, messages.emailMessage)).length})
            </button>
          )}
        </div>
      )}

      {contacts.length === 0 ? (
        <div className="ecs-sans" style={{ textAlign: "center", padding: "40px 0", color: "#888780", fontSize: 13 }}>
          No contacts yet. Photograph a card to start the ledger.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
          {[...contacts].reverse().map((c) => {
            const idx = contacts.findIndex((x) => x.id === c.id);
            const isEditing = editingIndex === idx;
            const link = waLink(c, messages.whatsappMessage);
            const mail = mailtoLink(c, messages.emailMessage);
            const cStatus = commentStatus[c.id];
            const canSyncComment = Boolean(c._sheetId && c._rowNumber);
            return (
              <div key={c.id || idx} style={{ background: "#fff", border: "1px solid #D3D1C7", borderRadius: 8, padding: "12px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 20px" }}>
                    {FIELDS.map((f) => (
                      <div key={f.key}>
                        <div className="ecs-sans" style={{ fontSize: 10, color: "#888780", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                          {f.label}
                        </div>
                        {isEditing ? (
                          <input className="ecs-input" value={c[f.key] || ""} onChange={(e) => updateField(idx, f.key, e.target.value)} />
                        ) : (
                          <div style={{ fontSize: 13, minHeight: 18 }}>{c[f.key] || <span style={{ color: "#B4B2A9" }}>&mdash;</span>}</div>
                        )}
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                    <button className="ecs-btn" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => setEditingIndex(isEditing ? null : idx)}>
                      {isEditing ? "Done" : "Edit"}
                    </button>
                    <button
                      className="ecs-btn"
                      style={{ padding: "5px 10px", fontSize: 12, borderColor: "#E24B4A", color: "#A32D2D" }}
                      onClick={() => removeContact(idx)}
                    >
                      Remove
                    </button>
                  </div>
                </div>

                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #F1EFE8" }}>
                  <div className="ecs-sans" style={{ fontSize: 10, color: "#888780", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                    Comments
                  </div>
                  <textarea
                    className="ecs-textarea"
                    rows={2}
                    maxLength={400}
                    placeholder="Add a note about this contact..."
                    value={c.comment || ""}
                    onChange={(e) => updateField(idx, "comment", e.target.value)}
                  />
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                    <span className="ecs-sans" style={{ fontSize: 11, color: "#888780" }}>
                      {(c.comment || "").length}/400
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {cStatus === "saved" && (
                        <span className="ecs-sans" style={{ fontSize: 11, color: "#2E7D32" }}>
                          Saved
                        </span>
                      )}
                      {cStatus === "error" && (
                        <span className="ecs-sans" style={{ fontSize: 11, color: "#A32D2D" }}>
                          Could not save
                        </span>
                      )}
                      <button
                        className="ecs-btn"
                        style={{ padding: "5px 10px", fontSize: 12 }}
                        disabled={cStatus === "saving" || !canSyncComment}
                        onClick={() => saveComment(c.id)}
                      >
                        {cStatus === "saving" ? "Saving..." : "Save comment"}
                      </button>
                    </div>
                  </div>
                  {!canSyncComment && (
                    <div className="ecs-sans" style={{ fontSize: 11, color: "#854F0B", marginTop: 4 }}>
                      This card wasn't saved to the sheet, so comments can't sync.
                    </div>
                  )}
                </div>

                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #F1EFE8", display: "flex", gap: 20, flexWrap: "wrap" }}>
                  {link ? (
                    <a href={link} target="_blank" rel="noopener noreferrer" className="ecs-sans" style={{ fontSize: 12, color: "#3D5A80", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <i className="ti ti-brand-whatsapp" aria-hidden="true"></i>
                      Send on WhatsApp
                    </a>
                  ) : (
                    <span className="ecs-sans" style={{ fontSize: 12, color: "#B4B2A9" }}>
                      No phone &mdash; WhatsApp unavailable
                    </span>
                  )}
                  {mail ? (
                    <a href={mail} className="ecs-sans" style={{ fontSize: 12, color: "#3D5A80", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <i className="ti ti-mail" aria-hidden="true"></i>
                      Draft email
                    </a>
                  ) : (
                    <span className="ecs-sans" style={{ fontSize: 12, color: "#B4B2A9" }}>
                      No email &mdash; draft unavailable
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", borderTop: "1px solid #D3D1C7", paddingTop: 16 }}>
        <button className="ecs-btn ecs-btn-primary" disabled={contacts.length === 0} onClick={exportCSV}>
          <i className="ti ti-download" style={{ marginRight: 6, verticalAlign: "-2px" }} aria-hidden="true"></i>
          Export {contacts.length > 0 ? `${contacts.length} contacts` : ""} to Excel (CSV)
        </button>
      </div>
    </div>
  );
}
