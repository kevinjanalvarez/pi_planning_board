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
const AdoIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path d="M2 17.25V6.75L10 2l8 4.75v4.3L10 14.5l-4-.04v3.8L2 17.25zM22 6.75v10.5L18 22l-6-4v-3l6 3.5v-6.5l-6-4V5l10 1.75z" fill="#0078D7"/>
  </svg>
);

const PROVIDERS = [
  { key: "jira", label: "Jira", icon: <JiraIcon /> },
  { key: "ado", label: "Azure DevOps", icon: <AdoIcon /> },
];

export default function UserProfile({ apiFetch, currentUser, onLogout, onBack, onProfile, onManageUsers, onIntegrations, onAuthUpdated, initialTab, pendingCount, integrationWarnings }) {
  const [tab, setTab] = useState(initialTab || "profile"); // "profile" | "integrations"
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);

  // ── Profile state ──
  const [profileForm, setProfileForm] = useState({
    display_name: currentUser?.display_name || "",
    current_password: "",
    new_password: "",
    confirm_password: "",
  });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState(null); // { type: "success"|"error", text }

  // ── Integrations state ──
  const [credentials, setCredentials] = useState([]);
  const [credLoading, setCredLoading] = useState(true);
  const [showCredModal, setShowCredModal] = useState(false);
  const [editProvider, setEditProvider] = useState(null);
  const [credForm, setCredForm] = useState({
    provider: "jira", label: "", email: "", password: "", jira_url: "", pat: "", ado_org: "",
  });
  const [credSaving, setCredSaving] = useState(false);
  const [credError, setCredError] = useState("");
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [cardTestResult, setCardTestResult] = useState({}); // { jira: { status, message }, ado: ... }
  const [cardTesting, setCardTesting] = useState({});

  // ── Profile handlers ──
  async function handleProfileSave() {
    setProfileMsg(null);
    const { display_name, current_password, new_password, confirm_password } = profileForm;
    if (!display_name.trim()) {
      setProfileMsg({ type: "error", text: "Display name is required." });
      return;
    }
    if (new_password && new_password !== confirm_password) {
      setProfileMsg({ type: "error", text: "New passwords do not match." });
      return;
    }
    if (new_password && new_password.length < 4) {
      setProfileMsg({ type: "error", text: "Password must be at least 4 characters." });
      return;
    }
    setProfileSaving(true);
    try {
      const body = { display_name: display_name.trim() };
      if (new_password) {
        body.password = new_password;
        body.current_password = current_password;
      }
      const res = await apiFetch(`${API_BASE}/api/auth/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.detail || "Failed to update profile");
      }
      const updated = await res.json();
      setProfileMsg({ type: "success", text: "Profile updated successfully." });
      setProfileForm((f) => ({ ...f, current_password: "", new_password: "", confirm_password: "" }));
      if (onAuthUpdated) onAuthUpdated(updated);
    } catch (err) {
      setProfileMsg({ type: "error", text: err.message });
    } finally {
      setProfileSaving(false);
    }
  }

  // ── Integrations handlers ──
  async function fetchCredentials() {
    setCredLoading(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/credentials`);
      const data = await res.json();
      setCredentials(data.credentials || []);
    } catch { setCredentials([]); }
    finally { setCredLoading(false); }
  }

  useEffect(() => { if (tab === "integrations") fetchCredentials(); }, [tab]);

  async function openCredModal(providerKey) {
    const existing = credentials.find((c) => c.provider === providerKey);
    setEditProvider(existing ? providerKey : null);
    setCredForm({
      provider: providerKey, label: existing?.label || "",
      email: "", password: "", jira_url: "", pat: "", ado_org: "",
    });
    setCredError("");
    setTestResult(null);
    setShowCredModal(true);
    // Pre-fill with saved data if editing
    if (existing) {
      try {
        const res = await apiFetch(`${API_BASE}/api/credentials/${providerKey}/details`);
        if (res.ok) {
          const d = await res.json();
          setCredForm((f) => ({
            ...f,
            label: d.label || f.label,
            email: d.email || "",
            jira_url: d.jira_url || "",
            ado_org: d.ado_org || "",
            password: "",
            pat: "",
          }));
        }
      } catch {}
    }
  }

  async function handleCredSave() {
    setCredError("");
    if (!editProvider && credForm.provider === "jira" && (!credForm.email.trim() || !credForm.password.trim())) {
      setCredError("Email and password are required for Jira."); return;
    }
    if (!editProvider && credForm.provider === "ado" && !credForm.pat.trim()) {
      setCredError("Personal Access Token is required for Azure DevOps."); return;
    }
    setCredSaving(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/credentials/${credForm.provider}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credForm),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || "Failed to save"); }
      setShowCredModal(false);
      fetchCredentials();
    } catch (err) { setCredError(err.message); }
    finally { setCredSaving(false); }
  }

  async function handleCredTest() {
    setTestResult(null); setCredError("");
    if (!editProvider && credForm.provider === "jira" && (!credForm.email.trim() || !credForm.password.trim())) {
      setCredError("Fill in email and password before testing."); return;
    }
    if (!editProvider && credForm.provider === "ado" && !credForm.pat.trim()) {
      setCredError("Fill in the PAT before testing."); return;
    }
    setTesting(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/credentials/${credForm.provider}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credForm),
      });
      setTestResult(await res.json());
    } catch (err) { setTestResult({ status: "failed", message: err.message }); }
    finally { setTesting(false); }
  }

  async function handleCardTest(providerKey) {
    setCardTesting((t) => ({ ...t, [providerKey]: true }));
    setCardTestResult((r) => ({ ...r, [providerKey]: null }));
    try {
      const res = await apiFetch(`${API_BASE}/api/credentials/health`);
      const data = await res.json();
      const result = data.results?.[providerKey];
      setCardTestResult((r) => ({ ...r, [providerKey]: result || { status: "failed", message: "No result returned" } }));
    } catch (err) {
      setCardTestResult((r) => ({ ...r, [providerKey]: { status: "failed", message: err.message } }));
    } finally {
      setCardTesting((t) => ({ ...t, [providerKey]: false }));
    }
  }

  async function handleCredDelete(providerKey) {
    const provLabel = PROVIDERS.find((p) => p.key === providerKey)?.label || providerKey;
    setConfirmDialog({
      message: `Remove ${provLabel} credentials? This cannot be undone.`,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await apiFetch(`${API_BASE}/api/credentials/${providerKey}`, { method: "DELETE" });
          fetchCredentials();
        } catch {}
      },
    });
  }

  const providerMeta = PROVIDERS.find((p) => p.key === credForm.provider);

  const tabStyle = (active) => ({
    padding: "8px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer",
    border: "none", borderBottom: active ? "2px solid #1d4ed8" : "2px solid transparent",
    background: "none", color: active ? "#1d4ed8" : "#6b7280",
    transition: "color 0.15s, border-color 0.15s",
  });

  return (
    <div style={{ minHeight: "100vh", background: "#f3f4f6", fontFamily: "'Inter', -apple-system, system-ui, sans-serif" }}>
      {/* ── Navbar ── */}
      <div style={{ background: "#ffffff", borderBottom: "1px solid #e5e7eb" }}>
        <div style={{
          display: "grid", gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center", padding: "0 28px", height: "52px",
          borderBottom: "1px solid #f3f4f6",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button onClick={onBack} style={{
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
          <div style={{ textAlign: "center" }}>
            <span style={{ fontSize: "15px", fontWeight: "600", color: "#111827" }}>My Profile</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", justifyContent: "flex-end" }}>
            <div style={{ position: "relative" }}>
              <button onClick={() => setAvatarMenuOpen((v) => !v)} style={{
                width: 34, height: 34, borderRadius: "50%", border: "2px solid #93c5fd",
                background: "#dbeafe", display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", fontSize: 14, fontWeight: 700, color: "#1d4ed8", padding: 0, lineHeight: 1,
              }} title={currentUser?.display_name || currentUser?.username}>
                {(currentUser?.display_name || currentUser?.username || "?")[0].toUpperCase()}
              </button>
              {avatarMenuOpen && (
                <>
                  <div style={{ position: "fixed", inset: 0, zIndex: 9998 }} onClick={() => setAvatarMenuOpen(false)} />
                  <div style={{
                    position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 9999,
                    background: "#fff", borderRadius: 12, boxShadow: "0 8px 30px rgba(0,0,0,0.15)",
                    border: "1px solid #e5e7eb", minWidth: 220, overflow: "hidden",
                  }}>
                    <div style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#dbeafe", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color: "#1d4ed8", flexShrink: 0 }}>
                        {(currentUser?.display_name || currentUser?.username || "?")[0].toUpperCase()}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{currentUser?.display_name || currentUser?.username}</div>
                        <div style={{ fontSize: 11, color: "#6b7280" }}>@{currentUser?.username} · {currentUser?.role?.toUpperCase()}</div>
                      </div>
                    </div>
                    <div style={{ padding: "6px 0" }}>
                      <button onClick={() => { setAvatarMenuOpen(false); onBack(); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 16px", border: "none", background: "none", fontSize: 13, color: "#374151", cursor: "pointer", textAlign: "left" }}
                        onMouseEnter={(e) => e.currentTarget.style.background = "#f3f4f6"} onMouseLeave={(e) => e.currentTarget.style.background = "none"}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
                        My Boards
                      </button>
                      {onProfile && (
                        <button onClick={() => { setAvatarMenuOpen(false); onProfile(); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 16px", border: "none", background: tab === "profile" ? "#eff6ff" : "none", fontSize: 13, color: tab === "profile" ? "#1d4ed8" : "#374151", fontWeight: tab === "profile" ? 600 : 400, cursor: "pointer", textAlign: "left", borderLeft: tab === "profile" ? "3px solid #1d4ed8" : "3px solid transparent" }}
                          onMouseEnter={(e) => e.currentTarget.style.background = tab === "profile" ? "#dbeafe" : "#f3f4f6"} onMouseLeave={(e) => e.currentTarget.style.background = tab === "profile" ? "#eff6ff" : "none"}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={tab === "profile" ? "#1d4ed8" : "#6b7280"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                          My Profile
                        </button>
                      )}
                      {onIntegrations && (
                        <button onClick={() => { setAvatarMenuOpen(false); onIntegrations(); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 16px", border: "none", background: tab === "integrations" ? "#eff6ff" : "none", fontSize: 13, color: tab === "integrations" ? "#1d4ed8" : "#374151", fontWeight: tab === "integrations" ? 600 : 400, cursor: "pointer", textAlign: "left", borderLeft: tab === "integrations" ? "3px solid #1d4ed8" : "3px solid transparent" }}
                          onMouseEnter={(e) => e.currentTarget.style.background = tab === "integrations" ? "#dbeafe" : "#f3f4f6"} onMouseLeave={(e) => e.currentTarget.style.background = tab === "integrations" ? "#eff6ff" : "none"}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={tab === "integrations" ? "#1d4ed8" : "#6b7280"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                          Integrations
                          {integrationWarnings && (
                            <span style={{
                              marginLeft: "auto", minWidth: 18, height: 18, borderRadius: 9,
                              background: "#f59e0b", color: "#fff", fontSize: 10, fontWeight: 700,
                              display: "inline-flex", alignItems: "center", justifyContent: "center",
                              padding: "0 5px", lineHeight: 1,
                            }}>!</span>
                          )}
                        </button>
                      )}
                      {onManageUsers && (
                        <button onClick={() => { setAvatarMenuOpen(false); onManageUsers(); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 16px", border: "none", background: "none", fontSize: 13, color: "#374151", cursor: "pointer", textAlign: "left" }}
                          onMouseEnter={(e) => e.currentTarget.style.background = "#f3f4f6"} onMouseLeave={(e) => e.currentTarget.style.background = "none"}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                          Manage Users
                          {pendingCount > 0 && (
                            <span style={{
                              marginLeft: "auto", minWidth: 18, height: 18, borderRadius: 9,
                              background: "#dc2626", color: "#fff", fontSize: 10, fontWeight: 700,
                              display: "inline-flex", alignItems: "center", justifyContent: "center",
                              padding: "0 5px", lineHeight: 1,
                            }}>{pendingCount}</span>
                          )}
                        </button>
                      )}
                    </div>
                    <div style={{ borderTop: "1px solid #f3f4f6", padding: "6px 0" }}>
                      <button onClick={() => { setAvatarMenuOpen(false); onLogout(); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 16px", border: "none", background: "none", fontSize: 13, color: "#ef4444", cursor: "pointer", textAlign: "left" }}
                        onMouseEnter={(e) => e.currentTarget.style.background = "#fef2f2"} onMouseLeave={(e) => e.currentTarget.style.background = "none"}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                        Logout
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", padding: "0 28px", gap: 4, borderBottom: "1px solid #e5e7eb" }}>
          <button style={tabStyle(tab === "profile")} onClick={() => setTab("profile")}>Profile</button>
          <button style={tabStyle(tab === "integrations")} onClick={() => setTab("integrations")}>Integrations</button>
        </div>
      </div>

      {/* ── Content ── */}
      <div style={{ maxWidth: 600, margin: "0 auto", padding: "32px 20px" }}>

        {/* ── Profile Tab ── */}
        {tab === "profile" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 28 }}>
              <div style={{
                width: 56, height: 56, borderRadius: "50%", background: "#dbeafe",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 22, fontWeight: 700, color: "#1d4ed8",
              }}>
                {(currentUser?.display_name || currentUser?.username || "?")[0].toUpperCase()}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 18, color: "#111827" }}>
                  {currentUser?.display_name || currentUser?.username}
                </div>
                <div style={{ fontSize: 13, color: "#6b7280" }}>
                  @{currentUser?.username} · <span style={{
                    fontSize: 11, fontWeight: 700, borderRadius: 4, padding: "1px 6px",
                    background: currentUser?.role === "admin" ? "#dbeafe" : "#f3f4f6",
                    color: currentUser?.role === "admin" ? "#1d4ed8" : "#6b7280",
                  }}>{currentUser?.role?.toUpperCase()}</span>
                </div>
              </div>
            </div>

            {profileMsg && (
              <div style={{
                padding: "8px 12px", borderRadius: 8, fontSize: 13, marginBottom: 16,
                background: profileMsg.type === "success" ? "#f0fdf4" : "#fef2f2",
                border: `1px solid ${profileMsg.type === "success" ? "#bbf7d0" : "#fecaca"}`,
                color: profileMsg.type === "success" ? "#166534" : "#b91c1c",
              }}>{profileMsg.text}</div>
            )}

            <div style={{
              background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12,
              padding: "24px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}>
              <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700, color: "#111827" }}>
                Account Information
              </h3>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Username</label>
                <input style={{ ...inputStyle, background: "#f9fafb", color: "#9ca3af" }}
                  value={currentUser?.username || ""} disabled />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Display Name</label>
                <input style={inputStyle} value={profileForm.display_name}
                  onChange={(e) => setProfileForm((f) => ({ ...f, display_name: e.target.value }))} />
              </div>

              <div style={{ borderTop: "1px solid #f3f4f6", margin: "20px 0 16px", paddingTop: 16 }}>
                <h4 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600, color: "#374151" }}>
                  Change Password
                </h4>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Current Password</label>
                  <input style={inputStyle} type="password" autoComplete="current-password"
                    value={profileForm.current_password}
                    onChange={(e) => setProfileForm((f) => ({ ...f, current_password: e.target.value }))}
                    placeholder="••••••••" />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>New Password</label>
                  <input style={inputStyle} type="password" autoComplete="new-password"
                    value={profileForm.new_password}
                    onChange={(e) => setProfileForm((f) => ({ ...f, new_password: e.target.value }))}
                    placeholder="min 4 characters" />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Confirm New Password</label>
                  <input style={inputStyle} type="password" autoComplete="new-password"
                    value={profileForm.confirm_password}
                    onChange={(e) => setProfileForm((f) => ({ ...f, confirm_password: e.target.value }))}
                    placeholder="re-enter new password" />
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                <button onClick={handleProfileSave} disabled={profileSaving} style={{
                  background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 8,
                  padding: "10px 24px", fontSize: 13, fontWeight: 700,
                  cursor: profileSaving ? "wait" : "pointer", opacity: profileSaving ? 0.7 : 1,
                }}>{profileSaving ? "Saving…" : "Save Changes"}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Integrations Tab ── */}
        {tab === "integrations" && (
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "#111827", marginBottom: 4 }}>
              External Integrations
            </h2>
            <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 24, marginTop: 0 }}>
              Connect your Jira or Azure DevOps account so TaskWeave can fetch project data. Credentials are encrypted at rest.
            </p>

            {credLoading ? (
              <div style={{ color: "#6b7280", fontSize: 13, padding: "24px 0" }}>Loading…</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {PROVIDERS.map((prov) => {
                  const cred = credentials.find((c) => c.provider === prov.key);
                  return (
                    <div key={prov.key} style={{
                      background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12,
                      padding: "20px 24px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ fontSize: 24 }}>{prov.icon}</span>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14, color: "#111827" }}>{prov.label}</div>
                          {cred ? (
                            <div style={{ fontSize: 12, color: "#059669", marginTop: 2 }}>✓ Connected{cred.label ? ` — ${cred.label}` : ""}</div>
                          ) : (
                            <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>Not configured</div>
                          )}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        {cred && (
                          <button onClick={() => handleCardTest(prov.key)} disabled={cardTesting[prov.key]} style={{
                            background: "none", border: "1px solid #a5b4fc", borderRadius: 6,
                            padding: "6px 12px", cursor: cardTesting[prov.key] ? "wait" : "pointer",
                            fontSize: 12, color: "#4f46e5", fontWeight: 600,
                            opacity: cardTesting[prov.key] ? 0.7 : 1,
                          }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = "#eef2ff"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                          >{cardTesting[prov.key] ? "Testing…" : "Test"}</button>
                        )}
                        <button onClick={() => openCredModal(prov.key)} style={{
                          background: cred ? "none" : "#1d4ed8", color: cred ? "#1d4ed8" : "#fff",
                          border: cred ? "1px solid #93c5fd" : "none", borderRadius: 6,
                          padding: "6px 14px", cursor: "pointer", fontSize: 12, fontWeight: 600,
                        }}
                          onMouseEnter={(e) => { if (cred) e.currentTarget.style.background = "#eff6ff"; }}
                          onMouseLeave={(e) => { if (cred) e.currentTarget.style.background = "none"; }}
                        >{cred ? "Edit" : "Connect"}</button>
                        {cred && (
                          <button onClick={() => handleCredDelete(prov.key)} style={{
                            background: "none", border: "1px solid #fca5a5", borderRadius: 6,
                            padding: "6px 12px", cursor: "pointer", fontSize: 12, color: "#dc2626", fontWeight: 600,
                          }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = "#fef2f2"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                          >Remove</button>
                        )}
                      </div>
                    </div>
                    {cardTestResult[prov.key] && (
                      <div style={{
                        marginTop: 8, padding: "8px 14px", borderRadius: 8, fontSize: 12, fontWeight: 500,
                        background: cardTestResult[prov.key].status === "success" ? "#f0fdf4" : "#fef2f2",
                        border: `1px solid ${cardTestResult[prov.key].status === "success" ? "#bbf7d0" : "#fecaca"}`,
                        color: cardTestResult[prov.key].status === "success" ? "#166534" : "#b91c1c",
                      }}>
                        {cardTestResult[prov.key].status === "success" ? "✓ " : "✗ "}
                        {cardTestResult[prov.key].message}
                      </div>
                    )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Credential Modal ── */}
      {showCredModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000 }}
          onClick={() => setShowCredModal(false)}
        >
          <div style={{
            background: "#fff", borderRadius: 14, padding: "28px 32px 22px",
            maxWidth: 480, width: "90vw", boxShadow: "0 12px 40px rgba(15,23,42,0.18)",
          }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 18px", fontSize: 16, fontWeight: 700, color: "#111827" }}>
              {providerMeta?.icon} {editProvider ? `Edit ${providerMeta?.label}` : `Connect ${providerMeta?.label}`}
            </h3>
            {credError && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c",
                padding: "8px 12px", borderRadius: 8, fontSize: 13, marginBottom: 14 }}>{credError}</div>
            )}
            {testResult && (
              <div style={{
                background: testResult.status === "success" ? "#f0fdf4" : "#fef2f2",
                border: `1px solid ${testResult.status === "success" ? "#bbf7d0" : "#fecaca"}`,
                color: testResult.status === "success" ? "#166534" : "#b91c1c",
                padding: "8px 12px", borderRadius: 8, fontSize: 13, marginBottom: 14,
              }}>{testResult.status === "success" ? "✓ " : "✗ "}{testResult.message}</div>
            )}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>
                Label <span style={{ color: "#9ca3af", fontWeight: 400 }}>(optional)</span>
              </label>
              <input style={inputStyle} placeholder="e.g. My work account" value={credForm.label}
                onChange={(e) => setCredForm((f) => ({ ...f, label: e.target.value }))} />
            </div>
            {credForm.provider === "jira" ? (
              <>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Jira URL</label>
                  <input style={inputStyle} placeholder="https://yourcompany.atlassian.net" value={credForm.jira_url}
                    onChange={(e) => setCredForm((f) => ({ ...f, jira_url: e.target.value }))} />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Email</label>
                  <input style={inputStyle} placeholder="you@company.com" value={credForm.email} autoComplete="off"
                    onChange={(e) => setCredForm((f) => ({ ...f, email: e.target.value }))} />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>API Token / Password</label>
                  <input style={inputStyle} type="password" placeholder={editProvider ? "Using saved password" : "••••••••"} value={credForm.password} autoComplete="new-password"
                    onChange={(e) => setCredForm((f) => ({ ...f, password: e.target.value }))} />
                </div>
              </>
            ) : (
              <>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Organization</label>
                  <input style={inputStyle} placeholder="your-org-name" value={credForm.ado_org}
                    onChange={(e) => setCredForm((f) => ({ ...f, ado_org: e.target.value }))} />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Personal Access Token</label>
                  <input style={inputStyle} type="password" placeholder={editProvider ? "Using saved PAT" : "••••••••"} value={credForm.pat} autoComplete="new-password"
                    onChange={(e) => setCredForm((f) => ({ ...f, pat: e.target.value }))} />
                </div>
              </>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
              <button onClick={handleCredTest} disabled={testing} style={{
                background: "none", border: "1px solid #93c5fd", borderRadius: 8,
                padding: "8px 18px", fontSize: 13, fontWeight: 600, color: "#1d4ed8",
                cursor: testing ? "wait" : "pointer", opacity: testing ? 0.7 : 1,
              }}>{testing ? "Testing…" : "Test Connection"}</button>
              <button onClick={() => setShowCredModal(false)} style={{
                background: "none", border: "1px solid #d1d5db", borderRadius: 8,
                padding: "8px 18px", fontSize: 13, fontWeight: 600, color: "#6b7280", cursor: "pointer",
              }}>Cancel</button>
              <button onClick={handleCredSave} disabled={credSaving} style={{
                background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 8,
                padding: "8px 22px", fontSize: 13, fontWeight: 700,
                cursor: credSaving ? "wait" : "pointer", opacity: credSaving ? 0.7 : 1,
              }}>{credSaving ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm dialog ── */}
      {confirmDialog && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10001 }}
          onClick={() => setConfirmDialog(null)}>
          <div style={{ background: "#fff", borderRadius: 14, padding: "28px 32px 22px",
            maxWidth: 400, width: "90vw", textAlign: "center", boxShadow: "0 12px 40px rgba(15,23,42,0.18)" }}
            onClick={(e) => e.stopPropagation()}>
            <p style={{ fontSize: 14, fontWeight: 500, color: "#111827", marginBottom: 20 }}>{confirmDialog.message}</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <button onClick={() => setConfirmDialog(null)} style={{
                background: "none", border: "1px solid #d1d5db", borderRadius: 8,
                padding: "8px 18px", fontSize: 13, fontWeight: 600, color: "#6b7280", cursor: "pointer",
              }}>Cancel</button>
              <button onClick={confirmDialog.onConfirm} style={{
                background: "#dc2626", color: "#fff", border: "none", borderRadius: 8,
                padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer",
              }}>Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
