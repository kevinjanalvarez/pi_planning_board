import React, { useCallback, useEffect, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://0.0.0.0:8000";

const DEFAULT_COL_COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#8b5cf6", "#ec4899", "#ef4444", "#06b6d4"];

export default function KanbanBoard({ board, apiFetch, auth, onLogout, onBack, onProfile, onIntegrations, onManageUsers }) {
  const [columns, setColumns] = useState([]);
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
  const [addCardMode, setAddCardMode] = useState("manual"); // "manual" | "ticket"
  const [ticketSource, setTicketSource] = useState("jira");
  const [ticketKey, setTicketKey] = useState("");
  const [ticketLookup, setTicketLookup] = useState(null); // fetched ticket info
  const [ticketLoading, setTicketLoading] = useState(false);
  const [ticketError, setTicketError] = useState("");

  // Editing
  const [editCol, setEditCol] = useState(null);
  const [editCard, setEditCard] = useState(null);

  // Confirm dialog
  const [confirmDialog, setConfirmDialog] = useState(null);

  // Drag
  const [dragCard, setDragCard] = useState(null);
  const [dragOverCol, setDragOverCol] = useState(null);

  const loadBoard = useCallback(async () => {
    setError("");
    try {
      const res = await apiFetch(`${API_BASE}/api/kanban/${board.id}`);
      if (!res.ok) throw new Error("Failed to load kanban board");
      const data = await res.json();
      setColumns(data.columns || []);
      setCards(data.cards || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [board.id, apiFetch]);

  useEffect(() => { loadBoard(); }, [loadBoard]);

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
      const res = await apiFetch(`${API_BASE}/api/kanban/ticket-lookup?key=${encodeURIComponent(ticketKey.trim())}&source=${ticketSource}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || "Ticket not found");
      }
      const data = await res.json();
      setTicketLookup(data);
      setNewCardTitle(data.summary || ticketKey.trim());
    } catch (e) {
      setTicketError(e.message);
    } finally {
      setTicketLoading(false);
    }
  }

  async function addCard() {
    if (!addCardColId || !newCardTitle.trim()) return;
    const body = {
      column_id: addCardColId,
      row_id: null,
      title: newCardTitle.trim(),
    };
    if (addCardMode === "ticket" && ticketLookup) {
      body.issue_key = ticketLookup.issue_key;
      body.ticket_source = ticketSource;
      body.description = ticketLookup.summary;
    }
    await apiFetch(`${API_BASE}/api/kanban/${board.id}/cards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setNewCardTitle("");
    setAddCardColId(null);
    setTicketLookup(null);
    setTicketKey("");
    setTicketError("");
    setAddCardMode("manual");
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
        {/* Row 1: logo | board name (centered) | user controls */}
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

          {/* Center — board name */}
          <div style={{ textAlign: "center" }}>
            <span style={{ fontSize: "15px", fontWeight: "600", color: "#111827" }}>
              {board.name}
            </span>
          </div>

          {/* Right — add column + avatar dropdown */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", justifyContent: "flex-end" }}>
            <button onClick={() => { setShowAddCol(true); setNewColColor(DEFAULT_COL_COLORS[columns.length % DEFAULT_COL_COLORS.length]); }}
              style={{
                background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 6,
                padding: "6px 14px", cursor: "pointer", fontSize: 12, fontWeight: 700,
              }}>+ Column</button>
            <div style={{ borderLeft: "1px solid #e5e7eb", height: 24, margin: "0 4px" }} />
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
                        </button>
                      )}
                      {onManageUsers && (
                        <button onClick={() => { setAvatarMenuOpen(false); onManageUsers(); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 16px", border: "none", background: "none", fontSize: 13, color: "#374151", cursor: "pointer", textAlign: "left" }}
                          onMouseEnter={(e) => e.currentTarget.style.background = "#f3f4f6"} onMouseLeave={(e) => e.currentTarget.style.background = "none"}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                          Manage Users
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

        {/* Row 2: board type label (left) */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 28px", height: "40px",
        }}>
          <span style={{ fontSize: "13px", color: "#9ca3af", fontStyle: "italic" }}>
            Kanban Board
          </span>
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

      {/* ── Columns ── */}
      {columns.length > 0 && (
        <div style={{
          display: "flex", gap: 6, padding: "16px 24px", flex: 1,
          overflowX: "auto", alignItems: "flex-start",
        }}>
          {columns.map((col) => {
            const colCards = cards.filter((c) => c.column_id === col.id);
            const isOver = dragOverCol === col.id;
            return (
              <div
                key={col.id}
                onDragOver={(e) => { e.preventDefault(); setDragOverCol(col.id); }}
                onDragLeave={() => setDragOverCol(null)}
                onDrop={() => handleDrop(col.id)}
                style={{
                  minWidth: 260, maxWidth: 300, width: 280, flexShrink: 0,
                  background: isOver ? "#eff6ff" : "#fff",
                  borderRadius: 12, border: "1px solid #e5e7eb",
                  display: "flex", flexDirection: "column",
                  transition: "background 0.15s",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                  overflow: "hidden",
                }}
              >
                {/* Column header */}
                <div style={{
                  padding: "10px 14px", borderBottom: `3px solid ${col.color}`,
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: col.color, flexShrink: 0 }} />
                    <span
                      style={{ fontWeight: 700, fontSize: 14, color: "#111827", cursor: "pointer" }}
                      onClick={() => setEditCol({ ...col })}
                      title="Edit column"
                    >{col.name}</span>
                    <span style={{
                      background: "#f3f4f6", borderRadius: 999, padding: "1px 7px",
                      fontSize: 11, fontWeight: 700, color: "#6b7280",
                    }}>{colCards.length}</span>
                  </div>
                  <button onClick={() => removeColumn(col.id)} title="Delete column" style={{
                    background: "none", border: "none", cursor: "pointer", color: "#9ca3af",
                    fontSize: 14, padding: "2px 4px", lineHeight: 1,
                  }}>✕</button>
                </div>

                {/* Cards */}
                <div style={{ padding: "8px 10px", flex: 1, minHeight: 60 }}>
                  {colCards.map((card) => (
                    <div
                      key={card.id}
                      draggable
                      onDragStart={() => handleDragStart(card)}
                      onDragEnd={() => { setDragCard(null); setDragOverCol(null); }}
                      style={{
                        background: card.color || "#1f6688", color: "#fff",
                        borderRadius: 8, padding: "10px 12px", marginBottom: 8,
                        fontSize: 13, fontWeight: 600, cursor: "grab",
                        display: "flex", alignItems: "flex-start", justifyContent: "space-between",
                        boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
                        opacity: dragCard?.id === card.id ? 0.5 : 1,
                        transition: "opacity 0.15s",
                      }}
                    >
                      <span
                        style={{ flex: 1, cursor: "pointer", wordBreak: "break-word", lineHeight: 1.4 }}
                        onClick={() => setEditCard({ ...card })}
                        title="Edit card"
                      >
                        {card.issue_key && (
                          <span style={{
                            display: "inline-block", fontSize: 10, fontWeight: 700,
                            background: "rgba(255,255,255,0.25)", borderRadius: 3,
                            padding: "1px 5px", marginRight: 5, verticalAlign: "middle",
                            letterSpacing: 0.3,
                          }}>{card.ticket_source === "ado" ? "ADO" : "JIRA"} {card.issue_key}</span>
                        )}
                        {card.title}
                      </span>
                      <button onClick={(e) => { e.stopPropagation(); removeCard(card.id); }} style={{
                        background: "none", border: "none", cursor: "pointer",
                        color: "rgba(255,255,255,0.6)", fontSize: 12, padding: "0 0 0 8px",
                        lineHeight: 1, flexShrink: 0,
                      }}>✕</button>
                    </div>
                  ))}

                  {/* Add card button */}
                  <button
                    onClick={() => { setAddCardColId(col.id); setNewCardTitle(""); setAddCardMode("manual"); setTicketKey(""); setTicketLookup(null); setTicketError(""); }}
                    style={{
                      background: "none", border: "1px dashed #d1d5db", borderRadius: 8,
                      padding: "8px 12px", width: "100%", cursor: "pointer",
                      fontSize: 12, color: "#9ca3af", fontWeight: 600,
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                    }}
                  >
                    <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> Add card
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Add Column Modal ── */}
      {showAddCol && (
        <div onClick={() => setShowAddCol(false)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
        }}>
          <div onClick={(e) => e.stopPropagation()}>
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
        <div onClick={() => setAddCardColId(null)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
        }}>
          <div onClick={(e) => e.stopPropagation()}>
            <div className="form">
              <h3>Add Card</h3>

              <label>Source</label>
              <div style={{ display: "flex", marginBottom: 16, borderRadius: 8, overflow: "hidden", border: "1px solid #e5e7eb" }}>
                {[
                  { key: "manual", label: "Manual" },
                  { key: "ticket", label: "From JIRA / ADO" },
                ].map((m) => (
                  <button key={m.key} type="button" onClick={() => { setAddCardMode(m.key); setTicketLookup(null); setTicketError(""); if (m.key === "manual") setNewCardTitle(""); }}
                    style={{
                      flex: 1, padding: "9px 0", border: "none", cursor: "pointer",
                      background: addCardMode === m.key ? "#1d4ed8" : "#f9fafb",
                      color: addCardMode === m.key ? "#fff" : "#6b7280",
                      fontWeight: 700, fontSize: 13, transition: "all 0.15s",
                    }}
                  >{m.label}</button>
                ))}
              </div>

              {addCardMode === "ticket" && (
                <>
                  <label>Ticket System</label>
                  <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                    {["jira", "ado"].map((s) => (
                      <button key={s} type="button" onClick={() => { setTicketSource(s); setTicketLookup(null); setTicketError(""); }}
                        style={{
                          flex: 1, padding: "8px 0", borderRadius: 6, cursor: "pointer",
                          border: ticketSource === s ? "2px solid #1d4ed8" : "1px solid #d1d5db",
                          background: ticketSource === s ? "#eff6ff" : "#fff",
                          color: ticketSource === s ? "#1d4ed8" : "#6b7280",
                          fontWeight: 700, fontSize: 13,
                        }}
                      >{s.toUpperCase()}</button>
                    ))}
                  </div>
                  <label>
                    {ticketSource === "jira" ? "Issue Key" : "ADO Work Item (US only)"}
                    <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                      <input value={ticketKey}
                        onChange={(e) => setTicketKey(ticketSource === "jira" ? e.target.value.toUpperCase() : e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); lookupTicket(); } }}
                        autoFocus
                        placeholder={ticketSource === "jira" ? "PROJ-123" : "US-12345 or 12345"}
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
                  {ticketError && (
                    <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "8px 12px", marginTop: 8, marginBottom: 4, fontSize: 12, color: "#dc2626" }}>
                      {ticketError}
                    </div>
                  )}
                  {ticketLookup && (
                    <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "10px 12px", marginTop: 8, marginBottom: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, background: ticketSource === "jira" ? "#dbeafe" : "#fef3c7", color: ticketSource === "jira" ? "#1d4ed8" : "#92400e", borderRadius: 3, padding: "1px 5px" }}>
                          {ticketSource.toUpperCase()} {ticketLookup.issue_key}
                        </span>
                        {ticketLookup.issue_type && <span style={{ fontSize: 11, color: "#6b7280" }}>{ticketLookup.issue_type}</span>}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{ticketLookup.summary}</div>
                      <div style={{ display: "flex", gap: 12, marginTop: 4, fontSize: 11, color: "#6b7280" }}>
                        {ticketLookup.status && <span>Status: {ticketLookup.status}</span>}
                        {ticketLookup.assignee && <span>Assignee: {ticketLookup.assignee}</span>}
                      </div>
                    </div>
                  )}
                </>
              )}

              <label>
                Card Title {addCardMode === "ticket" ? "(auto-filled from ticket)" : "*"}
                <input value={newCardTitle} onChange={(e) => setNewCardTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && newCardTitle.trim()) addCard(); }}
                  autoFocus={addCardMode === "manual"}
                  placeholder="Card title" />
              </label>

              <div className="actions">
                <button type="button" onClick={() => setAddCardColId(null)} style={{
                  padding: "10px 20px", borderRadius: 8, border: "1px solid #d1d5db",
                  background: "white", cursor: "pointer", fontWeight: 500, fontSize: 14, color: "#374151",
                }}>Cancel</button>
                <button onClick={addCard}
                  disabled={!newCardTitle.trim() || (addCardMode === "ticket" && !ticketLookup)}
                  style={{
                    padding: "10px 20px", borderRadius: 8, border: "none",
                    background: (newCardTitle.trim() && (addCardMode === "manual" || ticketLookup)) ? "#1d4ed8" : "#93c5fd",
                    color: "#fff",
                    cursor: (newCardTitle.trim() && (addCardMode === "manual" || ticketLookup)) ? "pointer" : "not-allowed",
                    fontWeight: 700, fontSize: 14,
                  }}>Add Card</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Column Modal ── */}
      {editCol && (
        <div onClick={() => setEditCol(null)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
        }}>
          <div onClick={(e) => e.stopPropagation()}>
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
        <div onClick={() => setEditCard(null)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
        }}>
          <div onClick={(e) => e.stopPropagation()}>
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
