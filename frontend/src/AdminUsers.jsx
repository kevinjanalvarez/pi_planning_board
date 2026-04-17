import React, { useEffect, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://0.0.0.0:8000";

function formatDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const inputStyle = {
  display: "block", width: "100%", padding: "10px 12px", marginTop: 4,
  borderRadius: 8, border: "1px solid #d1d5db", fontSize: 14,
  boxSizing: "border-box", outline: "none", color: "#111827",
};

const JiraIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path d="M12.005 2C6.486 2 2.005 6.481 2.005 12s4.481 10 10 10 10-4.481 10-10-4.481-10-10-10z" fill="#2684FF"/>
    <path d="M11.29 8.35l-1.29 1.29-1.29-1.29a1 1 0 00-1.41 1.41L8.58 11l-1.29 1.29a1 1 0 001.41 1.41l1.29-1.29 1.29 1.29a1 1 0 001.41-1.41L11.41 11l1.29-1.29a1 1 0 00-1.41-1.41z" fill="none"/>
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

export default function AdminUsers({ apiFetch, currentUser, onLogout, onBack, onProfile, onIntegrations, onManageUsers, pendingCount, onPendingCountChange, integrationWarnings }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [form, setForm] = useState({ username: "", display_name: "", password: "", role: "user" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [expandedUserId, setExpandedUserId] = useState(null);
  const [userBoards, setUserBoards] = useState({});
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);

  // ── Credential management state ──
  const [modalTab, setModalTab] = useState("account"); // "account" | "credentials"
  const [userCreds, setUserCreds] = useState([]); // credentials for the user being edited
  const [credsLoading, setCredsLoading] = useState(false);
  const [showCredForm, setShowCredForm] = useState(null); // provider key or null
  const [credForm, setCredForm] = useState({ label: "", email: "", password: "", jira_url: "", pat: "", ado_org: "" });
  const [credSaving, setCredSaving] = useState(false);
  const [credError, setCredError] = useState("");

  async function fetchUsers() {
    setLoading(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/users`);
      const data = await res.json();
      setUsers(data || []);
    } catch {
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchUsers(); }, []);

  const pendingUsers = users.filter((u) => u.status === "pending");
  const approvedUsers = users.filter((u) => u.status !== "pending");

  async function handleApprove(userId) {
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/users/${userId}/approve`, { method: "PATCH" });
      if (!res.ok) { const d = await res.json(); setError(d.detail || "Failed to approve"); return; }
      fetchUsers();
      if (onPendingCountChange) onPendingCountChange();
    } catch (err) { setError(err.message); }
  }

  async function handleReject(userId) {
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/users/${userId}/reject`, { method: "PATCH" });
      if (!res.ok) { const d = await res.json(); setError(d.detail || "Failed to reject"); return; }
      fetchUsers();
      if (onPendingCountChange) onPendingCountChange();
    } catch (err) { setError(err.message); }
  }

  async function toggleUserBoards(userId) {
    if (expandedUserId === userId) {
      setExpandedUserId(null);
      return;
    }
    setExpandedUserId(userId);
    if (!userBoards[userId]) {
      try {
        const res = await apiFetch(`${API_BASE}/api/admin/users/${userId}/boards`);
        const data = await res.json();
        setUserBoards((prev) => ({ ...prev, [userId]: data || [] }));
      } catch {
        setUserBoards((prev) => ({ ...prev, [userId]: [] }));
      }
    }
  }

  function openCreateModal() {
    setEditUser(null);
    setForm({ username: "", display_name: "", password: "", role: "user" });
    setError("");
    setShowModal(true);
  }

  function openEditModal(user) {
    setEditUser(user);
    setForm({ username: user.username, display_name: user.display_name, password: "", role: user.role });
    setError("");
    setModalTab("account");
    setUserCreds([]);
    setShowCredForm(null);
    setCredError("");
    fetchUserCreds(user.id);
    setShowModal(true);
  }

  async function handleSave() {
    setError("");
    if (!editUser && (!form.username.trim() || !form.display_name.trim() || !form.password)) {
      setError("All fields are required.");
      return;
    }
    if (editUser && !form.display_name.trim()) {
      setError("Display name is required.");
      return;
    }
    setSaving(true);
    try {
      if (editUser) {
        const body = { display_name: form.display_name.trim(), role: form.role };
        if (form.password) body.password = form.password;
        const res = await apiFetch(`${API_BASE}/api/admin/users/${editUser.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d.detail || "Failed to update user");
        }
      } else {
        const res = await apiFetch(`${API_BASE}/api/admin/users`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: form.username.trim(),
            display_name: form.display_name.trim(),
            password: form.password,
            role: form.role,
          }),
        });
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d.detail || "Failed to create user");
        }
      }
      setShowModal(false);
      fetchUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(userId, username) {
    setConfirmDialog({
      message: `Delete user "${username}"? This cannot be undone.`,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          const res = await apiFetch(`${API_BASE}/api/admin/users/${userId}`, { method: "DELETE" });
          if (!res.ok) {
            const d = await res.json();
            setError(d.detail || "Failed to delete user");
            return;
          }
          fetchUsers();
        } catch (err) {
          setError(err.message);
        }
      },
    });
  }

  // ── Admin credential helpers ──
  async function fetchUserCreds(userId) {
    setCredsLoading(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/users/${userId}/credentials`);
      const data = await res.json();
      setUserCreds(data.credentials || []);
    } catch { setUserCreds([]); }
    finally { setCredsLoading(false); }
  }

  function openCredForm(providerKey) {
    const existing = userCreds.find((c) => c.provider === providerKey);
    setCredForm({ label: existing?.label || "", email: "", password: "", jira_url: "", pat: "", ado_org: "" });
    setCredError("");
    setShowCredForm(providerKey);
  }

  async function handleCredSave(userId) {
    setCredError("");
    const prov = showCredForm;
    if (prov === "jira" && (!credForm.email.trim() || !credForm.password.trim())) {
      setCredError("Email and password are required."); return;
    }
    if (prov === "ado" && !credForm.pat.trim()) {
      setCredError("PAT is required."); return;
    }
    setCredSaving(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/users/${userId}/credentials/${prov}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: prov, ...credForm }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || "Failed to save"); }
      setShowCredForm(null);
      fetchUserCreds(userId);
    } catch (err) { setCredError(err.message); }
    finally { setCredSaving(false); }
  }

  async function handleCredDelete(userId, providerKey) {
    const provLabel = PROVIDERS.find((p) => p.key === providerKey)?.label || providerKey;
    setConfirmDialog({
      message: `Remove ${provLabel} credentials for this user?`,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await apiFetch(`${API_BASE}/api/admin/users/${userId}/credentials/${providerKey}`, { method: "DELETE" });
          fetchUserCreds(userId);
        } catch {}
      },
    });
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f3f4f6", fontFamily: "'Inter', -apple-system, system-ui, sans-serif" }}>
      {/* ── Navbar (matching PI Planning header) ── */}
      <div style={{
        background: "#ffffff",
        borderBottom: "1px solid #e5e7eb",
      }}>
        {/* Row 1: logo | page title (centered) | user controls */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          padding: "0 28px",
          height: "52px",
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
              User Management
            </span>
          </div>

          {/* Right — add user + avatar dropdown */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", justifyContent: "flex-end" }}>
            <button
              onClick={openCreateModal}
              style={{
                background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 6,
                padding: "6px 14px", cursor: "pointer", fontSize: 12, fontWeight: 700,
              }}
            >+ Add User</button>
            <div style={{ borderLeft: "1px solid #e5e7eb", height: 24, margin: "0 4px" }} />
            {pendingCount > 0 && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6,
                padding: "3px 10px", fontSize: 11, fontWeight: 700, color: "#dc2626",
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
                {pendingCount} pending
              </span>
            )}
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
                        <button onClick={() => { setAvatarMenuOpen(false); onProfile(); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 16px", border: "none", background: "none", fontSize: 13, color: "#374151", cursor: "pointer", textAlign: "left" }}
                          onMouseEnter={(e) => e.currentTarget.style.background = "#f3f4f6"} onMouseLeave={(e) => e.currentTarget.style.background = "none"}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                          My Profile
                        </button>
                      )}
                      {onIntegrations && (
                        <button onClick={() => { setAvatarMenuOpen(false); onIntegrations(); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 16px", border: "none", background: "none", fontSize: 13, color: "#374151", cursor: "pointer", textAlign: "left" }}
                          onMouseEnter={(e) => e.currentTarget.style.background = "#f3f4f6"} onMouseLeave={(e) => e.currentTarget.style.background = "none"}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
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
                        <button onClick={() => { setAvatarMenuOpen(false); onManageUsers(); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 16px", border: "none", background: "#eff6ff", fontSize: 13, color: "#1d4ed8", fontWeight: 600, cursor: "pointer", textAlign: "left", borderLeft: "3px solid #1d4ed8" }}
                          onMouseEnter={(e) => e.currentTarget.style.background = "#dbeafe"} onMouseLeave={(e) => e.currentTarget.style.background = "#eff6ff"}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1d4ed8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
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

        {/* Row 2: label + user count */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 28px", height: "40px",
        }}>
          <span style={{ fontSize: "13px", color: "#9ca3af", fontStyle: "italic" }}>
            Administration · {users.length} Users
          </span>
        </div>
      </div>

      {/* Users table */}
      <div style={{ padding: "24px 28px" }}>
      {loading ? (
        <p style={{ color: "#9ca3af", fontSize: 14 }}>Loading users...</p>
      ) : (
        <>
        {/* ── Pending Requests Section ── */}
        {pendingUsers.length > 0 && (
          <div style={{
            background: "#fffbeb", borderRadius: 12, border: "1px solid #fde68a",
            marginBottom: 20, overflow: "hidden",
          }}>
            <div style={{
              padding: "12px 16px", borderBottom: "1px solid #fde68a",
              display: "flex", alignItems: "center", gap: 8,
              background: "#fef3c7",
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#92400e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#92400e" }}>
                Pending Registration Requests ({pendingUsers.length})
              </span>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ background: "#fef9e7", borderBottom: "1px solid #fde68a" }}>
                  <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 600, color: "#92400e", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>Username</th>
                  <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 600, color: "#92400e", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>Display Name</th>
                  <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 600, color: "#92400e", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>Requested</th>
                  <th style={{ padding: "10px 16px", textAlign: "right", fontWeight: 600, color: "#92400e", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pendingUsers.map((user) => (
                  <tr key={user.id} style={{ borderBottom: "1px solid #fde68a" }}>
                    <td style={{ padding: "10px 16px", fontWeight: 600, color: "#111827" }}>{user.username}</td>
                    <td style={{ padding: "10px 16px", color: "#374151" }}>{user.display_name}</td>
                    <td style={{ padding: "10px 16px", color: "#6b7280", fontSize: 12 }}>
                      {user.created_at ? new Date(user.created_at).toLocaleDateString() : "—"}
                    </td>
                    <td style={{ padding: "10px 16px", textAlign: "right" }}>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <button
                          onClick={() => handleApprove(user.id)}
                          style={{
                            background: "#15803d", color: "#fff", border: "none", borderRadius: 6,
                            padding: "5px 14px", cursor: "pointer", fontSize: 12, fontWeight: 700,
                          }}
                        >Approve</button>
                        <button
                          onClick={() => handleReject(user.id)}
                          style={{
                            background: "#dc2626", color: "#fff", border: "none", borderRadius: 6,
                            padding: "5px 14px", cursor: "pointer", fontSize: 12, fontWeight: 700,
                          }}
                        >Reject</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Approved Users Table ── */}
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 600, color: "#6b7280", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>ID</th>
                <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 600, color: "#6b7280", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>Username</th>
                <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 600, color: "#6b7280", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>Display Name</th>
                <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 600, color: "#6b7280", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>Role</th>
                <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 600, color: "#6b7280", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>Boards</th>
                <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 600, color: "#6b7280", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>Integrations</th>
                <th style={{ padding: "12px 16px", textAlign: "left", fontWeight: 600, color: "#6b7280", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>Created</th>
                <th style={{ padding: "12px 16px", textAlign: "right", fontWeight: 600, color: "#6b7280", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {approvedUsers.map((user) => {
                const isExpanded = expandedUserId === user.id;
                const boards = userBoards[user.id];
                const isSelf = currentUser?.id === user.id;
                return (
                  <React.Fragment key={user.id}>
                    <tr style={{ borderBottom: "1px solid #f3f4f6", transition: "background 0.1s" }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "#f9fafb"}
                      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                    >
                      <td style={{ padding: "12px 16px", color: "#9ca3af", fontSize: 13 }}>#{user.id}</td>
                      <td style={{ padding: "12px 16px", fontWeight: 600, color: "#111827" }}>
                        {user.username}
                        {isSelf && <span style={{ fontSize: 10, color: "#6b7280", marginLeft: 6 }}>(you)</span>}
                      </td>
                      <td style={{ padding: "12px 16px", color: "#374151" }}>{user.display_name}</td>
                      <td style={{ padding: "12px 16px" }}>
                        <span style={{
                          fontSize: 11, fontWeight: 700, borderRadius: 4, padding: "2px 8px",
                          background: user.role === "admin" ? "#dbeafe" : "#f3f4f6",
                          color: user.role === "admin" ? "#1d4ed8" : "#6b7280",
                        }}>
                          {user.role.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <button
                          onClick={() => toggleUserBoards(user.id)}
                          style={{
                            background: "none", border: "none", color: "#1d4ed8",
                            cursor: "pointer", fontSize: 13, fontWeight: 600,
                            display: "flex", alignItems: "center", gap: 4,
                          }}
                        >
                          {user.board_count ?? 0} board{(user.board_count ?? 0) !== 1 ? "s" : ""}
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
                            style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.15s" }}>
                            <polyline points="6 9 12 15 18 9"/>
                          </svg>
                        </button>
                      </td>
                      <td style={{ padding: "12px 16px", fontSize: 12 }}>
                        {(user.integrations || []).length > 0
                          ? (user.integrations || []).map((p) => {
                              const prov = PROVIDERS.find((x) => x.key === p);
                              return <span key={p} style={{ marginRight: 6 }} title={prov?.label || p}>{prov?.icon || p} ✓</span>;
                            })
                          : <span style={{ color: "#d1d5db" }}>—</span>
                        }
                      </td>
                      <td style={{ padding: "12px 16px", color: "#9ca3af", fontSize: 13 }}>{formatDate(user.created_at)}</td>
                      <td style={{ padding: "12px 16px", textAlign: "right" }}>
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                          <button
                            onClick={() => openEditModal(user)}
                            style={{
                              background: "none", border: "1px solid #d1d5db", borderRadius: 6,
                              padding: "5px 12px", fontSize: 12, color: "#374151", cursor: "pointer", fontWeight: 500,
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = "#f3f4f6"}
                            onMouseLeave={(e) => e.currentTarget.style.background = "none"}
                          >
                            Edit
                          </button>
                          {!isSelf && (
                            <button
                              onClick={() => handleDelete(user.id, user.username)}
                              style={{
                                background: "none", border: "1px solid #fecaca", borderRadius: 6,
                                padding: "5px 12px", fontSize: 12, color: "#ef4444", cursor: "pointer", fontWeight: 500,
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = "#fef2f2"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {/* Expanded boards list */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} style={{ padding: 0 }}>
                          <div style={{ background: "#f9fafb", padding: "12px 48px 16px", borderBottom: "1px solid #e5e7eb" }}>
                            {!boards ? (
                              <span style={{ color: "#9ca3af", fontSize: 13 }}>Loading boards...</span>
                            ) : boards.length === 0 ? (
                              <span style={{ color: "#9ca3af", fontSize: 13 }}>No boards created by this user.</span>
                            ) : (
                              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                <span style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 4 }}>Boards created by {user.display_name}:</span>
                                {boards.map((b) => (
                                  <div key={b.id} style={{
                                    display: "flex", alignItems: "center", gap: 12,
                                    background: "#fff", borderRadius: 8, padding: "8px 14px",
                                    border: "1px solid #e5e7eb", fontSize: 13,
                                  }}>
                                    <span style={{ fontWeight: 600, color: "#111827" }}>{b.name}</span>
                                    {b.start_date && b.end_date && (
                                      <span style={{ color: "#0d9488", fontSize: 12, fontWeight: 600 }}>
                                        {b.start_date.slice(0, 7)} → {b.end_date.slice(0, 7)}
                                      </span>
                                    )}
                                    {b.is_archived === 1 && (
                                      <span style={{ fontSize: 10, background: "#fef3c7", color: "#92400e", borderRadius: 4, padding: "1px 5px", fontWeight: 700 }}>Archived</span>
                                    )}
                                    <span style={{ color: "#9ca3af", fontSize: 12, marginLeft: "auto" }}>{formatDate(b.created_at)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
      </div>

      {/* Create / Edit Modal */}
      {showModal && (
        <div
          onMouseDown={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
          }}
        >
          <div onMouseDown={(e) => e.stopPropagation()} style={{
            background: "#fff", borderRadius: 16, padding: "32px 36px", width: 480,
            boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          }}>
            <h2 style={{ margin: "0 0 16px", fontSize: 20, fontWeight: 700, color: "#111827" }}>
              {editUser ? "Edit User" : "Add New User"}
            </h2>

            {/* Tabs (only when editing) */}
            {editUser && (
              <div style={{ display: "flex", gap: 4, marginBottom: 18, borderBottom: "1px solid #e5e7eb" }}>
                {[{ key: "account", label: "Account" }, { key: "credentials", label: "Credentials" }].map((t) => (
                  <button key={t.key} onClick={() => { setModalTab(t.key); setShowCredForm(null); setCredError(""); }}
                    style={{
                      padding: "6px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                      border: "none", borderBottom: modalTab === t.key ? "2px solid #1d4ed8" : "2px solid transparent",
                      background: "none", color: modalTab === t.key ? "#1d4ed8" : "#6b7280",
                    }}
                  >{t.label}</button>
                ))}
              </div>
            )}

            {/* ── Account tab ── */}
            {(!editUser || modalTab === "account") && (
              <>
                {!editUser && (
                  <label style={{ display: "block", marginBottom: 14 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Username *</span>
                    <input
                      value={form.username}
                      onChange={(e) => setForm((p) => ({ ...p, username: e.target.value }))}
                      placeholder="username"
                      required
                      autoFocus
                      style={inputStyle}
                    />
                  </label>
                )}

                <label style={{ display: "block", marginBottom: 14 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Display Name *</span>
                  <input
                    value={form.display_name}
                    onChange={(e) => setForm((p) => ({ ...p, display_name: e.target.value }))}
                    placeholder="Juan Dela Cruz"
                    required
                    autoFocus={!!editUser}
                    style={inputStyle}
                  />
                </label>

                <label style={{ display: "block", marginBottom: 14 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>
                    Password {editUser ? "(leave blank to keep current)" : "*"}
                  </span>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                    placeholder={editUser ? "••••••••" : "min 4 characters"}
                    required={!editUser}
                    style={inputStyle}
                  />
                </label>

                <label style={{ display: "block", marginBottom: 20 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Role</span>
                  <select
                    value={form.role}
                    onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))}
                    style={{ ...inputStyle, cursor: "pointer" }}
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>

                {error && (
                  <div className="error-overlay-backdrop" style={{ zIndex: 10001 }} onClick={() => setError("")}>
                    <div className="error-overlay" onClick={(e) => e.stopPropagation()}>
                      <div className="error-overlay-icon">⚠️</div>
                      <div className="error-overlay-message">{error}</div>
                      <button className="error-overlay-close" onClick={() => setError("")}>Close</button>
                    </div>
                  </div>
                )}

                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button
                    onClick={() => setShowModal(false)}
                    style={{
                      padding: "10px 20px", borderRadius: 8, border: "1px solid #d1d5db",
                      background: "#fff", cursor: "pointer", fontWeight: 500, fontSize: 14, color: "#374151",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    style={{
                      padding: "10px 20px", borderRadius: 8, border: "none",
                      background: saving ? "#93c5fd" : "#1d4ed8", color: "#fff",
                      cursor: saving ? "wait" : "pointer", fontWeight: 700, fontSize: 14,
                    }}
                  >
                    {saving ? "Saving..." : editUser ? "Save Changes" : "Create User"}
                  </button>
                </div>
              </>
            )}

            {/* ── Credentials tab ── */}
            {editUser && modalTab === "credentials" && (
              <div>
                {credsLoading ? (
                  <p style={{ color: "#9ca3af", fontSize: 13, margin: "12px 0" }}>Loading credentials…</p>
                ) : showCredForm ? (
                  /* Credential form for specific provider */
                  <div>
                    <h4 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600, color: "#111827" }}>
                      {PROVIDERS.find((p) => p.key === showCredForm)?.icon}{" "}
                      {userCreds.find((c) => c.provider === showCredForm) ? "Edit" : "Add"}{" "}
                      {PROVIDERS.find((p) => p.key === showCredForm)?.label} Credentials
                    </h4>
                    {credError && (
                      <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c",
                        padding: "6px 10px", borderRadius: 6, fontSize: 12, marginBottom: 10 }}>{credError}</div>
                    )}
                    <label style={{ display: "block", marginBottom: 10 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Label <span style={{ color: "#9ca3af", fontWeight: 400 }}>(optional)</span></span>
                      <input style={{ ...inputStyle, padding: "8px 10px", fontSize: 13 }} placeholder="e.g. Work account" value={credForm.label}
                        onChange={(e) => setCredForm((f) => ({ ...f, label: e.target.value }))} />
                    </label>
                    {showCredForm === "jira" ? (
                      <>
                        <label style={{ display: "block", marginBottom: 10 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Jira URL</span>
                          <input style={{ ...inputStyle, padding: "8px 10px", fontSize: 13 }} placeholder="https://yourcompany.atlassian.net" value={credForm.jira_url}
                            onChange={(e) => setCredForm((f) => ({ ...f, jira_url: e.target.value }))} />
                        </label>
                        <label style={{ display: "block", marginBottom: 10 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Email</span>
                          <input style={{ ...inputStyle, padding: "8px 10px", fontSize: 13 }} placeholder="you@company.com" value={credForm.email} autoComplete="off"
                            onChange={(e) => setCredForm((f) => ({ ...f, email: e.target.value }))} />
                        </label>
                        <label style={{ display: "block", marginBottom: 10 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>API Token / Password</span>
                          <input style={{ ...inputStyle, padding: "8px 10px", fontSize: 13 }} type="password" placeholder="••••••••" value={credForm.password} autoComplete="new-password"
                            onChange={(e) => setCredForm((f) => ({ ...f, password: e.target.value }))} />
                        </label>
                      </>
                    ) : (
                      <>
                        <label style={{ display: "block", marginBottom: 10 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Organization</span>
                          <input style={{ ...inputStyle, padding: "8px 10px", fontSize: 13 }} placeholder="your-org-name" value={credForm.ado_org}
                            onChange={(e) => setCredForm((f) => ({ ...f, ado_org: e.target.value }))} />
                        </label>
                        <label style={{ display: "block", marginBottom: 10 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Personal Access Token</span>
                          <input style={{ ...inputStyle, padding: "8px 10px", fontSize: 13 }} type="password" placeholder="••••••••" value={credForm.pat} autoComplete="new-password"
                            onChange={(e) => setCredForm((f) => ({ ...f, pat: e.target.value }))} />
                        </label>
                      </>
                    )}
                    <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
                      <button onClick={() => setShowCredForm(null)} style={{
                        padding: "8px 16px", borderRadius: 6, border: "1px solid #d1d5db",
                        background: "#fff", cursor: "pointer", fontWeight: 500, fontSize: 13, color: "#374151",
                      }}>Back</button>
                      <button onClick={() => handleCredSave(editUser.id)} disabled={credSaving} style={{
                        padding: "8px 18px", borderRadius: 6, border: "none",
                        background: credSaving ? "#93c5fd" : "#1d4ed8", color: "#fff",
                        cursor: credSaving ? "wait" : "pointer", fontWeight: 700, fontSize: 13,
                      }}>{credSaving ? "Saving…" : "Save"}</button>
                    </div>
                  </div>
                ) : (
                  /* Provider cards list */
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {PROVIDERS.map((prov) => {
                      const cred = userCreds.find((c) => c.provider === prov.key);
                      return (
                        <div key={prov.key} style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          border: "1px solid #e5e7eb", borderRadius: 10, padding: "14px 16px",
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ fontSize: 20 }}>{prov.icon}</span>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: 13, color: "#111827" }}>{prov.label}</div>
                              {cred ? (
                                <div style={{ fontSize: 11, color: "#059669", marginTop: 1 }}>✓ Connected{cred.label ? ` — ${cred.label}` : ""}</div>
                              ) : (
                                <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 1 }}>Not configured</div>
                              )}
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={() => openCredForm(prov.key)} style={{
                              background: cred ? "none" : "#1d4ed8", color: cred ? "#1d4ed8" : "#fff",
                              border: cred ? "1px solid #93c5fd" : "none", borderRadius: 6,
                              padding: "5px 12px", cursor: "pointer", fontSize: 11, fontWeight: 600,
                            }}>{cred ? "Edit" : "Connect"}</button>
                            {cred && (
                              <button onClick={() => handleCredDelete(editUser.id, prov.key)} style={{
                                background: "none", border: "1px solid #fca5a5", borderRadius: 6,
                                padding: "5px 10px", cursor: "pointer", fontSize: 11, color: "#dc2626", fontWeight: 600,
                              }}>Remove</button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
                      <button onClick={() => setShowModal(false)} style={{
                        padding: "8px 18px", borderRadius: 6, border: "1px solid #d1d5db",
                        background: "#fff", cursor: "pointer", fontWeight: 500, fontSize: 13, color: "#374151",
                      }}>Close</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Confirm dialog ── */}
      {confirmDialog && (
        <div className="error-overlay-backdrop" onClick={() => setConfirmDialog(null)}>
          <div className="error-overlay" onClick={(e) => e.stopPropagation()} style={{ borderColor: "#d1d5db" }}>
            <div className="error-overlay-icon">⚠️</div>
            <div className="error-overlay-message" style={{ color: "#374151" }}>{confirmDialog.message}</div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button className="error-overlay-close" onClick={() => setConfirmDialog(null)}>Cancel</button>
              <button
                className="error-overlay-close"
                style={{ background: "#ef4444", color: "#fff", borderColor: "#ef4444" }}
                onClick={confirmDialog.onConfirm}
              >Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
