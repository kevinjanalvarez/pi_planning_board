import React, { useEffect, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://0.0.0.0:8000";

const inputStyle = {
  display: "block", width: "100%", padding: "10px 12px", marginTop: 4,
  borderRadius: 8, border: "1px solid #d1d5db", fontSize: 14,
  boxSizing: "border-box", outline: "none", color: "#111827",
};

const JiraIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path d="M12.005 2C6.486 2 2.005 6.481 2.005 12s4.481 10 10 10 10-4.481 10-10-4.481-10-10-10z" fill="#2684FF"/>
    <path d="M15.53 8h-3.06a.47.47 0 00-.47.47v3.06c0 .26.21.47.47.47h3.06c.26 0 .47-.21.47-.47V8.47a.47.47 0 00-.47-.47z" fill="#fff"/>
    <path d="M11.53 12h-3.06a.47.47 0 00-.47.47v3.06c0 .26.21.47.47.47h3.06c.26 0 .47-.21.47-.47v-3.06a.47.47 0 00-.47-.47z" fill="#fff" opacity=".7"/>
  </svg>
);
const JiraNetIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path d="M12.005 2C6.486 2 2.005 6.481 2.005 12s4.481 10 10 10 10-4.481 10-10-4.481-10-10-10z" fill="#0891b2"/>
    <path d="M15.53 8h-3.06a.47.47 0 00-.47.47v3.06c0 .26.21.47.47.47h3.06c.26 0 .47-.21.47-.47V8.47a.47.47 0 00-.47-.47z" fill="#fff"/>
    <path d="M11.53 12h-3.06a.47.47 0 00-.47.47v3.06c0 .26.21.47.47.47h3.06c.26 0 .47-.21.47-.47v-3.06a.47.47 0 00-.47-.47z" fill="#fff" opacity=".7"/>
  </svg>
);
const AdoIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path d="M2 17.25V6.75L10 2l8 4.75v4.3L10 14.5l-4-.04v3.8L2 17.25zM22 6.75v10.5L18 22l-6-4v-3l6 3.5v-6.5l-6-4V5l10 1.75z" fill="#0078D7"/>
  </svg>
);

const ItsdIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" fill="#dc2626"/>
    <path d="M13 7h-2v5.414l3.293 3.293 1.414-1.414L13 11.586V7z" fill="#fff"/>
  </svg>
);

function isJiraProvider(p) { return p === "jira" || p === "jira_net" || p === "itsd"; }

const PROVIDERS = [
  { key: "jira", label: "Jira", icon: <JiraIcon /> },
  { key: "jira_net", label: "JIRA.net", icon: <JiraNetIcon /> },
  { key: "ado", label: "Azure DevOps", icon: <AdoIcon /> },
  { key: "itsd", label: "ITSD", icon: <ItsdIcon /> },
];

