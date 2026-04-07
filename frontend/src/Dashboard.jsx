import React, { useEffect, useState } from "react";

const API_BASE = "http://0.0.0.0:8000";

const PREVIEW_COLORS = [
  ["#10b981", "#ec4899", "#8b5cf6"],
  ["#3b82f6", "#f59e0b", "#10b981"],
  ["#ec4899", "#8b5cf6", "#3b82f6"],
  ["#f59e0b", "#10b981", "#ec4899"],
  ["#8b5cf6", "#3b82f6", "#f59e0b"],
];

function formatDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function Dashboard({ onOpenBoard }) {
  const [boards, setBoards] = useState([]);
  const [filter, setFilter] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editBoard, setEditBoard] = useState(null);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formStartDate, setFormStartDate] = useState("");
  const [formEndDate, setFormEndDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);

  async function fetchBoards() {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/boards?include_archived=${showArchived}`);
      const data = await res.json();
      setBoards(data.boards || []);
    } catch {
      setBoards([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchBoards();
  }, [showArchived]);

  function openCreateModal() {
    setEditBoard(null);
    setFormName("");
    setFormDesc("");
    setFormStartDate("");
    setFormEndDate("");
    setShowModal(true);
  }

  function openEditModal(e, board) {
    e.stopPropagation();
    setEditBoard(board);
    setFormName(board.name);
    setFormDesc(board.description || "");
    setFormStartDate(board.start_date ? board.start_date.slice(0, 7) : "");
    setFormEndDate(board.end_date ? board.end_date.slice(0, 7) : "");
    setShowModal(true);
  }

  async function handleSave() {
    if (!formName.trim()) return;
    if (!editBoard && (!formStartDate || !formEndDate)) return;
    setSaving(true);
    try {
      const startIso = formStartDate ? `${formStartDate}-01` : undefined;
      const endIso = formEndDate ? `${formEndDate}-01` : undefined;

      if (editBoard) {
        await fetch(`${API_BASE}/api/boards/${editBoard.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formName,
            description: formDesc,
            start_date: startIso,
            end_date: endIso,
          }),
        });
      } else {
        await fetch(`${API_BASE}/api/boards`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formName,
            description: formDesc,
            start_date: startIso,
            end_date: endIso,
          }),
        });
      }
      setShowModal(false);
      fetchBoards();
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive(e, boardId) {
    e.stopPropagation();
    if (!window.confirm("Archive this board?")) return;
    await fetch(`${API_BASE}/api/boards/${boardId}/archive`, { method: "PATCH" });
    fetchBoards();
  }

  async function handleClone(e, boardId) {
    e.stopPropagation();
    const res = await fetch(`${API_BASE}/api/boards/${boardId}/clone`, { method: "POST" });
    if (!res.ok) return;
    const data = await res.json();
    if (data.board && onOpenBoard) {
      onOpenBoard(data.board);
    }
  }

  async function handleDelete(e, boardId) {
    e.stopPropagation();
    if (!window.confirm("Permanently delete this board? This cannot be undone.")) return;
    await fetch(`${API_BASE}/api/boards/${boardId}`, { method: "DELETE" });
    fetchBoards();
  }

  const filteredBoards = boards.filter((b) =>
    b.name.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div style={{ minHeight: "100vh", background: "#f3f4f6", padding: "32px 40px" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <h1 style={{ fontSize: "26px", fontWeight: "800", margin: 0, color: "#111827", letterSpacing: "-0.5px" }}>
            Dashboard
          </h1>
          <span style={{
            background: "#e5e7eb", borderRadius: "999px",
            padding: "3px 12px", fontSize: "13px", color: "#6b7280", fontWeight: "600",
          }}>
            {boards.length} Boards
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {/* Filter input */}
          <div style={{ position: "relative" }}>
            <span style={{
              position: "absolute", left: "10px", top: "50%",
              transform: "translateY(-50%)", color: "#9ca3af", fontSize: "14px",
            }}>🔍</span>
            <input
              placeholder="Filter your boards"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{
                padding: "9px 14px 9px 32px", borderRadius: "8px",
                border: "1px solid #d1d5db", width: "220px",
                fontSize: "14px", background: "white", outline: "none",
                color: "#111827",
              }}
            />
          </div>

          {/* Archived toggle */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#6b7280" }}>
            <span>Show archived/deleted</span>
            <button
              onClick={() => setShowArchived(!showArchived)}
              style={{
                background: showArchived ? "#1d4ed8" : "#e5e7eb",
                color: showArchived ? "white" : "#6b7280",
                border: "none", borderRadius: "6px",
                padding: "4px 10px", cursor: "pointer",
                fontWeight: "700", fontSize: "12px", transition: "background 0.15s",
              }}
            >
              {showArchived ? "YES" : "NO"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Promo banner ── */}
      <div style={{
        background: "#fefce8", border: "1px solid #fde68a",
        borderRadius: "10px", padding: "14px 20px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: "28px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ fontSize: "22px" }}>📋</span>
          <span style={{ color: "#78350f", fontSize: "14px" }}>
            Create and manage PI Planning boards for your teams.
          </span>
        </div>
        <button
          onClick={openCreateModal}
          style={{
            background: "#d97706", color: "white", border: "none",
            borderRadius: "8px", padding: "10px 20px",
            fontWeight: "700", fontSize: "14px", cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          + New Board
        </button>
      </div>

      {/* ── Section header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "15px", fontWeight: "700", color: "#374151" }}>
            PI Planning Boards
          </span>
          <span style={{
            background: "#e5e7eb", borderRadius: "999px",
            padding: "2px 10px", fontSize: "12px", color: "#6b7280",
          }}>
            {filteredBoards.length}/{boards.length}
          </span>
          <span style={{ fontSize: "13px", color: "#9ca3af" }}>
            · Collaborate by opening a board
          </span>
        </div>
        <button
          onClick={() => setShowArchived(!showArchived)}
          style={{ background: "none", border: "none", color: "#6b7280", fontSize: "13px", cursor: "pointer" }}
        >
          {showArchived ? "Hide archived ▲" : "Show archived ▼"}
        </button>
      </div>

      {/* ── Board grid ── */}
      {loading ? (
        <p style={{ color: "#9ca3af", fontSize: "14px" }}>Loading boards…</p>
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(270px, 1fr))",
          gap: "20px",
        }}>
          {/* Add board card */}
          <div
            onClick={openCreateModal}
            style={{
              border: "2px dashed #d1d5db", borderRadius: "6px",
              minHeight: "160px", display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              cursor: "pointer", gap: "10px", background: "white",
              transition: "border-color 0.15s, background 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "#6b7280";
              e.currentTarget.style.background = "#f9fafb";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "#d1d5db";
              e.currentTarget.style.background = "white";
            }}
          >
            <div style={{
              width: "44px", height: "44px", borderRadius: "50%",
              background: "#e5e7eb", display: "flex",
              alignItems: "center", justifyContent: "center",
              fontSize: "22px", color: "#9ca3af",
            }}>+</div>
            <span style={{ color: "#6b7280", fontSize: "14px", fontWeight: "500" }}>Add board</span>
          </div>

          {/* Board cards */}
          {filteredBoards.map((board, idx) => {
            const colors = PREVIEW_COLORS[idx % PREVIEW_COLORS.length];
            const isMenuOpen = openMenuId === board.id;
            return (
              <div
                key={board.id}
                onClick={() => { setOpenMenuId(null); onOpenBoard && onOpenBoard(board); }}
                style={{
                  background: "white", borderRadius: "10px",
                  cursor: "pointer",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                  border: "1px solid #e5e7eb",
                  transition: "box-shadow 0.15s, transform 0.1s",
                  opacity: board.is_archived ? 0.65 : 1,
                  overflow: "visible",
                  display: "flex", flexDirection: "column",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = "0 6px 20px rgba(0,0,0,0.12)";
                  e.currentTarget.style.transform = "translateY(-2px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.08)";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                {/* Card body */}
                <div style={{ padding: "16px 16px 12px" }}>
                  {/* Title row */}
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "8px" }}>
                    <h3 style={{ margin: 0, fontSize: "14px", fontWeight: "700", color: "#111827", lineHeight: "1.4", flex: 1, paddingRight: "8px" }}>
                      {board.name}
                      {board.is_archived === 1 && (
                        <span style={{
                          fontSize: "10px", background: "#fef3c7",
                          color: "#92400e", borderRadius: "4px",
                          padding: "1px 5px", fontWeight: "700", marginLeft: "6px",
                        }}>Archived</span>
                      )}
                    </h3>
                  </div>

                  {/* Meta row: date left, range right */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
                    <span style={{ fontSize: "12px", color: "#9ca3af", display: "flex", alignItems: "center", gap: "4px" }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      {formatDate(board.created_at)}
                    </span>
                    {board.start_date && board.end_date ? (
                      <span style={{ fontSize: "12px", color: "#0d9488", fontWeight: "600" }}>
                        {board.start_date.slice(0, 7)} → {board.end_date.slice(0, 7)}
                      </span>
                    ) : null}
                  </div>

                  {/* PI Planning board mini-preview */}
                  <div style={{ border: "1px solid #e5e7eb", borderRadius: "5px", overflow: "hidden", background: "#f8fafc" }}>
                    {/* Header row */}
                    <div style={{ display: "flex", borderBottom: "1px solid #e5e7eb", background: "#eff6ff" }}>
                      <div style={{ width: "28px", borderRight: "1px solid #e5e7eb", padding: "3px" }} />
                      {[colors[0], colors[1], colors[2], colors[0]].map((c, i) => (
                        <div key={i} style={{ flex: 1, padding: "3px 4px", borderRight: i < 3 ? "1px solid #e5e7eb" : "none" }}>
                          <div style={{ height: "5px", borderRadius: "2px", background: "#bfdbfe" }} />
                        </div>
                      ))}
                    </div>
                    {/* Data rows */}
                    {[colors[0], colors[1], colors[2]].map((rowColor, ri) => (
                      <div key={ri} style={{ display: "flex", borderBottom: ri < 2 ? "1px solid #e5e7eb" : "none" }}>
                        <div style={{ width: "28px", borderRight: "1px solid #e5e7eb", padding: "4px 3px", background: "#f1f5f9" }}>
                          <div style={{ height: "5px", borderRadius: "2px", background: "#cbd5e1" }} />
                        </div>
                        {[0, 1, 2, 3].map((ci) => (
                          <div key={ci} style={{ flex: 1, padding: "4px", borderRight: ci < 3 ? "1px solid #e5e7eb" : "none", minHeight: "18px" }}>
                            {ci === 0 || (ci === 1 && ri === 1) ? (
                              <div style={{ height: "10px", borderRadius: "2px", background: rowColor, opacity: 0.75, width: ci === 0 ? "90%" : "60%" }} />
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Footer */}
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    borderTop: "1px solid #f3f4f6", padding: "10px 14px",
                    display: "flex", alignItems: "center", gap: "4px",
                  }}
                >
                  <button
                    onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?board=${board.id}`); }}
                    style={{
                      background: "none", border: "none", color: "#374151",
                      fontSize: "12px", cursor: "pointer", padding: "4px 8px",
                      borderRadius: "5px", fontWeight: "500", display: "flex", alignItems: "center", gap: "4px",
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "#f3f4f6"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "none"}
                    title="Copy link to clipboard"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                    Share
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleClone(e, board.id); }}
                    style={{
                      background: "none", border: "none", color: "#374151",
                      fontSize: "12px", cursor: "pointer", padding: "4px 8px",
                      borderRadius: "5px", fontWeight: "500", display: "flex", alignItems: "center", gap: "4px",
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "#f3f4f6"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "none"}
                    title="Duplicate this board"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    Clone
                  </button>

                  {/* ⋯ dropdown */}
                  <div style={{ marginLeft: "auto", position: "relative" }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); setOpenMenuId(isMenuOpen ? null : board.id); }}
                      style={{
                        background: "none", border: "none", color: "#9ca3af",
                        fontSize: "18px", cursor: "pointer", padding: "2px 6px",
                        borderRadius: "5px", lineHeight: 1, fontWeight: "700",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "#f3f4f6"; e.currentTarget.style.color = "#374151"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "#9ca3af"; }}
                    >
                      ···
                    </button>
                    {isMenuOpen && (
                      <div style={{
                        position: "absolute", right: 0, bottom: "calc(100% + 4px)",
                        background: "white", border: "1px solid #e5e7eb",
                        borderRadius: "8px",
                        boxShadow: "0 8px 24px rgba(0,0,0,0.14)",
                        padding: "4px", minWidth: "150px", zIndex: 200,
                      }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); openEditModal(e, board); }}
                          style={{
                            display: "flex", alignItems: "center", gap: "8px",
                            width: "100%", background: "none", border: "none",
                            color: "#374151", fontSize: "13px", padding: "7px 10px",
                            cursor: "pointer", borderRadius: "5px", textAlign: "left",
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = "#f3f4f6"}
                          onMouseLeave={(e) => e.currentTarget.style.background = "none"}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          Edit
                        </button>
                        {board.is_archived === 0 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); handleArchive(e, board.id); }}
                            style={{
                              display: "flex", alignItems: "center", gap: "8px",
                              width: "100%", background: "none", border: "none",
                              color: "#374151", fontSize: "13px", padding: "7px 10px",
                              cursor: "pointer", borderRadius: "5px", textAlign: "left",
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = "#f3f4f6"}
                            onMouseLeave={(e) => e.currentTarget.style.background = "none"}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
                            Archive
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); handleDelete(e, board.id); }}
                          style={{
                            display: "flex", alignItems: "center", gap: "8px",
                            width: "100%", background: "none", border: "none",
                            color: "#ef4444", fontSize: "13px", padding: "7px 10px",
                            cursor: "pointer", borderRadius: "5px", textAlign: "left",
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = "#fef2f2"}
                          onMouseLeave={(e) => e.currentTarget.style.background = "none"}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Create / Edit Modal ── */}
      {showModal && (
        <div
          onClick={() => setShowModal(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "white", borderRadius: "16px",
              padding: "32px", width: "440px",
              boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
            }}
          >
            <h2 style={{ margin: "0 0 20px", fontSize: "20px", fontWeight: "700", color: "#111827" }}>
              {editBoard ? "Edit Board" : "Create New Board"}
            </h2>

            <label style={{ fontSize: "13px", fontWeight: "600", color: "#374151", display: "block" }}>
              Board Name *
            </label>
            <input
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setShowModal(false); }}
              placeholder="e.g. PI Planning Q1 2026"
              autoFocus
              style={{
                width: "100%", padding: "10px 12px", borderRadius: "8px",
                border: "1px solid #d1d5db", marginTop: "6px", marginBottom: "16px",
                fontSize: "14px", boxSizing: "border-box", outline: "none",
                color: "#111827",
              }}
            />

            {/* Date range row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
              <div>
                <label style={{ fontSize: "13px", fontWeight: "600", color: "#374151", display: "block" }}>
                  Start Month {!editBoard && "*"}
                </label>
                <input
                  type="month"
                  value={formStartDate}
                  onChange={(e) => setFormStartDate(e.target.value)}
                  style={{
                    width: "100%", padding: "9px 10px", borderRadius: "8px",
                    border: "1px solid #d1d5db", marginTop: "6px",
                    fontSize: "14px", boxSizing: "border-box", outline: "none",
                    color: "#111827",
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: "13px", fontWeight: "600", color: "#374151", display: "block" }}>
                  End Month {!editBoard && "*"}
                </label>
                <input
                  type="month"
                  value={formEndDate}
                  onChange={(e) => setFormEndDate(e.target.value)}
                  style={{
                    width: "100%", padding: "9px 10px", borderRadius: "8px",
                    border: "1px solid #d1d5db", marginTop: "6px",
                    fontSize: "14px", boxSizing: "border-box", outline: "none",
                    color: "#111827",
                  }}
                />
              </div>
            </div>

            <label style={{ fontSize: "13px", fontWeight: "600", color: "#374151", display: "block" }}>
              Description
            </label>
            <textarea
              value={formDesc}
              onChange={(e) => setFormDesc(e.target.value)}
              placeholder="Optional description…"
              rows={3}
              style={{
                width: "100%", padding: "10px 12px", borderRadius: "8px",
                border: "1px solid #d1d5db", marginTop: "6px",
                fontSize: "14px", resize: "vertical", boxSizing: "border-box",
                outline: "none", color: "#111827",
              }}
            />

            <div style={{ display: "flex", gap: "10px", marginTop: "24px", justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  padding: "10px 20px", borderRadius: "8px",
                  border: "1px solid #d1d5db", background: "white",
                  cursor: "pointer", fontWeight: "500", fontSize: "14px", color: "#374151",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!formName.trim() || (!editBoard && (!formStartDate || !formEndDate)) || saving}
                style={{
                  padding: "10px 20px", borderRadius: "8px", border: "none",
                  background: (formName.trim() && (editBoard || (formStartDate && formEndDate)) && !saving) ? "#1d4ed8" : "#93c5fd",
                  color: "white",
                  cursor: (formName.trim() && (editBoard || (formStartDate && formEndDate)) && !saving) ? "pointer" : "not-allowed",
                  fontWeight: "700", fontSize: "14px", transition: "background 0.15s",
                }}
              >
                {saving ? "Saving…" : editBoard ? "Save Changes" : "Create Board"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
