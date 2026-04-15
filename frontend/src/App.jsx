import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Dashboard from "./Dashboard";
import AdminUsers from "./AdminUsers";
import KanbanBoard from "./KanbanBoard";
import Configuration from "./Configuration";
import UserProfile from "./UserProfile";

const API_BASE = import.meta.env.VITE_API_BASE || "http://0.0.0.0:8000";

// ── Auth helpers ────────────────────────────────────────────────────────
function getStoredAuth() {
  try {
    const raw = sessionStorage.getItem("pi_board_auth");
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}
function setStoredAuth(auth) {
  if (auth) sessionStorage.setItem("pi_board_auth", JSON.stringify(auth));
  else sessionStorage.removeItem("pi_board_auth");
}

function isTokenExpired(token) {
  if (!token) return true;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return !payload.exp || payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

function makeApiFetch(token, onUnauthorized) {
  return async function apiFetch(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      onUnauthorized();
      throw new Error("Session expired — please log in again");
    }
    return res;
  };
}

const TECH_TEAMS = [
  { code: "DWH", name: "DWH Scrum Team" },
  { code: "OPT2", name: "Operations Stream Board" },
  { code: "RIT2", name: "Risk Stream Board" },
  { code: "RIT1", name: "RIT1 Big Data Stream Board" },
  { code: "WCORP", name: "WEB board" },
  { code: "WPAY", name: "Web Payments Board" },
  { code: "DXP", name: "DXP board" },
  { code: "HRT1", name: "HR/Fin Scrum Team" },
  { code: "CORE", name: "DATA & AI - CORE Testing Team" },
  { code: "AI", name: "DAI board" },
  { code: "BEM", name: "SMPH BEM Kanban" },
  { code: "SAS IT PH", name: "SAS Updated Kanban" },
  { code: "OSCS", name: "OSS board" },
  { code: "Sycamore (BAU)", name: "ELM board" },
  { code: "SAT3", name: "SAT3 LMS" },
  { code: "PH_Core", name: "PH_Core" },
  { code: "PH_LOR1", name: "LOR_1" },
  { code: "PH_LOR2", name: "LOR_2" },
  { code: "PH_eKYC", name: "PH_eKYC" },
  { code: "PH_QR", name: "PH_QR" },
  { code: "PH_DTr", name: "PH_DTr" },
  { code: "SAT1", name: "SNA board" },
  { code: "SAT2", name: "Partner Central Board" },
  { code: "PH_REL_and_Servicing", name: "PH_REL_and_SelfServicing" },
  { code: "CCT", name: "CCT: Commercial Core" },
  { code: "CRT2", name: "CRT2: CREED" },
].map((team) => ({ ...team, type: "technical" }));

const BUSINESS_TEAM_GROUPS = [
  {
    group: "Products",
    teams: ["Prototyping", "Sales", "Revolving", "Online"],
  },
  {
    group: "Risk",
    teams: ["Underwriting", "Anti-Fraud", "Risk Technology", "Blaze"],
  },
  {
    group: "Finance",
    teams: ["Settlement", "Reconciliation", "Pre-funding", "Operations"],
  },
  {
    group: "Legal",
    teams: [],
  },
  {
    group: "CRM",
    teams: ["Lifecycle", "SAS"],
  },
  {
    group: "Marketing",
    teams: [],
  },
  {
    group: "OPS",
    teams: ["Backoffice", "CustEx", "Payments", "Disbursements"],
  },
  {
    group: "Online",
    teams: ["Digital Lifecycle", "UI/UX", "Digital Product Management", "Digital Platform Team"],
  },
  {
    group: "Sales",
    teams: ["POS"],
  },
];

const BUSINESS_TEAMS = BUSINESS_TEAM_GROUPS.flatMap((section) => {
  if (!section.teams.length) {
    return [{ code: `${section.group}`, name: `${section.group}`, group: section.group, type: "business" }];
  }
  return section.teams.map((team) => ({
    code: `${section.group} - ${team}`,
    name: `${section.group} - ${team}`,
    group: section.group,
    type: "business",
  }));
});

const ALL_TEAM_OPTIONS = [...TECH_TEAMS, ...BUSINESS_TEAMS];
const TEAM_OPTION_BY_CODE = ALL_TEAM_OPTIONS.reduce((acc, team) => {
  acc[team.code] = team;
  return acc;
}, {});
const BUSINESS_GROUP_OPTIONS = BUSINESS_TEAM_GROUPS.map((section) => section.group);

const TEAM_NAME_MAP = ALL_TEAM_OPTIONS.reduce((acc, team) => {
  acc[team.code] = team.name;
  return acc;
}, {});

function slotToDate(months, slot) {
  for (const month of months) {
    const found = month.slots.find((s) => s.slot === slot);
    if (found) {
      const week = Number(found.label.replace("WK", ""));
      const day = (week - 1) * 7 + 1;
      return `${month.year}-${String(new Date(`${month.name} 1, ${month.year}`).getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return "";
}

function slotToBoardDate(months, slot) {
  return slotToDate(months, slot) || "N/A";
}

function dateToSlot(months, isoDate) {
  if (!isoDate) {
    return null;
  }

  const parsed = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const monthNumber = parsed.getMonth() + 1;
  const year = parsed.getFullYear();
  const weekIndex = Math.min(Math.max(Math.floor((parsed.getDate() - 1) / 7), 0), 3);

  const matchedMonth = months.find((month) => {
    const monthDate = new Date(`${month.name} 1, ${month.year}`);
    return month.year === year && monthDate.getMonth() + 1 === monthNumber;
  });

  if (!matchedMonth || !matchedMonth.slots || !matchedMonth.slots[weekIndex]) {
    return null;
  }

  return matchedMonth.slots[weekIndex].slot;
}

function truncateText(value, maxLength = 30) {
  if (!value) {
    return "";
  }
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function getSummaryMaxLengthBySpan(span) {
  const safeSpan = Math.max(1, Number(span) || 1);
  const dynamicLength = 14 + safeSpan * 18;
  return Math.min(140, dynamicLength);
}

function truncateSummaryBySpan(value, span) {
  return truncateText(value, getSummaryMaxLengthBySpan(span));
}

function formatIssueKey(item) {
  const key = (item?.issue_key || "").trim();
  if (!key) {
    return "";
  }
  if ((item?.ticket_source || "").toLowerCase() === "ado" && key.toUpperCase().startsWith("US-")) {
    return key.slice(3);
  }
  return key;
}

function getTileColor(item) {
  const source = (item?.ticket_source || "").toLowerCase();
  if (source === "ado") {
    return "#7c6bb3";
  }
  if (source === "jira") {
    return "#2563eb";
  }
  return item?.color;
}

function getTicketLabel(item) {
  if (item.sync_status === "sync_failed" || item.sync_status === "unsynced") {
    const key = formatIssueKey(item);
    if (key) return key;
    return `TEMP-${String(item.id).padStart(4, "0")}`;
  }
  const displayKey = formatIssueKey(item);
  if (displayKey) {
    if (item.jira_shirt_size) {
      return `${displayKey} (${item.jira_shirt_size})`;
    }
    return displayKey;
  }
  return item.item_type;
}

function getTicketMetaLine(item) {
  if ((item?.ticket_source || "").toLowerCase() !== "jira") {
    return "";
  }
  const parts = [];
  if (item?.jira_status) {
    parts.push(item.jira_status);
  }
  if (item?.jira_assignee) {
    parts.push(item.jira_assignee);
  }
  if (item?.jira_shirt_size) {
    parts.push(`Size: ${item.jira_shirt_size}`);
  }
  return parts.join(" | ");
}

function getStatusTone(status) {
  const value = (status || "").toLowerCase();
  if (!value) {
    return "unknown";
  }
  if (value.includes("design")) {
    return "design";
  }
  if (value.includes("ready")) {
    return "ready";
  }
  if (value.includes("development")) {
    return "in-progress";
  }
  if (value.includes("icebox") || value.includes("refill")) {
    return "icebox";
  }
  if (value.includes("done") || value.includes("resolved") || value.includes("closed")) {
    return "done";
  }
  if (value.includes("progress") || value.includes("active") || value.includes("ongoing")) {
    return "in-progress";
  }
  if (value.includes("block") || value.includes("hold")) {
    return "blocked";
  }
  if (value.includes("todo") || value.includes("open") || value.includes("backlog") || value.includes("new")) {
    return "todo";
  }
  return "unknown";
}

const authInputStyle = {
  display: "block", width: "100%", padding: "10px 12px", marginTop: 4,
  borderRadius: 8, border: "1px solid #d1d5db", fontSize: 14,
  boxSizing: "border-box", outline: "none",
};

function buildRowLayouts(items) {
  const byRow = {};
  for (const item of items) {
    if (!byRow[item.row_index]) {
      byRow[item.row_index] = [];
    }
    byRow[item.row_index].push(item);
  }

  const itemLayout = {};
  const rowLaneCount = {};

  Object.entries(byRow).forEach(([rowIndex, rowItems]) => {
    rowItems.sort((a, b) => {
      if (a.start_slot !== b.start_slot) {
        return a.start_slot - b.start_slot;
      }
      if (a.end_slot !== b.end_slot) {
        return a.end_slot - b.end_slot;
      }
      return a.id - b.id;
    });

    const laneEnds = [];
    for (const item of rowItems) {
      let lane = 0;
      while (lane < laneEnds.length && item.start_slot <= laneEnds[lane]) {
        lane += 1;
      }
      if (lane === laneEnds.length) {
        laneEnds.push(item.end_slot);
      } else {
        laneEnds[lane] = item.end_slot;
      }
      itemLayout[item.id] = { lane };
    }

    rowLaneCount[rowIndex] = Math.max(1, laneEnds.length);
  });

  return { itemLayout, rowLaneCount };
}

export default function App() {
  // ── Auth state ──
  const [auth, setAuth] = useState(getStoredAuth);
  const [authMode, setAuthMode] = useState("login"); // "login" | "register"
  const [authForm, setAuthForm] = useState({ username: "", password: "", display_name: "" });
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [logoutNotice, setLogoutNotice] = useState(false);

  // ── App state (must be declared before any early return to satisfy Rules of Hooks) ──
  const [view, setView] = useState("dashboard");
  const [selectedBoard, setSelectedBoard] = useState(null);
  const [board, setBoard] = useState({ months: [], rows: [], items: [], links: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState(null);
  const [itemAction, setItemAction] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [form, setForm] = useState({ issue_key: "", target_date: "", end_date: "" });
  const [taskForm, setTaskForm] = useState({
    source_mode: "existing",
    ticket_source: "jira",
    jira_project_key: "",
    jira_issue_type: "",
    jira_service: "",
    title: "",
    issue_key: "",
    row_index: null,
    start_slot: 0,
    end_slot: 0,
    start_date: "",
    end_date: "",
  });
  const [jiraProjects, setJiraProjects] = useState([]);
  const [jiraProjectsLoading, setJiraProjectsLoading] = useState(false);
  const [jiraIssueTypes, setJiraIssueTypes] = useState([]);
  const [jiraIssueTypesLoading, setJiraIssueTypesLoading] = useState(false);
  const [jiraServiceOptions, setJiraServiceOptions] = useState([]);
  const [jiraServiceLoading, setJiraServiceLoading] = useState(false);
  const [jiraServiceFieldKey, setJiraServiceFieldKey] = useState("customfield_12102");
  const [teamAssignments, setTeamAssignments] = useState({});
  const [teamForm, setTeamForm] = useState({ rowIndex: null, teamCode: "", teamType: "technical", businessGroup: "All" });
  const [linkMode, setLinkMode] = useState(null);
  const [linkPaths, setLinkPaths] = useState([]);
  const [linkCanvas, setLinkCanvas] = useState({ width: 0, height: 0, scrollLeft: 0, scrollTop: 0 });
  const [showLinks, setShowLinks] = useState(true);
  const [dragState, setDragState] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [resizeState, setResizeState] = useState(null);
  const [hoveredTileId, setHoveredTileId] = useState(null);
  const [linkTypeMenu, setLinkTypeMenu] = useState(null);
  const [linkTypeDraft, setLinkTypeDraft] = useState("relates to");
  const [commitMenu, setCommitMenu] = useState(null);
  const [commitResult, setCommitResult] = useState(null);
  const [jiraCreateNotice, setJiraCreateNotice] = useState(null);
  const [isRefreshingExternal, setIsRefreshingExternal] = useState(false);
  const [lastExternalRefreshAt, setLastExternalRefreshAt] = useState(null);
  const [selectedTicketId, setSelectedTicketId] = useState(null);
  const [visibleTeamRows, setVisibleTeamRows] = useState(5);
  const [showActivity, setShowActivity] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const [showGantt, setShowGantt] = useState(false);
  const [activityLog, setActivityLog] = useState([]);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const boardWrapRef = useRef(null);
  const resizeStateRef = useRef(null);

  function handleLogout() {
    setStoredAuth(null);
    setAuth(null);
    setAuthMode("login");
    setLogoutNotice(true);
  }

  // Proactively log out when the JWT token expires
  useEffect(() => {
    if (!auth?.token) return;
    if (isTokenExpired(auth.token)) {
      handleLogout();
      return;
    }
    const interval = setInterval(() => {
      if (isTokenExpired(auth.token)) {
        handleLogout();
      }
    }, 30000); // check every 30 seconds
    return () => clearInterval(interval);
  }, [auth?.token]);

  const apiFetch = useCallback(
    makeApiFetch(auth?.token, handleLogout),
    [auth?.token],
  );

  async function handleAuthSubmit(e) {
    e.preventDefault();
    setAuthError("");
    setLogoutNotice(false);
    setAuthLoading(true);
    try {
      const endpoint = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
      const body = authMode === "login"
        ? { username: authForm.username, password: authForm.password }
        : { username: authForm.username, password: authForm.password, display_name: authForm.display_name };
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Authentication failed");
      const authData = { token: data.token, user: data.user };
      setStoredAuth(authData);
      setAuth(authData);
      setAuthForm({ username: "", password: "", display_name: "" });
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  }

  // ── Authenticated app below ──

  async function loadActivity() {
    if (!selectedBoard?.id) return;
    try {
      const res = await apiFetch(`${API_BASE}/api/boards/${selectedBoard.id}/activity?limit=100`);
      if (res.ok) {
        const data = await res.json();
        setActivityLog(data.events || []);
      }
    } catch {}
  }

  const monthHeaders = useMemo(() => board.months ?? [], [board.months]);
  const { itemLayout, rowLaneCount } = useMemo(() => buildRowLayouts(board.items ?? []), [board.items]);

  const linkModeSourceLabel = useMemo(() => {
    if (!linkMode) {
      return "";
    }
    const source = (board.items || []).find((item) => item.id === linkMode.sourceItemId);
    return source ? formatIssueKey(source) || source.title || `#${source.id}` : "";
  }, [linkMode, board.items]);

  const focusModeTicketLabel = useMemo(() => {
    if (!selectedTicketId) {
      return "";
    }
    const selected = (board.items || []).find((item) => item.id === selectedTicketId);
    return selected ? formatIssueKey(selected) || selected.title || `#${selected.id}` : "";
  }, [selectedTicketId, board.items]);

  const resizePreview = useMemo(() => {
    if (!resizeState) {
      return null;
    }
    const item = (board.items || []).find((it) => it.id === resizeState.itemId);
    if (!item) {
      return null;
    }
    return {
      label: formatIssueKey(item) || item.title || `#${item.id}`,
      start: slotToBoardDate(board.months, resizeState.draftStart),
      end: slotToBoardDate(board.months, resizeState.draftEnd),
    };
  }, [resizeState, board.items, board.months]);

  const filteredBusinessTeams = useMemo(() => {
    if (teamForm.businessGroup === "All") {
      return BUSINESS_TEAMS;
    }
    return BUSINESS_TEAMS.filter((team) => team.group === teamForm.businessGroup);
  }, [teamForm.businessGroup]);

  const teamOptions = useMemo(() => {
    return teamForm.teamType === "technical" ? TECH_TEAMS : filteredBusinessTeams;
  }, [teamForm.teamType, filteredBusinessTeams]);

  const highlightedTicketIds = useMemo(() => {
    if (!selectedTicketId) {
      return new Set();
    }
    const linked = (board.links || []).reduce((acc, link) => {
      if (link.source_item_id === selectedTicketId) {
        acc.push(link.target_item_id);
      }
      if (link.target_item_id === selectedTicketId) {
        acc.push(link.source_item_id);
      }
      return acc;
    }, []);
    return new Set([selectedTicketId, ...linked]);
  }, [selectedTicketId, board.links]);

  const impactedRowIndexes = useMemo(() => {
    if (!selectedTicketId) {
      return new Set();
    }
    const impacted = (board.items || [])
      .filter((item) => highlightedTicketIds.has(item.id))
      .map((item) => item.row_index);
    return new Set(impacted);
  }, [selectedTicketId, board.items, highlightedTicketIds]);

  const shouldRenderLinkLayer = showLinks || Boolean(selectedTicketId);

  const rowsToRender = useMemo(() => {
    return (board.rows || []).filter((row) => row.index === 0 || row.index <= visibleTeamRows);
  }, [board.rows, visibleTeamRows]);

  const maxTeamRows = useMemo(() => {
    const teamRows = (board.rows || []).filter((row) => row.index > 0).length;
    return teamRows;
  }, [board.rows]);

  async function loadBoard(options = {}) {
    const { refreshExternal = false, showSpinner = false, boardId = null } = options;
    const activeBoardId = boardId ?? selectedBoard?.id;
    if (!activeBoardId) return;
    if (showSpinner) {
      setLoading(true);
    }
    setError("");
    try {
      const res = await apiFetch(`${API_BASE}/api/board?board_id=${activeBoardId}&refresh_external=${refreshExternal ? "true" : "false"}`);
      if (!res.ok) {
        throw new Error("Failed to load board");
      }
      const data = await res.json();
      setBoard(data);
      const assignments = data.team_assignments || {};
      setTeamAssignments(assignments);

      const assignedRowIndexes = Object.keys(assignments)
        .map((key) => Number(key))
        .filter((idx) => Number.isFinite(idx) && idx > 0);
      const highestAssigned = assignedRowIndexes.length ? Math.max(...assignedRowIndexes) : 0;
      setVisibleTeamRows((prev) => Math.max(prev, 5, highestAssigned));
      if (refreshExternal) {
        setLastExternalRefreshAt(new Date());
      }
    } catch (e) {
      setError(e.message || "Could not load board");
    } finally {
      if (showSpinner) {
        setLoading(false);
      }
    }
  }

  async function refreshBoardFromSources() {
    setIsRefreshingExternal(true);
    try {
      await loadBoard({ refreshExternal: true, showSpinner: false });
    } finally {
      setIsRefreshingExternal(false);
    }
  }

  useEffect(() => {
    // On mount: if URL has ?board=id, auto-open that board
    const params = new URLSearchParams(window.location.search);
    const boardIdParam = params.get("board");
    if (boardIdParam) {
      apiFetch(`${API_BASE}/api/boards/${boardIdParam}`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (data?.id) {
            setSelectedBoard(data);
            if (data.board_type === "kanban") {
              setView("kanban");
            } else {
              setView("board");
              loadBoard({ refreshExternal: true, showSpinner: true, boardId: data.id });
            }
          }
        })
        .catch(() => {});
    }

    // Handle browser back/forward
    function onPopState() {
      const p = new URLSearchParams(window.location.search);
      const bid = p.get("board");
      if (!bid) {
        setView("dashboard");
        setSelectedBoard(null);
      } else {
        apiFetch(`${API_BASE}/api/boards/${bid}`)
          .then((r) => r.ok ? r.json() : null)
          .then((data) => {
            if (data?.id) {
              setSelectedBoard(data);
              if (data.board_type === "kanban") {
                setView("kanban");
              } else {
                setView("board");
                loadBoard({ refreshExternal: false, showSpinner: true, boardId: data.id });
              }
            }
          })
          .catch(() => {});
      }
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key !== "Escape") {
        return;
      }

      setMenu(null);
      setItemAction(null);
      setDeleteConfirm(null);
      setLinkTypeMenu(null);
      setCommitMenu(null);
      setCommitResult(null);
      setJiraCreateNotice(null);
      setLinkMode(null);
      setSelectedTicketId(null);
      setResizeState(null);
      setError("");
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    async function loadJiraProjects() {
      setJiraProjectsLoading(true);
      try {
        const res = await apiFetch(`${API_BASE}/api/jira/projects`);
        if (!res.ok) {
          const body = await res.json();
          throw new Error(body.detail || "Could not load JIRA projects");
        }
        const data = await res.json();
        const projects = Array.isArray(data.projects) ? data.projects : [];
        setJiraProjects(projects);
        if (projects.length) {
          setTaskForm((prev) => ({
            ...prev,
            jira_project_key: prev.jira_project_key || projects[0].key,
          }));
        }
      } catch (e) {
        setError(e.message || "Could not load JIRA projects");
      } finally {
        setJiraProjectsLoading(false);
      }
    }

    if (
      menu?.type === "task" &&
      taskForm.source_mode === "new" &&
      taskForm.ticket_source === "jira" &&
      !jiraProjects.length &&
      !jiraProjectsLoading
    ) {
      loadJiraProjects();
    }
  }, [menu, taskForm.source_mode, taskForm.ticket_source, jiraProjects.length, jiraProjectsLoading]);

  // Load issue types when project key is set (new + jira mode)
  useEffect(() => {
    if (
      menu?.type === "task" &&
      taskForm.source_mode === "new" &&
      taskForm.ticket_source === "jira" &&
      taskForm.jira_project_key
    ) {
      setJiraIssueTypesLoading(true);
      setJiraIssueTypes([]);
      apiFetch(`${API_BASE}/api/jira/projects/${taskForm.jira_project_key}/issue-types`)
        .then((r) => r.json())
        .then((data) => {
          const types = Array.isArray(data.issue_types) ? data.issue_types : [];
          setJiraIssueTypes(types);
          if (types.length) {
            setTaskForm((prev) => ({ ...prev, jira_issue_type: prev.jira_issue_type || types[0].name }));
          }
        })
        .catch(() => setJiraIssueTypes([]))
        .finally(() => setJiraIssueTypesLoading(false));
    } else {
      setJiraIssueTypes([]);
    }
  }, [menu?.type, taskForm.source_mode, taskForm.ticket_source, taskForm.jira_project_key]);

  // Load "service" field options when MAP project is selected
  useEffect(() => {
    const isMap = taskForm.jira_project_key.toUpperCase() === "MAP";
    if (
      menu?.type === "task" &&
      taskForm.source_mode === "new" &&
      taskForm.ticket_source === "jira" &&
      isMap
    ) {
      setJiraServiceLoading(true);
      setJiraServiceOptions([]);
      apiFetch(
        `${API_BASE}/api/jira/field-options?project_key=MAP&issue_type=Task&field_name=service`
      )
        .then((r) => r.json())
        .then((data) => {
          setJiraServiceOptions(Array.isArray(data.options) ? data.options : []);
          if (data.field_key) setJiraServiceFieldKey(data.field_key);
        })
        .catch(() => setJiraServiceOptions([]))
        .finally(() => setJiraServiceLoading(false));
    } else {
      setJiraServiceOptions([]);
      setTaskForm((prev) => ({ ...prev, jira_service: "" }));
    }
  }, [menu?.type, taskForm.source_mode, taskForm.ticket_source, taskForm.jira_project_key]);

  useEffect(() => {
    resizeStateRef.current = resizeState;
  }, [resizeState]);

  useEffect(() => {
    function updateLinkPaths() {
      const container = boardWrapRef.current;
      if (!container) {
        setLinkPaths([]);
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const scrollLeft = container.scrollLeft;
      const scrollTop = container.scrollTop;

      setLinkCanvas({
        width: container.scrollWidth,
        height: container.scrollHeight,
        scrollLeft,
        scrollTop,
      });

      const nextPaths = (board.links || [])
        .map((link) => {
          const sourceEl = container.querySelector(`[data-ticket-id="${link.source_item_id}"]`);
          const targetEl = container.querySelector(`[data-ticket-id="${link.target_item_id}"]`);
          if (!sourceEl || !targetEl) {
            return null;
          }

          const sourceRect = sourceEl.getBoundingClientRect();
          const targetRect = targetEl.getBoundingClientRect();
          const rawFromX = sourceRect.right - containerRect.left + scrollLeft;
          const rawFromY = sourceRect.top + sourceRect.height / 2 - containerRect.top + scrollTop;
          const rawToX = targetRect.left - containerRect.left + scrollLeft;
          const rawToY = targetRect.top + targetRect.height / 2 - containerRect.top + scrollTop;

          const viewportLeft = scrollLeft;
          const viewportRight = scrollLeft + container.clientWidth;
          const viewportTop = scrollTop;
          const viewportBottom = scrollTop + container.clientHeight;

          const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

          // Clamp to viewport so links stay visible when one endpoint is off-screen.
          const fromX = clamp(rawFromX, viewportLeft, viewportRight);
          const fromY = clamp(rawFromY, viewportTop, viewportBottom);
          const toX = clamp(rawToX, viewportLeft, viewportRight);
          const toY = clamp(rawToY, viewportTop, viewportBottom);
          const controlOffset = Math.max(40, Math.abs(toX - fromX) / 3);
          const d = `M ${fromX} ${fromY} C ${fromX + controlOffset} ${fromY}, ${toX - controlOffset} ${toY}, ${toX} ${toY}`;

          return {
            id: link.id,
            linkType: link.link_type,
            sourceItemId: link.source_item_id,
            targetItemId: link.target_item_id,
            d,
            midX: (fromX + toX) / 2,
            midY: (fromY + toY) / 2,
          };
        })
        .filter(Boolean);

      setLinkPaths(nextPaths);
    }

    updateLinkPaths();
    window.addEventListener("resize", updateLinkPaths);
    const container = boardWrapRef.current;
    if (container) {
      container.addEventListener("scroll", updateLinkPaths);
    }

    return () => {
      window.removeEventListener("resize", updateLinkPaths);
      if (container) {
        container.removeEventListener("scroll", updateLinkPaths);
      }
    };
  }, [board.items, board.links, loading]);

  function getLinkStyle(linkType) {
    if (linkType === "blocks" || linkType === "is blocked by") {
      return { stroke: "#dc2626", dasharray: "0" };
    }
    if (linkType === "depends on" || linkType === "is dependant") {
      return { stroke: "#ea580c", dasharray: "8 6" };
    }
    if (linkType === "is worklog for" || linkType === "has worklog in") {
      return { stroke: "#8b5cf6", dasharray: "5 3" };
    }
    if (linkType === "external link") {
      return { stroke: "#059669", dasharray: "4 4" };
    }
    return { stroke: "#2563eb", dasharray: "3 5" };
  }

  function onBoardCellClick(event, rowIndex, slot, hasTeamAssignment) {
    event.stopPropagation();
    if (rowIndex === 0) {
      setMenu({ type: "milestone", x: event.clientX, y: event.clientY, rowIndex, slot });
      const selectedDate = slotToDate(board.months, slot);
      setForm({ issue_key: "", target_date: selectedDate, end_date: selectedDate });
      return;
    }

    if (hasTeamAssignment) {
      setMenu({ type: "task", x: event.clientX, y: event.clientY, rowIndex, slot });
      const selectedDate = slotToDate(board.months, slot);
      setTaskForm({
        source_mode: "existing",
        ticket_source: "jira",
        jira_project_key: "",
        jira_issue_type: "",
        jira_service: "",
        title: "",
        issue_key: "",
        row_index: rowIndex,
        start_slot: slot,
        end_slot: slot,
        start_date: selectedDate,
        end_date: selectedDate,
      });
      return;
    }

    setMenu({ type: "team-required", x: event.clientX, y: event.clientY, rowIndex, slot });
  }

  function onTeamLabelClick(event, rowIndex) {
    if (rowIndex === 0) {
      return;
    }
    event.stopPropagation();
    const currentTeamCode = teamAssignments[rowIndex] || "";
    const selectedTeam = currentTeamCode ? TEAM_OPTION_BY_CODE[currentTeamCode] : null;
    setMenu({ type: "team", x: event.clientX, y: event.clientY, rowIndex });
    setTeamForm({
      rowIndex,
      teamCode: currentTeamCode,
      teamType: selectedTeam?.type || "technical",
      businessGroup: selectedTeam?.group || "All",
    });
  }

  function onItemDoubleClick(event, item) {
    event.preventDefault();
    event.stopPropagation();
    const boardStartDate = slotToBoardDate(board.months, item.start_slot);
    const boardEndDate = slotToBoardDate(board.months, item.end_slot);
    setItemAction({
      x: event.clientX,
      y: event.clientY,
      itemId: item.id,
      itemLabel: formatIssueKey(item) || item.title || "item",
      issueKey: formatIssueKey(item) || "N/A",
      assignee: item.jira_assignee || "Unassigned",
      shirtSize: item.jira_shirt_size || "N/A",
      status: item.jira_status || "N/A",
      description: item.jira_description || "No description",
      boardStartDate,
      boardEndDate,
    });
  }

  async function createMilestone(event) {
    event.preventDefault();
    setError("");
    try {
      const payload = {
        board_id: selectedBoard?.id,
        issue_key: form.issue_key || null,
        ticket_source: "jira",
        target_date: form.target_date,
        end_date: form.end_date,
        is_temp: !!form.is_temp,
      };
      if (form.is_temp) {
        payload.title = form.temp_title || null;
      }

      const res = await apiFetch(`${API_BASE}/api/milestones`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.detail || "Could not create milestone");
      }
      setMenu(null);
      setForm({ issue_key: "", target_date: "", end_date: "", is_temp: false, temp_title: "" });
      await loadBoard({ refreshExternal: false, showSpinner: false });
    } catch (e) {
      setError(e.message || "Could not create milestone");
    }
  }

  async function saveTeamAssignment(event) {
    event.preventDefault();
    if (teamForm.rowIndex === null) {
      return;
    }

    setError("");
    try {
      const res = await apiFetch(`${API_BASE}/api/team-assignments/${teamForm.rowIndex}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ board_id: selectedBoard?.id, team_code: teamForm.teamCode || null }),
      });

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.detail || "Could not save team assignment");
      }

      setMenu(null);
      await loadBoard({ refreshExternal: false, showSpinner: false });
    } catch (e) {
      setError(e.message || "Could not save team assignment");
    }
  }

  async function deleteTeamRow(rowIndex) {
    setError("");
    try {
      const boardId = selectedBoard?.id;
      // Count items on this row
      const rowItems = (board.items || []).filter((it) => it.row_index === rowIndex);
      if (rowItems.length > 0) {
        setConfirmDialog({
          message: `This row has ${rowItems.length} task(s). Clearing this row will permanently delete all tasks and their links.\n\nAre you sure?`,
          onConfirm: async () => {
            setConfirmDialog(null);
            try {
              const res = await apiFetch(`${API_BASE}/api/team-rows/${rowIndex}?board_id=${boardId}`, {
                method: "DELETE",
              });
              if (!res.ok) {
                const body = await res.json();
                throw new Error(body.detail || "Could not clear team row");
              }
              setMenu(null);
              await loadBoard({ refreshExternal: false, showSpinner: false });
            } catch (e2) {
              setError(e2.message || "Could not clear team row");
            }
          },
        });
        return;
      }
      const res = await apiFetch(`${API_BASE}/api/team-rows/${rowIndex}?board_id=${boardId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.detail || "Could not clear team row");
      }
      setMenu(null);
      await loadBoard({ refreshExternal: false, showSpinner: false });
    } catch (e) {
      setError(e.message || "Could not clear team row");
    }
  }

  async function deleteItem(itemId) {
    setError("");
    try {
      const res = await apiFetch(`${API_BASE}/api/items/${itemId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.detail || "Could not delete item");
      }
      setItemAction(null);
      setDeleteConfirm(null);
      await loadBoard({ refreshExternal: false, showSpinner: false });
    } catch (e) {
      setError(e.message || "Could not delete item");
    }
  }

  async function createTask(event) {
    event.preventDefault();
    setError("");
    try {
      const startSlotFromDate = dateToSlot(board.months, taskForm.start_date);
      const endSlotFromDate = dateToSlot(board.months, taskForm.end_date);

      if (startSlotFromDate === null || endSlotFromDate === null) {
        throw new Error("Task dates must be within the 4-month planning window");
      }
      if (endSlotFromDate < startSlotFromDate) {
        throw new Error("Task end date must be on or after start date");
      }

      const isMapProject =
        taskForm.source_mode === "new" &&
        taskForm.ticket_source === "jira" &&
        taskForm.jira_project_key.toUpperCase() === "MAP";

      const jiraExtraFields =
        isMapProject && taskForm.jira_service
          ? { [jiraServiceFieldKey]: { value: taskForm.jira_service } }
          : null;

      const payload = {
        board_id: selectedBoard?.id,
        title: taskForm.source_mode === "new" ? taskForm.title : "",
        issue_key: taskForm.source_mode === "existing" ? taskForm.issue_key || null : null,
        jira_project_key:
          taskForm.source_mode === "new" && taskForm.ticket_source === "jira" ? taskForm.jira_project_key || null : null,
        jira_issue_type:
          taskForm.source_mode === "new" && taskForm.ticket_source === "jira" ? taskForm.jira_issue_type || null : null,
        jira_extra_fields: jiraExtraFields,
        ticket_source: taskForm.ticket_source,
        row_index: taskForm.row_index,
        start_slot: startSlotFromDate,
        end_slot: endSlotFromDate,
      };

      const res = await apiFetch(`${API_BASE}/api/tasks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.detail || "Could not create task");
      }
      const body = await res.json();

      setMenu(null);
      setTaskForm({
        source_mode: "existing",
        ticket_source: "jira",
        jira_project_key: "",
        jira_issue_type: "",
        jira_service: "",
        title: "",
        issue_key: "",
        row_index: null,
        start_slot: 0,
        end_slot: 0,
        start_date: "",
        end_date: "",
      });
      setJiraServiceOptions([]);
      await loadBoard({ refreshExternal: false, showSpinner: false });
      if (body?.sync_failed) {
        setJiraCreateNotice({
          failed: true,
          system: body.system_label || "the ticket system",
          title: body.title,
        });
      } else if (body?.jira_created && body?.jira_created_issue_key) {
        setJiraCreateNotice({ system: "JIRA", issueKey: body.jira_created_issue_key });
      } else if (body?.ado_created && body?.ado_created_issue_key) {
        setJiraCreateNotice({ system: "ADO", issueKey: body.ado_created_issue_key });
      }
    } catch (e) {
      setError(e.message || "Could not create task");
    }
  }

  async function moveItem(itemId, rowIndex, startSlot, endSlot) {
    setError("");
    try {
      const res = await apiFetch(`${API_BASE}/api/items/${itemId}/move`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          row_index: rowIndex,
          start_slot: startSlot,
          end_slot: endSlot,
        }),
      });

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.detail || "Could not move item");
      }

      await loadBoard({ refreshExternal: false, showSpinner: false });
    } catch (e) {
      setError(e.message || "Could not move item");
    }
  }

  function getSlotFromClientX(clientX) {
    const container = boardWrapRef.current;
    if (!container) {
      return null;
    }

    const headers = Array.from(container.querySelectorAll("th.week-header"));
    if (!headers.length) {
      return null;
    }

    for (let i = 0; i < headers.length; i += 1) {
      const rect = headers[i].getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right) {
        return i;
      }
    }

    const firstRect = headers[0].getBoundingClientRect();
    const lastRect = headers[headers.length - 1].getBoundingClientRect();
    if (clientX < firstRect.left) {
      return 0;
    }
    if (clientX > lastRect.right) {
      return headers.length - 1;
    }

    return null;
  }

  function startResize(event, item, edge) {
    event.preventDefault();
    event.stopPropagation();
    setResizeState({
      itemId: item.id,
      rowIndex: item.row_index,
      edge,
      originalStart: item.start_slot,
      originalEnd: item.end_slot,
      draftStart: item.start_slot,
      draftEnd: item.end_slot,
    });
  }

  useEffect(() => {
    if (!resizeState) {
      return undefined;
    }

    function onMouseMove(event) {
      const slot = getSlotFromClientX(event.clientX);
      if (slot === null) {
        return;
      }

      setResizeState((prev) => {
        if (!prev) {
          return prev;
        }
        if (prev.edge === "left") {
          const nextStart = Math.min(Math.max(slot, 0), prev.draftEnd);
          return { ...prev, draftStart: nextStart };
        }
        const nextEnd = Math.max(Math.min(slot, 15), prev.draftStart);
        return { ...prev, draftEnd: nextEnd };
      });
    }

    function onMouseUp() {
      const current = resizeStateRef.current;
      if (!current) {
        setResizeState(null);
        return;
      }

      setResizeState(null);
      if (current.draftStart === current.originalStart && current.draftEnd === current.originalEnd) {
        return;
      }

      moveItem(current.itemId, current.rowIndex, current.draftStart, current.draftEnd);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [resizeState]);

  function onTicketDragStart(event, item) {
    if (linkMode) {
      event.preventDefault();
      return;
    }
    setDragState({ itemId: item.id });
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(item.id));
  }

  function onCellDragOver(event, rowIndex, slot, canDropRow) {
    if (!dragState || !canDropRow) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget({ rowIndex, slot });
  }

  async function onCellDrop(event, rowIndex, slot, canDropRow) {
    if (!dragState || !canDropRow) {
      return;
    }
    event.preventDefault();

    const item = (board.items || []).find((it) => it.id === dragState.itemId);
    if (!item) {
      setDropTarget(null);
      setDragState(null);
      return;
    }

    const span = item.end_slot - item.start_slot + 1;
    const maxStart = 15 - (span - 1);
    const nextStart = Math.max(0, Math.min(slot, maxStart));
    const nextEnd = nextStart + span - 1;

    setDropTarget(null);
    setDragState(null);

    if (item.row_index === rowIndex && item.start_slot === nextStart && item.end_slot === nextEnd) {
      return;
    }

    await moveItem(item.id, rowIndex, nextStart, nextEnd);
  }

  function beginLinkMode(itemId) {
    setItemAction(null);
    setLinkTypeMenu(null);
    setLinkMode({ sourceItemId: itemId });
  }

  function openLinkTypeMenu(event, targetItemId) {
    if (!linkMode || targetItemId === linkMode.sourceItemId) {
      return;
    }

    event.stopPropagation();

    // Detect cross-platform (JIRA <-> ADO) — auto-create as "external link"
    const sourceItem = board.items.find((i) => i.id === linkMode.sourceItemId);
    const targetItem = board.items.find((i) => i.id === targetItemId);
    const srcSource = (sourceItem?.ticket_source || "").toLowerCase();
    const tgtSource = (targetItem?.ticket_source || "").toLowerCase();
    const isCrossPlatform = (srcSource === "jira" && tgtSource === "ado") || (srcSource === "ado" && tgtSource === "jira");

    if (isCrossPlatform) {
      setLinkTypeMenu({ x: event.clientX, y: event.clientY, targetItemId });
      createLink("external link");
      return;
    }

    setLinkTypeMenu({
      x: event.clientX,
      y: event.clientY,
      targetItemId,
    });
    setLinkTypeDraft("relates to");
  }

  async function createLink(linkType) {
    if (!linkMode || !linkTypeMenu) {
      return;
    }

    setError("");
    try {
      const res = await apiFetch(`${API_BASE}/api/links`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          board_id: selectedBoard?.id,
          source_item_id: linkMode.sourceItemId,
          target_item_id: linkTypeMenu.targetItemId,
          link_type: linkType,
        }),
      });

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.detail || "Could not create link");
      }

      setLinkTypeMenu(null);
      setLinkMode(null);
      await loadBoard({ refreshExternal: false, showSpinner: false });
    } catch (e) {
      setError(e.message || "Could not create link");
    }
  }

  async function removeLink(linkId) {
    setError("");
    try {
      const res = await apiFetch(`${API_BASE}/api/links/${linkId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.detail || "Could not remove link");
      }

      await loadBoard({ refreshExternal: false, showSpinner: false });
    } catch (e) {
      setError(e.message || "Could not remove link");
    }
  }

  async function commitBoard() {
    setError("");
    try {
      const res = await apiFetch(`${API_BASE}/api/board/commit?board_id=${selectedBoard?.id}`, {
        method: "POST",
      });

      const body = await res.json();
      if (!res.ok) {
        const detail = body?.detail;
        if (detail?.issues && Array.isArray(detail.issues)) {
          throw new Error(detail.issues.join(" | "));
        }
        throw new Error(detail?.message || detail || "Could not commit board");
      }

      setCommitMenu(null);
      setCommitResult(body);
      await loadBoard({ refreshExternal: true, showSpinner: false });
    } catch (e) {
      setError(e.message || "Could not commit board");
    }
  }

  // ── Login / Register screen ──
  if (!auth) {
    return (
      <div style={{
        minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        background: "#f3f4f6",
      }}>
        <form onSubmit={handleAuthSubmit} style={{
          background: "#fff", borderRadius: 16, padding: "40px 36px", width: 380,
          boxShadow: "0 1px 3px rgba(0,0,0,0.08)", border: "1px solid #e5e7eb",
        }}>
          {logoutNotice && (
            <div style={{
              background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#15803d",
              borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 16,
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#15803d" strokeWidth="2"><path d="M20 6L9 17l-5-5"/></svg>
              You have been logged out successfully.
            </div>
          )}

          <h2 style={{ margin: "0 0 4px", fontSize: 22, color: "#111827", fontWeight: 700 }}>
            TaskWeave
          </h2>
          <p style={{ margin: "0 0 20px", fontSize: 13, color: "#6b7280" }}>
            {authMode === "login" ? "Sign in to your account" : "Create a new account"}
          </p>

          {/* Tab switcher */}
          <div style={{ display: "flex", marginBottom: 24, borderRadius: 8, overflow: "hidden", border: "1px solid #e5e7eb" }}>
            <button type="button" onClick={() => { setAuthMode("login"); setAuthError(""); }}
              style={{
                flex: 1, padding: "10px 0", border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer",
                background: authMode === "login" ? "#1d4ed8" : "#f9fafb",
                color: authMode === "login" ? "#fff" : "#6b7280",
                transition: "background 0.15s, color 0.15s",
              }}>
              Sign In
            </button>
            <button type="button" onClick={() => { setAuthMode("register"); setAuthError(""); }}
              style={{
                flex: 1, padding: "10px 0", border: "none", borderLeft: "1px solid #e5e7eb", fontSize: 13, fontWeight: 700, cursor: "pointer",
                background: authMode === "register" ? "#1d4ed8" : "#f9fafb",
                color: authMode === "register" ? "#fff" : "#6b7280",
                transition: "background 0.15s, color 0.15s",
              }}>
              Register
            </button>
          </div>

          {authMode === "register" ? (
            <label style={{ display: "block", marginBottom: 14 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Display Name</span>
              <input
                value={authForm.display_name}
                onChange={(e) => setAuthForm((p) => ({ ...p, display_name: e.target.value }))}
                placeholder="Juan Dela Cruz"
                required
                style={authInputStyle}
              />
            </label>
          ) : null}

          <label style={{ display: "block", marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Username</span>
            <input
              value={authForm.username}
              onChange={(e) => setAuthForm((p) => ({ ...p, username: e.target.value }))}
              placeholder="username"
              required
              autoFocus
              style={authInputStyle}
            />
          </label>

          <label style={{ display: "block", marginBottom: 20 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Password</span>
            <input
              type="password"
              value={authForm.password}
              onChange={(e) => setAuthForm((p) => ({ ...p, password: e.target.value }))}
              placeholder="••••••••"
              required
              style={authInputStyle}
            />
          </label>

          {authError ? (
            <div style={{
              background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c",
              borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 14,
            }}>
              {authError}
            </div>
          ) : null}

          <button type="submit" disabled={authLoading} style={{
            width: "100%", padding: "12px", borderRadius: 10, border: "none",
            background: "#1d4ed8", color: "#fff", fontWeight: 700, fontSize: 15,
            cursor: authLoading ? "wait" : "pointer", opacity: authLoading ? 0.7 : 1,
          }}>
            {authLoading ? "Please wait..." : authMode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>
      </div>
    );
  }

  if (view === "admin-users") {
    return (
      <AdminUsers
        apiFetch={apiFetch}
        currentUser={auth?.user}
        onLogout={handleLogout}
        onBack={() => setView("dashboard")}
        onProfile={() => setView("profile")}
        onIntegrations={() => setView("integrations")}
        onManageUsers={() => setView("admin-users")}
      />
    );
  }

  if (view === "profile" || view === "integrations") {
    return (
      <UserProfile
        key={view}
        initialTab={view === "integrations" ? "integrations" : "profile"}
        apiFetch={apiFetch}
        currentUser={auth?.user}
        onLogout={handleLogout}
        onBack={() => setView("dashboard")}
        onProfile={() => setView("profile")}
        onManageUsers={auth?.user?.role === "admin" ? () => setView("admin-users") : null}
        onIntegrations={() => setView("integrations")}
        onAuthUpdated={(updatedUser) => {
          const newAuth = { ...auth, user: { ...auth.user, ...updatedUser } };
          setStoredAuth(newAuth);
          setAuth(newAuth);
        }}
      />
    );
  }

  if (view === "dashboard") {
    return (
      <Dashboard
        onOpenBoard={(boardMeta) => {
          setSelectedBoard(boardMeta);
          if (boardMeta.board_type === "kanban") {
            setView("kanban");
          } else {
            setView("board");
            loadBoard({ refreshExternal: true, showSpinner: true, boardId: boardMeta.id });
          }
          window.history.pushState({ boardId: boardMeta.id }, "", `?board=${boardMeta.id}`);
        }}
        apiFetch={apiFetch}
        currentUser={auth?.user}
        onLogout={handleLogout}
        onManageUsers={auth?.user?.role === "admin" ? () => setView("admin-users") : null}
        onProfile={() => setView("profile")}
        onIntegrations={() => setView("integrations")}
      />
    );
  }

  if (view === "kanban" && selectedBoard) {
    return (
      <KanbanBoard
        board={selectedBoard}
        apiFetch={apiFetch}
        auth={auth}
        onLogout={handleLogout}
        onProfile={() => setView("profile")}
        onIntegrations={() => setView("integrations")}
        onManageUsers={auth?.user?.role === "admin" ? () => setView("admin-users") : null}
        onBack={() => {
          setView("dashboard");
          setSelectedBoard(null);
          window.history.pushState({}, "", window.location.pathname);
        }}
      />
    );
  }

  return (
    <div
      className="page"
      onClick={() => {
        if (menu) {
          setMenu(null);
        }
        if (itemAction) {
          setItemAction(null);
        }
        if (deleteConfirm) {
          setDeleteConfirm(null);
        }
        if (linkTypeMenu) {
          setLinkTypeMenu(null);
        }
        if (commitMenu) {
          setCommitMenu(null);
        }
        if (commitResult) {
          setCommitResult(null);
        }
        if (selectedTicketId) {
          setSelectedTicketId(null);
        }
      }}
    >
      {/* ── Navbar (EasyRetro-style two-row header) ── */}
      <div
        style={{
          margin: `calc(-1 * var(--page-gap))`,
          marginBottom: "0",
          background: "#ffffff",
          borderBottom: "1px solid #e5e7eb",
        }}
        onClick={(e) => e.stopPropagation()}
      >
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
              onClick={() => {
                setView("dashboard");
                window.history.pushState({}, "", window.location.pathname);
              }}
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
              {selectedBoard ? selectedBoard.name : ""}
            </span>
          </div>

          {/* Right — refresh + commit + avatar dropdown */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", justifyContent: "flex-end" }}>
            <span style={{ fontSize: "12px", color: "#9ca3af" }}>
              {lastExternalRefreshAt
                ? `Refreshed ${lastExternalRefreshAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                : ""}
            </span>
            <button
              type="button"
              className="board-refresh-button"
              onClick={refreshBoardFromSources}
              disabled={isRefreshingExternal}
              title="Refresh from JIRA/ADO"
            >
              {isRefreshingExternal ? "Refreshing…" : "↻ Refresh"}
            </button>
            <button
              type="button"
              className="board-commit-button"
              onClick={() => setCommitMenu({ open: true })}
              title="Verify and commit board"
            >
              Commit Board
            </button>
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
                      <button onClick={() => { setAvatarMenuOpen(false); setView("dashboard"); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 16px", border: "none", background: "none", fontSize: 13, color: "#374151", cursor: "pointer", textAlign: "left" }}
                        onMouseEnter={(e) => e.currentTarget.style.background = "#f3f4f6"} onMouseLeave={(e) => e.currentTarget.style.background = "none"}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
                        My Boards
                      </button>
                      <button onClick={() => { setAvatarMenuOpen(false); setView("profile"); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 16px", border: "none", background: "none", fontSize: 13, color: "#374151", cursor: "pointer", textAlign: "left" }}
                        onMouseEnter={(e) => e.currentTarget.style.background = "#f3f4f6"} onMouseLeave={(e) => e.currentTarget.style.background = "none"}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                        My Profile
                      </button>
                      <button onClick={() => { setAvatarMenuOpen(false); setView("integrations"); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 16px", border: "none", background: "none", fontSize: 13, color: "#374151", cursor: "pointer", textAlign: "left" }}
                        onMouseEnter={(e) => e.currentTarget.style.background = "#f3f4f6"} onMouseLeave={(e) => e.currentTarget.style.background = "none"}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                        Integrations
                      </button>
                      {auth?.user?.role === "admin" && (
                        <button onClick={() => { setAvatarMenuOpen(false); setView("admin-users"); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 16px", border: "none", background: "none", fontSize: 13, color: "#374151", cursor: "pointer", textAlign: "left" }}
                          onMouseEnter={(e) => e.currentTarget.style.background = "#f3f4f6"} onMouseLeave={(e) => e.currentTarget.style.background = "none"}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                          Manage Users
                        </button>
                      )}
                    </div>
                    <div style={{ borderTop: "1px solid #f3f4f6", padding: "6px 0" }}>
                      <button onClick={() => { setAvatarMenuOpen(false); handleLogout(); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 16px", border: "none", background: "none", fontSize: 13, color: "#ef4444", cursor: "pointer", textAlign: "left" }}
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

        {/* Row 2: PI Planning label (left) | legend + links (right) */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 28px", height: "40px",
        }}>
          {/* Left label */}
          <span style={{ fontSize: "13px", color: "#9ca3af", fontStyle: "italic" }}>
            {selectedBoard?.board_type === "kanban" ? "Kanban Board" : "PI Planning Board"}
            {selectedBoard?.start_date && selectedBoard?.end_date
              ? ` · ${selectedBoard.start_date.slice(0, 7)} to ${selectedBoard.end_date.slice(0, 7)}`
              : ""}
          </span>

          {/* Right — links toggle + legend + history */}
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <label className="link-toggle-switch" title="Show or hide link visuals">
              <span className="link-toggle-text">Links</span>
              <input
                type="checkbox"
                checked={showLinks}
                onChange={(e) => {
                  const next = e.target.checked;
                  setShowLinks(next);
                  if (!next) {
                    setLinkMode(null);
                    setLinkTypeMenu(null);
                  }
                }}
              />
              <span className="link-toggle-slider" />
            </label>
            <div style={{ position: "relative", display: "inline-block" }}>
              <button
                type="button"
                onClick={() => setShowLegend((v) => !v)}
                style={{
                  background: showLegend ? "#eff6ff" : "none",
                  border: showLegend ? "1px solid #bfdbfe" : "1px solid #e5e7eb",
                  color: showLegend ? "#1d4ed8" : "#6b7280",
                  borderRadius: "6px", fontSize: "12px", fontWeight: "600",
                  padding: "3px 10px", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: "5px",
                }}
                title="Toggle legend"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="12" y2="17"/></svg>
                Legend
              </button>
              {showLegend && (
                <div className="legend-popup" onClick={(e) => e.stopPropagation()}>
                  <div className="legend-popup-section">
                    <span className="legend-title-inline">Status</span>
                    <span className="legend-chip"><span className="legend-status-dot ticket-status-done" />Done</span>
                    <span className="legend-chip"><span className="legend-status-dot ticket-status-in-progress" />In Progress</span>
                    <span className="legend-chip"><span className="legend-status-dot ticket-status-blocked" />Blocked</span>
                    <span className="legend-chip"><span className="legend-status-dot ticket-status-todo" />To Do</span>
                    <span className="legend-chip"><span className="legend-status-dot ticket-status-design" />Design</span>
                    <span className="legend-chip"><span className="legend-status-dot ticket-status-ready" />Ready</span>
                    <span className="legend-chip"><span className="legend-status-dot ticket-status-icebox" />Icebox</span>
                  </div>
                  <div className="legend-popup-section">
                    <span className="legend-title-inline">Line</span>
                    <span className="legend-chip"><span className="legend-line legend-line-blocks" />blocks / is blocked by</span>
                    <span className="legend-chip"><span className="legend-line legend-line-worklog" />worklog</span>
                    <span className="legend-chip"><span className="legend-line legend-line-depends" />depends on / is dependant</span>
                    <span className="legend-chip"><span className="legend-line legend-line-relates" />relates to</span>
                    <span className="legend-chip"><span className="legend-line legend-line-external" />external link</span>
                  </div>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => { setShowActivity((v) => !v); if (!showActivity) loadActivity(); }}
              style={{
                background: showActivity ? "#eff6ff" : "none",
                border: showActivity ? "1px solid #bfdbfe" : "1px solid #e5e7eb",
                color: showActivity ? "#1d4ed8" : "#6b7280",
                borderRadius: "6px", fontSize: "12px", fontWeight: "600",
                padding: "3px 10px", cursor: "pointer",
                display: "flex", alignItems: "center", gap: "5px",
              }}
              title="Toggle change history"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              History
            </button>
            <button
              type="button"
              onClick={() => setShowGantt((v) => !v)}
              style={{
                background: showGantt ? "#eff6ff" : "none",
                border: showGantt ? "1px solid #bfdbfe" : "1px solid #e5e7eb",
                color: showGantt ? "#1d4ed8" : "#6b7280",
                borderRadius: "6px", fontSize: "12px", fontWeight: "600",
                padding: "3px 10px", cursor: "pointer",
                display: "flex", alignItems: "center", gap: "5px",
              }}
              title="Toggle Gantt chart view"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="6" x2="16" y2="6"/><line x1="8" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="14" y2="18"/></svg>
              Gantt
            </button>
          </div>
        </div>
      </div>

      {/* ── Activity drawer ── */}
      {showActivity && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed", top: 0, right: 0, bottom: 0,
            width: "320px", background: "#ffffff",
            borderLeft: "1px solid #e5e7eb",
            boxShadow: "-4px 0 20px rgba(0,0,0,0.08)",
            zIndex: 50, display: "flex", flexDirection: "column",
          }}
        >
          {/* Drawer header */}
          <div style={{ padding: "16px 18px 12px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontWeight: "700", fontSize: "14px", color: "#111827" }}>Change History</span>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <button
                type="button"
                onClick={loadActivity}
                style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", fontSize: "16px", padding: "2px 4px" }}
                title="Refresh"
              >↻</button>
              <button
                type="button"
                onClick={() => setShowActivity(false)}
                style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", fontSize: "18px", lineHeight: 1, padding: "2px 4px" }}
                title="Close"
              >×</button>
            </div>
          </div>
          {/* Event list */}
          <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
            {activityLog.length === 0 ? (
              <p style={{ color: "#9ca3af", fontSize: "13px", textAlign: "center", marginTop: "32px" }}>No changes yet.</p>
            ) : (
              activityLog.map((ev) => (
                <div key={ev.id} style={{ padding: "10px 18px", borderBottom: "1px solid #f9fafb" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "3px" }}>
                    <span style={{
                      fontSize: "11px", fontWeight: "700", color: "#1d4ed8",
                      background: "#eff6ff", borderRadius: "4px", padding: "1px 6px",
                      whiteSpace: "nowrap",
                    }}>{ev.action}</span>
                    <span style={{ fontSize: "11px", color: "#9ca3af", marginLeft: "auto", whiteSpace: "nowrap" }}>
                      {new Date(ev.created_at + "Z").toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  {ev.detail && (
                    <div style={{ fontSize: "12px", color: "#374151", wordBreak: "break-word" }}>{ev.detail}</div>
                  )}
                  <div style={{ fontSize: "11px", color: "#d1d5db", marginTop: "2px" }}>
                    {new Date(ev.created_at + "Z").toLocaleDateString([], { month: "short", day: "numeric" })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="error-overlay-backdrop" onClick={() => setError("")}>
          <div className="error-overlay" onClick={(e) => e.stopPropagation()}>
            <div className="error-overlay-icon">⚠️</div>
            <div className="error-overlay-message">{error}</div>
            <button className="error-overlay-close" onClick={() => setError("")}>Close</button>
          </div>
        </div>
      )}

      {/* ── Confirm dialog ── */}
      {confirmDialog && (
        <div className="error-overlay-backdrop" onClick={() => setConfirmDialog(null)}>
          <div className="error-overlay" onClick={(e) => e.stopPropagation()} style={{ borderColor: "#d1d5db" }}>
            <div className="error-overlay-icon">⚠️</div>
            <div className="error-overlay-message" style={{ color: "#374151", whiteSpace: "pre-line" }}>{confirmDialog.message}</div>
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

      {selectedTicketId || resizePreview || (showLinks && linkMode) ? (
        <div className="hud-stack" onClick={(e) => e.stopPropagation()}>
          {selectedTicketId ? (
            <div className="focus-banner banner-with-close">
              <span>Focus mode: {focusModeTicketLabel || "ticket"}</span>
              <button
                type="button"
                className="banner-close"
                onClick={() => {
                  setSelectedTicketId(null);
                }}
                title="Close"
                aria-label="Close focus mode banner"
              >
                X
              </button>
            </div>
          ) : null}

          {resizePreview ? (
            <div className="resize-preview">
              <strong>{resizePreview.label}</strong>
              <span>Start: {resizePreview.start}</span>
              <span>End: {resizePreview.end}</span>
            </div>
          ) : null}

          {showLinks && linkMode ? (
            <div className="link-mode-banner banner-with-close">
              <span>Link Mode: {linkModeSourceLabel}</span>
              <span>Click another tile, then choose link type.</span>
              <button
                type="button"
                className="banner-close"
                onClick={() => {
                  setLinkTypeMenu(null);
                  setLinkMode(null);
                }}
                title="Close"
                aria-label="Close link mode banner"
              >
                X
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {loading ? <div className="loading">Loading board...</div> : null}

      {!loading ? (
        <>
          {showGantt ? (
            /* ── Gantt Chart View ── */
            <div style={{ padding: "20px 28px", overflowX: "auto", fontFamily: "var(--font-family)" }}>
              {(() => {
                const months = board.months || [];
                const allSlots = months.flatMap((m) => m.slots);
                const totalSlots = allSlots.length;
                const items = (board.items || []).filter((t) => t.item_type === "TASK" && t.start_slot != null && t.end_slot != null);
                const teamAssigns = board.team_assignments || {};
                const rows = (board.rows || []).filter((r) => r.index > 0 && teamAssigns[r.index]);
                const colW = 100;
                const rowH = 40;
                const labelW = 160;
                const headerH = 56;
                const borderClr = "#d9dee6";
                const gridClr = "#e5e7eb";
                const panelBg = "#ffffff";
                const headerBg = "#f8fafc";

                // Group items by row
                const itemsByRow = {};
                for (const r of rows) itemsByRow[r.index] = [];
                for (const item of items) {
                  if (itemsByRow[item.row_index]) itemsByRow[item.row_index].push(item);
                }

                // Status color map — matches PI board badge palette
                const ganttColorMap = {
                  done: "#15803d", "in-progress": "#ea7a12", blocked: "#dc2626",
                  todo: "#64748b", design: "#d4a017", ready: "#d4a017",
                  icebox: "#dc2626", unknown: "#94a3b8",
                };
                const statusColor = (s) => ganttColorMap[getStatusTone(s)] || "#94a3b8";
                const statusText = (s) => { const t = getStatusTone(s); return t === "design" || t === "ready" ? "#422006" : "#fff"; };

                // Today line — find which slot "today" falls into
                const todayISO = new Date().toISOString().slice(0, 10);
                const todaySlot = dateToSlot(months, todayISO);
                const todayOffset = todaySlot != null ? (() => {
                  const parsed = new Date(`${todayISO}T00:00:00`);
                  const dayInWeek = ((parsed.getDate() - 1) % 7);
                  return todaySlot * colW + (dayInWeek / 7) * colW;
                })() : null;

                // Build a lookup for item positions (for dependency arrows)
                const itemPositions = {};

                // Dependency links between items on the Gantt
                const ganttLinks = (board.links || []).filter((link) => {
                  const src = items.find((i) => i.id === link.source_item_id);
                  const tgt = items.find((i) => i.id === link.target_item_id);
                  return src && tgt;
                });

                return (
                  <div style={{ position: "relative", background: panelBg, borderRadius: 8, border: `1px solid ${borderClr}`, overflow: "hidden" }}>
                    {/* Gantt header */}
                    <div style={{ display: "flex", position: "relative" }}>
                      <div style={{ minWidth: labelW, maxWidth: labelW, height: headerH, borderRight: `1px solid ${borderClr}`, background: headerBg, display: "flex", alignItems: "flex-end", padding: "0 12px 8px" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em" }}>Team</span>
                      </div>
                      <div style={{ display: "flex" }}>
                        {months.map((m, mi) => (
                          <div key={mi}>
                            <div style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: "#374151", padding: "6px 0 2px", borderBottom: `1px solid ${borderClr}`, width: m.slots.length * colW }}>
                              {m.name} {m.year}
                            </div>
                            <div style={{ display: "flex" }}>
                              {m.slots.map((s) => (
                                <div key={s.slot} style={{ width: colW, textAlign: "center", fontSize: 10, color: "#94a3b8", padding: "4px 0", borderRight: `1px solid ${gridClr}`, borderBottom: `1px solid ${borderClr}` }}>
                                  {s.label}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Gantt rows */}
                    {rows.map((row) => {
                      const rowItems = itemsByRow[row.index] || [];
                      const teamCode = teamAssigns[row.index];
                      const teamName = teamCode || row.label;
                      // Stack overlapping items
                      const lanes = [];
                      for (const item of rowItems) {
                        let placed = false;
                        for (const lane of lanes) {
                          if (lane.every((li) => li.end_slot < item.start_slot || li.start_slot > item.end_slot)) {
                            lane.push(item);
                            placed = true;
                            break;
                          }
                        }
                        if (!placed) lanes.push([item]);
                      }
                      const laneCount = Math.max(lanes.length, 1);
                      const rH = laneCount * rowH;

                      return (
                        <div key={row.index} style={{ display: "flex", borderBottom: `1px solid ${gridClr}` }}>
                          <div style={{
                            minWidth: labelW, maxWidth: labelW, height: rH,
                            display: "flex", alignItems: "center", padding: "0 12px",
                            borderRight: `1px solid ${borderClr}`, background: headerBg,
                          }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: "#1f2937", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{teamName}</span>
                          </div>
                          <div style={{ position: "relative", width: totalSlots * colW, height: rH }}>
                            {/* Grid lines */}
                            {allSlots.map((s) => (
                              <div key={s.slot} style={{
                                position: "absolute", left: s.slot * colW, top: 0,
                                width: colW, height: "100%",
                                borderRight: `1px solid ${gridClr}`,
                              }} />
                            ))}
                            {/* Today line per row */}
                            {todayOffset != null && (
                              <div style={{
                                position: "absolute", left: todayOffset, top: 0,
                                width: 0, height: "100%",
                                borderLeft: "1px dashed #ef4444",
                                zIndex: 5, pointerEvents: "none",
                              }} />
                            )}
                            {/* Task bars */}
                            {lanes.map((lane, li) =>
                              lane.map((item) => {
                                const left = item.start_slot * colW + 4;
                                const width = (item.end_slot - item.start_slot + 1) * colW - 8;
                                const top = li * rowH + 6;
                                const barH = rowH - 12;
                                // Record position for dependency arrows
                                const rowOffset = rows.slice(0, rows.findIndex((r) => r.index === item.row_index)).reduce((sum, r2) => {
                                  const ri = itemsByRow[r2.index] || [];
                                  const lns = [];
                                  for (const it of ri) {
                                    let pl = false;
                                    for (const ln of lns) { if (ln.every((x) => x.end_slot < it.start_slot || x.start_slot > it.end_slot)) { ln.push(it); pl = true; break; } }
                                    if (!pl) lns.push([it]);
                                  }
                                  return sum + Math.max(lns.length, 1) * rowH;
                                }, 0);
                                itemPositions[item.id] = {
                                  rightX: left + width,
                                  leftX: left,
                                  centerY: rowOffset + top + barH / 2,
                                };
                                return (
                                  <div key={item.id} title={`${item.issue_key || ""} ${item.title}\nStatus: ${item.jira_status || "N/A"}\nAssignee: ${item.jira_assignee || "N/A"}`}
                                    style={{
                                      position: "absolute", left, top, width, height: barH,
                                      background: statusColor(item.jira_status),
                                      borderRadius: 4, cursor: "pointer",
                                      display: "flex", alignItems: "center", padding: "0 8px",
                                      overflow: "hidden", boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
                                      transition: "opacity 0.15s",
                                    }}
                                    onClick={() => setSelectedTicketId(item.id)}
                                    onMouseEnter={(e) => e.currentTarget.style.opacity = "0.85"}
                                    onMouseLeave={(e) => e.currentTarget.style.opacity = "1"}
                                  >
                                    <span style={{
                                      fontSize: 11, fontWeight: 600, color: statusText(item.jira_status),
                                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                                    }}>
                                      {item.issue_key ? `${item.issue_key} · ` : ""}{item.title}
                                    </span>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {/* Dependency arrows (SVG overlay) — respects showLinks toggle */}
                    {showLinks && ganttLinks.length > 0 && (
                      <svg style={{ position: "absolute", top: headerH, left: labelW, width: totalSlots * colW, height: rows.reduce((sum, r) => {
                        const ri = itemsByRow[r.index] || [];
                        const lns = [];
                        for (const it of ri) { let pl = false; for (const ln of lns) { if (ln.every((x) => x.end_slot < it.start_slot || x.start_slot > it.end_slot)) { ln.push(it); pl = true; break; } } if (!pl) lns.push([it]); }
                        return sum + Math.max(lns.length, 1) * rowH;
                      }, 0), pointerEvents: "none", overflow: "visible" }}>
                        <defs>
                          <marker id="ganttArrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
                            <path d="M0,0 L0,6 L8,3 z" fill="#64748b" />
                          </marker>
                        </defs>
                        {ganttLinks.map((link) => {
                          const src = itemPositions[link.source_item_id];
                          const tgt = itemPositions[link.target_item_id];
                          if (!src || !tgt) return null;
                          const x1 = src.rightX;
                          const y1 = src.centerY;
                          const x2 = tgt.leftX;
                          const y2 = tgt.centerY;
                          const mx = (x1 + x2) / 2;
                          const style = getLinkStyle(link.link_type);
                          return (
                            <path key={link.id} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                              stroke={style.stroke} strokeWidth="1" fill="none"
                              strokeDasharray={style.dasharray} markerEnd="url(#ganttArrow)" opacity="0.7" />
                          );
                        })}
                      </svg>
                    )}

                    {/* Milestones row */}
                    {(() => {
                      const milestones = (board.items || []).filter((t) => t.item_type === "IDEA" && t.start_slot != null);
                      if (!milestones.length) return null;
                      const msRowH = Math.max(milestones.length * 28 + 8, rowH);
                      return (
                        <div style={{ display: "flex", borderBottom: `1px solid ${gridClr}` }}>
                          <div style={{
                            minWidth: labelW, maxWidth: labelW, height: msRowH,
                            display: "flex", alignItems: "center", padding: "0 12px",
                            borderRight: `1px solid ${borderClr}`, background: "#fffbeb",
                          }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: "#92400e" }}>Milestones</span>
                          </div>
                          <div style={{ position: "relative", width: totalSlots * colW, height: msRowH }}>
                            {allSlots.map((s) => (
                              <div key={s.slot} style={{
                                position: "absolute", left: s.slot * colW, top: 0,
                                width: colW, height: "100%",
                                borderRight: `1px solid ${gridClr}`,
                              }} />
                            ))}
                            {/* Today line in milestones */}
                            {todayOffset != null && (
                              <div style={{
                                position: "absolute", left: todayOffset, top: 0,
                                width: 0, height: "100%",
                                borderLeft: "1px dashed #ef4444",
                                zIndex: 5, pointerEvents: "none",
                              }} />
                            )}
                            {milestones.map((ms, mi) => {
                              const cx = ms.start_slot * colW + colW / 2;
                              const myTop = mi * 28 + 4;
                              return (
                                <div key={ms.id} style={{ position: "absolute", left: cx - 8, top: myTop, display: "flex", alignItems: "center", cursor: "pointer" }}
                                  title={`${ms.issue_key || ""} ${ms.title}`}
                                  onClick={() => setSelectedTicketId(ms.id)}
                                >
                                  <div style={{
                                    width: 14, height: 14, background: "#f59e0b",
                                    transform: "rotate(45deg)", borderRadius: 2, flexShrink: 0,
                                    boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                                  }} />
                                  <span style={{
                                    marginLeft: 12, fontSize: 11, fontWeight: 600, color: "#92400e",
                                    whiteSpace: "nowrap", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis",
                                  }}>
                                    {ms.issue_key ? `${ms.issue_key} · ` : ""}{ms.title}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Today badge below the board */}
                    {todayOffset != null && (
                      <div style={{ position: "relative", height: 18, marginLeft: labelW }}>
                        <div style={{
                          position: "absolute", left: todayOffset - 1, top: 0,
                          display: "flex", flexDirection: "column", alignItems: "center",
                          pointerEvents: "none",
                        }}>
                          <div style={{
                            fontSize: 9, fontWeight: 700, color: "#fff", background: "#ef4444",
                            padding: "1px 5px", borderRadius: 3, whiteSpace: "nowrap", marginTop: 2,
                          }}>Today</div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          ) : (
          <div className="board-wrap" ref={boardWrapRef}>
            {shouldRenderLinkLayer ? (
            <svg
              className="link-layer"
              width={Math.max(linkCanvas.width, 1)}
              height={Math.max(linkCanvas.height, 1)}
              aria-hidden="true"
            >
              <defs>
                <marker id="linkArrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L0,6 L8,3 z" fill="#334155" />
                </marker>
              </defs>
              {linkPaths
                .filter((path) => {
                  if (showLinks) {
                    return true;
                  }
                  if (!selectedTicketId) {
                    return false;
                  }
                  return highlightedTicketIds.has(path.sourceItemId) && highlightedTicketIds.has(path.targetItemId);
                })
                .map((path) => {
                const style = getLinkStyle(path.linkType);
                const isFocused =
                  !selectedTicketId ||
                  (highlightedTicketIds.has(path.sourceItemId) && highlightedTicketIds.has(path.targetItemId));
                return (
                  <g key={path.id}>
                    <path
                      d={path.d}
                      stroke={style.stroke}
                      strokeDasharray={style.dasharray}
                      strokeWidth="1"
                      fill="none"
                      markerEnd="url(#linkArrow)"
                      className={`link-path ${isFocused ? "link-path-focused" : "link-path-dim"}`}
                      onClick={(e) => {
                        if (!showLinks) {
                          return;
                        }
                        e.stopPropagation();
                        removeLink(path.id);
                      }}
                    />
                    <text x={path.midX} y={path.midY - 6} className="link-label">
                      {path.linkType}
                    </text>
                  </g>
                );
              })}
            </svg>
          ) : null}
          <table className="board" style={{
              width: `max(100%, calc(${1 + monthHeaders.length * 4} * var(--week-col-width)))`,
              minWidth: `calc(${1 + monthHeaders.length * 4} * var(--week-col-width))`,
            }}>
            <colgroup>
              <col className="board-col" />
              {monthHeaders.flatMap((month) =>
                month.slots.map((slot) => (
                  <col key={`col-${slot.slot}`} className="board-col" />
                ))
              )}
            </colgroup>
            <thead>
              <tr>
                <th className="left-col">&nbsp;</th>
                {monthHeaders.map((month) => (
                  <th key={`${month.name}-${month.year}`} colSpan={4} className="month-header">
                    {month.name}
                  </th>
                ))}
              </tr>
              <tr>
                <th className="left-col">&nbsp;</th>
                {monthHeaders.flatMap((month) =>
                  month.slots.map((slot) => (
                    <th key={slot.slot} className="week-header">
                      {slot.label}
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {rowsToRender.map((row) => {
                const assignedTeamCode = teamAssignments[row.index];
                const assignedTeamMeta = assignedTeamCode ? TEAM_OPTION_BY_CODE[assignedTeamCode] : null;
                const isTeamRow = row.index !== 0;
                const isTeamMissing = isTeamRow && !assignedTeamCode;
                const isTechnicalRow = isTeamRow && assignedTeamMeta?.type === "technical";
                const isBusinessRow = isTeamRow && assignedTeamMeta?.type === "business";
                const isImpactedRow = selectedTicketId ? impactedRowIndexes.has(row.index) : false;
                const draggedItem = dragState ? (board.items || []).find((it) => it.id === dragState.itemId) : null;
                const canDropToRow = draggedItem
                  ? draggedItem.item_type === "IDEA"
                    ? row.index === 0
                    : row.index !== 0 && Boolean(assignedTeamCode)
                  : false;
                const assignedTeamName = assignedTeamCode ? TEAM_NAME_MAP[assignedTeamCode] : "";
                const laneCount = rowLaneCount[row.index] || 1;

                return (
                  <tr
                    key={row.index}
                    className={`${isTechnicalRow ? "technical-row" : ""} ${isBusinessRow ? "business-row" : ""} ${isTeamMissing ? "team-row-missing" : ""} ${isImpactedRow ? "impacted-row" : ""}`.trim()}
                    style={{ "--lane-count": laneCount }}
                  >
                    <td
                      className={`left-col row-label ${isTeamRow ? "row-label-clickable" : ""}`.trim()}
                      onClick={(e) => onTeamLabelClick(e, row.index)}
                      title={isTeamRow ? (assignedTeamName || "Left-click to add team") : "Milestone"}
                      style={{ position: "relative" }}
                    >
                      {row.index === 0 ? row.label : assignedTeamCode || "Left-click to add team"}
                      {isTeamMissing && row.index === rowsToRender[rowsToRender.length - 1].index ? (
                        <button
                          type="button"
                          className="row-delete-btn"
                          title="Remove this empty row"
                          onClick={(e) => {
                            e.stopPropagation();
                            setVisibleTeamRows((prev) => Math.max(1, prev - 1));
                          }}
                        >
                          ×
                        </button>
                      ) : null}
                    </td>
                    {Array.from({ length: 16 }).map((_, slot) => {
                      const itemsStarting = board.items.filter((it) => it.row_index === row.index && slot === it.start_slot);
                      return (
                        <td
                          key={`${row.index}-${slot}`}
                          className={`cell ${row.index === 0 ? "milestone-cell" : ""} ${isTeamMissing ? "team-cell-disabled" : ""} ${dropTarget?.rowIndex === row.index && dropTarget?.slot === slot ? "drop-target" : ""}`.trim()}
                          title={isTeamMissing ? "Please add team first" : undefined}
                          onClick={(e) => onBoardCellClick(e, row.index, slot, Boolean(assignedTeamCode))}
                          onDragOver={(e) => onCellDragOver(e, row.index, slot, canDropToRow)}
                          onDrop={(e) => onCellDrop(e, row.index, slot, canDropToRow)}
                        >
                          <div className="cell-stack">
                            {itemsStarting.map((item) => (
                              (() => {
                                const itemSpan = item.end_slot - item.start_slot + 1;
                                const isLinkSource = Boolean(linkMode && linkMode.sourceItemId === item.id);
                                const isLinkModeActive = Boolean(showLinks && linkMode);
                                const showLinkStartButton = Boolean(showLinks && !linkMode && hoveredTileId === item.id);
                                const hasSelection = Boolean(selectedTicketId);
                                const isHighlighted = hasSelection ? highlightedTicketIds.has(item.id) : false;
                                return (
                              <div
                                key={item.id}
                                className={`ticket ticket-source-${(item.ticket_source || "manual").toLowerCase()} ticket-status-${getStatusTone(item.jira_status)} ${isLinkModeActive ? "ticket-link-mode" : ""} ${isLinkSource ? "ticket-link-source" : ""} ${hasSelection ? (isHighlighted ? "ticket-highlighted" : "ticket-dimmed") : ""}`.trim()}
                                data-ticket-id={item.id}
                                draggable={!linkMode && !resizeState}
                                style={{
                                  backgroundColor: getTileColor(item),
                                  "--span": item.end_slot - item.start_slot + 1,
                                  "--lane": itemLayout[item.id]?.lane ?? 0,
                                  "--offset-start": 0,
                                }}
                                onClick={(e) => {
                                  if (!showLinks || !linkMode) {
                                    e.stopPropagation();
                                    setSelectedTicketId((prev) => (prev === item.id ? null : item.id));
                                    return;
                                  }
                                  if (isLinkSource) {
                                    return;
                                  }
                                  openLinkTypeMenu(e, item.id);
                                }}
                                onDragStart={(e) => onTicketDragStart(e, item)}
                                onDragEnd={() => {
                                  setDropTarget(null);
                                  setDragState(null);
                                }}
                                onMouseEnter={() => setHoveredTileId(item.id)}
                                onMouseLeave={() => setHoveredTileId((prev) => (prev === item.id ? null : prev))}
                                onDoubleClick={(e) => onItemDoubleClick(e, item)}
                              >
                                <div className="resize-handle resize-handle-left" onMouseDown={(e) => startResize(e, item, "left")} />
                                <div className="resize-handle resize-handle-right" onMouseDown={(e) => startResize(e, item, "right")} />
                                <div className="ticket-status-dot" title={item.jira_status || "N/A"} />
                                {(item.sync_status === "sync_failed" || item.sync_status === "unsynced") ? (
                                  <div
                                    title="This task was saved locally but could not be created in the ticket system. Please create the ticket manually and link it here."
                                    style={{
                                      position: "absolute",
                                      bottom: 3,
                                      right: 6,
                                      fontSize: "9px",
                                      fontWeight: 700,
                                      color: "#fff",
                                      background: "#b45309",
                                      borderRadius: 3,
                                      padding: "1px 4px",
                                      lineHeight: 1.4,
                                      letterSpacing: "0.02em",
                                      pointerEvents: "none",
                                      zIndex: 2,
                                    }}
                                  >
                                    UNSYNCED
                                  </div>
                                ) : null}
                                {showLinkStartButton ? (
                                  <button
                                    type="button"
                                    className="link-circle trigger"
                                    title="Start linking from this tile"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      beginLinkMode(item.id);
                                    }}
                                  >
                                    +
                                  </button>
                                ) : null}
                                {isLinkModeActive ? (
                                  <div className={`link-circle ${isLinkSource ? "source" : "target"}`} title={isLinkSource ? "Link source" : "Click to link here"}>
                                    {isLinkSource ? "" : "+"}
                                  </div>
                                ) : null}
                                <strong>{truncateSummaryBySpan(getTicketLabel(item), itemSpan)}</strong>
                                <span title={item.title}>{truncateSummaryBySpan(item.title, itemSpan)}</span>
                                {getTicketMetaLine(item) ? (
                                  <div className="ticket-meta" title={getTicketMetaLine(item)}>
                                    {truncateSummaryBySpan(getTicketMetaLine(item), itemSpan)}
                                  </div>
                                ) : null}
                              </div>
                                );
                              })()
                            ))}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
            {visibleTeamRows < maxTeamRows ? (
              <div className="board-actions">
              <div
                className="add-row-button"
                onClick={() => setVisibleTeamRows((prev) => Math.min(prev + 1, maxTeamRows))}
                title="Add row"
                aria-label="Add one more team row"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setVisibleTeamRows((prev) => Math.min(prev + 1, maxTeamRows));
                  }
                }}
              >
                + Add Row
              </div>
              </div>
            ) : null}
          </div>
          )}
        </>
      ) : null}

      {menu?.type === "milestone" ? (
        <div
          onClick={() => setMenu(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
          }}
        >
          <div onClick={(e) => e.stopPropagation()}>
          <form onSubmit={createMilestone} className="form">
            <h3>Add IDEA Milestone</h3>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 4 }}>
              <input
                type="checkbox"
                checked={!!form.is_temp}
                onChange={(e) => setForm((prev) => ({ ...prev, is_temp: e.target.checked }))}
                style={{ width: 16, height: 16, accentColor: "#b45309" }}
              />
              <span style={{ fontSize: 13, fontWeight: 600, color: "#b45309" }}>Temp / Unsynced (no JIRA fetch)</span>
            </label>
            {form.is_temp ? (
              <>
                <label>
                  Title
                  <input
                    value={form.temp_title || ""}
                    onChange={(e) => setForm((prev) => ({ ...prev, temp_title: e.target.value }))}
                    placeholder="Milestone title"
                    required
                  />
                </label>
                <label>
                  IDEA Key (optional)
                  <input
                    value={form.issue_key}
                    onChange={(e) => setForm((prev) => ({ ...prev, issue_key: e.target.value.toUpperCase() }))}
                    placeholder="IDEA-123"
                  />
                </label>
              </>
            ) : (
              <label>
                IDEA Ticket Key (JIRA)
                <input
                  value={form.issue_key}
                  onChange={(e) => setForm((prev) => ({ ...prev, issue_key: e.target.value.toUpperCase() }))}
                  placeholder="IDEA-123"
                  required
                />
              </label>
            )}
            <div className="date-row">
              <label className="date-field">
                Target Date
                <input
                  type="date"
                  value={form.target_date}
                  onChange={(e) => setForm((prev) => ({ ...prev, target_date: e.target.value }))}
                  required
                />
              </label>
              <label className="date-field">
                End Date
                <input
                  type="date"
                  value={form.end_date}
                  onChange={(e) => setForm((prev) => ({ ...prev, end_date: e.target.value }))}
                  required
                />
              </label>
            </div>
            <div className="actions">
              <button type="button" onClick={() => setMenu(null)} style={{
                padding: "10px 20px", borderRadius: "8px",
                border: "1px solid #d1d5db", background: "white",
                cursor: "pointer", fontWeight: "500", fontSize: "14px", color: "#374151",
              }}>
                Cancel
              </button>
              <button type="submit" style={{
                padding: "10px 20px", borderRadius: "8px", border: "none",
                background: "#1d4ed8", color: "white",
                cursor: "pointer", fontWeight: "700", fontSize: "14px",
              }}>
                Save
              </button>
            </div>
          </form>
          </div>
        </div>
      ) : null}

      {menu?.type === "team" ? (
        <div
          onClick={() => setMenu(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
          }}
        >
          <div onClick={(e) => e.stopPropagation()}>
          <form onSubmit={saveTeamAssignment} className="form">
            <h3>Assign Team</h3>
            <label>
              Team Type
              <div className="team-type-row">
                <label className="team-type-option">
                  <input
                    type="radio"
                    name="teamType"
                    value="technical"
                    checked={teamForm.teamType === "technical"}
                    onChange={() => setTeamForm((prev) => ({ ...prev, teamType: "technical", teamCode: "" }))}
                  />
                  Technical
                </label>
                <label className="team-type-option">
                  <input
                    type="radio"
                    name="teamType"
                    value="business"
                    checked={teamForm.teamType === "business"}
                    onChange={() =>
                      setTeamForm((prev) => ({
                        ...prev,
                        teamType: "business",
                        businessGroup: prev.businessGroup || "All",
                        teamCode: "",
                      }))
                    }
                  />
                  Business
                </label>
              </div>
            </label>
            {teamForm.teamType === "business" ? (
              <label>
                Business Group
                <select
                  value={teamForm.businessGroup}
                  onChange={(e) => setTeamForm((prev) => ({ ...prev, businessGroup: e.target.value, teamCode: "" }))}
                >
                  <option value="All">All</option>
                  {BUSINESS_GROUP_OPTIONS.map((group) => (
                    <option key={group} value={group}>
                      {group}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label>
              Team Code
              <select value={teamForm.teamCode} onChange={(e) => setTeamForm((prev) => ({ ...prev, teamCode: e.target.value }))}>
                <option value="" title="Clear assignment for this row">
                  No team assigned
                </option>
                {teamOptions.map((team) => (
                  <option key={team.code} value={team.code} title={team.name}>
                    {team.code}
                  </option>
                ))}
              </select>
            </label>
            {teamForm.teamCode ? <div className="team-hint">{TEAM_NAME_MAP[teamForm.teamCode]}</div> : null}
            {teamAssignments[teamForm.rowIndex] ? (
              <button
                type="button"
                onClick={() => deleteTeamRow(teamForm.rowIndex)}
                style={{
                  padding: "8px 16px", borderRadius: "8px",
                  border: "1px solid #dc2626", background: "#fef2f2",
                  cursor: "pointer", fontWeight: "600", fontSize: "13px", color: "#dc2626",
                  width: "100%", marginTop: 4,
                }}
              >
                Clear Row (remove team &amp; all tasks)
              </button>
            ) : null}
            <div className="actions">
              <button type="button" onClick={() => setMenu(null)} style={{
                padding: "10px 20px", borderRadius: "8px",
                border: "1px solid #d1d5db", background: "white",
                cursor: "pointer", fontWeight: "500", fontSize: "14px", color: "#374151",
              }}>
                Cancel
              </button>
              <button type="submit" style={{
                padding: "10px 20px", borderRadius: "8px", border: "none",
                background: "#1d4ed8", color: "white",
                cursor: "pointer", fontWeight: "700", fontSize: "14px",
              }}>
                Apply
              </button>
            </div>
          </form>
          </div>
        </div>
      ) : null}

      {menu?.type === "task" ? (
        <div
          onClick={() => setMenu(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
          }}
        >
          <div onClick={(e) => e.stopPropagation()}>
          <form onSubmit={createTask} className="form">
            <h3>Add Task</h3>
            <label>Source</label>
            <div style={{ display: "flex", marginBottom: 16, borderRadius: 8, overflow: "hidden", border: "1px solid #e5e7eb" }}>
              {[
                { key: "existing", label: "Existing" },
                { key: "new", label: "New" },
              ].map((m) => (
                <button key={m.key} type="button" onClick={() => {
                  if (m.key === "existing") setTaskForm((prev) => ({ ...prev, source_mode: "existing", title: "" }));
                  else setTaskForm((prev) => ({ ...prev, source_mode: "new", issue_key: "", ticket_source: "jira", jira_issue_type: "", jira_project_key: prev.jira_project_key || (jiraProjects[0]?.key || "") }));
                }}
                  style={{
                    flex: 1, padding: "9px 0", border: "none", cursor: "pointer",
                    background: taskForm.source_mode === m.key ? "#1d4ed8" : "#f9fafb",
                    color: taskForm.source_mode === m.key ? "#fff" : "#6b7280",
                    fontWeight: 700, fontSize: 13, transition: "all 0.15s",
                  }}
                >{m.label}</button>
              ))}
            </div>
            {taskForm.source_mode === "existing" ? (
              <>
                <label>Ticket System</label>
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  {["jira", "ado"].map((s) => (
                    <button key={s} type="button" onClick={() => setTaskForm((prev) => ({ ...prev, ticket_source: s, issue_key: "" }))}
                      style={{
                        flex: 1, padding: "8px 0", borderRadius: 6, cursor: "pointer",
                        border: taskForm.ticket_source === s ? "2px solid #1d4ed8" : "1px solid #d1d5db",
                        background: taskForm.ticket_source === s ? "#eff6ff" : "#fff",
                        color: taskForm.ticket_source === s ? "#1d4ed8" : "#6b7280",
                        fontWeight: 700, fontSize: 13,
                      }}
                    >{s.toUpperCase()}</button>
                  ))}
                </div>
                <label>
                  {taskForm.ticket_source === "jira" ? "Issue Key" : "ADO Work Item (US only)"}
                  <input
                    value={taskForm.issue_key}
                    onChange={(e) =>
                      setTaskForm((prev) => ({
                        ...prev,
                        issue_key: prev.ticket_source === "jira" ? e.target.value.toUpperCase() : e.target.value,
                      }))
                    }
                    placeholder={taskForm.ticket_source === "jira" ? "PROJ-123" : "US-12345 or 12345"}
                    required
                  />
                </label>
              </>
            ) : (
              <>
                <label>Ticket System</label>
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  {["jira", "ado"].map((s) => (
                    <button key={s} type="button" onClick={() => {
                      if (s === "jira") setTaskForm((prev) => ({ ...prev, ticket_source: "jira", jira_project_key: prev.jira_project_key || (jiraProjects[0]?.key || "") }));
                      else setTaskForm((prev) => ({ ...prev, ticket_source: "ado" }));
                    }}
                      style={{
                        flex: 1, padding: "8px 0", borderRadius: 6, cursor: "pointer",
                        border: taskForm.ticket_source === s ? "2px solid #1d4ed8" : "1px solid #d1d5db",
                        background: taskForm.ticket_source === s ? "#eff6ff" : "#fff",
                        color: taskForm.ticket_source === s ? "#1d4ed8" : "#6b7280",
                        fontWeight: 700, fontSize: 13,
                      }}
                    >{s.toUpperCase()}</button>
                  ))}
                </div>
                {taskForm.ticket_source === "jira" ? (
                <label>
                  JIRA Project Key
                  <select
                    value={taskForm.jira_project_key}
                    onChange={(e) => setTaskForm((prev) => ({ ...prev, jira_project_key: e.target.value, jira_issue_type: "", jira_service: "" }))}
                    required
                    disabled={jiraProjectsLoading || !jiraProjects.length}
                  >
                    <option value="" disabled>
                      {jiraProjectsLoading ? "Loading projects..." : "Select project"}
                    </option>
                    {jiraProjects.map((project) => (
                      <option key={project.key} value={project.key}>
                        {project.key} - {project.name}
                      </option>
                    ))}
                  </select>
                </label>
                ) : (
                  <label>
                    Work Item Type
                    <input value="User Story" readOnly aria-label="ADO work item type" />
                  </label>
                )}
                {taskForm.ticket_source === "jira" && (
                  <label>
                    Issue Type <span style={{ color: "#dc2626" }}>*</span>
                    <select
                      value={taskForm.jira_issue_type}
                      onChange={(e) => setTaskForm((prev) => ({ ...prev, jira_issue_type: e.target.value }))}
                      required
                      disabled={jiraIssueTypesLoading || !jiraIssueTypes.length || !taskForm.jira_project_key}
                    >
                      <option value="" disabled>
                        {!taskForm.jira_project_key
                          ? "Select a project first"
                          : jiraIssueTypesLoading
                          ? "Loading issue types..."
                          : "Select issue type"}
                      </option>
                      {jiraIssueTypes.map((it) => (
                        <option key={it.id} value={it.name}>{it.name}</option>
                      ))}
                    </select>
                  </label>
                )}
                {taskForm.ticket_source === "jira" && taskForm.jira_project_key.toUpperCase() === "MAP" && (
                  <label>
                    Service <span style={{ color: "#dc2626" }}>*</span>
                    <select
                      value={taskForm.jira_service}
                      onChange={(e) => setTaskForm((prev) => ({ ...prev, jira_service: e.target.value }))}
                      required
                      disabled={jiraServiceLoading || !jiraServiceOptions.length}
                    >
                      <option value="" disabled>
                        {jiraServiceLoading ? "Loading services..." : jiraServiceOptions.length === 0 ? "No services available" : "Select service"}
                      </option>
                      {jiraServiceOptions.map((opt) => (
                        <option key={opt.id} value={opt.value || opt.name}>
                          {opt.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  Task Title
                  <input
                    value={taskForm.title}
                    onChange={(e) => setTaskForm((prev) => ({ ...prev, title: e.target.value }))}
                    placeholder="Enter task title"
                    required
                  />
                </label>
              </>
            )}
            <div className="date-row">
              <label className="date-field">
                Start Date
                <input
                  type="date"
                  value={taskForm.start_date}
                  onChange={(e) =>
                    setTaskForm((prev) => ({
                      ...prev,
                      start_date: e.target.value,
                      start_slot: dateToSlot(board.months, e.target.value) ?? prev.start_slot,
                    }))
                  }
                  required
                />
              </label>
              <label className="date-field">
                End Date
                <input
                  type="date"
                  value={taskForm.end_date}
                  onChange={(e) =>
                    setTaskForm((prev) => ({
                      ...prev,
                      end_date: e.target.value,
                      end_slot: dateToSlot(board.months, e.target.value) ?? prev.end_slot,
                    }))
                  }
                  required
                />
              </label>
            </div>
            <div className="actions">
              <button type="button" onClick={() => setMenu(null)} style={{
                padding: "10px 20px", borderRadius: "8px",
                border: "1px solid #d1d5db", background: "white",
                cursor: "pointer", fontWeight: "500", fontSize: "14px", color: "#374151",
              }}>
                Cancel
              </button>
              <button type="submit" style={{
                padding: "10px 20px", borderRadius: "8px", border: "none",
                background: "#1d4ed8", color: "white",
                cursor: "pointer", fontWeight: "700", fontSize: "14px",
              }}>
                Add Task
              </button>
            </div>
          </form>
          </div>
        </div>
      ) : null}

      {menu?.type === "team-required" ? (
        <div
          onClick={() => setMenu(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{
            background: "white", borderRadius: "16px", padding: "28px 32px",
            boxShadow: "0 20px 60px rgba(0,0,0,0.25)", minWidth: "300px", textAlign: "center",
          }}>
            <div style={{ fontSize: "15px", fontWeight: "600", color: "#111827", marginBottom: "20px" }}>Please assign a team first.</div>
            <button
              type="button"
              onClick={() => setMenu(null)}
              style={{
                padding: "10px 28px", borderRadius: "8px", border: "none",
                background: "#1d4ed8", color: "white",
                cursor: "pointer", fontWeight: "700", fontSize: "14px",
              }}
            >
              OK
            </button>
          </div>
        </div>
      ) : null}

      {itemAction ? (
        <div className="menu" style={{ left: itemAction.x, top: itemAction.y }} onClick={(e) => e.stopPropagation()}>
          <div className="item-action-menu">
            <div className="item-details">
              <div className="detail-row">
                <strong>Ticket:</strong> {itemAction.issueKey}
              </div>
              <div className="detail-row">
                <strong>Assignee:</strong> {itemAction.assignee}
              </div>
              <div className="detail-row">
                <strong>Shirt Size:</strong> {itemAction.shirtSize}
              </div>
              <div className="detail-row">
                <strong>Status:</strong> {itemAction.status}
              </div>
              <div className="detail-row">
                <strong>Board Start Date:</strong> {itemAction.boardStartDate}
              </div>
              <div className="detail-row">
                <strong>Board End Date:</strong> {itemAction.boardEndDate}
              </div>
              <div className="detail-row detail-description">
                <strong>Description:</strong>
                <div>{itemAction.description}</div>
              </div>
            </div>
            <div className="item-actions">
              {showLinks ? (
                <button type="button" onClick={() => beginLinkMode(itemAction.itemId)} title="Link ticket" aria-label="Link ticket">
                  &#128279;
                </button>
              ) : null}
              <button
                type="button"
                title="Delete"
                aria-label="Delete ticket"
                onClick={() => {
                  setDeleteConfirm(itemAction);
                  setItemAction(null);
                }}
              >
                &#128465;
              </button>
              <button type="button" onClick={() => setItemAction(null)} title="Close" aria-label="Close ticket details">
                X
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteConfirm ? (
        <div className="menu" style={{ left: deleteConfirm.x, top: deleteConfirm.y }} onClick={(e) => e.stopPropagation()}>
          <div className="item-action-menu delete-confirm-menu">
            <div className="confirm-text">Delete {truncateText(deleteConfirm.itemLabel)}?</div>
            <div className="confirm-note">This removes the card from this board only. The external ticket (JIRA/ADO) will not be deleted.</div>
            <div className="action-row">
              <button type="button" onClick={() => deleteItem(deleteConfirm.itemId)} title="Delete" aria-label="Confirm delete">
                &#10003;
              </button>
              <button type="button" onClick={() => setDeleteConfirm(null)} title="Close" aria-label="Cancel delete">
                X
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {linkTypeMenu ? (
        <div className="menu" style={{ left: linkTypeMenu.x, top: linkTypeMenu.y }} onClick={(e) => e.stopPropagation()}>
          <div className="item-action-menu link-type-menu">
            <div className="confirm-text">Choose link type</div>
            <label className="link-type-field">
              <select value={linkTypeDraft} onChange={(e) => setLinkTypeDraft(e.target.value)}>
                <option value="blocks">blocks</option>
                <option value="is blocked by">is blocked by</option>
                <option value="is worklog for">is worklog for</option>
                <option value="has worklog in">has worklog in</option>
                <option value="depends on">depends on</option>
                <option value="is dependant">is dependant</option>
                <option value="relates to">relates to</option>
              </select>
            </label>
            <div className="action-row">
              <button type="button" onClick={() => createLink(linkTypeDraft)} title="Apply" aria-label="Apply link type">
                &#10003;
              </button>
              <button type="button" onClick={() => setLinkTypeMenu(null)} title="Close" aria-label="Close link menu">
                X
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {commitMenu ? (
        <div className="menu" style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)" }} onClick={(e) => e.stopPropagation()}>
          <div className="item-action-menu commit-menu">
            <div className="confirm-text">Verify and commit board changes?</div>
            <div className="confirm-note">This checks board consistency and stores a commit checkpoint.</div>
            <div className="action-row">
              <button type="button" onClick={commitBoard} title="Commit" aria-label="Commit board changes">
                &#10003;
              </button>
              <button type="button" onClick={() => setCommitMenu(null)} title="Close" aria-label="Cancel commit">
                X
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {commitResult ? (
        <div className="menu" style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)" }} onClick={(e) => e.stopPropagation()}>
          <div className="item-action-menu commit-menu center-single-close">
            <button
              type="button"
              className="popup-top-close"
              onClick={() => setCommitResult(null)}
              title="Close"
              aria-label="Close commit result"
            >
              X
            </button>
            <div className="confirm-text">Board committed</div>
            <div className="item-details">
              <div className="detail-row">Items: {commitResult.summary?.items ?? 0}</div>
              <div className="detail-row">Links: {commitResult.summary?.links ?? 0}</div>
              <div className="detail-row">Pending Changes: {commitResult.summary?.pending_changes ?? 0}</div>
            </div>
          </div>
        </div>
      ) : null}

      {jiraCreateNotice ? (
        <div className="menu" style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)" }} onClick={(e) => e.stopPropagation()}>
          <div className="item-action-menu commit-menu center-single-close">
            <button
              type="button"
              className="popup-top-close"
              onClick={() => setJiraCreateNotice(null)}
              title="Close"
              aria-label="Close JIRA created notice"
            >
              X
            </button>
            {jiraCreateNotice.failed ? (
              <>
                <div className="confirm-text" style={{ color: "#b45309" }}>
                  ⚠ Saved locally — could not sync to {jiraCreateNotice.system}
                </div>
                <div className="confirm-note">
                  The task <strong>&ldquo;{jiraCreateNotice.title}&rdquo;</strong> has been added to your board but was <strong>not created</strong> in {jiraCreateNotice.system} due to a connection or configuration error.
                </div>
                <div className="confirm-note" style={{ marginTop: 6 }}>
                  Please create the ticket manually in {jiraCreateNotice.system} and link it to this board item.
                </div>
              </>
            ) : (
              <>
                <div className="confirm-text">{jiraCreateNotice.system || "Ticket"} created: {jiraCreateNotice.issueKey}</div>
                <div className="confirm-note">Please update necessary fields on {jiraCreateNotice.system || "the ticket system"}.</div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