export default function Configuration({ apiFetch, currentUser, onLogout, onBack }) {
  const [credentials, setCredentials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editProvider, setEditProvider] = useState(null); // "jira" | "ado"
  const [form, setForm] = useState({
    provider: "jira",
    label: "",
    email: "",
    password: "",
    jira_url: "",
    pat: "",
    ado_org: "",
    ado_project: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [testResult, setTestResult] = useState(null); // { status, message }
  const [testing, setTesting] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);

  async function fetchCredentials() {
    setLoading(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/credentials`);
      const data = await res.json();
      setCredentials(data.credentials || []);
    } catch {
      setCredentials([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchCredentials(); }, []);

  function hasProvider(providerKey) {
    return credentials.some((c) => c.provider === providerKey);
  }

  function openModal(providerKey) {
    const existing = credentials.find((c) => c.provider === providerKey);
    setEditProvider(existing ? providerKey : null);
    setForm({
      provider: providerKey,
      label: existing?.label || "",
      email: "",
      password: "",
      jira_url: providerKey === "jira_net" ? "https://jira.homecredit.net/jira" : providerKey === "itsd" ? "https://itservicedesk.homecredit.ph" : "",
      pat: "",
      ado_org: "",
      ado_project: "",
    });
    setError("");
    setTestResult(null);
    setShowModal(true);
  }

  async function handleSave() {
    setError("");
    if (isJiraProvider(form.provider) && (!form.email.trim() || !form.password.trim())) {
      setError("Email and password are required for Jira.");
      return;
    }
    if (form.provider === "ado" && !form.pat.trim()) {
      setError("Personal Access Token is required for Azure DevOps.");
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/credentials/${form.provider}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.detail || "Failed to save credential");
      }
      setShowModal(false);
      fetchCredentials();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTestResult(null);
    setError("");
    if (isJiraProvider(form.provider) && (!form.email.trim() || !form.password.trim())) {
      setError("Fill in email and password before testing.");
      return;
    }
    if (form.provider === "ado" && !form.pat.trim()) {
      setError("Fill in the PAT before testing.");
      return;
    }
    setTesting(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/credentials/${form.provider}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      setTestResult(data);
    } catch (err) {
      setTestResult({ status: "failed", message: err.message });
    } finally {
      setTesting(false);
    }
  }

  async function handleDelete(providerKey) {
    const providerLabel = PROVIDERS.find((p) => p.key === providerKey)?.label || providerKey;
    setConfirmDialog({
      message: `Remove ${providerLabel} credentials? This cannot be undone.`,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          const res = await apiFetch(`${API_BASE}/api/credentials/${providerKey}`, { method: "DELETE" });
          if (!res.ok) {
            const d = await res.json();
            setError(d.detail || "Failed to delete credential");
            return;
          }
          fetchCredentials();
        } catch (err) {
          setError(err.message);
        }
      },
    });
  }

  const providerMeta = PROVIDERS.find((p) => p.key === form.provider);

  return (
    <div style={{ minHeight: "100vh", background: "#f3f4f6", fontFamily: "'Inter', -apple-system, system-ui, sans-serif" }}>
      {/* ── Navbar ── */}
      <div style={{ background: "#ffffff", borderBottom: "1px solid #e5e7eb" }}>
        <div style={{
          display: "grid", gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center", padding: "0 28px", height: "52px",
          borderBottom: "1px solid #f3f4f6",
        }}>
          {/* Left — back nav */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              onClick={onBack}
              style={{
                background: "none", border: "none", cursor: "pointer",
                display: "inline-flex", alignItems: "center", gap: "6px",
                padding: "0", color: "#1d4ed8", fontWeight: "700",
                fontSize: "15px", letterSpacing: "-0.2px",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.75")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#1d4ed8">
                <rect x="3" y="3" width="8" height="8" rx="1.5"/>
                <rect x="13" y="3" width="8" height="8" rx="1.5"/>
                <rect x="3" y="13" width="8" height="8" rx="1.5"/>
                <rect x="13" y="13" width="8" height="8" rx="1.5"/>
              </svg>
              <span style={{ color: "#111827" }}>Task</span>
              <span style={{ color: "#1d4ed8" }}>Weave</span>
            </button>
          </div>

          {/* Center — page name */}
          <div style={{ textAlign: "center" }}>
            <span style={{ fontSize: "15px", fontWeight: "600", color: "#111827" }}>
              Configuration
            </span>
          </div>

          {/* Right — user info */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", justifyContent: "flex-end" }}>
            <div style={{ borderLeft: "1px solid #e5e7eb", height: 24, margin: "0 4px" }} />
            <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 500 }}
              title={`${currentUser?.username} (${currentUser?.role})`}>
              {currentUser?.display_name || currentUser?.username}
            </span>
            <button
              type="button"
              onClick={onLogout}
              style={{
                background: "none", border: "1px solid #d1d5db", borderRadius: 6,
                padding: "4px 10px", fontSize: 12, color: "#6b7280", cursor: "pointer",
                fontWeight: 600,
              }}
              title="Sign out"
            >Logout</button>
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div style={{ maxWidth: 700, margin: "0 auto", padding: "32px 20px" }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "#111827", marginBottom: 4 }}>
          External Integrations
        </h2>
        <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 24, marginTop: 0 }}>
          Connect your Jira or Azure DevOps account so TaskWeave can fetch project data. Credentials are encrypted at rest.
        </p>

        {loading ? (
          <div style={{ color: "#6b7280", fontSize: 13, padding: "24px 0" }}>Loading…</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {PROVIDERS.map((prov) => {
              const cred = credentials.find((c) => c.provider === prov.key);
              return (
                <div
                  key={prov.key}
                  style={{
                    background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12,
                    padding: "20px 24px", display: "flex", alignItems: "center",
                    justifyContent: "space-between", boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 24 }}>{prov.icon}</span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, color: "#111827" }}>{prov.label}</div>
                      {cred ? (
                        <div style={{ fontSize: 12, color: "#059669", marginTop: 2 }}>
                          ✓ Connected{cred.label ? ` — ${cred.label}` : ""}
                        </div>
                      ) : (
                        <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>
                          Not configured
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => openModal(prov.key)}
                      style={{
                        background: cred ? "none" : "#1d4ed8",
                        color: cred ? "#1d4ed8" : "#fff",
                        border: cred ? "1px solid #93c5fd" : "none",
                        borderRadius: 6, padding: "6px 14px", cursor: "pointer",
                        fontSize: 12, fontWeight: 600,
                      }}
                      onMouseEnter={(e) => { if (cred) e.currentTarget.style.background = "#eff6ff"; }}
                      onMouseLeave={(e) => { if (cred) e.currentTarget.style.background = "none"; }}
                    >
                      {cred ? "Edit" : "Connect"}
                    </button>
                    {cred && (
                      <button
                        onClick={() => handleDelete(prov.key)}
                        style={{
                          background: "none", border: "1px solid #fca5a5", borderRadius: 6,
                          padding: "6px 12px", cursor: "pointer", fontSize: 12,
                          color: "#dc2626", fontWeight: 600,
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "#fef2f2"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Modal ── */}
      {showModal && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000,
          }}
          onClick={() => setShowModal(false)}
        >
          <div
            style={{
              background: "#fff", borderRadius: 14, padding: "28px 32px 22px",
              maxWidth: 480, width: "90vw",
              boxShadow: "0 12px 40px rgba(15,23,42,0.18)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 18px", fontSize: 16, fontWeight: 700, color: "#111827" }}>
              {providerMeta?.icon} {editProvider ? `Edit ${providerMeta?.label}` : `Connect ${providerMeta?.label}`}
            </h3>

            {error && (
              <div style={{
                background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c",
                padding: "8px 12px", borderRadius: 8, fontSize: 13, marginBottom: 14,
              }}>{error}</div>
            )}

            {testResult && (
              <div style={{
                background: testResult.status === "success" ? "#f0fdf4" : "#fef2f2",
                border: `1px solid ${testResult.status === "success" ? "#bbf7d0" : "#fecaca"}`,
                color: testResult.status === "success" ? "#166534" : "#b91c1c",
                padding: "8px 12px", borderRadius: 8, fontSize: 13, marginBottom: 14,
              }}>
                {testResult.status === "success" ? "✓ " : "✗ "}{testResult.message}
              </div>
            )}

            {/* Label */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>
                Label <span style={{ color: "#9ca3af", fontWeight: 400 }}>(optional)</span>
              </label>
              <input
                style={inputStyle}
                placeholder="e.g. My work account"
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              />
            </div>

            {isJiraProvider(form.provider) ? (
              <>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Jira URL</label>
                  <input
                    style={inputStyle}
                    placeholder="https://yourcompany.atlassian.net"
                    value={form.jira_url}
                    onChange={(e) => setForm((f) => ({ ...f, jira_url: e.target.value }))}
                  />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Email</label>
                  <input
                    style={inputStyle}
                    placeholder="you@company.com"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    autoComplete="off"
                  />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>API Token / Password</label>
                  <input
                    style={inputStyle}
                    type="password"
                    placeholder="••••••••"
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    autoComplete="new-password"
                  />
                </div>
              </>
            ) : (
              <>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Organization</label>
                  <input
                    style={inputStyle}
                    placeholder="your-org-name"
                    value={form.ado_org}
                    onChange={(e) => setForm((f) => ({ ...f, ado_org: e.target.value }))}
                  />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Project</label>
                  <input
                    style={inputStyle}
                    placeholder="your-project-name"
                    value={form.ado_project}
                    onChange={(e) => setForm((f) => ({ ...f, ado_project: e.target.value }))}
                  />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Personal Access Token</label>
                  <input
                    style={inputStyle}
                    type="password"
                    placeholder="••••••••"
                    value={form.pat}
                    onChange={(e) => setForm((f) => ({ ...f, pat: e.target.value }))}
                    autoComplete="new-password"
                  />
                </div>
              </>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
              <button
                onClick={handleTest}
                disabled={testing}
                style={{
                  background: "none", border: "1px solid #93c5fd", borderRadius: 8,
                  padding: "8px 18px", fontSize: 13, fontWeight: 600,
                  color: "#1d4ed8", cursor: testing ? "wait" : "pointer",
                  opacity: testing ? 0.7 : 1,
                }}
              >
                {testing ? "Testing…" : "Test Connection"}
              </button>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  background: "none", border: "1px solid #d1d5db", borderRadius: 8,
                  padding: "8px 18px", fontSize: 13, fontWeight: 600,
                  color: "#6b7280", cursor: "pointer",
                }}
              >Cancel</button>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 8,
                  padding: "8px 22px", fontSize: 13, fontWeight: 700,
                  cursor: saving ? "wait" : "pointer", opacity: saving ? 0.7 : 1,
                }}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm dialog ── */}
      {confirmDialog && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10001,
          }}
          onClick={() => setConfirmDialog(null)}
        >
          <div
            style={{
              background: "#fff", borderRadius: 14, padding: "28px 32px 22px",
              maxWidth: 400, width: "90vw", textAlign: "center",
              boxShadow: "0 12px 40px rgba(15,23,42,0.18)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <p style={{ fontSize: 14, fontWeight: 500, color: "#111827", marginBottom: 20 }}>
              {confirmDialog.message}
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <button
                onClick={() => setConfirmDialog(null)}
                style={{
                  background: "none", border: "1px solid #d1d5db", borderRadius: 8,
                  padding: "8px 18px", fontSize: 13, fontWeight: 600,
                  color: "#6b7280", cursor: "pointer",
                }}
              >Cancel</button>
              <button
                onClick={confirmDialog.onConfirm}
                style={{
                  background: "#dc2626", color: "#fff", border: "none", borderRadius: 8,
                  padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer",
                }}
              >Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
