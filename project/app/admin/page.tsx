"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { Html5Qrcode } from "html5-qrcode";
import { api, ApiClientError } from "@/lib/client";
import { computeMembership, GYM_PLANS } from "@/lib/membershipUtils";
import type { AdminUserRow, ExpenseRow, GateLogRow, SessionUser } from "@/lib/types";
import {
  IconShield,
  IconUser,
  IconCheck,
  IconX,
  IconCreditCard,
  IconAlertCircle,
  IconRefresh,
  IconLogOut,
  IconPlus,
  IconSearch,
  IconQrCode,
  IconCamera,
} from "@/lib/svgIcons";

interface AdminMember extends AdminUserRow {
  membership: ReturnType<typeof computeMembership>;
}

interface AdminTrainer extends AdminUserRow {
  dutyStatus: "IN" | "OUT";
  date: string;
}

export default function AdminPortal() {
  const router = useRouter();

  const [admin, setAdmin] = useState<SessionUser | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [creds, setCreds] = useState({ username: "", password: "" });
  const [authError, setAuthError] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState("");

  const [activeTab, setActiveTab] = useState<
    | "overview"
    | "attendance"
    | "members"
    | "trainers_pending"
    | "trainers_approved"
    | "expenses"
  >("overview");
  const [memberFilter, setMemberFilter] = useState<"ALL" | "ACTIVE" | "EXPIRING_SOON" | "EXPIRED">(
    "ALL"
  );
  const [searchQuery, setSearchQuery] = useState("");

  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [expenseReason, setExpenseReason] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseError, setExpenseError] = useState("");

  const [renewModalMember, setRenewModalMember] = useState<AdminMember | null>(null);
  const [renewPlanCode, setRenewPlanCode] = useState(GYM_PLANS[0].id);
  const [renewing, setRenewing] = useState(false);
  const [renewError, setRenewError] = useState("");

  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const [showReceptionScanner, setShowReceptionScanner] = useState(false);
  const [scannerActive, setScannerActive] = useState(false);
  const [scannerFeedback, setScannerFeedback] = useState<{
    type: "success" | "error" | "info";
    title: string;
    message: string;
    user?: Awaited<ReturnType<typeof api.adminScan>>["user"];
  } | null>(null);
  const [scanAckModal, setScanAckModal] = useState<{
    show: boolean;
    action: "check-in" | "check-out";
    title: string;
    message: string;
    user?: Awaited<ReturnType<typeof api.adminScan>>["user"];
    time: string;
  } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [manualScanInput, setManualScanInput] = useState("");
  const scannerInstanceRef = useRef<Html5Qrcode | null>(null);
  const adminScanLockRef = useRef(false);
  const lastScannedQrRef = useRef<{ code: string; timestamp: number }>({ code: "", timestamp: 0 });

  const [showPosterModal, setShowPosterModal] = useState(false);
  const [entrancePosterQr, setEntrancePosterQr] = useState("");

  const [membersList, setMembersList] = useState<AdminMember[]>([]);
  const [pendingTrainers, setPendingTrainers] = useState<AdminTrainer[]>([]);
  const [approvedTrainers, setApprovedTrainers] = useState<AdminTrainer[]>([]);
  const [expensesList, setExpensesList] = useState<ExpenseRow[]>([]);
  const [attendanceLogs, setAttendanceLogs] = useState<GateLogRow[]>([]);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalExpense, setTotalExpense] = useState(0);

  // ---------------------------------------------------------------------------
  // Session
  // ---------------------------------------------------------------------------
  useEffect(() => {
    (async () => {
      try {
        const data = await api.me();
        if (data.authenticated && data.user) {
          if (data.user.role === "admin") {
            setAdmin(data.user);
            setIsAuthenticated(true);
          } else {
            setAuthError("This account does not have administrator access.");
          }
        }
      } catch {
        /* signed out */
      } finally {
        setCheckingSession(false);
      }
    })();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    setSigningIn(true);

    try {
      const { user } = await api.login(creds.username.trim(), creds.password);

      if (user.role !== "admin") {
        setAuthError("These credentials do not belong to an administrator account.");
        await api.logout().catch(() => undefined);
        return;
      }

      setAdmin(user);
      setIsAuthenticated(true);
    } catch (err) {
      setAuthError(
        err instanceof ApiClientError ? err.message : "Sign in failed. Please try again."
      );
    } finally {
      setSigningIn(false);
    }
  };

  const handleLogout = async () => {
    await api.logout().catch(() => undefined);
    setIsAuthenticated(false);
    setAdmin(null);
    setCreds({ username: "", password: "" });
  };

  // ---------------------------------------------------------------------------
  // Entrance poster QR
  // ---------------------------------------------------------------------------
  useEffect(() => {
    QRCode.toDataURL(
      JSON.stringify({
        gymId: "AURA_CLUB_MAIN_ENTRANCE",
        facility: "AURA Athletic Club - Main Gate",
        action: "check-in",
      }),
      { width: 400, margin: 2, color: { dark: "#141414", light: "#ffffff" } }
    ).then(setEntrancePosterQr);
  }, []);

  // ---------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------
  const fetchRealData = useCallback(async () => {
    setLoading(true);
    setFetchError("");

    try {
      const result = await api.adminData();

      const members: AdminMember[] = [];
      const pending: AdminTrainer[] = [];
      const approved: AdminTrainer[] = [];

      for (const row of result.users) {
        if (row.role === "member") {
          members.push({
            ...row,
            membership: computeMembership(row.plan, row.createdAt),
          });
        } else if (row.role === "trainer") {
          const trainer: AdminTrainer = {
            ...row,
            dutyStatus: row.currentStatus === "IN" ? "IN" : "OUT",
            date: row.requestedAt
              ? new Date(row.requestedAt).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })
              : row.createdAt
                ? new Date(row.createdAt).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })
                : "Recent",
          };

          if (row.status === "pending") pending.push(trainer);
          else if (row.status === "approved") approved.push(trainer);
        }
      }

      setMembersList(members);
      setPendingTrainers(pending);
      setApprovedTrainers(approved);
      setTotalRevenue(result.totalRevenue ?? 0);
      setAttendanceLogs(result.logs ?? []);
      setExpensesList(result.expenses ?? []);

      setTotalExpense(
        (result.expenses ?? []).reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0)
      );
    } catch (err) {
      setFetchError(
        err instanceof ApiClientError ? err.message : "Failed to load management records."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // This effect initiates an external request or synchronizes the camera.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isAuthenticated) fetchRealData();
  }, [isAuthenticated, fetchRealData]);

  // ---------------------------------------------------------------------------
  // Reception scanner
  // ---------------------------------------------------------------------------
  const startReceptionScanner = async () => {
    setScannerFeedback(null);
    setScannerActive(false);

    try {
      const element = document.getElementById("admin-reception-scanner");
      if (!element) return;

      if (scannerInstanceRef.current) {
        try {
          if (scannerInstanceRef.current.isScanning) await scannerInstanceRef.current.stop();
          scannerInstanceRef.current.clear();
        } catch {
          /* already stopped */
        }
        scannerInstanceRef.current = null;
      }

      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setScannerFeedback({
          type: "error",
          title: "Camera Not Available on Insecure Connection",
          message:
            "Live video streaming requires HTTPS or localhost. Use 'Scan with Phone Camera' or the instant member search below.",
        });
        return;
      }

      let permStream: MediaStream | null = null;
      try {
        permStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
        });
      } catch (permErr: unknown) {
        const error = permErr as { name?: string; message?: string };
        if (
          error.name === "NotAllowedError" ||
          error.name === "PermissionDeniedError" ||
          error.message?.toLowerCase().includes("denied")
        ) {
          setScannerFeedback({
            type: "error",
            title: "Camera Permission Denied",
            message:
              "Camera permission was blocked. Allow camera access in your browser settings, or use 'Scan with Phone Camera'.",
          });
          return;
        }
        permStream = await navigator.mediaDevices.getUserMedia({ video: true });
      }

      permStream?.getTracks().forEach((track) => track.stop());

      const html5QrCode = new Html5Qrcode("admin-reception-scanner");
      scannerInstanceRef.current = html5QrCode;

      const onDecoded = (decodedText: string) => handleExecuteScan(decodedText);

      try {
        await html5QrCode.start(
          { facingMode: "environment" },
          { fps: 15, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 },
          onDecoded,
          () => {}
        );
      } catch {
        await html5QrCode.start(
          { facingMode: "user" },
          { fps: 15, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 },
          onDecoded,
          () => {}
        );
      }

      setScannerActive(true);
    } catch (err: unknown) {
      setScannerActive(false);
      const error = err as { name?: string; message?: string };
      const isPerm =
        error.name === "NotAllowedError" ||
        error.message?.toLowerCase().includes("permission") ||
        error.message?.toLowerCase().includes("denied");

      setScannerFeedback({
        type: "error",
        title: isPerm ? "Camera Permission Denied" : "Camera Activation Failed",
        message: isPerm
          ? "Camera permission was denied. Allow camera access in your browser, then retry."
          : error.message || "Failed to initialize the webcam. Use the member search below.",
      });
    }
  };

  const stopReceptionScanner = async () => {
    if (scannerInstanceRef.current) {
      try {
        if (scannerInstanceRef.current.isScanning) await scannerInstanceRef.current.stop();
        scannerInstanceRef.current.clear();
      } catch {
        /* already stopped */
      }
      scannerInstanceRef.current = null;
    }
    setScannerActive(false);
  };

  useEffect(() => {
    if (showReceptionScanner) {
      const timer = setTimeout(startReceptionScanner, 200);
      return () => {
        clearTimeout(timer);
        stopReceptionScanner();
      };
    }
    // This effect initiates an external request or synchronizes the camera.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    stopReceptionScanner();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showReceptionScanner]);

  const processAdminFile = async (file: File) => {
    if (scanning) return;
    if (!file.type.startsWith("image/")) {
      alert("Please provide a valid image file.");
      return;
    }

    setScanning(true);
    setScannerFeedback({
      type: "info",
      title: "Scanning Captured Photo...",
      message: "Decoding QR code from camera snapshot...",
    });

    try {
      const html5QrCode = new Html5Qrcode("admin-hidden-file-reader");
      const result = await html5QrCode.scanFileV2(file, true);
      html5QrCode.clear();
      await handleExecuteScan(result.decodedText);
    } catch {
      setScannerFeedback({
        type: "error",
        title: "No QR Code Detected",
        message: "No valid QR pass was found in the captured photo. Align the code clearly and retry.",
      });
      setScanning(false);
    }
  };

  async function handleExecuteScan(qrData: string) {
    if (scanning || adminScanLockRef.current) return;

    const trimmed = qrData.trim();
    const now = Date.now();

    if (
      lastScannedQrRef.current.code === trimmed &&
      now - lastScannedQrRef.current.timestamp < 12_000
    ) {
      return;
    }
    if (now - lastScannedQrRef.current.timestamp < 3500) return;

    lastScannedQrRef.current = { code: trimmed, timestamp: now };
    adminScanLockRef.current = true;

    if (scannerInstanceRef.current?.isScanning) {
      try {
        scannerInstanceRef.current.pause(true);
      } catch {
        /* not scanning */
      }
    }

    setScanning(true);
    setScannerFeedback({
      type: "info",
      title: "Verifying Gate Access...",
      message: "Checking member identity and subscription status...",
    });

    try {
      const data = await api.adminScan(trimmed);
      const actionType = data.action === "check-in" ? "check-in" : "check-out";

      setScannerFeedback({
        type: "success",
        title: data.action === "check-in" ? "Check-In Approved" : "Check-Out Approved",
        message: data.message,
        user: data.user,
      });

      setScanAckModal({
        show: true,
        action: actionType,
        title: actionType === "check-in" ? "CHECK-IN APPROVED" : "CHECK-OUT RECORDED",
        message: data.message,
        user: data.user,
        time: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
      });

      await fetchRealData();
    } catch (err) {
      const message =
        err instanceof ApiClientError ? err.message : "Failed to reach the gate server.";

      setScannerFeedback({ type: "error", title: "Access Denied", message });
      setScanAckModal({
        show: true,
        action: "check-in",
        title: "ACCESS DENIED",
        message,
        time: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
      });
    } finally {
      setScanning(false);
    }
  };

  const handleCloseScanAckModal = () => {
    setScanAckModal(null);
    setScannerFeedback(null);

    setTimeout(() => {
      adminScanLockRef.current = false;
      try {
        scannerInstanceRef.current?.resume();
      } catch {
        /* not paused */
      }
    }, 1500);
  };

  const handleDirectCheckToggle = async (userId: string, currentStatus: string) => {
    setActionLoading(`status-${userId}`);
    try {
      await api.adminScan(userId, currentStatus === "IN" ? "check-out" : "check-in");
      await fetchRealData();
    } catch (err) {
      alert(err instanceof ApiClientError ? err.message : "Failed to update attendance status.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleTrainerApproval = async (trainerUid: string, action: "approve" | "reject" | "revoke") => {
    setActionLoading(trainerUid);
    try {
      await api.approveTrainer(trainerUid, action);
      await fetchRealData();
    } catch (err) {
      alert(err instanceof ApiClientError ? err.message : "Action failed.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    setExpenseError("");

    try {
      await api.addExpense(expenseReason.trim(), Number(expenseAmount));
      setShowExpenseModal(false);
      setExpenseReason("");
      setExpenseAmount("");
      await fetchRealData();
    } catch (err) {
      setExpenseError(
        err instanceof ApiClientError ? err.message : "Failed to save the expense record."
      );
    }
  };

  const openRenewModal = (member: AdminMember) => {
    setRenewModalMember(member);
    setRenewPlanCode(GYM_PLANS[0].id);
    setRenewError("");
  };

  const handleRenewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renewModalMember) return;

    setRenewing(true);
    setRenewError("");

    try {
      await api.renewMembership(renewModalMember.id, renewPlanCode);
      setRenewModalMember(null);
      await fetchRealData();
    } catch (err) {
      setRenewError(err instanceof ApiClientError ? err.message : "Renewal failed.");
    } finally {
      setRenewing(false);
    }
  };

  const filteredMembers = membersList.filter((member) => {
    const matchesFilter =
      memberFilter === "ALL" ? true : member.membership.status === memberFilter;
    const query = searchQuery.trim().toLowerCase();
    const matchesSearch =
      query === "" ||
      member.name.toLowerCase().includes(query) ||
      (member.phone ?? "").includes(query) ||
      member.email.toLowerCase().includes(query);
    return matchesFilter && matchesSearch;
  });

  const activeCount = membersList.filter((m) => m.membership.status === "ACTIVE").length;
  const expiringSoonCount = membersList.filter(
    (m) => m.membership.status === "EXPIRING_SOON"
  ).length;
  const expiredCount = membersList.filter((m) => m.membership.status === "EXPIRED").length;
  const insideCount = membersList.filter((m) => m.currentStatus === "IN").length;
  const coachesOnDuty = approvedTrainers.filter((t) => t.dutyStatus === "IN").length;

  // ---------------------------------------------------------------------------
  // Login screen
  // ---------------------------------------------------------------------------
  if (checkingSession) {
    return (
      <div className="min-h-screen bg-[#FAF8F5] flex items-center justify-center">
        <IconRefresh className="animate-spin text-[#C93E0B]" size={28} />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#FAF8F5] flex items-center justify-center p-4">
        <div className="bg-[#FFFFFF] rounded-2xl border border-[#ECE7E0] p-8 w-full max-w-md shadow-md space-y-6">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#FF5A1F] to-[#FF5A1F] flex items-center justify-center text-[#141414] mx-auto shadow-md shadow-[#141414]/10">
              <IconShield size={24} />
            </div>
            <h2 className="text-3xl font-bold text-[#141414] font-display">AURA Athletic ERP</h2>
            <p className="text-xs text-[#6B6760]">Owner & Administrator Management Terminal</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#6B6760] tracking-wide mb-1.5">
                Admin Email or Username
              </label>
              <input
                type="text"
                value={creds.username}
                onChange={(e) => setCreds({ ...creds, username: e.target.value })}
                placeholder="admin@auraclub.fit"
                autoComplete="username"
                className="w-full bg-[#F7F4EF] border border-[#ECE7E0] rounded-xl px-4 py-3 text-sm text-[#141414] focus:outline-none focus:border-[#FF5A1F] transition-colors"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#6B6760] tracking-wide mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={creds.password}
                onChange={(e) => setCreds({ ...creds, password: e.target.value })}
                placeholder="••••••••"
                autoComplete="current-password"
                className="w-full bg-[#F7F4EF] border border-[#ECE7E0] rounded-xl px-4 py-3 text-sm text-[#141414] focus:outline-none focus:border-[#FF5A1F] transition-colors"
                required
              />
            </div>

            {authError && (
              <div className="p-3 rounded-lg bg-[#D93636]/10 border border-[#D93636]/30 text-[#C42B2B] text-xs flex items-center gap-2">
                <IconAlertCircle size={16} />
                <span>{authError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={signingIn}
              className="w-full py-3 rounded-xl bg-[#FF5A1F] hover:bg-[#FF7A45] text-[#141414] font-bold text-xs tracking-wide transition-all shadow-md shadow-[#141414]/10 disabled:opacity-50"
            >
              {signingIn ? "Verifying..." : "Sign In to ERP"}
            </button>

            <button
              type="button"
              onClick={() => router.push("/")}
              className="w-full py-2 text-xs text-[#7A756D] hover:text-[#4A4640] transition-colors"
            >
              Return to Member Portal
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#141414] flex flex-col">
      <div id="admin-hidden-file-reader" style={{ display: "none" }} />

      <header className="border-b border-[#ECE7E0] bg-[#FFFFFF]/90 backdrop-blur-md sticky top-0 z-40 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#FF5A1F] to-[#FF5A1F] flex items-center justify-center text-[#141414] shadow-md shadow-[#141414]/10">
              <IconShield size={22} />
            </div>
            <div>
              <span className="font-bold tracking-wide text-base text-[#141414]">
                AURA Athletic Club
              </span>
              <span className="hidden sm:inline-block ml-2 px-2 py-0.5 rounded text-[11px] font-bold tracking-wide bg-[#FF5A1F]/10 text-[#C93E0B] border border-[#FF5A1F]/20">
                ERP Admin
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden md:inline text-xs text-[#6B6760]">
              Signed in as <strong className="text-[#2A2724]">{admin?.name}</strong>
            </span>

            <button
              onClick={fetchRealData}
              disabled={loading}
              className="hidden sm:flex px-3 py-1.5 rounded-lg border border-[#E0D9CF] hover:bg-[#F1EDE7] text-[#4A4640] text-xs font-semibold items-center gap-1.5 transition-colors disabled:opacity-50"
              title="Reload management data"
            >
              <IconRefresh size={14} className={loading ? "animate-spin" : ""} />
              <span>{loading ? "Syncing..." : "Refresh"}</span>
            </button>

            <button
              onClick={() => router.push("/")}
              className="px-3 py-1.5 rounded-lg border border-[#E0D9CF] hover:bg-[#F1EDE7] text-[#4A4640] text-xs font-semibold transition-colors"
            >
              User Portal
            </button>

            <button
              onClick={handleLogout}
              className="p-2 rounded-lg border border-[#E0D9CF] hover:bg-[#F1EDE7] text-[#6B6760] hover:text-[#2A2724] transition-colors"
              title="Sign Out"
            >
              <IconLogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-8 flex-1 flex flex-col gap-6">
        {fetchError && (
          <div className="bg-[#D93636]/10 border border-[#D93636]/30 rounded-2xl p-4 flex items-start gap-3 text-xs text-[#C42B2B]">
            <IconAlertCircle size={18} className="shrink-0 mt-0.5" />
            <div className="flex-1">
              <strong className="block font-bold mb-0.5">Could not load management data</strong>
              <span>{fetchError}</span>
            </div>
            <button onClick={fetchRealData} className="font-bold underline">
              Retry
            </button>
          </div>
        )}

        {pendingTrainers.length > 0 && (
          <div className="bg-[#E0A100]/10 border border-[#E0A100]/30 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#E0A100]/20 text-[#8A6100] flex items-center justify-center shrink-0">
                <IconAlertCircle size={22} />
              </div>
              <div>
                <h4 className="text-sm font-bold text-[#8A6100]">
                  {pendingTrainers.length} Trainer Application(s) Awaiting Review
                </h4>
                <p className="text-xs text-[#8A6100]/70 mt-0.5">
                  Held in pending gate to prevent unauthorized access to trainer dashboards.
                </p>
              </div>
            </div>
            <button
              onClick={() => setActiveTab("trainers_pending")}
              className="px-4 py-2 rounded-lg bg-[#E0A100] text-[#141414] font-bold text-xs tracking-wide transition-all self-start sm:self-auto shadow-md shadow-[#141414]/10"
            >
              Review Applications
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 bg-white/90 p-1.5 rounded-xl border border-[#ECE7E0] self-start">
          {(
            [
              ["overview", "Financial Overview"],
              ["attendance", "Live Attendance"],
              ["members", `Members (${membersList.length})`],
              ["trainers_pending", `Trainer Approvals${pendingTrainers.length ? ` (${pendingTrainers.length})` : ""}`],
              ["trainers_approved", `Approved Staff (${approvedTrainers.length})`],
              ["expenses", "Expenses Ledger"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                activeTab === key
                  ? "bg-[#F1EDE7] text-[#141414] shadow-sm"
                  : "text-[#6B6760] hover:text-[#2A2724]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {activeTab === "overview" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-[#FFFFFF] rounded-2xl border border-[#ECE7E0] p-6 space-y-2">
                <span className="text-xs font-semibold text-[#6B6760] tracking-wide">
                  Total Membership Revenue
                </span>
                <p className="text-4xl font-bold text-[#17803F] font-display tabular-nums">
                  ₹{totalRevenue.toLocaleString("en-IN")}
                </p>
                <p className="text-xs text-[#6B6760]">
                  Across {membersList.length} enrolled gym members
                </p>
              </div>

              <div className="bg-[#FFFFFF] rounded-2xl border border-[#ECE7E0] p-6 space-y-2">
                <span className="text-xs font-semibold text-[#6B6760] tracking-wide">
                  Operational Expenses
                </span>
                <p className="text-4xl font-bold text-[#C42B2B] font-display tabular-nums">
                  ₹{totalExpense.toLocaleString("en-IN")}
                </p>
                <p className="text-xs text-[#6B6760]">Recorded utility and maintenance costs</p>
              </div>

              <div className="bg-[#FFFFFF] rounded-2xl border border-[#ECE7E0] p-6 space-y-2">
                <span className="text-xs font-semibold text-[#6B6760] tracking-wide">
                  Net Operating Profit
                </span>
                <p
                  className={`text-4xl font-bold font-display tabular-nums ${
                    totalRevenue - totalExpense >= 0 ? "text-[#17803F]" : "text-[#C42B2B]"
                  }`}
                >
                  ₹{(totalRevenue - totalExpense).toLocaleString("en-IN")}
                </p>
                <p className="text-xs text-[#6B6760]">Net operating balance</p>
              </div>
            </div>

            <div className="bg-[#FFFFFF] rounded-2xl border border-[#ECE7E0] p-6 space-y-4">
              <h3 className="text-lg font-bold text-[#141414] font-display">
                Membership Health Breakdown
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {(
                  [
                    ["ACTIVE", activeCount, "Active Members", "Facility access enabled", "text-[#17803F]"],
                    [
                      "EXPIRING_SOON",
                      expiringSoonCount,
                      "Expiring Soon (≤ 7 Days)",
                      "Due for renewal",
                      "text-[#8A6100]",
                    ],
                    ["EXPIRED", expiredCount, "Expired Members", "Check-in access blocked", "text-[#C42B2B]"],
                  ] as const
                ).map(([filter, count, title, subtitle, tone]) => (
                  <div
                    key={filter}
                    onClick={() => {
                      setMemberFilter(filter);
                      setActiveTab("members");
                    }}
                    className="bg-white/80 p-4 rounded-xl border border-[#ECE7E0] cursor-pointer hover:border-[#FF5A1F]/50 transition-all"
                  >
                    <span className={`text-xs font-semibold tracking-wide ${tone}`}>{title}</span>
                    <p className="text-3xl font-bold text-[#141414] mt-1 font-display tabular-nums">
                      {count}
                    </p>
                    <p className="text-xs text-[#6B6760] mt-0.5">{subtitle}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === "attendance" && (
          <div className="space-y-6">
            <div className="bg-[#FFFFFF] rounded-2xl border border-[#ECE7E0] p-4 sm:p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setShowReceptionScanner(!showReceptionScanner)}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs tracking-wide transition-all shadow-md ${
                      showReceptionScanner
                        ? "bg-[#D93636] hover:bg-[#E04B4B] text-white shadow-[#141414]/10"
                        : "btn-emerald"
                    }`}
                  >
                    <IconCamera size={16} />
                    <span>{showReceptionScanner ? "Close Gate Scanner" : "Open Reception Gate Scanner"}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => document.getElementById("admin-phone-camera-input")?.click()}
                    className="btn-slate text-xs py-2.5 px-4 flex items-center gap-2 cursor-pointer"
                  >
                    <IconCamera size={16} />
                    <span>Scan with Phone Camera</span>
                  </button>
                  <input
                    id="admin-phone-camera-input"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && processAdminFile(e.target.files[0])}
                  />

                  <button
                    type="button"
                    onClick={() => setShowPosterModal(true)}
                    className="btn-slate text-xs py-2.5 px-4 flex items-center gap-2"
                  >
                    <IconQrCode size={16} />
                    <span>Print Entrance QR Poster</span>
                  </button>
                </div>

                <div className="flex items-center gap-2 text-xs text-[#6B6760]">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#FF5A1F] animate-pulse" />
                  <span>Front Desk Reader Ready</span>
                </div>
              </div>

              {showReceptionScanner && (
                <div className="mt-4 pt-4 border-t border-[#ECE7E0] grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold tracking-wide text-[#C93E0B]">
                        Front Desk Live Scanner
                      </span>
                      <span className="text-[11px] text-[#6B6760]">
                        Point at member&apos;s &ldquo;My QR Pass&rdquo;
                      </span>
                    </div>

                    <div className="relative rounded-2xl overflow-hidden bg-[#141414] border border-[#ECE7E0] min-h-[260px] flex items-center justify-center shadow-inner">
                      <div
                        id="admin-reception-scanner"
                        className="w-full"
                        style={{ opacity: scanning ? 0.3 : 1 }}
                      />
                      {!scannerActive && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#141414]/60 text-[#6B6760] p-4 text-center">
                          <IconRefresh className="animate-spin text-[#C93E0B]" size={24} />
                          <p className="text-xs font-semibold text-[#2A2724]">
                            Activating Reception Camera...
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <span className="text-xs font-bold tracking-wide text-[#6B6760] block">
                      Scan Status & Verification
                    </span>

                    {scannerFeedback ? (
                      <div
                        className={`p-4 rounded-xl border space-y-2 ${
                          scannerFeedback.type === "success"
                            ? "bg-[#1F9D55]/10 border-[#1F9D55]/30 text-[#17803F]"
                            : scannerFeedback.type === "error"
                              ? "bg-[#D93636]/10 border-[#D93636]/30 text-[#C42B2B]"
                              : "bg-[#F7F4EF] border-[#E0D9CF] text-[#4A4640]"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {scannerFeedback.type === "success" && (
                            <IconCheck size={18} className="text-[#17803F] shrink-0" />
                          )}
                          {scannerFeedback.type === "error" && (
                            <IconAlertCircle size={18} className="text-[#C42B2B] shrink-0" />
                          )}
                          {scannerFeedback.type === "info" && (
                            <IconRefresh size={18} className="animate-spin text-[#C93E0B] shrink-0" />
                          )}
                          <strong className="text-sm font-bold">{scannerFeedback.title}</strong>
                        </div>
                        <p className="text-xs leading-relaxed">{scannerFeedback.message}</p>

                        {scannerFeedback.user && (
                          <div className="pt-2 border-t border-[#ECE7E0]/80 text-xs space-y-1">
                            <p>
                              <strong>Name:</strong> {scannerFeedback.user.name}
                            </p>
                            {scannerFeedback.user.membership && (
                              <p>
                                <strong>Plan:</strong> {scannerFeedback.user.membership.planName} · Status:{" "}
                                <span
                                  className={
                                    scannerFeedback.user.membership.status === "ACTIVE"
                                      ? "text-[#17803F] font-bold"
                                      : "text-[#C42B2B] font-bold"
                                  }
                                >
                                  {scannerFeedback.user.membership.status}
                                </span>
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="p-4 rounded-xl bg-[#F7F4EF]/60 border border-[#ECE7E0] text-xs text-[#6B6760] leading-relaxed">
                        Ready to scan. Ask the member to open <strong>&ldquo;My QR Pass&rdquo;</strong>{" "}
                        on their phone. The system verifies membership status and logs check-in or
                        check-out automatically.
                      </div>
                    )}

                    <div className="pt-3 border-t border-[#ECE7E0] space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-[#4A4640] block">
                          Instant Member Search & Check-In
                        </span>
                        <span className="text-[11px] text-[#6B6760]">Search name, phone, or ID</span>
                      </div>

                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (manualScanInput.trim()) {
                            handleExecuteScan(manualScanInput.trim());
                            setManualScanInput("");
                          }
                        }}
                        className="space-y-2"
                      >
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="Type Member Name, Phone, Email, or UID..."
                            value={manualScanInput}
                            onChange={(e) => setManualScanInput(e.target.value)}
                            className="flex-1 bg-[#F7F4EF] border border-[#ECE7E0] rounded-xl px-3 py-2 text-xs text-[#141414] focus:outline-none focus:border-[#FF5A1F]"
                          />
                          <button
                            type="submit"
                            disabled={!manualScanInput.trim() || scanning}
                            className="px-3.5 py-2 btn-emerald text-xs rounded-xl disabled:opacity-40 cursor-pointer"
                          >
                            {scanning ? "..." : "Check In/Out"}
                          </button>
                        </div>

                        {manualScanInput.trim().length >= 2 && (
                          <div className="max-h-48 overflow-y-auto space-y-1 bg-[#141414]/60 p-2 rounded-xl border border-[#ECE7E0] shadow-md">
                            {membersList
                              .filter(
                                (m) =>
                                  (m.name || "").toLowerCase().includes(manualScanInput.toLowerCase()) ||
                                  (m.phone || "").includes(manualScanInput) ||
                                  (m.email || "").toLowerCase().includes(manualScanInput.toLowerCase())
                              )
                              .slice(0, 5)
                              .map((m) => (
                                <div
                                  key={m.id}
                                  className="p-2 rounded-lg bg-white/90 hover:bg-[#F1EDE7] flex items-center justify-between text-xs transition-colors"
                                >
                                  <div>
                                    <strong className="text-[#141414] block">{m.name}</strong>
                                    <span className="text-[11px] text-[#6B6760]">
                                      {m.phone} · {m.membership.planName} · Status:{" "}
                                      <span
                                        className={
                                          m.membership.status === "ACTIVE"
                                            ? "text-[#17803F]"
                                            : "text-[#C42B2B]"
                                        }
                                      >
                                        {m.membership.status}
                                      </span>
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    disabled={scanning}
                                    onClick={() => {
                                      handleExecuteScan(m.id);
                                      setManualScanInput("");
                                    }}
                                    className={`px-3 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                                      m.currentStatus === "IN"
                                        ? "bg-[#D93636]/20 text-[#C42B2B] hover:bg-[#C42B2B] hover:text-[#141414]"
                                        : "bg-[#FF5A1F]/20 text-[#C93E0B] hover:bg-[#FF5A1F] hover:text-[#141414]"
                                    }`}
                                  >
                                    {m.currentStatus === "IN" ? "Check Out" : "Check In"}
                                  </button>
                                </div>
                              ))}
                          </div>
                        )}
                      </form>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              <div className="bg-[#FFFFFF] rounded-2xl border border-[#ECE7E0] p-6 space-y-2">
                <span className="text-xs font-semibold text-[#6B6760] tracking-wide">
                  Members Inside Now
                </span>
                <p className="text-4xl font-bold text-[#17803F] font-display tabular-nums">
                  {insideCount}
                </p>
                <p className="text-xs text-[#6B6760]">Actively on the gym floor</p>
              </div>

              <div className="bg-[#FFFFFF] rounded-2xl border border-[#ECE7E0] p-6 space-y-2">
                <span className="text-xs font-semibold text-[#6B6760] tracking-wide">
                  Coaching Staff On Duty
                </span>
                <p className="text-4xl font-bold text-[#17803F] font-display tabular-nums">
                  {coachesOnDuty}
                </p>
                <p className="text-xs text-[#6B6760]">Personal trainers clocked in</p>
              </div>

              <div className="bg-[#FFFFFF] rounded-2xl border border-[#ECE7E0] p-6 space-y-2">
                <span className="text-xs font-semibold text-[#6B6760] tracking-wide">
                  Total Gate Logs
                </span>
                <p className="text-4xl font-bold text-[#141414] font-display tabular-nums">
                  {attendanceLogs.length}
                </p>
                <p className="text-xs text-[#6B6760]">Recent turnstile events</p>
              </div>
            </div>

            <div className="bg-[#FFFFFF] rounded-2xl border border-[#ECE7E0] p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-[#141414] font-display">
                    Currently Inside Facility
                  </h3>
                  <p className="text-xs text-[#6B6760] mt-0.5">
                    Live roster of individuals checked in through the turnstile.
                  </p>
                </div>
                <button
                  onClick={fetchRealData}
                  className="btn-slate text-xs py-1.5 px-3 flex items-center gap-1.5"
                >
                  <IconRefresh size={14} className={loading ? "animate-spin" : ""} />
                  <span>Refresh</span>
                </button>
              </div>

              {insideCount === 0 && coachesOnDuty === 0 ? (
                <div className="p-8 text-center text-[#6B6760]">
                  <p className="font-semibold text-[#4A4640]">Facility Currently Empty</p>
                  <p className="text-xs text-[#7A756D] mt-1">
                    No members or coaching staff have active check-ins right now.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {membersList
                    .filter((m) => m.currentStatus === "IN")
                    .map((m) => (
                      <div
                        key={m.id}
                        className="p-3.5 rounded-xl bg-[#F7F4EF] border border-[#FF5A1F]/30 flex items-center justify-between"
                      >
                        <div>
                          <strong className="text-xs text-[#141414] block">{m.name}</strong>
                          <span className="text-[11px] text-[#C93E0B]">
                            Member ({m.membership.planName})
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-[#1F9D55]/10 text-[#17803F] border border-[#1F9D55]/30">
                            INSIDE
                          </span>
                          <button
                            type="button"
                            onClick={() => handleDirectCheckToggle(m.id, "IN")}
                            disabled={actionLoading === `status-${m.id}`}
                            className="px-2 py-0.5 rounded text-[11px] font-bold bg-[#D93636]/20 text-[#C42B2B] hover:bg-[#C42B2B] hover:text-[#141414] transition-all border border-[#D93636]/30 cursor-pointer"
                          >
                            {actionLoading === `status-${m.id}` ? "..." : "Check Out"}
                          </button>
                        </div>
                      </div>
                    ))}

                  {approvedTrainers
                    .filter((t) => t.dutyStatus === "IN")
                    .map((t) => (
                      <div
                        key={t.id}
                        className="p-3.5 rounded-xl bg-[#F7F4EF] border border-[#FF5A1F]/30 flex items-center justify-between"
                      >
                        <div>
                          <strong className="text-xs text-[#141414] block">{t.name}</strong>
                          <span className="text-[11px] text-[#C93E0B]">
                            Coach ({t.specialization})
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-[#FF5A1F]/10 text-[#C93E0B] border border-[#FF5A1F]/30">
                            ON DUTY
                          </span>
                          <button
                            type="button"
                            onClick={() => handleDirectCheckToggle(t.id, "IN")}
                            disabled={actionLoading === `status-${t.id}`}
                            className="px-2 py-0.5 rounded text-[11px] font-bold bg-[#D93636]/20 text-[#C42B2B] hover:bg-[#C42B2B] hover:text-[#141414] transition-all border border-[#D93636]/30 cursor-pointer"
                          >
                            {actionLoading === `status-${t.id}` ? "..." : "Clock Out"}
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>

            <div className="bg-[#FFFFFF] rounded-2xl border border-[#ECE7E0] overflow-hidden p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-[#141414] font-display">
                    Master Gate Activity Feed
                  </h3>
                  <p className="text-xs text-[#6B6760] mt-0.5">
                    Turnstile event logs recorded via QR terminals.
                  </p>
                </div>
                <span className="text-xs text-[#6B6760]">{attendanceLogs.length} Events</span>
              </div>

              {attendanceLogs.length === 0 ? (
                <div className="p-8 text-center text-[#6B6760]">
                  <p className="font-semibold text-[#4A4640]">No attendance activity recorded yet</p>
                  <p className="text-xs text-[#7A756D] mt-1">
                    When members or trainers check in/out, records appear here automatically.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs sm:text-sm">
                    <thead className="bg-white/80 text-[#6B6760] text-[11px] font-semibold tracking-wide border-b border-[#ECE7E0]">
                      <tr>
                        <th className="py-3 px-4">User</th>
                        <th className="py-3 px-4">Role</th>
                        <th className="py-3 px-4">Action</th>
                        <th className="py-3 px-4">Terminal</th>
                        <th className="py-3 px-4 text-right">Timestamp</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#ECE7E0]/80 text-[#2A2724]">
                      {attendanceLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-[#F1EDE7]/40 transition-colors">
                          <td className="py-3 px-4">
                            <strong className="text-[#141414] block">{log.userName}</strong>
                            <span className="text-[11px] text-[#6B6760]">{log.userEmail}</span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="px-2 py-0.5 rounded text-[11px] font-bold tracking-wide bg-[#FF5A1F]/10 text-[#C93E0B] border border-[#FF5A1F]/30">
                              {log.role}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`px-2 py-0.5 rounded text-[11px] font-bold tracking-wide ${
                                log.type === "CHECK-IN"
                                  ? "bg-[#FF5A1F] text-[#141414]"
                                  : "bg-[#F1EDE7] text-[#4A4640] border border-[#E0D9CF]"
                              }`}
                            >
                              {log.type}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-[#6B6760] text-xs">{log.gymId}</td>
                          <td className="py-3 px-4 text-right text-[#4A4640] font-medium">
                            {log.time}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "members" && (
          <div className="bg-[#FFFFFF] rounded-2xl border border-[#ECE7E0] overflow-hidden space-y-4 p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-[#141414] font-display">
                  Gym Members & Subscriptions
                </h2>
                <p className="text-xs text-[#6B6760] mt-0.5">
                  Manage memberships, renewals, and facility access permissions.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="relative">
                  <IconSearch size={16} className="absolute left-3 top-2.5 text-[#6B6760]" />
                  <input
                    type="text"
                    placeholder="Search by name, phone or email..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="bg-[#F7F4EF] border border-[#ECE7E0] rounded-xl pl-9 pr-4 py-1.5 text-xs text-[#141414] focus:outline-none focus:border-[#FF5A1F]"
                  />
                </div>

                <div className="flex items-center gap-1 bg-[#F7F4EF] p-1 rounded-xl border border-[#ECE7E0] text-xs">
                  {(
                    [
                      ["ALL", `All (${membersList.length})`, "text-[#141414]"],
                      ["ACTIVE", `Active (${activeCount})`, "text-[#C93E0B]"],
                      ["EXPIRING_SOON", `Expiring (${expiringSoonCount})`, "text-[#8A6100]"],
                      ["EXPIRED", `Expired (${expiredCount})`, "text-[#C42B2B]"],
                    ] as const
                  ).map(([filter, label, tone]) => (
                    <button
                      key={filter}
                      onClick={() => setMemberFilter(filter)}
                      className={`px-3 py-1 rounded-lg font-medium transition-all ${
                        memberFilter === filter ? `bg-[#F1EDE7] ${tone}` : "text-[#6B6760]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {filteredMembers.length === 0 ? (
              <div className="p-12 text-center text-[#6B6760]">
                <IconUser size={36} className="mx-auto mb-3 opacity-40" />
                <p className="font-semibold text-[#4A4640]">No members match the current filter</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs sm:text-sm">
                  <thead className="bg-white/80 text-[#6B6760] text-[11px] font-semibold tracking-wide border-b border-[#ECE7E0]">
                    <tr>
                      <th className="py-3.5 px-4">Member</th>
                      <th className="py-3.5 px-4">Presence</th>
                      <th className="py-3.5 px-4">Phone</th>
                      <th className="py-3.5 px-4">Plan Tier</th>
                      <th className="py-3.5 px-4">Check-Ins</th>
                      <th className="py-3.5 px-4">Valid Until</th>
                      <th className="py-3.5 px-4">Days Left</th>
                      <th className="py-3.5 px-4">Plan Status</th>
                      <th className="py-3.5 px-4">Trainer</th>
                      <th className="py-3.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#ECE7E0]/80 text-[#2A2724]">
                    {filteredMembers.map((member) => (
                      <tr key={member.id} className="hover:bg-[#F1EDE7]/40 transition-colors">
                        <td className="py-3.5 px-4">
                          <strong className="font-semibold text-[#141414] block">
                            {member.name}
                          </strong>
                          <span className="text-[11px] text-[#7A756D]">{member.email}</span>
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                              member.currentStatus === "IN"
                                ? "bg-[#1F9D55]/10 text-[#17803F] border border-[#1F9D55]/30"
                                : "bg-[#F1EDE7] text-[#6B6760] border border-[#E0D9CF]"
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                member.currentStatus === "IN"
                                  ? "bg-[#1F9D55] animate-pulse"
                                  : "bg-[#A09A92]"
                              }`}
                            />
                            {member.currentStatus === "IN" ? "INSIDE" : "OUTSIDE"}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-[#6B6760]">{member.phone || "—"}</td>
                        <td className="py-3.5 px-4">
                          <span className="font-medium text-[#4A4640]">
                            {member.membership.planName}
                          </span>
                          <span className="text-[11px] text-[#7A756D] block">
                            ₹{member.membership.price}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 font-bold text-[#141414]">
                          {member.totalSessions} visits
                        </td>
                        <td className="py-3.5 px-4 text-[#6B6760]">
                          {member.membership.endDateFormatted}
                        </td>
                        <td className="py-3.5 px-4 font-bold">
                          <span
                            className={
                              member.membership.daysRemaining <= 0
                                ? "text-[#C42B2B]"
                                : member.membership.daysRemaining <= 7
                                  ? "text-[#8A6100]"
                                  : "text-[#17803F]"
                            }
                          >
                            {member.membership.daysRemaining}d
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`whitespace-nowrap px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wide ${
                              member.membership.status === "ACTIVE"
                                ? "bg-[#1F9D55]/10 text-[#17803F] border border-[#1F9D55]/20"
                                : member.membership.status === "EXPIRING_SOON"
                                  ? "bg-[#E0A100]/10 text-[#8A6100] border border-[#E0A100]/20"
                                  : "bg-[#D93636]/10 text-[#C42B2B] border border-[#D93636]/20"
                            }`}
                          >
                            {member.membership.status}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-[#6B6760]">
                          {member.assignedTrainer?.name || "General"}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <button
                            onClick={() => openRenewModal(member)}
                            className="px-3 py-1.5 rounded-lg bg-[#FF5A1F]/10 hover:bg-[#FF5A1F]/25 text-[#C93E0B] border border-[#FF5A1F]/30 text-xs font-semibold transition-all"
                          >
                            Renew / Extend
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === "trainers_pending" && (
          <div className="bg-[#FFFFFF] rounded-2xl border border-[#ECE7E0] overflow-hidden p-6 space-y-4">
            <div>
              <h2 className="text-xl font-bold text-[#141414] font-display">
                Trainer Applications Awaiting Review
              </h2>
              <p className="text-xs text-[#6B6760] mt-0.5">
                New applicants cannot log in or coach members until an administrator grants approval.
              </p>
            </div>

            {pendingTrainers.length === 0 ? (
              <div className="p-12 text-center text-[#6B6760]">
                <IconCheck size={36} className="mx-auto mb-3 text-[#C93E0B]" />
                <p className="font-semibold text-[#4A4640]">
                  All trainer applications are reviewed
                </p>
                <p className="text-xs text-[#7A756D] mt-1">
                  No applicants are waiting in the approval gate.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs sm:text-sm">
                  <thead className="bg-white/80 text-[#6B6760] text-[11px] font-semibold tracking-wide border-b border-[#ECE7E0]">
                    <tr>
                      <th className="py-3.5 px-4">Applicant</th>
                      <th className="py-3.5 px-4">Phone</th>
                      <th className="py-3.5 px-4">Email</th>
                      <th className="py-3.5 px-4">Specialization</th>
                      <th className="py-3.5 px-4">Experience</th>
                      <th className="py-3.5 px-4">Date Applied</th>
                      <th className="py-3.5 px-4 text-right">Decision</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#ECE7E0]/80 text-[#2A2724]">
                    {pendingTrainers.map((trainer) => (
                      <tr key={trainer.id} className="hover:bg-[#F1EDE7]/40 transition-colors">
                        <td className="py-4 px-4 font-semibold text-[#141414]">{trainer.name}</td>
                        <td className="py-4 px-4 text-[#6B6760]">{trainer.phone || "—"}</td>
                        <td className="py-4 px-4 text-[#6B6760]">{trainer.email}</td>
                        <td className="py-4 px-4">
                          <span className="bg-[#F1EDE7] text-[#4A4640] px-2 py-0.5 rounded text-xs">
                            {trainer.specialization || "General Fitness"}
                          </span>
                        </td>
                        <td className="py-4 px-4 text-[#4A4640]">
                          {trainer.experience || "Not provided"}
                        </td>
                        <td className="py-4 px-4 text-[#6B6760]">{trainer.date}</td>
                        <td className="py-4 px-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleTrainerApproval(trainer.id, "approve")}
                              disabled={actionLoading === trainer.id}
                              className="px-3 py-1.5 rounded-lg bg-[#FF5A1F] hover:bg-[#FF7A45] text-[#141414] font-bold text-xs flex items-center gap-1 transition-all disabled:opacity-50"
                            >
                              <IconCheck size={14} />
                              <span>{actionLoading === trainer.id ? "..." : "Approve"}</span>
                            </button>
                            <button
                              onClick={() => handleTrainerApproval(trainer.id, "reject")}
                              disabled={actionLoading === trainer.id}
                              className="px-3 py-1.5 rounded-lg bg-[#D93636]/10 hover:bg-[#C42B2B]/20 text-[#C42B2B] border border-[#D93636]/30 text-xs font-semibold flex items-center gap-1 transition-all disabled:opacity-50"
                            >
                              <IconX size={14} />
                              <span>Reject</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === "trainers_approved" && (
          <div className="bg-[#FFFFFF] rounded-2xl border border-[#ECE7E0] overflow-hidden p-6 space-y-4">
            <div>
              <h2 className="text-xl font-bold text-[#141414] font-display">
                Active Coaching & Training Staff
              </h2>
              <p className="text-xs text-[#6B6760] mt-0.5">
                Approved coaches authorized to train members and record duty shifts.
              </p>
            </div>

            {approvedTrainers.length === 0 ? (
              <div className="p-12 text-center text-[#6B6760]">
                <IconUser size={36} className="mx-auto mb-3 opacity-40" />
                <p className="font-semibold text-[#4A4640]">No approved trainers yet</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs sm:text-sm">
                  <thead className="bg-white/80 text-[#6B6760] text-[11px] font-semibold tracking-wide border-b border-[#ECE7E0]">
                    <tr>
                      <th className="py-3.5 px-4">Trainer Name</th>
                      <th className="py-3.5 px-4">Phone</th>
                      <th className="py-3.5 px-4">Email</th>
                      <th className="py-3.5 px-4">Specialization</th>
                      <th className="py-3.5 px-4">Duty Status</th>
                      <th className="py-3.5 px-4">Total Shifts</th>
                      <th className="py-3.5 px-4 text-right">Revocation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#ECE7E0]/80 text-[#2A2724]">
                    {approvedTrainers.map((trainer) => (
                      <tr key={trainer.id} className="hover:bg-[#F1EDE7]/40 transition-colors">
                        <td className="py-4 px-4 font-semibold text-[#141414]">{trainer.name}</td>
                        <td className="py-4 px-4 text-[#6B6760]">{trainer.phone || "—"}</td>
                        <td className="py-4 px-4 text-[#6B6760]">{trainer.email}</td>
                        <td className="py-4 px-4">{trainer.specialization}</td>
                        <td className="py-4 px-4">
                          <span
                            className={`whitespace-nowrap px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wide ${
                              trainer.dutyStatus === "IN"
                                ? "bg-[#1F9D55]/10 text-[#17803F] border border-[#1F9D55]/20"
                                : "bg-[#F1EDE7] text-[#6B6760] border border-[#E0D9CF]"
                            }`}
                          >
                            {trainer.dutyStatus === "IN" ? "On Duty" : "Off Duty"}
                          </span>
                        </td>
                        <td className="py-4 px-4 font-bold">{trainer.totalSessions}</td>
                        <td className="py-4 px-4 text-right">
                          <button
                            onClick={() => {
                              if (confirm(`Revoke trainer access for ${trainer.name}?`)) {
                                handleTrainerApproval(trainer.id, "revoke");
                              }
                            }}
                            disabled={actionLoading === trainer.id}
                            className="px-3 py-1.5 rounded-lg bg-[#F1EDE7] hover:bg-[#E4DED5] text-[#6B6760] hover:text-[#C42B2B] border border-[#E0D9CF] text-xs font-semibold transition-all disabled:opacity-50"
                          >
                            Revoke
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === "expenses" && (
          <div className="bg-[#FFFFFF] rounded-2xl border border-[#ECE7E0] overflow-hidden p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-[#141414] font-display">
                  Facility Expenses Ledger
                </h2>
                <p className="text-xs text-[#6B6760] mt-0.5">
                  Track recurring maintenance, utilities, and operational costs. Total: ₹
                  {totalExpense.toLocaleString("en-IN")}
                </p>
              </div>

              <button
                onClick={() => {
                  setExpenseError("");
                  setShowExpenseModal(true);
                }}
                className="px-4 py-2 rounded-xl bg-[#FF5A1F] hover:bg-[#FF7A45] text-[#141414] font-bold text-xs tracking-wide flex items-center gap-2 transition-all shadow-md shadow-[#141414]/10"
              >
                <IconPlus size={16} />
                <span>Add Expense</span>
              </button>
            </div>

            {expensesList.length === 0 ? (
              <div className="p-12 text-center text-[#6B6760]">
                <IconCreditCard size={36} className="mx-auto mb-3 opacity-40" />
                <p className="font-semibold text-[#4A4640]">No operational expenses recorded</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs sm:text-sm">
                  <thead className="bg-white/80 text-[#6B6760] text-[11px] font-semibold tracking-wide border-b border-[#ECE7E0]">
                    <tr>
                      <th className="py-3.5 px-4">Expense Category</th>
                      <th className="py-3.5 px-4">Amount</th>
                      <th className="py-3.5 px-4">Date Recorded</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#ECE7E0]/80 text-[#2A2724]">
                    {expensesList.map((expense) => (
                      <tr key={expense.id} className="hover:bg-[#F1EDE7]/40 transition-colors">
                        <td className="py-3.5 px-4 font-semibold text-[#141414]">
                          {expense.category}
                        </td>
                        <td className="py-3.5 px-4 font-bold text-[#C42B2B]">
                          ₹{Number(expense.amount).toLocaleString("en-IN")}
                        </td>
                        <td className="py-3.5 px-4 text-[#6B6760]">{expense.dateFormatted}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {showExpenseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#141414]/60 backdrop-blur-sm">
          <form
            onSubmit={handleAddExpense}
            className="bg-[#FFFFFF] rounded-2xl border border-[#ECE7E0] w-full max-w-md p-6 space-y-5 shadow-md"
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#ECE7E0]">
              <h3 className="text-xl font-bold text-[#141414] font-display">Add Expense Record</h3>
              <button
                type="button"
                onClick={() => setShowExpenseModal(false)}
                className="text-[#6B6760] hover:text-[#141414] text-sm"
              >
                Close
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#6B6760] tracking-wide mb-1.5">
                Expense Category / Description
              </label>
              <input
                type="text"
                value={expenseReason}
                onChange={(e) => setExpenseReason(e.target.value)}
                placeholder="e.g. Electricity & utilities"
                className="w-full bg-[#F7F4EF] border border-[#ECE7E0] rounded-xl px-4 py-2.5 text-xs text-[#141414] focus:outline-none focus:border-[#FF5A1F]"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#6B6760] tracking-wide mb-1.5">
                Amount (₹)
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={expenseAmount}
                onChange={(e) => setExpenseAmount(e.target.value)}
                placeholder="2500"
                className="w-full bg-[#F7F4EF] border border-[#ECE7E0] rounded-xl px-4 py-2.5 text-xs text-[#141414] focus:outline-none focus:border-[#FF5A1F]"
                required
              />
            </div>

            {expenseError && (
              <div className="p-3 rounded-xl bg-[#D93636]/10 border border-[#D93636]/30 text-[#C42B2B] text-xs flex items-center gap-2">
                <IconAlertCircle size={16} className="shrink-0" />
                <span>{expenseError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#ECE7E0]">
              <button
                type="button"
                onClick={() => setShowExpenseModal(false)}
                className="px-4 py-2 rounded-lg bg-[#F1EDE7] hover:bg-[#E4DED5] text-[#4A4640] text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-lg bg-[#FF5A1F] hover:bg-[#FF7A45] text-[#141414] font-bold text-xs tracking-wide transition-all"
              >
                Save Expense
              </button>
            </div>
          </form>
        </div>
      )}

      {renewModalMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#141414]/60 backdrop-blur-sm">
          <div className="bg-[#FFFFFF] rounded-2xl border border-[#ECE7E0] w-full max-w-md p-6 space-y-6 shadow-md">
            <div className="flex items-center justify-between pb-4 border-b border-[#ECE7E0]">
              <div>
                <h3 className="text-xl font-bold text-[#141414] font-display">Renew Membership</h3>
                <p className="text-xs text-[#6B6760] mt-0.5">
                  Member: <strong className="text-[#141414]">{renewModalMember.name}</strong>
                </p>
              </div>
              <button
                onClick={() => setRenewModalMember(null)}
                className="text-[#6B6760] hover:text-[#141414] text-sm"
              >
                Close
              </button>
            </div>

            <form onSubmit={handleRenewSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#6B6760] tracking-wide mb-2">
                  Select Plan Extension Duration
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {GYM_PLANS.map((plan) => (
                    <button
                      key={plan.id}
                      type="button"
                      onClick={() => setRenewPlanCode(plan.id)}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        renewPlanCode === plan.id
                          ? "bg-[#FF5A1F]/10 border-[#FF5A1F] text-[#141414]"
                          : "bg-[#F7F4EF] border-[#ECE7E0] text-[#6B6760] hover:border-[#E0D9CF]"
                      }`}
                    >
                      <span className="block text-[11px] font-bold text-[#C93E0B]">
                        {plan.durationMonths} Mo
                      </span>
                      <span className="block text-xs font-semibold text-[#141414] mt-1">
                        ₹{plan.price}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-[#F7F4EF]/60 border border-[#ECE7E0] text-xs text-[#6B6760]">
                Extension is measured from the current expiry date when the plan is still active,
                otherwise from today. The payment receipt is recorded automatically.
              </div>

              {renewError && (
                <div className="p-3 rounded-xl bg-[#D93636]/10 border border-[#D93636]/30 text-[#C42B2B] text-xs flex items-center gap-2">
                  <IconAlertCircle size={16} className="shrink-0" />
                  <span>{renewError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#ECE7E0]">
                <button
                  type="button"
                  onClick={() => setRenewModalMember(null)}
                  disabled={renewing}
                  className="px-4 py-2 rounded-lg bg-[#F1EDE7] hover:bg-[#E4DED5] text-[#4A4640] text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={renewing}
                  className="px-5 py-2 rounded-lg bg-[#FF5A1F] hover:bg-[#FF7A45] text-[#141414] font-bold text-xs tracking-wide transition-all disabled:opacity-50"
                >
                  {renewing ? "Extending..." : "Confirm Extension"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {scanAckModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#141414]/60 backdrop-blur-md">
          <div className="bg-[#FFFFFF] rounded-2xl border border-[#E0D9CF]/80 w-full max-w-sm p-6 text-center space-y-6 shadow-md">
            <div className="flex justify-center">
              {scanAckModal.title.includes("DENIED") ? (
                <div className="w-20 h-20 rounded-full bg-[#D93636]/20 border-4 border-[#D93636] flex items-center justify-center">
                  <IconAlertCircle size={44} className="text-[#C42B2B]" />
                </div>
              ) : (
                <div className="w-20 h-20 rounded-full bg-[#FF5A1F]/20 border-4 border-[#FF5A1F] flex items-center justify-center">
                  <IconCheck size={44} className="text-[#C93E0B]" />
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <span
                className={`text-[11px] font-bold tracking-wide block ${
                  scanAckModal.title.includes("DENIED") ? "text-[#C42B2B]" : "text-[#C93E0B]"
                }`}
              >
                {scanAckModal.title}
              </span>
              <h3 className="text-2xl font-bold text-[#141414] font-display">
                {scanAckModal.user?.name || "Gate Scan"}
              </h3>
              <p className="text-xs text-[#4A4640] leading-relaxed max-w-xs mx-auto pt-1">
                {scanAckModal.message}
              </p>
            </div>

            <button
              type="button"
              onClick={handleCloseScanAckModal}
              className={`w-full py-3.5 rounded-xl font-bold text-xs tracking-wide transition-all shadow-md cursor-pointer ${
                scanAckModal.title.includes("DENIED") ? "btn-slate" : "btn-emerald"
              }`}
            >
              Continue Scanning
            </button>
          </div>
        </div>
      )}

      {showPosterModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#141414]/60 backdrop-blur-sm">
          <div className="bg-[#FFFFFF] rounded-2xl border border-[#ECE7E0] w-full max-w-md p-6 space-y-6 shadow-md text-center">
            <div className="flex items-center justify-between pb-3 border-b border-[#ECE7E0]">
              <span className="text-xs font-bold tracking-wide text-[#C93E0B]">
                Official Facility Asset
              </span>
              <button
                onClick={() => setShowPosterModal(false)}
                className="text-[#6B6760] hover:text-[#141414] text-xs font-bold"
              >
                Close
              </button>
            </div>

            <div className="space-y-1">
              <h2 className="text-2xl font-bold text-[#141414] tracking-wide font-display">
                AURA Athletic Club
              </h2>
              <p className="text-xs text-[#6B6760]">Entrance Turnstile Check-In QR Poster</p>
            </div>

            <div className="p-4 bg-white rounded-2xl shadow-md inline-block border-4 border-[#FF5A1F]/40">
              {entrancePosterQr ? (
                <img
                  src={entrancePosterQr}
                  alt="Entrance Poster QR Code"
                  className="w-64 h-64 mx-auto block rounded-lg"
                />
              ) : (
                <div className="w-64 h-64 flex items-center justify-center text-[#6B6760]">
                  <IconRefresh className="animate-spin" size={32} />
                </div>
              )}
            </div>

            <div className="bg-white/80 p-3 rounded-xl border border-[#ECE7E0] text-xs text-[#4A4640] leading-relaxed text-left space-y-1">
              <p className="font-bold text-[#141414] flex items-center gap-1.5">
                <IconCheck size={14} className="text-[#C93E0B]" />
                <span>How to use this poster:</span>
              </p>
              <p className="text-[#6B6760] text-[11px]">
                1. Print this poster and place it at the gym entrance turnstile.
                <br />
                2. Members open the app &rarr; Attendance &rarr;{" "}
                <strong>Camera Scanner</strong> to scan this code on entry.
                <br />
                3. Attendance is recorded automatically in the database.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#ECE7E0]">
              <button
                type="button"
                onClick={() => setShowPosterModal(false)}
                className="px-4 py-2.5 rounded-xl bg-[#F1EDE7] hover:bg-[#E4DED5] text-[#4A4640] text-xs font-semibold"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  const printWin = window.open("", "_blank");
                  if (printWin && entrancePosterQr) {
                    printWin.document.write(`
                      <html>
                        <head>
                          <title>AURA Athletic Club - Entrance QR Poster</title>
                          <style>
                            body { font-family: sans-serif; text-align: center; padding: 40px; }
                            h1 { font-size: 28px; margin-bottom: 4px; text-transform: uppercase; }
                            h2 { font-size: 16px; color: #555; margin-bottom: 24px; font-weight: normal; }
                            img { width: 340px; height: 340px; border: 4px solid #000; border-radius: 16px; padding: 12px; }
                            p { font-size: 14px; color: #333; margin-top: 20px; font-weight: bold; }
                          </style>
                        </head>
                        <body>
                          <h1>AURA ATHLETIC CLUB</h1>
                          <h2>Entrance Gate Turnstile &amp; Check-In</h2>
                          <img src="${entrancePosterQr}" alt="QR" />
                          <p>Open the AURA App &gt; Attendance &gt; Camera Scanner to Check In</p>
                          <script>window.onload = function() { window.print(); window.close(); }<\/script>
                        </body>
                      </html>
                    `);
                    printWin.document.close();
                  }
                }}
                className="btn-emerald text-xs py-2.5 px-5 flex items-center gap-2"
              >
                <IconQrCode size={16} />
                <span>Print Poster</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
