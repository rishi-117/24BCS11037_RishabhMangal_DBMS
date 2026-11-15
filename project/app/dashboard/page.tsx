"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api, ApiClientError } from "@/lib/client";
import { computeMembership, GYM_PLANS } from "@/lib/membershipUtils";
import type { SessionUser } from "@/lib/types";
import {
  IconDumbbell,
  IconUser,
  IconQrCode,
  IconLogOut,
  IconCheck,
  IconCreditCard,
  IconRefresh,
  IconShield,
  IconTrendingUp,
  IconAlertCircle,
} from "@/lib/svgIcons";

export default function UserPortal() {
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<"overview" | "attendance" | "profile">("overview");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [renewModalOpen, setRenewModalOpen] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const [renewSuccess, setRenewSuccess] = useState<string | null>(null);
  const [renewError, setRenewError] = useState("");

  const [attendedDates, setAttendedDates] = useState<number[]>([]);
  const [activeFloorCount, setActiveFloorCount] = useState(0);

  const fetchProfile = useCallback(async () => {
    try {
      const data = await api.me();

      if (!data.authenticated || !data.user) {
        router.replace("/");
        return;
      }
      if (data.user.role === "trainer") {
        router.replace("/trainer/dashboard");
        return;
      }
      if (data.user.role === "admin") {
        router.replace("/admin");
        return;
      }

      setUser(data.user);
      setLoadError("");
    } catch (err) {
      setLoadError(
        err instanceof ApiClientError ? err.message : "Could not load your member profile."
      );
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    // This effect initiates an external request or synchronizes the camera.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchProfile();
  }, [fetchProfile]);

  const fetchAttendance = useCallback(async () => {
    if (!user) return;
    try {
      const data = await api.attendanceHistory(user.uid);
      setAttendedDates(data.attendedDates ?? []);
      setActiveFloorCount(data.activeFloorCount ?? 0);
    } catch {
      // Non-fatal: the streak panel simply shows no activity.
    }
  }, [user]);

  useEffect(() => {
    // This effect initiates an external request or synchronizes the camera.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAttendance();
  }, [fetchAttendance]);

  const handleLogout = async () => {
    await api.logout().catch(() => undefined);
    router.push("/");
  };

  const handleRenewPlan = async (planCode: string) => {
    if (!user) return;
    setRenewing(true);
    setRenewSuccess(null);
    setRenewError("");

    try {
      await api.renewMembership(user.uid, planCode);
      setRenewSuccess("Membership extended successfully.");
      await fetchProfile();
      setTimeout(() => {
        setRenewModalOpen(false);
        setRenewSuccess(null);
      }, 1600);
    } catch (err) {
      setRenewError(err instanceof ApiClientError ? err.message : "Renewal failed.");
    } finally {
      setRenewing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAF8F5] flex items-center justify-center text-[#4A4640]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-[#FF5A1F]/10 border border-[#FF5A1F]/20 flex items-center justify-center text-[#C93E0B] animate-pulse">
            <IconDumbbell size={28} />
          </div>
          <div className="flex items-center gap-2">
            <IconRefresh className="animate-spin text-[#C93E0B]" size={18} />
            <p className="text-sm font-semibold tracking-wide text-[#4A4640]">
              Loading Your Member Hub...
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (loadError || !user) {
    return (
      <div className="min-h-screen bg-[#FAF8F5] flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-[#D93636]/30 bg-white p-8 text-center space-y-4">
          <IconAlertCircle size={32} className="mx-auto text-[#C42B2B]" />
          <h2 className="text-xl font-bold text-[#141414] font-display">Could not load profile</h2>
          <p className="text-xs text-[#6B6760]">{loadError || "Please sign in again."}</p>
          <button onClick={() => router.push("/")} className="btn-secondary w-full">
            Return to Sign In
          </button>
        </div>
      </div>
    );
  }

  const membership = computeMembership(user.plan, user.createdAt);
  const attendanceCount = user.attendanceCount;

  const totalDays = Math.max(
    1,
    Math.ceil((membership.endDate.getTime() - membership.startDate.getTime()) / 86_400_000)
  );
  const progressPercent = Math.min(100, Math.round((membership.daysRemaining / totalDays) * 100));

  const now = new Date();
  const dayOfWeek = (now.getDay() + 6) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - dayOfWeek);
  monday.setHours(0, 0, 0, 0);

  const weekDayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const weekDays = weekDayNames.map((name, idx) => {
    const dayStart = new Date(monday);
    dayStart.setDate(monday.getDate() + idx);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayStart.getDate() + 1);

    const isToday = now.toDateString() === dayStart.toDateString();
    const hasLog = attendedDates.some((ts) => ts >= dayStart.getTime() && ts < dayEnd.getTime());
    const isAttended =
      (attendanceCount > 0 && hasLog) || (isToday && user.currentStatus === "IN");

    return { day: name, attended: isAttended, isToday };
  });

  let realStreak = 0;
  if (attendanceCount > 0) {
    const checkDate = new Date();
    checkDate.setHours(0, 0, 0, 0);

    if (!weekDays.find((d) => d.isToday)?.attended) {
      checkDate.setDate(checkDate.getDate() - 1);
    }

    for (;;) {
      const start = checkDate.getTime();
      const attendedOnDate = attendedDates.some((ts) => ts >= start && ts < start + 86_400_000);
      if (!attendedOnDate) break;
      realStreak += 1;
      checkDate.setDate(checkDate.getDate() - 1);
    }
  }

  const trafficLabel =
    activeFloorCount > 15
      ? "Peak Traffic"
      : activeFloorCount > 4
        ? "Moderate"
        : activeFloorCount > 0
          ? `${activeFloorCount} On Floor`
          : "Light / Quiet";

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#141414] flex flex-col selection:bg-[#FF5A1F] selection:text-[#141414]">
      <header className="border-b border-[#ECE7E0]/80 bg-white/90 backdrop-blur-xl sticky top-0 z-40 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#FF5A1F] via-[#FF5A1F] to-[#FFFFFF] flex items-center justify-center text-[#141414] shadow-md shadow-[#141414]/10 ring-1 ring-[#FF5A1F]/30">
              <IconDumbbell size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold tracking-wide text-base text-[#141414] block leading-tight">
                  AURA
                </span>
                <span className="px-2 py-0.5 rounded text-[11px] font-bold tracking-wide bg-[#FF5A1F]/10 text-[#C93E0B] border border-[#FF5A1F]/20">
                  Member
                </span>
              </div>
              <span className="text-[11px] text-[#6B6760] font-medium">Athletic Club</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/attendance")}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#FF5A1F] to-[#FF5A1F] hover:from-[#FF7A45] hover:to-[#FF7A45] text-[#141414] font-bold text-xs tracking-wide flex items-center gap-2 shadow-md shadow-[#141414]/10 transition-all hover:scale-[1.02] cursor-pointer"
              title="Open QR scanner for entrance check-in & exit"
            >
              <IconQrCode size={18} />
              <span>Gate Pass / Scan</span>
            </button>

            <button
              onClick={handleLogout}
              className="p-2.5 rounded-xl border border-[#ECE7E0] bg-white/80 hover:bg-[#F1EDE7] text-[#6B6760] hover:text-[#141414] transition-colors cursor-pointer"
              title="Sign Out"
            >
              <IconLogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-8 flex-1 flex flex-col gap-8">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-2">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-3xl sm:text-4xl font-bold text-[#141414] tracking-tight font-display">
                Welcome back, {user.name}
              </h1>

              {user.currentStatus === "IN" ? (
                <span className="px-3 py-1 rounded-full text-xs font-bold tracking-wide bg-[#1F9D55]/10 text-[#17803F] border border-[#1F9D55]/30 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#1F9D55] animate-ping" />
                  <span>On Premises (Active)</span>
                </span>
              ) : (
                <span className="px-3 py-1 rounded-full text-xs font-medium tracking-wide bg-[#F1EDE7]/80 text-[#6B6760] border border-[#E0D9CF]/80 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#A09A92]" />
                  <span>Outside Facility</span>
                </span>
              )}
            </div>

            <p className="text-xs sm:text-sm text-[#6B6760] mt-1">
              Member ID:{" "}
              <span className="text-[#4A4640] font-mono">
                {user.uid ? user.uid.substring(0, 10).toUpperCase() : "GUEST"}
              </span>{" "}
              · Every workout builds the future you.
            </p>
          </div>

          <div className="flex items-center gap-1 bg-white/90 p-1.5 rounded-xl border border-[#ECE7E0] self-start lg:self-auto">
            {(
              [
                ["overview", "Overview & Pass"],
                ["attendance", "Attendance Logs"],
                ["profile", "Profile & Info"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activeTab === key
                    ? "bg-[#F1EDE7] text-[#C93E0B] shadow-sm"
                    : "text-[#6B6760] hover:text-[#2A2724]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {activeTab === "overview" && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-7 relative rounded-2xl overflow-hidden p-7 hero-dark border border-white/10 shadow-md flex flex-col justify-between group">
                <div className="relative z-10 space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-[#FF5A1F] flex items-center justify-center text-[#141414] font-bold text-xs">
                        AC
                      </div>
                      <span className="text-xs font-bold tracking-wide text-white/80">
                        AURA Club Digital Pass
                      </span>
                    </div>

                    <span className="px-3 py-1 rounded-full text-[11px] font-bold tracking-wide bg-[#FF5A1F] text-[#141414]">
                      {membership.tier} Tier
                    </span>
                  </div>

                  <div className="pt-2">
                    <div className="flex items-center gap-3">
                      <h2 className="text-4xl sm:text-5xl font-bold text-white tracking-tight font-display">
                        {membership.planName}
                      </h2>
                    </div>
                    <p className="text-xs text-white/60 mt-1">
                      Rate: <span className="text-[#FF5A1F] font-semibold">₹{membership.price}</span>{" "}
                      · Tier Privileges Active
                    </p>
                  </div>

                  <div className="space-y-2 pt-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-white/60 font-medium">Subscription Lifecycle</span>
                      <span className="text-[#FF5A1F] font-bold">
                        {membership.daysRemaining} Days Left
                      </span>
                    </div>

                    <div className="w-full bg-white/15 h-2.5 rounded-full overflow-hidden p-0.5">
                      <div
                        className="bg-[#FF5A1F] h-full rounded-full transition-all duration-700"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-white/50 pt-1">
                      <span>Started: {membership.startDateFormatted}</span>
                      <span>Expires: {membership.endDateFormatted}</span>
                    </div>
                  </div>
                </div>

                <div className="relative z-10 pt-6 mt-6 border-t border-white/10 flex items-center justify-between flex-wrap gap-4">
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-2.5 h-2.5 rounded-full ${
                        membership.status === "ACTIVE" ? "bg-[#34C26F] animate-pulse" : "bg-[#E0A100]"
                      }`}
                    />
                    <span className="text-xs text-white/85 font-semibold">
                      {membership.status === "ACTIVE"
                        ? "Gate Turnstile Clearance Granted"
                        : membership.status === "EXPIRING_SOON"
                          ? "Renewal Due Soon"
                          : "Renewal Required"}
                    </span>
                  </div>

                  <button
                    onClick={() => {
                      setRenewError("");
                      setRenewModalOpen(true);
                    }}
                    className="px-5 py-2.5 rounded-xl bg-[#FF5A1F] hover:bg-[#FF7A45] text-[#141414] font-bold text-xs tracking-wide transition-all flex items-center gap-2 cursor-pointer shadow-sm"
                  >
                    <IconCreditCard size={15} />
                    <span>Renew / Extend Plan</span>
                  </button>
                </div>
              </div>

              <div className="lg:col-span-5 rounded-2xl bg-[#FFFFFF]/90 border border-[#ECE7E0]/90 p-7 flex flex-col justify-between shadow-md relative overflow-hidden">
                <div className="space-y-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold tracking-wide text-[#6B6760]">
                      <IconTrendingUp size={16} className="text-[#C93E0B]" />
                      <span>Weekly Consistency</span>
                    </div>
                    {realStreak > 0 ? (
                      <span className="text-[11px] text-[#C93E0B] font-bold bg-[#FF5A1F]/10 px-2.5 py-0.5 rounded-full border border-[#FF5A1F]/20">
                        🔥 {realStreak}-Day Streak
                      </span>
                    ) : (
                      <span className="text-[11px] text-[#6B6760] font-medium bg-[#F1EDE7]/80 px-2.5 py-0.5 rounded-full border border-[#E0D9CF]/60">
                        0-Day Streak · Check in to start
                      </span>
                    )}
                  </div>

                  <div>
                    <span className="text-xs text-[#6B6760] block mb-2 font-medium">
                      This Week’s Activity:
                    </span>
                    <div className="grid grid-cols-7 gap-2">
                      {weekDays.map((item, idx) => (
                        <div
                          key={idx}
                          className={`flex flex-col items-center py-2.5 rounded-xl border text-center transition-all ${
                            item.attended
                              ? "bg-[#FF5A1F]/15 border-[#FF5A1F]/40 text-[#C93E0B] shadow-sm shadow-[#141414]/10"
                              : item.isToday
                                ? "bg-[#F7F4EF] border-[#FF5A1F]/30 text-[#6B6760]"
                                : "bg-[#F7F4EF] border-[#ECE7E0] text-[#7A756D]"
                          }`}
                        >
                          <span
                            className={`text-[11px] font-bold ${item.isToday ? "text-[#C93E0B]" : ""}`}
                          >
                            {item.day}
                          </span>
                          <span
                            className={`text-xs mt-1 font-bold ${item.attended ? "text-[#C93E0B]" : "text-[#5C5851]"}`}
                          >
                            {item.attended ? "✓" : "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div className="p-3.5 rounded-2xl bg-white/80 border border-[#ECE7E0]">
                      <span className="text-[11px] font-bold tracking-wide text-[#6B6760] block">
                        Total Sessions
                      </span>
                      <p className="text-xl font-bold text-[#141414] mt-1">
                        {attendanceCount}{" "}
                        <span className="text-xs font-medium text-[#6B6760]">Visits</span>
                      </p>
                    </div>

                    <div className="p-3.5 rounded-2xl bg-white/80 border border-[#ECE7E0]">
                      <span className="text-[11px] font-bold tracking-wide text-[#6B6760] block">
                        Live Floor Traffic
                      </span>
                      <p
                        className={`text-xl font-bold mt-1 ${activeFloorCount > 0 ? "text-[#C93E0B]" : "text-[#4A4640]"}`}
                      >
                        {trafficLabel}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-[#ECE7E0]/80 flex items-center justify-between text-xs text-[#6B6760]">
                  <span>Peak Hours: 18:00 - 21:00</span>
                  <span className="text-[#4A4640] font-medium">Mon - Sat 06:00 - 22:00</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-7 bg-[#FFFFFF]/90 rounded-2xl border border-[#ECE7E0]/90 p-7 flex flex-col justify-between shadow-md">
                <div>
                  <div className="flex items-center justify-between pb-4 border-b border-[#ECE7E0]">
                    <div className="flex items-center gap-2">
                      <IconShield size={18} className="text-[#C93E0B]" />
                      <span className="text-xs font-bold tracking-wide text-[#4A4640]">
                        Assigned Coach Guidance
                      </span>
                    </div>
                    <span className="text-xs font-bold text-[#C93E0B] bg-[#FF5A1F]/10 px-2.5 py-1 rounded-lg border border-[#FF5A1F]/20">
                      Certified Coach
                    </span>
                  </div>

                  <div className="mt-5 space-y-4">
                    <div className="flex items-center justify-between p-4 rounded-2xl bg-white/80 border border-[#ECE7E0]">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#FF5A1F]/20 to-[#FF5A1F]/20 border border-[#FF5A1F]/30 flex items-center justify-center text-[#C93E0B] font-bold">
                          <IconUser size={22} />
                        </div>
                        <div>
                          <p className="text-base font-bold text-[#141414]">
                            {user.assignedTrainer?.name || "General Floor Coach"}
                          </p>
                          <p className="text-xs text-[#6B6760]">
                            {user.assignedTrainer?.specialization ||
                              "Strength & Conditioning Specialist"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 text-[#8A6100] font-bold text-sm bg-[#E0A100]/10 px-3 py-1.5 rounded-xl border border-[#E0A100]/20">
                        <IconCheck size={16} />
                        <span>{user.rating ? `${user.rating} / 10` : "Active"}</span>
                      </div>
                    </div>

                    <div className="p-4 rounded-2xl bg-[#F7F4EF]/60 border border-[#ECE7E0]/80 text-xs text-[#4A4640] leading-relaxed space-y-1.5">
                      <div className="flex items-center gap-2 text-[#6B6760] font-semibold text-[11px] tracking-wide">
                        <IconCheck size={13} />
                        <span>Latest Coach Feedback</span>
                      </div>
                      <p className="italic text-[#2A2724]">
                        &ldquo;
                        {user.trainerNotes ||
                          "Focus on compound movements, proper warmup mobility, and hydration during your sets."}
                        &rdquo;
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-5 pt-4 border-t border-[#ECE7E0]/80 flex items-center justify-between text-xs text-[#6B6760]">
                  <span>Direct Desk Assistance Available</span>
                  <span className="text-[#C93E0B] font-semibold">Trainer Verified Plan</span>
                </div>
              </div>

              <div className="lg:col-span-5 bg-[#FFFFFF]/90 rounded-2xl border border-[#ECE7E0]/90 p-7 flex flex-col justify-between shadow-md">
                <div>
                  <div className="flex items-center justify-between pb-4 border-b border-[#ECE7E0]">
                    <span className="text-xs font-bold tracking-wide text-[#4A4640]">
                      Tier Privileges
                    </span>
                    <span className="text-xs text-[#6B6760]">Included Access</span>
                  </div>

                  <div className="mt-5 space-y-3">
                    {[
                      {
                        title: "Cardio & Strength Zones",
                        detail: "Free weights, machines & functional training area",
                      },
                      {
                        title: "Turnstile Instant QR Pass",
                        detail: "One-touch gate entry with your mobile pass",
                      },
                      {
                        title: "Locker & Shower Facilities",
                        detail: "Clean locker room with hot water showers",
                      },
                    ].map((perk) => (
                      <div
                        key={perk.title}
                        className="p-3.5 rounded-2xl bg-white/80 border border-[#ECE7E0] flex items-center gap-3"
                      >
                        <div className="w-8 h-8 rounded-xl bg-[#FF5A1F]/10 text-[#C93E0B] flex items-center justify-center font-bold text-sm">
                          ✓
                        </div>
                        <div className="text-xs">
                          <strong className="text-[#141414] block font-semibold">
                            {perk.title}
                          </strong>
                          <span className="text-[#6B6760] text-[11px]">{perk.detail}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-5 border-t border-[#ECE7E0]/80">
                  <button
                    onClick={() => {
                      setRenewError("");
                      setRenewModalOpen(true);
                    }}
                    className="w-full py-3 rounded-2xl bg-[#F7F4EF] hover:bg-[#F1EDE7] border border-[#E0D9CF]/80 hover:border-[#FF5A1F]/50 text-[#141414] font-bold text-xs tracking-wide transition-all cursor-pointer"
                  >
                    View All Membership Tiers
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "attendance" && (
          <div className="bg-[#FFFFFF] rounded-2xl border border-[#ECE7E0]/90 p-7 sm:p-9 space-y-6 shadow-md">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#ECE7E0]">
              <div>
                <h2 className="text-3xl font-bold text-[#141414] tracking-tight font-display">
                  Attendance Records & Consistency
                </h2>
                <p className="text-xs sm:text-sm text-[#6B6760] mt-1">
                  Verified check-in history logged by the gate terminal.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="px-3 py-1 rounded-full text-xs font-bold tracking-wide bg-[#FF5A1F]/10 text-[#C93E0B] border border-[#FF5A1F]/20">
                  {user.currentStatus === "IN" ? "Checked In Now" : "Currently Outside"}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              <div className="bg-white/90 p-6 rounded-2xl border border-[#ECE7E0]">
                <span className="text-xs font-bold tracking-wide text-[#6B6760]">
                  Completed Sessions
                </span>
                <p className="text-4xl font-bold text-[#141414] mt-2 font-display tabular-nums">
                  {attendanceCount}
                </p>
                <p className="text-xs text-[#6B6760] mt-1">Lifetime verified visits</p>
              </div>

              <div className="bg-white/90 p-6 rounded-2xl border border-[#ECE7E0]">
                <span className="text-xs font-bold tracking-wide text-[#6B6760]">
                  Current Presence
                </span>
                <p
                  className={`text-4xl font-bold mt-2 font-display tabular-nums ${
                    user.currentStatus === "IN" ? "text-[#17803F]" : "text-[#6B6760]"
                  }`}
                >
                  {user.currentStatus === "IN" ? "INSIDE" : "OUTSIDE"}
                </p>
                <p className="text-xs text-[#6B6760] mt-1">
                  {user.currentStatus === "IN" ? "Floor session underway" : "Turnstile logged out"}
                </p>
              </div>

              <div className="bg-white/90 p-6 rounded-2xl border border-[#ECE7E0]">
                <span className="text-xs font-bold tracking-wide text-[#6B6760]">
                  Facility Operating Hours
                </span>
                <p className="text-4xl font-bold text-[#C93E0B] mt-2 font-display tabular-nums">
                  OPEN
                </p>
                <p className="text-xs text-[#6B6760] mt-1">Mon - Sat: 06:00 to 22:00</p>
              </div>
            </div>

            <div className="p-5 rounded-2xl bg-[#F7F4EF]/60 border border-[#ECE7E0] text-xs text-[#4A4640] flex items-center justify-between">
              <span>
                Gate entry is scanned automatically via your digital QR token at the front counter.
              </span>
            </div>
          </div>
        )}

        {activeTab === "profile" && (
          <div className="bg-[#FFFFFF] rounded-2xl border border-[#ECE7E0]/90 p-7 sm:p-9 space-y-6 shadow-md">
            <div className="pb-6 border-b border-[#ECE7E0]">
              <h2 className="text-3xl font-bold text-[#141414] tracking-tight font-display">
                Member Profile & Registration Details
              </h2>
              <p className="text-xs sm:text-sm text-[#6B6760] mt-1">
                Your registered credentials and club membership profile.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="p-5 rounded-2xl bg-white/90 border border-[#ECE7E0]">
                  <span className="text-xs font-bold text-[#6B6760] tracking-wide">
                    Full Legal Name
                  </span>
                  <p className="text-lg font-bold text-[#141414] mt-1">{user.name}</p>
                </div>

                <div className="p-5 rounded-2xl bg-white/90 border border-[#ECE7E0]">
                  <span className="text-xs font-bold text-[#6B6760] tracking-wide">
                    Contact Phone
                  </span>
                  <p className="text-lg font-bold text-[#141414] mt-1">{user.phone || "—"}</p>
                </div>

                <div className="p-5 rounded-2xl bg-white/90 border border-[#ECE7E0]">
                  <span className="text-xs font-bold text-[#6B6760] tracking-wide">
                    Registered Email
                  </span>
                  <p className="text-lg font-bold text-[#141414] mt-1">{user.email || "N/A"}</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="p-5 rounded-2xl bg-white/90 border border-[#ECE7E0]">
                  <span className="text-xs font-bold text-[#6B6760] tracking-wide">
                    Assigned Coach
                  </span>
                  <p className="text-lg font-bold text-[#C93E0B] mt-1">
                    {user.assignedTrainer?.name || "General Floor Coach"}
                  </p>
                  <p className="text-xs text-[#6B6760] mt-1">
                    Specialization:{" "}
                    {user.assignedTrainer?.specialization || "General Fitness"}
                  </p>
                </div>

                <div className="p-5 rounded-2xl bg-white/90 border border-[#ECE7E0]">
                  <span className="text-xs font-bold text-[#6B6760] tracking-wide">
                    Access Privileges
                  </span>
                  <p className="text-lg font-bold text-[#141414] mt-1">
                    Full All-Access Membership
                  </p>
                  <p className="text-xs text-[#6B6760] mt-1">
                    Weight room, cardio floor, shower rooms, and certified coach assignment.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-[#ECE7E0]/60 py-6 px-6 text-center text-xs text-[#7A756D]">
        <p>© 2026 AURA Athletic Club · Professional Fitness & Performance ERP</p>
      </footer>

      {renewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#141414]/60 backdrop-blur-md">
          <div className="bg-[#FFFFFF] rounded-2xl border border-[#ECE7E0] w-full max-w-2xl p-6 sm:p-8 space-y-6 shadow-md relative max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-[#ECE7E0]">
              <div>
                <h3 className="text-2xl font-bold text-[#141414] font-display">
                  Renew / Extend Gym Membership
                </h3>
                <p className="text-xs text-[#6B6760] mt-1">
                  Select a subscription tier to extend your access period seamlessly.
                </p>
              </div>
              <button
                onClick={() => setRenewModalOpen(false)}
                className="text-[#6B6760] hover:text-[#141414] text-sm p-1 rounded-lg hover:bg-[#F1EDE7] cursor-pointer"
              >
                ✕
              </button>
            </div>

            {renewSuccess && (
              <div className="p-3.5 rounded-xl bg-[#FF5A1F]/10 border border-[#FF5A1F]/30 text-[#C93E0B] text-xs font-semibold flex items-center gap-2">
                <IconCheck size={16} />
                <span>{renewSuccess}</span>
              </div>
            )}

            {renewError && (
              <div className="p-3.5 rounded-xl bg-[#D93636]/10 border border-[#D93636]/30 text-[#C42B2B] text-xs font-semibold flex items-center gap-2">
                <IconAlertCircle size={16} />
                <span>{renewError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {GYM_PLANS.map((plan) => (
                <div
                  key={plan.id}
                  className="bg-white/90 rounded-2xl border border-[#ECE7E0] p-5 flex flex-col justify-between hover:border-[#FF5A1F]/50 transition-all"
                >
                  <div className="space-y-3">
                    <span className="text-[11px] font-bold tracking-wide text-[#C93E0B] bg-[#FF5A1F]/10 px-2 py-0.5 rounded border border-[#FF5A1F]/20">
                      {plan.tier}
                    </span>
                    <h4 className="text-base font-bold text-[#141414]">{plan.name}</h4>
                    <p className="text-3xl font-bold text-[#141414] font-display tabular-nums">
                      ₹{plan.price.toLocaleString()}
                    </p>
                    <p className="text-xs text-[#6B6760] leading-relaxed">{plan.description}</p>
                  </div>

                  <button
                    onClick={() => handleRenewPlan(plan.id)}
                    disabled={renewing}
                    className="mt-5 w-full py-2.5 rounded-xl bg-[#FF5A1F] hover:bg-[#FF7A45] text-[#141414] font-bold text-xs tracking-wide transition-all disabled:opacity-50 cursor-pointer shadow-md shadow-[#141414]/10"
                  >
                    {renewing ? "Processing..." : `Select ${plan.durationMonths} Mo`}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
