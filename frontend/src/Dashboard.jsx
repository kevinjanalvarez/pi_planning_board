import React, { useEffect, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://0.0.0.0:8000";

const DEFAULT_COL_COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#8b5cf6", "#ec4899", "#ef4444", "#06b6d4"];

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

export default function Dashboard({ onOpenBoard, apiFetch, currentUser, onLogout, onManageUsers, onProfile, onIntegrations }) {
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
  const [formBoardType, setFormBoardType] = useState("pi_planning");
  const [kanbanCols, setKanbanCols] = useState([]);
  const [newKanbanColName, setNewKanbanColName] = useState("");
  const [saving, setSaving] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [assignModal, setAssignModal] = useState(null); // { boardId, boardName }
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const [assignUsers, setAssignUsers] = useState([]);
  const [assignUserId, setAssignUserId] = useState("");
  const [assignLoading, setAssignLoading] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null); // { message, onConfirm }
  const [shareLink, setShareLink] = useState(null); // link string to show

  async function fetchBoards() {
    setLoading(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/boards?include_archived=${showArchived}`);
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
    setFormBoardType("pi_planning");
    setKanbanCols([]);
    setNewKanbanColName("");
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
    if (!editBoard && formBoardType === "pi_planning" && (!formStartDate || !formEndDate)) return;
    setSaving(true);
    try {
      const startIso = formStartDate ? `${formStartDate}-01` : undefined;
      const endIso = formEndDate ? `${formEndDate}-01` : undefined;

      if (editBoard) {
        await apiFetch(`${API_BASE}/api/boards/${editBoard.id}`, {
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
        const body = {
          name: formName,
          description: formDesc,
          board_type: formBoardType,
        };
        if (formBoardType === "pi_planning") {
          body.start_date = startIso;
          body.end_date = endIso;
        }
        const createRes = await apiFetch(`${API_BASE}/api/boards`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        // If kanban with pre-defined columns, create them now
        if (formBoardType === "kanban" && kanbanCols.length > 0 && createRes.ok) {
          const created = await createRes.json();
          const boardId = created.id;
          for (const col of kanbanCols) {
            await apiFetch(`${API_BASE}/api/kanban/${boardId}/columns`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: col.name, color: col.color }),
            });
          }
        }
      }
      setShowModal(false);
      fetchBoards();
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive(e, boardId) {
    e.stopPropagation();
    setConfirmDialog({
      message: "Archive this board?",
      onConfirm: async () => {
        setConfirmDialog(null);
        await apiFetch(`${API_BASE}/api/boards/${boardId}/archive`, { method: "PATCH" });
        fetchBoards();
      },
    });
  }

  async function handleClone(e, boardId) {
    e.stopPropagation();
    const res = await apiFetch(`${API_BASE}/api/boards/${boardId}/clone`, { method: "POST" });
    if (!res.ok) return;
    const data = await res.json();
    if (data.board && onOpenBoard) {
      onOpenBoard(data.board);
    }
  }

  async function handleDelete(e, boardId) {
    e.stopPropagation();
    setConfirmDialog({
      message: "Permanently delete this board? This cannot be undone.",
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          const res = await apiFetch(`${API_BASE}/api/boards/${boardId}`, { method: "DELETE" });
          if (!res.ok) {
            const d = await res.json();
            setConfirmDialog({ message: d.detail || "Failed to delete board", onConfirm: () => setConfirmDialog(null), confirmLabel: "OK", hideCancel: true });
            return;
          }
          fetchBoards();
        } catch (err) {
          setConfirmDialog({ message: err.message || "Failed to delete board", onConfirm: () => setConfirmDialog(null), confirmLabel: "OK", hideCancel: true });
        }
      },
    });
  }

  async function openAssignModal(e, board) {
    e.stopPropagation();
    setAssignModal({ boardId: board.id, boardName: board.name });
    setAssignUserId(board.created_by ? String(board.created_by) : "");
    setAssignLoading(false);
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/users`);
      const data = await res.json();
      setAssignUsers(data || []);
    } catch {
      setAssignUsers([]);
    }
  }

  async function handleAssign() {
    if (!assignModal || !assignUserId) return;
    setAssignLoading(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/admin/boards/${assignModal.boardId}/assign`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: Number(assignUserId) }),
      });
      if (!res.ok) {
        const d = await res.json();
        alert(d.detail || "Failed to assign board");
        return;
      }
      setAssignModal(null);
      fetchBoards();
    } catch (err) {
      alert(err.message);
    } finally {
      setAssignLoading(false);
    }
  }

  const filteredBoards = boards.filter((b) =>
    b.name.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div style={{ minHeight: "100vh", background: "#f3f4f6" }}>

      {/* ── Navbar (matching PI Planning header) ── */}
      <div style={{
        background: "#ffffff",
        borderBottom: "1px solid #e5e7eb",
      }}>
        {/* Row 1: logo | title (centered) | user controls */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          padding: "0 28px",
          height: "52px",
          borderBottom: "1px solid #f3f4f6",
        }}>
          {/* Left — logo */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: "6px",
              padding: "0", color: "#1d4ed8", fontWeight: "700",
              fontSize: "15px", letterSpacing: "-0.2px",
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#1d4ed8">
                <rect x="3" y="3" width="8" height="8" rx="1.5"/>
                <rect x="13" y="3" width="8" height="8" rx="1.5"/>
                <rect x="3" y="13" width="8" height="8" rx="1.5"/>
                <rect x="13" y="13" width="8" height="8" rx="1.5"/>
              </svg>
              <span style={{ color: "#111827" }}>Task</span>
              <span style={{ color: "#1d4ed8" }}>Weave</span>
            </div>
          </div>

          {/* Center — Dashboard */}
          <div style={{ textAlign: "center" }}>
            <span style={{ fontSize: "15px", fontWeight: "600", color: "#111827" }}>
              Dashboard
            </span>
          </div>

          {/* Right — new board + avatar dropdown */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", justifyContent: "flex-end" }}>
            <button
              onClick={openCreateModal}
              style={{
                background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 6,
                padding: "6px 14px", cursor: "pointer", fontSize: 12, fontWeight: 700,
              }}
            >+ New Board</button>
            <div style={{ borderLeft: "1px solid #e5e7eb", height: 24, margin: "0 4px" }} />
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setAvatarMenuOpen((v) => !v)}
                style={{
                  width: 34, height: 34, borderRadius: "50%", border: "2px solid #93c5fd",
                  background: "#dbeafe", display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", fontSize: 14, fontWeight: 700, color: "#1d4ed8",
                  padding: 0, lineHeight: 1,
                }}
                title={currentUser?.display_name || currentUser?.username}
              >
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
                    {/* User info header */}
                    <div style={{ padding: "14px 16px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: "50%", background: "#dbeafe",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 15, fontWeight: 700, color: "#1d4ed8", flexShrink: 0,
                      }}>
                        {(currentUser?.display_name || currentUser?.username || "?")[0].toUpperCase()}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {currentUser?.display_name || currentUser?.username}
                        </div>
                        <div style={{ fontSize: 11, color: "#6b7280" }}>@{currentUser?.username} · {currentUser?.role?.toUpperCase()}</div>
                      </div>
                    </div>
                    {/* Menu items */}
                    <div style={{ padding: "6px 0" }}>
                      <button style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 16px", border: "none", background: "#eff6ff", fontSize: 13, color: "#1d4ed8", fontWeight: 600, cursor: "default", textAlign: "left", borderLeft: "3px solid #1d4ed8" }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1d4ed8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
                        My Boards
                      </button>
                      {onProfile && (
                        <button onClick={() => { setAvatarMenuOpen(false); onProfile(); }}
                          style={{
                            display: "flex", alignItems: "center", gap: 10, width: "100%",
                            padding: "9px 16px", border: "none", background: "none",
                            fontSize: 13, color: "#374151", cursor: "pointer", textAlign: "left",
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = "#f3f4f6"}
                          onMouseLeave={(e) => e.currentTarget.style.background = "none"}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                          </svg>
                          My Profile
                        </button>
                      )}
                      {onIntegrations && (
                        <button onClick={() => { setAvatarMenuOpen(false); onIntegrations(); }}
                          style={{
                            display: "flex", alignItems: "center", gap: 10, width: "100%",
                            padding: "9px 16px", border: "none", background: "none",
                            fontSize: 13, color: "#374151", cursor: "pointer", textAlign: "left",
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = "#f3f4f6"}
                          onMouseLeave={(e) => e.currentTarget.style.background = "none"}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                          </svg>
                          Integrations
                        </button>
                      )}
                      {onManageUsers && (
                        <button onClick={() => { setAvatarMenuOpen(false); onManageUsers(); }}
                          style={{
                            display: "flex", alignItems: "center", gap: 10, width: "100%",
                            padding: "9px 16px", border: "none", background: "none",
                            fontSize: 13, color: "#374151", cursor: "pointer", textAlign: "left",
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = "#f3f4f6"}
                          onMouseLeave={(e) => e.currentTarget.style.background = "none"}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                          </svg>
                          Manage Users
                        </button>
                      )}
                    </div>
                    {/* Logout */}
                    <div style={{ borderTop: "1px solid #f3f4f6", padding: "6px 0" }}>
                      <button onClick={() => { setAvatarMenuOpen(false); onLogout(); }}
                        style={{
                          display: "flex", alignItems: "center", gap: 10, width: "100%",
                          padding: "9px 16px", border: "none", background: "none",
                          fontSize: 13, color: "#ef4444", cursor: "pointer", textAlign: "left",
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = "#fef2f2"}
                        onMouseLeave={(e) => e.currentTarget.style.background = "none"}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
                        </svg>
                        Logout
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Row 2: board count + filter + archived toggle */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 28px", height: "40px",
        }}>
          <span style={{ fontSize: "13px", color: "#9ca3af", fontStyle: "italic" }}>
            {boards.length} Boards · Collaborate by opening a board
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {/* Center — filter */}
          <div style={{ position: "relative", marginTop: "-12px" }}>
            <span style={{
              position: "absolute", left: "8px", top: "50%",
              transform: "translateY(-50%)", color: "#9ca3af", fontSize: "12px",
            }}>🔍</span>
            <input
              placeholder="Filter boards"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{
                padding: "0 10px 0 26px", borderRadius: "6px",
                border: "1px solid #d1d5db", width: "180px", height: "30px",
                fontSize: "12px", background: "white", outline: "none",
                color: "#111827", boxSizing: "border-box",
              }}
            />
          </div>
          {/* Right — archived toggle */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#6b7280" }}>
            <span>Archived</span>
            <button
              onClick={() => setShowArchived(!showArchived)}
              style={{
                background: showArchived ? "#1d4ed8" : "#e5e7eb",
                color: showArchived ? "white" : "#6b7280",
                border: "none", borderRadius: "4px",
                padding: "2px 8px", cursor: "pointer",
                fontWeight: "700", fontSize: "11px", transition: "background 0.15s",
              }}
            >
              {showArchived ? "YES" : "NO"}
            </button>
          </div>
          </div>
        </div>
      </div>

      {/* ── Board content area ── */}
      <div style={{ padding: "20px 28px" }}>

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
            const isOwner = currentUser?.id === board.created_by;
            const isAdmin = currentUser?.role === "admin";
            const canManage = isOwner || isAdmin;
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
                      {board.board_type === "kanban" && (
                        <span style={{
                          fontSize: "10px", background: "#dbeafe",
                          color: "#1d4ed8", borderRadius: "4px",
                          padding: "1px 5px", fontWeight: "700", marginLeft: "6px",
                        }}>KANBAN</span>
                      )}
                      {board.board_type === "pi_planning" && (
                        <span style={{
                          fontSize: "10px", background: "#dcfce7",
                          color: "#166534", borderRadius: "4px",
                          padding: "1px 5px", fontWeight: "700", marginLeft: "6px",
                        }}>PI PLANNING</span>
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
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      const link = `${window.location.origin}${window.location.pathname}?board=${board.id}`;
                      setShareLink(link);
                      try { navigator.clipboard.writeText(link); } catch (_) { /* non-HTTPS fallback */ }
                    }}
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
                        {canManage && (
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
                        )}
                        {canManage && board.is_archived === 0 && (
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
                        {canManage && (
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
                        )}
                        {isAdmin && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); openAssignModal(e, board); }}
                            style={{
                              display: "flex", alignItems: "center", gap: "8px",
                              width: "100%", background: "none", border: "none",
                              color: "#1d4ed8", fontSize: "13px", padding: "7px 10px",
                              cursor: "pointer", borderRadius: "5px", textAlign: "left",
                              borderTop: "1px solid #f3f4f6",
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = "#eff6ff"}
                            onMouseLeave={(e) => e.currentTarget.style.background = "none"}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
                            Assign Owner
                          </button>
                        )}
                        {!canManage && (
                          <div style={{ padding: "8px 10px", fontSize: 12, color: "#9ca3af" }}>
                            No actions available
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      </div>

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

            {/* Board Type Selector (create only) */}
            {!editBoard && (
              <div style={{ marginBottom: 18 }}>
                <label style={{ fontSize: "13px", fontWeight: "600", color: "#374151", display: "block", marginBottom: 8 }}>
                  Board Type *
                </label>
                <div style={{ display: "flex", gap: 10 }}>
                  {[
                    { value: "pi_planning", label: "PI Planning", icon: "📋", desc: "Sprint-based with date ranges" },
                    { value: "kanban", label: "Kanban", icon: "📊", desc: "Custom columns & swimlanes" },
                  ].map((bt) => (
                    <div
                      key={bt.value}
                      onClick={() => setFormBoardType(bt.value)}
                      style={{
                        flex: 1, padding: "12px 14px", borderRadius: 10, cursor: "pointer",
                        border: formBoardType === bt.value ? "2px solid #1d4ed8" : "2px solid #e5e7eb",
                        background: formBoardType === bt.value ? "#eff6ff" : "#fff",
                        transition: "all 0.15s",
                      }}
                    >
                      <div style={{ fontSize: 22, marginBottom: 4 }}>{bt.icon}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>{bt.label}</div>
                      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{bt.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

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

            {/* Date range row - only for PI Planning */}
            {(editBoard || formBoardType === "pi_planning") && (
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
            )}

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

            {/* Kanban columns setup (create only) */}
            {!editBoard && formBoardType === "kanban" && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: "13px", fontWeight: "600", color: "#374151", display: "block", marginBottom: 8 }}>
                  Columns (workflow stages)
                </label>
                {kanbanCols.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                    {kanbanCols.map((col, i) => (
                      <div key={i} style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "6px 10px", borderRadius: 8, background: "#f9fafb",
                        border: "1px solid #e5e7eb",
                      }}>
                        <div style={{ width: 14, height: 14, borderRadius: 4, background: col.color, flexShrink: 0 }} />
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#111827" }}>{col.name}</span>
                        <button onClick={() => setKanbanCols(kanbanCols.filter((_, j) => j !== i))} style={{
                          background: "none", border: "none", cursor: "pointer", color: "#9ca3af",
                          fontSize: 13, padding: 0, lineHeight: 1,
                        }}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    value={newKanbanColName}
                    onChange={(e) => setNewKanbanColName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newKanbanColName.trim()) {
                        e.preventDefault();
                        setKanbanCols([...kanbanCols, { name: newKanbanColName.trim(), color: DEFAULT_COL_COLORS[kanbanCols.length % DEFAULT_COL_COLORS.length] }]);
                        setNewKanbanColName("");
                      }
                    }}
                    placeholder="e.g. To Do, In Progress, Done"
                    style={{
                      flex: 1, padding: "8px 10px", borderRadius: 8,
                      border: "1px solid #d1d5db", fontSize: 13,
                      boxSizing: "border-box", outline: "none", color: "#111827",
                    }}
                  />
                  <button
                    type="button"
                    disabled={!newKanbanColName.trim()}
                    onClick={() => {
                      if (!newKanbanColName.trim()) return;
                      setKanbanCols([...kanbanCols, { name: newKanbanColName.trim(), color: DEFAULT_COL_COLORS[kanbanCols.length % DEFAULT_COL_COLORS.length] }]);
                      setNewKanbanColName("");
                    }}
                    style={{
                      padding: "8px 14px", borderRadius: 8, border: "none",
                      background: newKanbanColName.trim() ? "#1d4ed8" : "#93c5fd",
                      color: "#fff", cursor: newKanbanColName.trim() ? "pointer" : "not-allowed",
                      fontWeight: 700, fontSize: 12, flexShrink: 0,
                    }}
                  >+ Add</button>
                </div>
                {kanbanCols.length === 0 && (
                  <p style={{ margin: "6px 0 0", fontSize: 11, color: "#9ca3af" }}>
                    You can add columns now or later inside the board.
                  </p>
                )}
              </div>
            )}

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
                disabled={!formName.trim() || (!editBoard && formBoardType === "pi_planning" && (!formStartDate || !formEndDate)) || saving}
                style={{
                  padding: "10px 20px", borderRadius: "8px", border: "none",
                  background: (formName.trim() && (editBoard || formBoardType === "kanban" || (formStartDate && formEndDate)) && !saving) ? "#1d4ed8" : "#93c5fd",
                  color: "white",
                  cursor: (formName.trim() && (editBoard || formBoardType === "kanban" || (formStartDate && formEndDate)) && !saving) ? "pointer" : "not-allowed",
                  fontWeight: "700", fontSize: "14px", transition: "background 0.15s",
                }}
              >
                {saving ? "Saving…" : editBoard ? "Save Changes" : "Create Board"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Assign Owner Modal ── */}
      {assignModal && (
        <div
          onClick={() => setAssignModal(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{
            background: "#fff", borderRadius: 16, padding: "32px 36px", width: 400,
            boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          }}>
            <h2 style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 700, color: "#111827" }}>
              Assign Board Owner
            </h2>
            <p style={{ margin: "0 0 20px", fontSize: 13, color: "#6b7280" }}>
              Board: <strong>{assignModal.boardName}</strong>
            </p>

            <label style={{ fontSize: 13, fontWeight: 600, color: "#374151", display: "block" }}>
              Select User
            </label>
            <select
              value={assignUserId}
              onChange={(e) => setAssignUserId(e.target.value)}
              style={{
                display: "block", width: "100%", padding: "10px 12px", marginTop: 6,
                borderRadius: 8, border: "1px solid #d1d5db", fontSize: 14,
                boxSizing: "border-box", outline: "none", color: "#111827",
                cursor: "pointer", marginBottom: 20,
              }}
            >
              <option value="">— Select a user —</option>
              {assignUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.display_name} ({u.username}){u.role === "admin" ? " [ADMIN]" : ""}
                </option>
              ))}
            </select>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => setAssignModal(null)}
                style={{
                  padding: "10px 20px", borderRadius: 8, border: "1px solid #d1d5db",
                  background: "#fff", cursor: "pointer", fontWeight: 500, fontSize: 14, color: "#374151",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleAssign}
                disabled={!assignUserId || assignLoading}
                style={{
                  padding: "10px 20px", borderRadius: 8, border: "none",
                  background: assignUserId && !assignLoading ? "#1d4ed8" : "#93c5fd",
                  color: "#fff", cursor: assignUserId && !assignLoading ? "pointer" : "not-allowed",
                  fontWeight: 700, fontSize: 14,
                }}
              >
                {assignLoading ? "Assigning..." : "Assign"}
              </button>
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
              {!confirmDialog.hideCancel && (
                <button className="error-overlay-close" onClick={() => setConfirmDialog(null)}>Cancel</button>
              )}
              <button
                className="error-overlay-close"
                style={{ background: confirmDialog.hideCancel ? "#1d4ed8" : "#ef4444", color: "#fff", borderColor: confirmDialog.hideCancel ? "#1d4ed8" : "#ef4444" }}
                onClick={confirmDialog.onConfirm}
              >
                {confirmDialog.confirmLabel || "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Share link dialog ── */}
      {shareLink && (
        <div className="error-overlay-backdrop" onClick={() => setShareLink(null)}>
          <div className="error-overlay" onClick={(e) => e.stopPropagation()} style={{ borderColor: "#d1d5db" }}>
            <div className="error-overlay-icon">🔗</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 10 }}>Board Link</div>
            <input
              id="share-link-input"
              readOnly
              value={shareLink}
              ref={(el) => { if (el) el.select(); }}
              onFocus={(e) => e.target.select()}
              onClick={(e) => e.target.select()}
              style={{
                width: "100%", padding: "10px 12px", fontSize: 14, border: "2px solid #3b82f6",
                borderRadius: 8, background: "#eff6ff", color: "#1d4ed8", boxSizing: "border-box",
                marginBottom: 16, textAlign: "center", fontWeight: 500,
                outline: "none",
              }}
            />
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button
                className="error-overlay-close"
                style={{ background: "#1d4ed8", color: "#fff", borderColor: "#1d4ed8" }}
                onClick={() => {
                  const el = document.getElementById('share-link-input');
                  if (el) {
                    el.select();
                    el.setSelectionRange(0, el.value.length);
                    try { document.execCommand('copy'); } catch (_) {}
                  }
                  try { navigator.clipboard.writeText(shareLink); } catch (_) {}
                }}
              >Copy</button>
              <button className="error-overlay-close" onClick={() => setShareLink(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
