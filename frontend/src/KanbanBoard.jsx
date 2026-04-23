import React, { useCallback, useEffect, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://0.0.0.0:8000";

const DEFAULT_COL_COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#8b5cf6", "#ec4899", "#ef4444", "#06b6d4"];

// ── Status-to-column tone map (mirrors PI board logic) ──
// Maps external statuses to a tone, then tone maps to column aliases.
const STATUS_TONE_MAP = {
  // In Progress
  "in dev": "in-progress",
  "in development": "in-progress",
  "development": "in-progress",
  "in progress": "in-progress",
  "in test": "in-progress",
  "in testing": "in-progress",
  "testing": "in-progress",
  "test": "in-progress",
  "active": "in-progress",
  "ongoing": "in-progress",
  "doing": "in-progress",
  "wip": "in-progress",
  "in review": "in-progress",
  "review": "in-progress",
  "committed": "in-progress",
  // Done
  "done": "done",
  "resolved": "done",
  "closed": "done",
  "completed": "done",
  "finished": "done",
  "cancelled": "done",
  "canceled": "done",
  // Blocked
  "blocked": "blocked",
  "on hold": "blocked",
  "impediment": "blocked",
  // To Do
  "to do": "todo",
  "todo": "todo",
  "open": "todo",
  "new": "todo",
  "backlog": "todo",
  "not started": "todo",
  // Design
  "design": "design",
  "discovery": "design",
  "analysis": "design",
  // Ready
  "ready": "ready",
  "ready for dev": "ready",
  "refined": "ready",
  // Icebox
  "icebox": "icebox",
  "refill": "icebox",
  "frozen": "icebox",
};

// Tone → list of column name aliases to match against
const TONE_COLUMN_ALIASES = {
  "in-progress": ["in progress", "inprogress", "in-progress", "wip", "doing", "active"],
  "done":        ["done", "completed", "resolved", "closed", "finished", "cancelled", "canceled"],
  "blocked":     ["blocked", "on hold", "impediment"],
  "todo":        ["to do", "todo", "backlog", "open", "not started"],
  "design":      ["design", "discovery", "analysis"],
  "ready":       ["ready", "refined"],
  "icebox":      ["icebox", "frozen", "parking lot"],
};

function getStatusTone(status) {
  const value = (status || "").trim().toLowerCase();
  if (!value) return "unknown";
  if (STATUS_TONE_MAP[value]) return STATUS_TONE_MAP[value];
  // Fallback: keyword matching
  for (const [keyword, tone] of Object.entries(STATUS_TONE_MAP)) {
    if (value.includes(keyword)) return tone;
  }
  return "unknown";
}

function findColumnByTone(tone, columns) {
  const aliases = TONE_COLUMN_ALIASES[tone];
  if (!aliases || !columns.length) return null;
  for (const col of columns) {
    const colName = col.name.trim().toLowerCase();
    if (aliases.includes(colName)) return col;
  }
  return null;
}

export default function KanbanBoard({ board, apiFetch, auth, onLogout, onBack, onProfile, onIntegrations, onManageUsers, pendingCount, integrationWarnings }) {
  const [columns, setColumns] = useState([]);
  const [rows, setRows] = useState([]);
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);

  // Add column
  const [showAddCol, setShowAddCol] = useState(false);
  const [newColName, setNewColName] = useState("");
  const [newColColor, setNewColColor] = useState("#3b82f6");

  // Card creation
  const [addCardColId, setAddCardColId] = useState(null);
  const [newCardTitle, setNewCardTitle] = useState("");
  const [newCardDesc, setNewCardDesc] = useState("");
  const [newCardAssignee, setNewCardAssignee] = useState("");
  const [addCardMode, setAddCardMode] = useState("internal"); // "internal" | "jira" | "jira_net" | "ado" | "itsd"
  const [ticketKey, setTicketKey] = useState("");
  const [ticketLookup, setTicketLookup] = useState(null); // fetched ticket info
  const [ticketLoading, setTicketLoading] = useState(false);
  const [ticketError, setTicketError] = useState("");

  // Editing
  const [editCol, setEditCol] = useState(null);
  const [editCard, setEditCard] = useState(null);

  // Card detail view (double-click)
  const [viewCard, setViewCard] = useState(null);

  // Status history
  const [statusHistory, setStatusHistory] = useState([]);

  // AI Insights
  const [insightsPanel, setInsightsPanel] = useState(false);
  const [insightsData, setInsightsData] = useState(null);
  const [insightsTab, setInsightsTab] = useState("overview"); // "overview" | "analysis"

  // Filters
  const [filterSearch, setFilterSearch] = useState("");
  const [filterAssignee, setFilterAssignee] = useState("");

  // Confirm dialog
  const [confirmDialog, setConfirmDialog] = useState(null);

  // Drag
  const [dragCard, setDragCard] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);

  // Refresh
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadBoard = useCallback(async (options = {}) => {
    const { refreshExternal = false } = options;
    setError("");
    try {
      const res = await apiFetch(`${API_BASE}/api/kanban/${board.id}?refresh_external=${refreshExternal ? "true" : "false"}`);
      if (!res.ok) throw new Error("Failed to load kanban board");
      const data = await res.json();
      setColumns(data.columns || []);
      setRows(data.rows || []);
      setCards(data.cards || []);
      setStatusHistory(data.status_history || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [board.id, apiFetch]);

  useEffect(() => { loadBoard(); }, [loadBoard]);

  // Auto-sync external tickets every 5 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      loadBoard({ refreshExternal: true });
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadBoard]);

  async function refreshBoard() {
    setIsRefreshing(true);
    try {
      await loadBoard({ refreshExternal: true });
    } finally {
      setIsRefreshing(false);
    }
  }

  // ── AI Insights ──
  async function fetchInsights() {
    setInsightsPanel(true);
    setInsightsData({ loading: true, data: null, error: null });
    try {
      const res = await apiFetch(`${API_BASE}/api/kanban/${board.id}/insights`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || "Failed to generate insights");
      setInsightsData({ loading: false, data: body, error: null });
    } catch (err) {
      setInsightsData({ loading: false, data: null, error: err.message });
    }
  }

  // ── Column CRUD ──
  async function addColumn() {
    if (!newColName.trim()) return;
    await apiFetch(`${API_BASE}/api/kanban/${board.id}/columns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newColName.trim(), color: newColColor }),
    });
    setNewColName("");
    setNewColColor(DEFAULT_COL_COLORS[(columns.length + 1) % DEFAULT_COL_COLORS.length]);
    setShowAddCol(false);
    loadBoard();
  }

  async function saveEditCol() {
    if (!editCol || !editCol.name.trim()) return;
    await apiFetch(`${API_BASE}/api/kanban/columns/${editCol.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editCol.name.trim(), color: editCol.color }),
    });
    setEditCol(null);
    loadBoard();
  }

  async function removeColumn(colId) {
    setConfirmDialog({
      message: "Delete this column and all its cards?",
      onConfirm: async () => {
        setConfirmDialog(null);
        await apiFetch(`${API_BASE}/api/kanban/columns/${colId}`, { method: "DELETE" });
        loadBoard();
      },
    });
  }

  // ── Card CRUD ──
  async function lookupTicket() {
    if (!ticketKey.trim()) return;
    setTicketLoading(true);
    setTicketError("");
    setTicketLookup(null);
    try {
      const src = addCardMode; // "jira", "jira_net", "ado", or "itsd"
      const res = await apiFetch(`${API_BASE}/api/kanban/ticket-lookup?key=${encodeURIComponent(ticketKey.trim())}&source=${src}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || "Ticket not found");
      }
      const data = await res.json();
      setTicketLookup(data);
      if (data.description) setNewCardDesc(data.description);
      if (data.assignee) setNewCardAssignee(data.assignee);
    } catch (e) {
      setTicketError(e.message);
    } finally {
      setTicketLoading(false);
    }
  }

  async function addCard() {
    if (!addCardColId || !newCardTitle.trim()) return;
    const isExternal = (addCardMode === "jira" || addCardMode === "jira_net" || addCardMode === "ado" || addCardMode === "itsd") && ticketLookup;

    // Determine target column via tone map
    let targetColId = addCardColId;
    if (isExternal && ticketLookup.status && columns.length > 0) {
      const tone = getStatusTone(ticketLookup.status);
      const matched = findColumnByTone(tone, columns);
      targetColId = matched ? matched.id : columns[0].id;
    }

    // Determine target row via tone map (if swimlanes exist)
    let targetRowId = rows.length > 0 ? rows[0].id : null;
    if (isExternal && ticketLookup.status && rows.length > 0) {
      const tone = getStatusTone(ticketLookup.status);
      const aliases = TONE_COLUMN_ALIASES[tone];
      if (aliases) {
        const matchedRow = rows.find((r) => aliases.includes(r.name.trim().toLowerCase()));
        if (matchedRow) targetRowId = matchedRow.id;
      }
    }

    const body = {
      column_id: targetColId,
      row_id: targetRowId,
      title: newCardTitle.trim(),
      description: newCardDesc.trim() || null,
      assignee: newCardAssignee.trim() || null,
    };
    if (isExternal) {
      body.issue_key = ticketLookup.issue_key;
      body.ticket_source = addCardMode;
      body.assignee = ticketLookup.assignee || newCardAssignee.trim() || null;
      body.external_status = ticketLookup.status || null;
      body.external_url = ticketLookup.external_url || null;
      body.external_title = ticketLookup.summary || null;
    }
    try {
      const res = await apiFetch(`${API_BASE}/api/kanban/${board.id}/cards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.detail || "Failed to add card");
        return;
      }
    } catch (e) {
      setError(e.message || "Failed to add card");
      return;
    }
    setNewCardTitle("");
    setNewCardDesc("");
    setNewCardAssignee("");
    setAddCardColId(null);
    setTicketLookup(null);
    setTicketKey("");
    setTicketError("");
    setAddCardMode("internal");
    loadBoard();
  }

  async function saveEditCard() {
    if (!editCard || !editCard.title.trim()) return;
    await apiFetch(`${API_BASE}/api/kanban/cards/${editCard.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: editCard.title.trim(), color: editCard.color }),
    });
    setEditCard(null);
    loadBoard();
  }

  async function removeCard(cardId) {
    await apiFetch(`${API_BASE}/api/kanban/cards/${cardId}`, { method: "DELETE" });
    loadBoard();
  }

  // ── Drag & Drop ──
  function handleDragStart(card) {
    setDragCard(card);
  }

  async function handleDrop(colId) {
    if (!dragCard) return;
    setDragOverCol(null);
    if (dragCard.column_id === colId) {
      setDragCard(null);
      return;
    }
    await apiFetch(`${API_BASE}/api/kanban/cards/${dragCard.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ column_id: colId }),
    });
    setDragCard(null);
    loadBoard();
  }

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f3f4f6" }}>
        <div style={{ fontSize: 16, color: "#6b7280" }}>Loading kanban board...</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f3f4f6", fontFamily: "'Inter', -apple-system, system-ui, sans-serif", display: "flex", flexDirection: "column" }}>
      {/* ── Navbar (matching PI Planning header) ── */}
      <div style={{
        background: "#ffffff",
        borderBottom: "1px solid #e5e7eb",
        flexShrink: 0,
      }}>
        {/* Single row: logo | board name + filters | actions + avatar */}
        <div style={{
          display: "flex",
          alignItems: "center",
          padding: "0 20px",
          height: "52px",
          gap: 12,
        }}>
          {/* Left — back nav + board name */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
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
            <div style={{ borderLeft: "1px solid #e5e7eb", height: 20, margin: "0 4px" }} />
            <span style={{ fontSize: "14px", fontWeight: "600", color: "#111827", whiteSpace: "nowrap" }}>
              {board.name}
            </span>
          </div>

          {/* Center — search + assignee filter */}
          {columns.length > 0 && (() => {
            const assignees = [...new Set(cards.map((c) => c.assignee).filter(Boolean))].sort();
            const isFiltered = filterSearch || filterAssignee;
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, justifyContent: "center", minWidth: 0 }}>
                <div style={{ position: "relative", flex: "0 1 200px", minWidth: 120 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    style={{ position: "absolute", left: 7, top: "50%", transform: "translateY(-50%)" }}>
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                  <input
                    value={filterSearch}
                    onChange={(e) => setFilterSearch(e.target.value)}
                    placeholder="Search cards..."
                    style={{
                      width: "100%", padding: "4px 8px 4px 26px", fontSize: 12, border: "1px solid #e5e7eb",
                      borderRadius: 6, outline: "none", background: "#f9fafb",
                    }}
                  />
                </div>
                {assignees.length > 0 && (
                  <select
                    value={filterAssignee}
                    onChange={(e) => setFilterAssignee(e.target.value)}
                    style={{
                      padding: "4px 8px", fontSize: 12, border: "1px solid #e5e7eb",
                      borderRadius: 6, background: "#f9fafb", color: filterAssignee ? "#111827" : "#9ca3af",
                      cursor: "pointer", outline: "none",
                    }}
                  >
                    <option value="">All assignees</option>
                    {assignees.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                )}
                {isFiltered && (
                  <button
                    onClick={() => { setFilterSearch(""); setFilterAssignee(""); }}
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      fontSize: 11, color: "#6b7280", padding: "3px 6px", borderRadius: 4,
                    }}
                    title="Clear filters"
                  >✕</button>
                )}
              </div>
            );
          })()}

          {/* Right — action buttons + avatar */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
            <button
              onClick={refreshBoard}
              disabled={isRefreshing}
              style={{
                background: "none", border: "1px solid #e5e7eb", borderRadius: 6,
                padding: "6px 10px", cursor: isRefreshing ? "default" : "pointer", fontSize: 13, color: "#6b7280",
                display: "flex", alignItems: "center", gap: 4, opacity: isRefreshing ? 0.5 : 1,
              }}
              title="Refresh external tickets"
            >
              <span style={{ display: "inline-block", animation: isRefreshing ? "spin 1s linear infinite" : "none" }}>↻</span>
            </button>
            <button onClick={() => { setShowAddCol(true); setNewColColor(DEFAULT_COL_COLORS[columns.length % DEFAULT_COL_COLORS.length]); }}
              style={{
                background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 6,
                padding: "6px 14px", cursor: "pointer", fontSize: 12, fontWeight: 700,
              }}>+ Column</button>
            <button
              onClick={() => { if (insightsPanel) { setInsightsPanel(false); } else { fetchInsights(); } }}
              style={{
                background: insightsPanel ? "#eff6ff" : "none",
                color: insightsPanel ? "#1d4ed8" : "#374151",
                border: insightsPanel ? "1px solid #bfdbfe" : "1px solid #e5e7eb",
                borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 12, fontWeight: 700,
                display: "flex", alignItems: "center", gap: 5,
              }}
              title={insightsPanel ? "Close panel" : "Taskweave Coach"}
            >
              <span style={{ fontSize: 14 }}>&#129302;</span>
              Taskweave Coach
            </button>
            <div style={{ borderLeft: "1px solid #e5e7eb", height: 24, margin: "0 4px" }} />
            {onManageUsers && pendingCount > 0 && (
              <button
                onClick={() => { setAvatarMenuOpen(false); onManageUsers(); }}
                style={{
                  position: "relative", background: "none", border: "none", cursor: "pointer",
                  padding: "4px 6px", display: "flex", alignItems: "center",
                }}
                title={`${pendingCount} pending registration(s)`}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
                <span style={{
                  position: "absolute", top: 0, right: 2, minWidth: 16, height: 16,
                  borderRadius: 8, background: "#dc2626", color: "#fff", fontSize: 10, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px",
                  lineHeight: 1,
                }}>{pendingCount}</span>
              </button>
            )}
            <div style={{ position: "relative" }}>
              <button onClick={() => setAvatarMenuOpen((v) => !v)} style={{
                width: 34, height: 34, borderRadius: "50%", border: "2px solid #93c5fd",
                background: "#dbeafe", display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", fontSize: 14, fontWeight: 700, color: "#1d4ed8", padding: 0, lineHeight: 1,
              }} title={auth?.user?.display_name || auth?.user?.username}>
                {(auth?.user?.display_name || auth?.user?.username || "?")[0].toUpperCase()}
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
                        {(auth?.user?.display_name || auth?.user?.username || "?")[0].toUpperCase()}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{auth?.user?.display_name || auth?.user?.username}</div>
                        <div style={{ fontSize: 11, color: "#6b7280" }}>@{auth?.user?.username} · {auth?.user?.role?.toUpperCase()}</div>
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

      </div>

      {error && (
        <div className="error-overlay-backdrop" onClick={() => setError("")}>
          <div className="error-overlay" onClick={(e) => e.stopPropagation()}>
            <div className="error-overlay-icon">⚠️</div>
            <div className="error-overlay-message">{error}</div>
            <button className="error-overlay-close" onClick={() => setError("")}>Close</button>
          </div>
        </div>
      )}

      {/* ── Empty state ── */}
      {columns.length === 0 && (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          padding: "80px 20px", color: "#6b7280", gap: 16, flex: 1,
        }}>
          <div style={{ fontSize: 48 }}>📊</div>
          <h3 style={{ margin: 0, color: "#374151", fontSize: 20 }}>Set up your Kanban board</h3>
          <p style={{ margin: 0, fontSize: 14, maxWidth: 400, textAlign: "center" }}>
            Add columns to define your workflow stages (e.g., To Do, In Progress, Review, Done).
          </p>
          <button onClick={() => { setShowAddCol(true); setNewColColor(DEFAULT_COL_COLORS[0]); }} style={{
            background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 8,
            padding: "10px 20px", cursor: "pointer", fontSize: 14, fontWeight: 700, marginTop: 8,
          }}>+ Add Column</button>
        </div>
      )}

      {/* ── Columns + Insights panel wrapper ── */}
      {columns.length > 0 && (
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <div style={{
          display: "flex", gap: 0, flex: 1,
          overflow: "hidden",
        }}>
          {columns.map((col, colIdx) => {
            const colCards = cards.filter((c) => {
              if (c.column_id !== col.id) return false;
              if (filterSearch && !(c.title || "").toLowerCase().includes(filterSearch.toLowerCase()) && !(c.issue_key || "").toLowerCase().includes(filterSearch.toLowerCase())) return false;
              if (filterAssignee && c.assignee !== filterAssignee) return false;
              return true;
            });
            const isOver = dragOverCol === col.id;
            return (
              <div
                key={col.id}
                onDragOver={(e) => { e.preventDefault(); setDragOverCol(col.id); }}
                onDragLeave={() => setDragOverCol(null)}
                onDrop={() => handleDrop(col.id)}
                style={{
                  flex: 1, minWidth: 0,
                  background: isOver ? "#f0f4ff" : "#f3f4f6",
                  display: "flex", flexDirection: "column",
                  transition: "background 0.15s",
                  borderRight: colIdx < columns.length - 1 ? "1px solid #e5e7eb" : "none",
                }}
              >
                {/* Column header */}
                <div style={{
                  padding: "10px 14px", borderBottom: "1px solid #e5e7eb",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  background: "#fff",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 4, height: 20, borderRadius: 2, background: col.color, flexShrink: 0 }} />
                    <span
                      style={{ fontWeight: 700, fontSize: 13, color: "#111827", cursor: "pointer", textTransform: "uppercase", letterSpacing: 0.5 }}
                      onClick={() => setEditCol({ ...col })}
                      title="Edit column"
                    >{col.name}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <button onClick={() => setEditCol({ ...col })} title="Edit column" style={{
                      background: "none", border: "none", cursor: "pointer", color: "#9ca3af",
                      fontSize: 13, padding: "2px 4px", lineHeight: 1,
                    }}>✎</button>
                    <button onClick={() => removeColumn(col.id)} title="Delete column" style={{
                      background: "none", border: "none", cursor: "pointer", color: "#9ca3af",
                      fontSize: 13, padding: "2px 4px", lineHeight: 1,
                    }}>⋮</button>
                  </div>
                </div>

                {/* Add card button - top of column */}
                <div style={{ padding: "8px 10px 0" }}>
                  <button
                    onClick={() => { setAddCardColId(col.id); setNewCardTitle(""); setNewCardDesc(""); setAddCardMode("manual"); setTicketKey(""); setTicketLookup(null); setTicketError(""); }}
                    style={{
                      background: "#fff", border: "1px dashed #d1d5db", borderRadius: 6,
                      padding: "6px 0", width: "100%", cursor: "pointer",
                      fontSize: 18, color: "#9ca3af", fontWeight: 400,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      transition: "border-color 0.15s, color 0.15s",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#6b7280"; e.currentTarget.style.color = "#6b7280"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#d1d5db"; e.currentTarget.style.color = "#9ca3af"; }}
                  >+</button>
                </div>

                {/* Cards */}
                <div style={{ padding: "8px 10px", flex: 1, overflowY: "auto" }}>
                  {colCards.map((card) => {
                    const isExternal = !!card.issue_key;
                    const sourceLabel = !isExternal ? "Internal" : card.ticket_source === "ado" ? "ADO" : card.ticket_source === "itsd" ? "ITSD" : card.ticket_source === "jira_net" ? "JIRA.net" : "JIRA";
                    const sourceBg = !isExternal ? "#e5e7eb" : card.ticket_source === "ado" ? "#fef3c7" : card.ticket_source === "itsd" ? "#fee2e2" : card.ticket_source === "jira_net" ? "#cffafe" : "#dbeafe";
                    const sourceColor = !isExternal ? "#6b7280" : card.ticket_source === "ado" ? "#92400e" : card.ticket_source === "itsd" ? "#dc2626" : card.ticket_source === "jira_net" ? "#0891b2" : "#1d4ed8";
                    const sourceIcon = !isExternal
                      ? /* board icon */ <svg width="10" height="10" viewBox="0 0 24 24" fill={sourceColor}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
                      : card.ticket_source === "ado"
                      ? /* ADO icon */ <svg width="10" height="10" viewBox="0 0 24 24" fill={sourceColor}><path d="M22 4v9.4L17.6 18l-6.1-2.1v4.6L7.4 16l12.2-1V4H22zM2 7.8l4.5-2.2L18 4v16l-11.5-2L2 15.6V7.8z"/></svg>
                      : /* JIRA icon */ <svg width="10" height="10" viewBox="0 0 24 24" fill={sourceColor}><path d="M12.005 2c-5.52 0-10 4.48-10 10s4.48 10 10 10 10-4.48 10-10-4.48-10-10-10zm0 3.6v2.9h5.4v2.5h-5.4v2.85L7.605 10l4.4-4.4z"/></svg>;

                    return (
                    <div
                      key={card.id}
                      draggable
                      onDragStart={() => handleDragStart(card)}
                      onDragEnd={() => { setDragCard(null); setDragOverCol(null); }}
                      onDoubleClick={() => setViewCard(card)}
                      style={{
                        background: "#fff",
                        borderRadius: 8, padding: 0, marginBottom: 8,
                        fontSize: 13, cursor: "grab",
                        display: "flex", flexDirection: "column",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)",
                        opacity: dragCard?.id === card.id ? 0.5 : 1,
                        transition: "opacity 0.15s, box-shadow 0.15s",
                        position: "relative",
                        borderLeft: `3px solid ${card.color || "#1f6688"}`,
                        overflow: "hidden",
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.12)"}
                      onMouseLeave={(e) => e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)"}
                    >
                      {/* Top row: source badge + actions */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px 4px" }}>
                        <span style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
                          background: sourceBg, color: sourceColor,
                          borderRadius: 4, padding: "2px 7px",
                        }}>
                          {sourceIcon}
                          {sourceLabel}
                        </span>
                        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                          <button onClick={(e) => { e.stopPropagation(); setEditCard({ ...card }); }} title="Edit card" style={{
                            background: "none", border: "none", cursor: "pointer",
                            color: "#9ca3af", fontSize: 12, padding: "2px 4px", lineHeight: 1,
                          }}>✎</button>
                          <button onClick={(e) => { e.stopPropagation(); removeCard(card.id); }} style={{
                            background: "none", border: "none", cursor: "pointer",
                            color: "#9ca3af", fontSize: 14, padding: "0 4px",
                            lineHeight: 1,
                          }}>×</button>
                        </div>
                      </div>

                      {/* Title */}
                      <div style={{ padding: "2px 10px 6px", fontWeight: 600, color: "#111827", lineHeight: 1.4, wordBreak: "break-word", cursor: "pointer" }}
                        onClick={() => setViewCard(card)}
                      >
                        {card.title}
                      </div>

                      {/* External link: KEY: Title */}
                      {isExternal && (
                        <div style={{ padding: "0 10px 6px" }}>
                          <a
                            href={card.external_url || "#"}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => { e.stopPropagation(); if (!card.external_url) e.preventDefault(); }}
                            style={{
                              fontSize: 11, fontWeight: 600, color: "#1d4ed8",
                              textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4,
                              cursor: card.external_url ? "pointer" : "default",
                              lineHeight: 1.4,
                            }}
                            onMouseEnter={(e) => { if (card.external_url) e.currentTarget.style.textDecoration = "underline"; }}
                            onMouseLeave={(e) => e.currentTarget.style.textDecoration = "none"}
                          >
                            {card.issue_key}: {card.external_title || card.title}
                            {card.external_url && (
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#1d4ed8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                              </svg>
                            )}
                          </a>
                        </div>
                      )}

                      {/* Footer: status + assignee */}
                      {(card.external_status || card.assignee) && (
                        <div style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "5px 10px", borderTop: "1px solid #f3f4f6",
                          background: "#fafafa",
                        }}>
                          {card.external_status && (
                            <span style={{
                              fontSize: 10, fontWeight: 600, color: "#6b7280",
                              background: "#f3f4f6", borderRadius: 3, padding: "2px 6px",
                              textTransform: "uppercase", letterSpacing: 0.3,
                            }}>{card.external_status}</span>
                          )}
                          {card.assignee && (
                            <span style={{
                              fontSize: 10, color: "#6b7280", display: "inline-flex",
                              alignItems: "center", gap: 3, marginLeft: "auto",
                            }}>
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                              </svg>
                              {card.assignee}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── AI Insights Docked Panel ── */}
        {insightsPanel && (
          <div style={{
            width: 360, minWidth: 360, borderLeft: "1px solid #e5e7eb",
            background: "#fff", display: "flex", flexDirection: "column",
            overflow: "hidden",
          }}>
            {/* Panel Header */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "12px 16px", borderBottom: "1px solid #f3f4f6", flexShrink: 0,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 16 }}>&#129302;</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>Taskweave Coach</span>
                <span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 500, marginLeft: 4 }}>Agile Delivery Insights</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <button type="button" onClick={fetchInsights}
                  style={{ background: "none", border: "1px solid #e5e7eb", borderRadius: 4, fontSize: 11, padding: "2px 8px", cursor: "pointer", color: "#6b7280" }}
                  title="Refresh insights">↻</button>
                <button type="button" onClick={() => setInsightsPanel(false)}
                  style={{ background: "none", border: "none", fontSize: 14, cursor: "pointer", color: "#6b7280", padding: "2px 6px" }}
                  title="Close panel">✕</button>
              </div>
            </div>

            {/* Panel Content */}
            <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px" }}>
              {insightsData?.loading ? (
                <div style={{ textAlign: "center", padding: "40px 0", color: "#6b7280" }}>
                  <div style={{ fontSize: 20, marginBottom: 8 }}>⏳</div>
                  <div style={{ fontSize: 12 }}>Analyzing board health...</div>
                </div>
              ) : insightsData?.error ? (
                <div style={{ color: "#dc2626", fontSize: 12, padding: "16px 0" }}>{insightsData.error}</div>
              ) : insightsData?.data ? (() => {
                const d = insightsData.data;
                const healthColor = d.board_health === "green" ? "#15803d" : d.board_health === "amber" ? "#d97706" : d.board_health === "red" ? "#dc2626" : "#6b7280";
                const healthBg = d.board_health === "green" ? "#f0fdf4" : d.board_health === "amber" ? "#fffbeb" : d.board_health === "red" ? "#fef2f2" : "#f9fafb";
                const healthIcon = d.board_health === "green" ? "🟢" : d.board_health === "amber" ? "🟡" : d.board_health === "red" ? "🔴" : "⚪";
                return (
                <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.6 }}>
                  {/* Tab switcher */}
                  <div style={{ display: "flex", gap: 0, marginBottom: 14, background: "#f3f4f6", borderRadius: 8, padding: 3 }}>
                    {[["overview", "Overview"], ["analysis", "Analysis"], ["actions", "Actions"]].map(([key, label]) => (
                      <button key={key} onClick={() => setInsightsTab(key)} style={{
                        flex: 1, padding: "6px 0", fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer",
                        borderRadius: 6, transition: "all 0.15s",
                        background: insightsTab === key ? "#fff" : "transparent",
                        color: insightsTab === key ? "#111827" : "#9ca3af",
                        boxShadow: insightsTab === key ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                      }}>{label}</button>
                    ))}
                  </div>

                  {/* ── OVERVIEW TAB ── */}
                  {insightsTab === "overview" && (
                    <>
                      {/* Board info bar */}
                      <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 10, padding: "6px 10px", background: "#f9fafb", borderRadius: 6 }}>
                        <strong style={{ color: "#111827" }}>{d.board_name}</strong> · {d.total_cards} cards
                      </div>

                      {/* Health + Score side by side */}
                      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                        <div style={{
                          flex: 1, background: healthBg, borderRadius: 8, padding: "10px 12px",
                          borderLeft: `3px solid ${healthColor}`,
                        }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: healthColor, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                            {healthIcon} Board Health
                          </div>
                          <div style={{ fontSize: 12, lineHeight: 1.5 }}>{d.health_summary}</div>
                        </div>
                        {d.agile_score != null && (
                          <div style={{
                            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                            padding: "10px 14px", background: "#f9fafb", borderRadius: 8, minWidth: 70,
                          }}>
                            <div style={{
                              width: 40, height: 40, borderRadius: "50%",
                              background: d.agile_score >= 7 ? "#dcfce7" : d.agile_score >= 4 ? "#fef3c7" : "#fef2f2",
                              border: `3px solid ${d.agile_score >= 7 ? "#15803d" : d.agile_score >= 4 ? "#d97706" : "#dc2626"}`,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: 15, fontWeight: 800,
                              color: d.agile_score >= 7 ? "#15803d" : d.agile_score >= 4 ? "#d97706" : "#dc2626",
                            }}>{d.agile_score}</div>
                            <div style={{ fontSize: 9, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", marginTop: 4 }}>Score</div>
                          </div>
                        )}
                      </div>

                      {/* Delivery Metrics */}
                      {d.delivery_metrics && (
                        <div style={{ marginBottom: 14 }}>
                          <div style={{ fontWeight: 700, fontSize: 10, color: "#111827", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                            📊 Delivery Metrics
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 8 }}>
                            <div style={{ background: "#f0fdf4", borderRadius: 6, padding: "8px 10px", textAlign: "center" }}>
                              <div style={{ fontSize: 16, fontWeight: 800, color: "#15803d" }}>
                                {d.delivery_metrics.avg_cycle_time_days != null ? `${d.delivery_metrics.avg_cycle_time_days}d` : "—"}
                              </div>
                              <div style={{ fontSize: 9, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>Avg Cycle</div>
                            </div>
                            <div style={{ background: "#eff6ff", borderRadius: 6, padding: "8px 10px", textAlign: "center" }}>
                              <div style={{ fontSize: 16, fontWeight: 800, color: "#1d4ed8" }}>
                                {d.delivery_metrics.avg_lead_time_days != null ? `${d.delivery_metrics.avg_lead_time_days}d` : "—"}
                              </div>
                              <div style={{ fontSize: 9, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>Avg Lead</div>
                            </div>
                            <div style={{ background: d.delivery_metrics.cards_aging_over_3d > 0 ? "#fef2f2" : "#f9fafb", borderRadius: 6, padding: "8px 10px", textAlign: "center" }}>
                              <div style={{ fontSize: 16, fontWeight: 800, color: d.delivery_metrics.cards_aging_over_3d > 0 ? "#dc2626" : "#6b7280" }}>
                                {d.delivery_metrics.cards_aging_over_3d ?? 0}
                              </div>
                              <div style={{ fontSize: 9, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>Aging &gt;3d</div>
                            </div>
                          </div>
                          {d.delivery_metrics.longest_aging_card && (
                            <div style={{ fontSize: 11, color: "#dc2626", background: "#fef2f2", borderRadius: 4, padding: "4px 8px" }}>
                              🐌 Longest aging: <strong>{d.delivery_metrics.longest_aging_card}</strong>
                            </div>
                          )}
                          {d.delivery_metrics.summary && (
                            <div style={{ fontSize: 12, color: "#374151", marginTop: 6, lineHeight: 1.5 }}>{d.delivery_metrics.summary}</div>
                          )}
                        </div>
                      )}

                      {/* Column Distribution */}
                      {d.column_distribution && (
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 10, color: "#111827", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Column Distribution</div>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {Object.entries(d.column_distribution).map(([col, count]) => (
                              <span key={col} style={{
                                fontSize: 11, padding: "3px 8px", borderRadius: 4,
                                background: "#f3f4f6", color: "#374151", fontWeight: 600,
                              }}>{col}: {count}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* ── ANALYSIS TAB ── */}
                  {insightsTab === "analysis" && (
                    <>
                      {/* WIP Analysis */}
                      {d.wip_analysis && (
                        <div style={{ marginBottom: 14 }}>
                          <div style={{ fontWeight: 700, fontSize: 10, color: "#111827", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>WIP Analysis</div>
                          <div style={{ background: "#eff6ff", borderRadius: 6, padding: "8px 10px", fontSize: 12, borderLeft: "3px solid #3b82f6", lineHeight: 1.5 }}>
                            {d.wip_analysis}
                          </div>
                        </div>
                      )}

                      {/* Blockers */}
                      {d.blockers?.length > 0 && (
                        <div style={{ marginBottom: 14 }}>
                          <div style={{ fontWeight: 700, fontSize: 10, color: "#dc2626", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>🚫 Blockers</div>
                          <div style={{ background: "#fef2f2", borderRadius: 6, borderLeft: "3px solid #dc2626", padding: "8px 10px" }}>
                            <ul style={{ margin: 0, paddingLeft: 14 }}>
                              {d.blockers.map((b, i) => <li key={i} style={{ marginBottom: 4, fontSize: 12, lineHeight: 1.5, color: "#991b1b" }}>{b}</li>)}
                            </ul>
                          </div>
                        </div>
                      )}

                      {/* At Risk */}
                      {d.blocker_risk_cards?.length > 0 && (
                        <div style={{ marginBottom: 14 }}>
                          <div style={{ fontWeight: 700, fontSize: 10, color: "#d97706", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>⚠ At Risk</div>
                          <div style={{ background: "#fffbeb", borderRadius: 6, borderLeft: "3px solid #d97706", padding: "8px 10px" }}>
                            <ul style={{ margin: 0, paddingLeft: 14 }}>
                              {d.blocker_risk_cards.map((b, i) => <li key={i} style={{ marginBottom: 4, fontSize: 12, lineHeight: 1.5, color: "#92400e" }}>{b}</li>)}
                            </ul>
                          </div>
                        </div>
                      )}

                      {/* Bottlenecks */}
                      {d.bottlenecks?.length > 0 && (
                        <div style={{ marginBottom: 14 }}>
                          <div style={{ fontWeight: 700, fontSize: 10, color: "#d97706", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>⚠ Bottlenecks</div>
                          <div style={{ background: "#fffbeb", borderRadius: 6, borderLeft: "3px solid #d97706", padding: "8px 10px" }}>
                            <ul style={{ margin: 0, paddingLeft: 14 }}>
                              {d.bottlenecks.map((b, i) => <li key={i} style={{ marginBottom: 4, fontSize: 12, lineHeight: 1.5, color: "#92400e" }}>{b}</li>)}
                            </ul>
                          </div>
                        </div>
                      )}

                      {/* Empty state */}
                      {!d.wip_analysis && !d.blockers?.length && !d.blocker_risk_cards?.length && !d.bottlenecks?.length && (
                        <div style={{ textAlign: "center", padding: "30px 0", color: "#9ca3af", fontSize: 12 }}>
                          ✅ No issues detected. Board is flowing well.
                        </div>
                      )}
                    </>
                  )}

                  {/* ── ACTIONS TAB ── */}
                  {insightsTab === "actions" && (
                    <>
                      {/* Risks */}
                      {d.risks?.length > 0 && (
                        <div style={{ marginBottom: 14 }}>
                          <div style={{ fontWeight: 700, fontSize: 10, color: "#dc2626", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>🚩 Risks</div>
                          <div style={{ background: "#fef2f2", borderRadius: 6, borderLeft: "3px solid #dc2626", padding: "8px 10px" }}>
                            <ul style={{ margin: 0, paddingLeft: 14 }}>
                              {d.risks.map((r, i) => <li key={i} style={{ marginBottom: 4, fontSize: 12, lineHeight: 1.5, color: "#991b1b" }}>{r}</li>)}
                            </ul>
                          </div>
                        </div>
                      )}

                      {/* Recommendations */}
                      {d.recommendations?.length > 0 && (
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 10, color: "#15803d", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>💡 Recommendations</div>
                          <div style={{ background: "#f0fdf4", borderRadius: 6, borderLeft: "3px solid #15803d", padding: "8px 10px" }}>
                            <ul style={{ margin: 0, paddingLeft: 14 }}>
                              {d.recommendations.map((r, i) => <li key={i} style={{ marginBottom: 4, fontSize: 12, lineHeight: 1.5, color: "#166534" }}>{r}</li>)}
                            </ul>
                          </div>
                        </div>
                      )}

                      {/* Empty state */}
                      {!d.risks?.length && !d.recommendations?.length && (
                        <div style={{ textAlign: "center", padding: "30px 0", color: "#9ca3af", fontSize: 12 }}>
                          ✅ No actions needed right now.
                        </div>
                      )}
                    </>
                  )}
                </div>
                );
              })() : (
                <div style={{ textAlign: "center", padding: "40px 0", color: "#9ca3af", fontSize: 12 }}>
                  Click <strong>Taskweave Coach</strong> to analyze your board's agile health.
                </div>
              )}
            </div>
          </div>
        )}
        </div>
      )}

      {/* ── Add Column Modal ── */}
      {showAddCol && (
        <div onMouseDown={(e) => { if (e.target === e.currentTarget) setShowAddCol(false); }} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
        }}>
          <div onMouseDown={(e) => e.stopPropagation()}>
            <div className="form">
              <h3>Add Column</h3>
              <label>
                Name *
                <input value={newColName} onChange={(e) => setNewColName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addColumn(); }}
                  autoFocus placeholder="e.g. To Do" />
              </label>
              <label>Color</label>
              <div style={{ display: "flex", gap: 6, marginTop: 6, marginBottom: 16, flexWrap: "wrap" }}>
                {DEFAULT_COL_COLORS.map((c) => (
                  <div key={c} onClick={() => setNewColColor(c)} style={{
                    width: 28, height: 28, borderRadius: 6, background: c, cursor: "pointer",
                    border: newColColor === c ? "3px solid #111" : "2px solid transparent",
                  }} />
                ))}
                <input type="color" value={newColColor} onChange={(e) => setNewColColor(e.target.value)}
                  style={{ width: 28, height: 28, border: "none", padding: 0, cursor: "pointer" }} />
              </div>
              <div className="actions">
                <button type="button" onClick={() => setShowAddCol(false)} style={{
                  padding: "10px 20px", borderRadius: 8, border: "1px solid #d1d5db",
                  background: "white", cursor: "pointer", fontWeight: 500, fontSize: 14, color: "#374151",
                }}>Cancel</button>
                <button onClick={addColumn} disabled={!newColName.trim()} style={{
                  padding: "10px 20px", borderRadius: 8, border: "none",
                  background: newColName.trim() ? "#1d4ed8" : "#93c5fd", color: "#fff",
                  cursor: newColName.trim() ? "pointer" : "not-allowed", fontWeight: 700, fontSize: 14,
                }}>Add</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Card Modal ── */}
      {addCardColId && (
        <div onMouseDown={(e) => { if (e.target === e.currentTarget) setAddCardColId(null); }} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
        }}>
          <div onMouseDown={(e) => e.stopPropagation()}>
            <div className="form" style={{ minWidth: 420 }}>
              <h3>Add Card</h3>

              {/* Link to toggle — always visible at top */}
              <label style={{ marginBottom: 4 }}>Link to</label>
              <div style={{ display: "flex", marginBottom: 16, borderRadius: 8, overflow: "hidden", border: "1px solid #e5e7eb" }}>
                {[
                  { key: "internal", label: "Internal" },
                  { key: "jira", label: "JIRA" },
                  { key: "jira_net", label: "JIRA.net" },
                  { key: "ado", label: "ADO" },
                  { key: "itsd", label: "ITSD" },
                ].map((m) => (
                  <button key={m.key} type="button" onClick={() => { setAddCardMode(m.key); setTicketLookup(null); setTicketError(""); setTicketKey(""); setNewCardDesc(""); setNewCardAssignee(""); }}
                    style={{
                      flex: 1, padding: "9px 0", border: "none", cursor: "pointer",
                      background: addCardMode === m.key ? (m.key === "internal" ? "#374151" : m.key === "jira" ? "#1d4ed8" : m.key === "jira_net" ? "#0891b2" : m.key === "itsd" ? "#dc2626" : "#b45309") : "#f9fafb",
                      color: addCardMode === m.key ? "#fff" : "#6b7280",
                      fontWeight: 700, fontSize: 13, transition: "all 0.15s",
                    }}
                  >{m.label}</button>
                ))}
              </div>

              {/* Title — always visible */}
              <label>
                Title <span style={{ color: "#dc2626" }}>*</span>
                <input value={newCardTitle} onChange={(e) => setNewCardTitle(e.target.value)}
                  autoFocus placeholder="Card title" readOnly={addCardMode !== "internal" && !!ticketLookup}
                  style={addCardMode !== "internal" && ticketLookup ? { background: "#f9fafb", color: "#6b7280" } : {}} />
              </label>

              {/* ── Internal mode fields ── */}
              {addCardMode === "internal" && (
                <>
                  <label>
                    Description
                  </label>
                  <textarea value={newCardDesc} onChange={(e) => setNewCardDesc(e.target.value)}
                    placeholder="Optional description"
                    rows={3}
                    style={{
                      width: "100%", boxSizing: "border-box", resize: "vertical", minHeight: 60,
                      fontFamily: "inherit", fontSize: 13, padding: "10px 12px",
                      border: "1px solid #d1d5db", borderRadius: 8, outline: "none",
                      marginBottom: 4,
                    }}
                    onFocus={(e) => e.target.style.borderColor = "#1d4ed8"}
                    onBlur={(e) => e.target.style.borderColor = "#d1d5db"}
                  />
                  <label>
                    Assignee
                    <input value={newCardAssignee} onChange={(e) => setNewCardAssignee(e.target.value)}
                      placeholder="Who is assigned?" />
                  </label>
                </>
              )}

              {/* ── JIRA / ADO mode ── */}
              {(addCardMode === "jira" || addCardMode === "jira_net" || addCardMode === "ado" || addCardMode === "itsd") && (
                <>
                  {/* Lookup input */}
                  <label>
                    {addCardMode === "ado" ? "ADO Work Item ID" : "Issue Key"}
                    <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                      <input value={ticketKey}
                        onChange={(e) => setTicketKey(addCardMode !== "ado" ? e.target.value.toUpperCase() : e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); lookupTicket(); } }}
                        placeholder={addCardMode === "ado" ? "12345" : "PROJ-123"}
                        style={{ flex: 1 }} />
                      <button type="button" onClick={lookupTicket} disabled={!ticketKey.trim() || ticketLoading}
                        style={{
                          padding: "10px 16px", borderRadius: 8, border: "none",
                          background: ticketKey.trim() && !ticketLoading ? "#1d4ed8" : "#93c5fd",
                          color: "#fff", cursor: ticketKey.trim() && !ticketLoading ? "pointer" : "not-allowed",
                          fontWeight: 700, fontSize: 13, flexShrink: 0, whiteSpace: "nowrap",
                        }}>{ticketLoading ? "Searching..." : "Lookup"}</button>
                    </div>
                  </label>

                  {/* Lookup error */}
                  {ticketError && (
                    <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "8px 12px", marginTop: 8, fontSize: 12, color: "#dc2626" }}>
                      {ticketError}
                    </div>
                  )}

                  {/* Ticket preview card — shown after lookup */}
                  {ticketLookup && (() => {
                    const src = ticketLookup.source || addCardMode;
                    const isJira = src === "jira" || src === "jira_net" || src === "itsd";
                    const badgeBg = isJira ? (src === "itsd" ? "#fee2e2" : src === "jira_net" ? "#cffafe" : "#dbeafe") : "#fef3c7";
                    const badgeColor = isJira ? (src === "itsd" ? "#dc2626" : src === "jira_net" ? "#0891b2" : "#1d4ed8") : "#92400e";
                    const badgeLabel = src === "itsd" ? "ITSD" : src === "jira_net" ? "JIRA.net" : (isJira ? "JIRA" : "ADO");
                    const badgeIcon = isJira
                      ? <svg width="12" height="12" viewBox="0 0 24 24" fill={badgeColor}><path d="M12.005 2c-5.52 0-10 4.48-10 10s4.48 10 10 10 10-4.48 10-10-4.48-10-10-10zm0 3.6v2.9h5.4v2.5h-5.4v2.85L7.605 10l4.4-4.4z"/></svg>
                      : <svg width="12" height="12" viewBox="0 0 24 24" fill={badgeColor}><path d="M22 4v9.4L17.6 18l-6.1-2.1v4.6L7.4 16l12.2-1V4H22zM2 7.8l4.5-2.2L18 4v16l-11.5-2L2 15.6V7.8z"/></svg>;
                    const extStatus = (ticketLookup.status || "").toLowerCase();
                    const matchedCol = columns.find((c) => c.name.toLowerCase() === extStatus);
                    const targetColName = matchedCol ? matchedCol.name : (columns[0]?.name || "first column");
                    const ticketLink = `${ticketLookup.issue_key}: ${ticketLookup.summary}`;
                    return (
                    <div style={{
                      marginTop: 12, border: "1px solid #e5e7eb", borderRadius: 10,
                      overflow: "hidden", background: "#fff",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                    }}>
                      {/* Header: badge + ticket link */}
                      <div style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "10px 12px", background: "#f9fafb", borderBottom: "1px solid #f3f4f6",
                      }}>
                        <span style={{
                          display: "inline-flex", alignItems: "center", gap: 5,
                          fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
                          background: badgeBg, color: badgeColor,
                          borderRadius: 4, padding: "3px 8px", flexShrink: 0,
                        }}>
                          {badgeIcon}
                          {badgeLabel}
                        </span>
                        {ticketLookup.external_url ? (
                          <a href={ticketLookup.external_url} target="_blank" rel="noopener noreferrer"
                            style={{
                              fontSize: 13, fontWeight: 600, color: "#1d4ed8",
                              textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4,
                              lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis",
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.textDecoration = "underline"}
                            onMouseLeave={(e) => e.currentTarget.style.textDecoration = "none"}
                          >
                            {ticketLink}
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#1d4ed8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                            </svg>
                          </a>
                        ) : (
                          <span style={{ fontSize: 13, fontWeight: 600, color: "#374151", lineHeight: 1.4 }}>{ticketLink}</span>
                        )}
                      </div>

                      {/* Body: description, type, status, assignee */}
                      <div style={{ padding: "10px 12px" }}>
                        {ticketLookup.description && (
                          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8, lineHeight: 1.5, maxHeight: 60, overflow: "hidden", textOverflow: "ellipsis" }}>
                            {ticketLookup.description}
                          </div>
                        )}
                        {ticketLookup.issue_type && (
                          <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 8 }}>
                            Type: {ticketLookup.issue_type}
                          </div>
                        )}
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          {ticketLookup.status && (
                            <span style={{
                              fontSize: 10, fontWeight: 700, color: "#6b7280",
                              background: "#f3f4f6", borderRadius: 4, padding: "3px 8px",
                              textTransform: "uppercase", letterSpacing: 0.3,
                            }}>{ticketLookup.status}</span>
                          )}
                          {ticketLookup.assignee && (
                            <span style={{
                              fontSize: 11, color: "#6b7280", display: "inline-flex",
                              alignItems: "center", gap: 4,
                            }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                              </svg>
                              {ticketLookup.assignee}
                            </span>
                          )}
                        </div>
                        <div style={{ marginTop: 8, fontSize: 11, color: "#6b7280", fontStyle: "italic" }}>
                          → Will be placed in <strong>{targetColName}</strong>
                          {!matchedCol && ticketLookup.status ? ` (no column matches "${ticketLookup.status}")` : ""}
                        </div>
                      </div>
                    </div>
                    );
                  })()}
                </>
              )}

              {/* Actions */}
              <div className="actions" style={{ marginTop: 16 }}>
                <button type="button" onClick={() => setAddCardColId(null)} style={{
                  padding: "10px 20px", borderRadius: 8, border: "1px solid #d1d5db",
                  background: "white", cursor: "pointer", fontWeight: 500, fontSize: 14, color: "#374151",
                }}>Cancel</button>
                <button onClick={addCard}
                  disabled={!newCardTitle.trim() || (addCardMode !== "internal" && !ticketLookup)}
                  style={{
                    padding: "10px 20px", borderRadius: 8, border: "none",
                    background: (newCardTitle.trim() && (addCardMode === "internal" || ticketLookup)) ? "#1d4ed8" : "#93c5fd",
                    color: "#fff",
                    cursor: (newCardTitle.trim() && (addCardMode === "internal" || ticketLookup)) ? "pointer" : "not-allowed",
                    fontWeight: 700, fontSize: 14,
                  }}>Add Card</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Column Modal ── */}
      {editCol && (
        <div onMouseDown={(e) => { if (e.target === e.currentTarget) setEditCol(null); }} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
        }}>
          <div onMouseDown={(e) => e.stopPropagation()}>
            <div className="form">
              <h3>Edit Column</h3>
              <label>
                Name
                <input value={editCol.name} onChange={(e) => setEditCol({ ...editCol, name: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") saveEditCol(); }}
                  autoFocus />
              </label>
              <label>Color</label>
              <div style={{ display: "flex", gap: 6, marginTop: 6, marginBottom: 16, flexWrap: "wrap" }}>
                {DEFAULT_COL_COLORS.map((c) => (
                  <div key={c} onClick={() => setEditCol({ ...editCol, color: c })} style={{
                    width: 28, height: 28, borderRadius: 6, background: c, cursor: "pointer",
                    border: editCol.color === c ? "3px solid #111" : "2px solid transparent",
                  }} />
                ))}
                <input type="color" value={editCol.color} onChange={(e) => setEditCol({ ...editCol, color: e.target.value })}
                  style={{ width: 28, height: 28, border: "none", padding: 0, cursor: "pointer" }} />
              </div>
              <div className="actions">
                <button type="button" onClick={() => setEditCol(null)} style={{
                  padding: "10px 20px", borderRadius: 8, border: "1px solid #d1d5db",
                  background: "white", cursor: "pointer", fontWeight: 500, fontSize: 14, color: "#374151",
                }}>Cancel</button>
                <button onClick={saveEditCol} style={{
                  padding: "10px 20px", borderRadius: 8, border: "none",
                  background: "#1d4ed8", color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 14,
                }}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Card Modal ── */}
      {editCard && (
        <div onMouseDown={(e) => { if (e.target === e.currentTarget) setEditCard(null); }} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
        }}>
          <div onMouseDown={(e) => e.stopPropagation()}>
            <div className="form">
              <h3>Edit Card</h3>
              <label>
                Title
                <input value={editCard.title} onChange={(e) => setEditCard({ ...editCard, title: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") saveEditCard(); }}
                  autoFocus />
              </label>
              <label>Color</label>
              <div style={{ display: "flex", gap: 6, marginTop: 6, marginBottom: 16, flexWrap: "wrap" }}>
                {["#1f6688", "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"].map((c) => (
                  <div key={c} onClick={() => setEditCard({ ...editCard, color: c })} style={{
                    width: 28, height: 28, borderRadius: 6, background: c, cursor: "pointer",
                    border: editCard.color === c ? "3px solid #111" : "2px solid transparent",
                  }} />
                ))}
                <input type="color" value={editCard.color || "#1f6688"} onChange={(e) => setEditCard({ ...editCard, color: e.target.value })}
                  style={{ width: 28, height: 28, border: "none", padding: 0, cursor: "pointer" }} />
              </div>
              <div className="actions">
                <button type="button" onClick={() => setEditCard(null)} style={{
                  padding: "10px 20px", borderRadius: 8, border: "1px solid #d1d5db",
                  background: "white", cursor: "pointer", fontWeight: 500, fontSize: 14, color: "#374151",
                }}>Cancel</button>
                <button onClick={saveEditCard} style={{
                  padding: "10px 20px", borderRadius: 8, border: "none",
                  background: "#1d4ed8", color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 14,
                }}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Card Detail Modal (double-click) ── */}
      {viewCard && (() => {
        const card = viewCard;
        const isExternal = !!card.issue_key;
        const sourceLabel = !isExternal ? "Internal" : card.ticket_source === "ado" ? "ADO" : card.ticket_source === "itsd" ? "ITSD" : card.ticket_source === "jira_net" ? "JIRA.net" : "JIRA";
        const sourceBg = !isExternal ? "#e5e7eb" : card.ticket_source === "ado" ? "#fef3c7" : card.ticket_source === "itsd" ? "#fee2e2" : card.ticket_source === "jira_net" ? "#cffafe" : "#dbeafe";
        const sourceColor = !isExternal ? "#6b7280" : card.ticket_source === "ado" ? "#92400e" : card.ticket_source === "itsd" ? "#dc2626" : card.ticket_source === "jira_net" ? "#0891b2" : "#1d4ed8";
        const statusTone = card.external_status ? getStatusTone(card.external_status) : null;
        const toneColors = {
          done: { bg: "#dcfce7", color: "#15803d" },
          "in-progress": { bg: "#fff7ed", color: "#ea7a12" },
          blocked: { bg: "#fef2f2", color: "#dc2626" },
          todo: { bg: "#f1f5f9", color: "#64748b" },
          design: { bg: "#fefce8", color: "#a16207" },
          ready: { bg: "#fefce8", color: "#a16207" },
          icebox: { bg: "#fef2f2", color: "#dc2626" },
          unknown: { bg: "#f3f4f6", color: "#6b7280" },
        };
        const sc = toneColors[statusTone] || toneColors.unknown;
        const colObj = columns.find((c) => c.id === card.column_id);
        return (
        <div onMouseDown={(e) => { if (e.target === e.currentTarget) setViewCard(null); }} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
        }}>
          <div onMouseDown={(e) => e.stopPropagation()} style={{
            background: "#fff", borderRadius: 14, width: 480, maxWidth: "92vw",
            maxHeight: "85vh", overflow: "auto",
            boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
            borderTop: `4px solid ${card.color || "#1f6688"}`,
          }}>
            {/* Header */}
            <div style={{ padding: "20px 24px 12px", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
              <div style={{ flex: 1 }}>
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
                  background: sourceBg, color: sourceColor,
                  borderRadius: 4, padding: "3px 8px", marginBottom: 8,
                }}>{sourceLabel}</span>
                <h2 style={{ margin: "8px 0 0", fontSize: 18, fontWeight: 700, color: "#111827", lineHeight: 1.4 }}>{card.title}</h2>
              </div>
              <button onClick={() => setViewCard(null)} style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 22, color: "#9ca3af", padding: "0 0 0 12px", lineHeight: 1,
              }}>&times;</button>
            </div>

            {/* External link */}
            {isExternal && (
              <div style={{ padding: "0 24px 12px" }}>
                <a href={card.external_url || "#"} target="_blank" rel="noopener noreferrer"
                  onClick={(e) => { if (!card.external_url) e.preventDefault(); }}
                  style={{
                    fontSize: 13, fontWeight: 600, color: "#1d4ed8",
                    textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 5,
                  }}
                  onMouseEnter={(e) => { if (card.external_url) e.currentTarget.style.textDecoration = "underline"; }}
                  onMouseLeave={(e) => e.currentTarget.style.textDecoration = "none"}
                >
                  {card.issue_key}: {card.external_title || card.title}
                  {card.external_url && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1d4ed8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                    </svg>
                  )}
                </a>
              </div>
            )}

            {/* Description */}
            {card.description && (
              <div style={{ padding: "0 24px 16px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Description</div>
                <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{card.description}</div>
              </div>
            )}

            {/* Details grid */}
            <div style={{ padding: "0 24px 20px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 20px" }}>
              {card.external_status && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Status</div>
                  <span style={{
                    fontSize: 12, fontWeight: 700, color: sc.color,
                    background: sc.bg, borderRadius: 4, padding: "4px 10px",
                    textTransform: "uppercase", letterSpacing: 0.3,
                  }}>{card.external_status}</span>
                </div>
              )}
              {card.assignee && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Assignee</div>
                  <span style={{ fontSize: 13, color: "#374151", display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                    </svg>
                    {card.assignee}
                  </span>
                </div>
              )}
              {colObj && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Column</div>
                  <span style={{ fontSize: 13, color: "#374151", display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: colObj.color }} />
                    {colObj.name}
                  </span>
                </div>
              )}
              {card.ticket_source && isExternal && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Source</div>
                  <span style={{ fontSize: 13, color: "#374151" }}>{card.ticket_source.toUpperCase()}</span>
                </div>
              )}
            </div>

            {/* Activity — merged metrics + timeline */}
            {(() => {
              const cardHistory = statusHistory.filter((h) => h.card_id === card.id);
              if (cardHistory.length === 0) return null;
              const createdAt = new Date(cardHistory[0].changed_at);
              const lastChange = new Date(cardHistory[cardHistory.length - 1].changed_at);
              const now = new Date();
              const ageDays = Math.round((now - createdAt) / 86400000);
              const inColDays = Math.round((now - lastChange) / 86400000);
              const moves = cardHistory.filter((h) => h.from_column_id !== null).length;
              const ageColor = ageDays > 5 ? "#dc2626" : ageDays > 3 ? "#d97706" : "#15803d";
              const colColor = inColDays > 3 ? "#dc2626" : inColDays > 2 ? "#d97706" : "#15803d";
              return (
                <div style={{ padding: "0 24px 16px" }}>
                  <button
                    onClick={() => setViewCard((prev) => ({ ...prev, _historyOpen: !prev._historyOpen }))}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                      background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8,
                      padding: "8px 12px", cursor: "pointer", transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "#f3f4f6"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "#f9fafb"}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                      </svg>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: 0.3 }}>
                        Activity
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: ageColor }}>{ageDays}d<span style={{ fontWeight: 500, color: "#9ca3af", marginLeft: 2 }}>age</span></span>
                      <span style={{ color: "#e5e7eb" }}>·</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: colColor }}>{inColDays}d<span style={{ fontWeight: 500, color: "#9ca3af", marginLeft: 2 }}>in col</span></span>
                      <span style={{ color: "#e5e7eb" }}>·</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#374151" }}>{moves}<span style={{ fontWeight: 500, color: "#9ca3af", marginLeft: 2 }}>{moves === 1 ? "move" : "moves"}</span></span>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                        style={{ transform: card._historyOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s", marginLeft: 2 }}>
                        <polyline points="6 9 12 15 18 9"/>
                      </svg>
                    </div>
                  </button>
                  {card._historyOpen && (
                    <div style={{ position: "relative", paddingLeft: 18, marginTop: 12 }}>
                      <div style={{ position: "absolute", left: 5, top: 4, bottom: 4, width: 2, background: "#e5e7eb", borderRadius: 1 }} />
                      {cardHistory.map((h, i) => {
                        const fromCol = columns.find((c) => c.id === h.from_column_id);
                        const toCol = columns.find((c) => c.id === h.to_column_id);
                        const ts = new Date(h.changed_at);
                        const timeStr = ts.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + ts.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
                        return (
                          <div key={h.id || i} style={{ position: "relative", marginBottom: i < cardHistory.length - 1 ? 12 : 0, paddingLeft: 12 }}>
                            <div style={{
                              position: "absolute", left: -14, top: 4,
                              width: 10, height: 10, borderRadius: "50%",
                              background: toCol?.color || "#3b82f6",
                              border: "2px solid #fff", boxShadow: "0 0 0 2px " + (toCol?.color || "#3b82f6"),
                            }} />
                            <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.5 }}>
                              {fromCol ? (
                                <span>
                                  <span style={{ color: "#9ca3af" }}>{fromCol.name}</span>
                                  <span style={{ margin: "0 5px", color: "#d1d5db" }}>&rarr;</span>
                                  <span style={{ fontWeight: 600, color: toCol?.color || "#374151" }}>{toCol?.name || "?"}</span>
                                </span>
                              ) : (
                                <span>
                                  <span style={{ color: "#9ca3af" }}>Created in</span>{" "}
                                  <span style={{ fontWeight: 600, color: toCol?.color || "#374151" }}>{toCol?.name || "?"}</span>
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 1 }}>{timeStr}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Footer actions */}
            <div style={{ padding: "12px 24px 20px", borderTop: "1px solid #f3f4f6", display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => { setViewCard(null); setEditCard({ ...card }); }} style={{
                padding: "8px 18px", borderRadius: 8, border: "1px solid #d1d5db",
                background: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 13, color: "#374151",
              }}>Edit</button>
              <button onClick={() => setViewCard(null)} style={{
                padding: "8px 18px", borderRadius: 8, border: "none",
                background: "#1d4ed8", color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 13,
              }}>Close</button>
            </div>
          </div>
        </div>
        );
      })()}

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
