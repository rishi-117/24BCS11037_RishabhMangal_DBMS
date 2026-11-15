"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api, ApiClientError } from "@/lib/client";
import { computeMembership } from "@/lib/membershipUtils";
import type { ClientRow, SessionUser } from "@/lib/types";
import {
  IconDumbbell,
  IconUser,
  IconQrCode,
  IconLogOut,
  IconAlertCircle,
  IconRefresh,
  IconClock,
} from "@/lib/svgIcons";

interface ClientWithMembership extends ClientRow {
  membership: ReturnType<typeof computeMembership>;
}

const MANAGEMENT_NOTICES = [
  "Ensure all morning batch trainees complete full mobility warm-ups.",
  "Update workout notes for newly enrolled quarterly members.",
];

export default function TrainerPortal() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"assigned" | "today" | "all" | "duty">("assigned");
  const [trainer, setTrainer] = useState<SessionUser | null>(null);
  const [assignedClients, setAssignedClients] = useState<ClientWithMembership[]>([]);
  const [clientsData, setClientsData] = useState<ClientWithMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [selectedClient, setSelectedClient] = useState<ClientWithMembership | null>(null);
  const [ratingValue, setRatingValue] = useState(8);
  const [trainerNotes, setTrainerNotes] = useState("");
  const [savingRating, setSavingRating] = useState(false);
  const [saveError, setSaveError] = useState("");

  const bootstrap = useCallback(async () => {
    try {
      const me = await api.me();

      if (!me.authenticated || !me.user) {
        router.replace("/trainer/login");
        return;
      }
      if (me.user.role !== "trainer") {
        router.replace("/dashboard");
        return;
      }
      if (me.user.status !== "approved") {
        router.replace("/pending-approval");
        return;
      }

      setTrainer(me.user);

      const roster = await api.trainerClients();
      const withMembership = (list: ClientRow[]): ClientWithMembership[] =>
        list.map((client) => ({
          ...client,
          membership: computeMembership(client.plan, client.createdAt),
        }));

      setClientsData(withMembership(roster.all ?? []));
      setAssignedClients(withMembership(roster.assigned ?? []));
      setLoadError("");
    } catch (err) {
      setLoadError(
        err instanceof ApiClientError ? err.message : "Could not load the trainer workspace."
      );
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    // This effect initiates an external request or synchronizes the camera.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    bootstrap();
  }, [bootstrap]);

  const refreshRoster = async () => {
    try {
      const roster = await api.trainerClients();
      const withMembership = (list: ClientRow[]): ClientWithMembership[] =>
        list.map((client) => ({
          ...client,
          membership: computeMembership(client.plan, client.createdAt),
        }));
      setClientsData(withMembership(roster.all ?? []));
      setAssignedClients(withMembership(roster.assigned ?? []));
    } catch {
      /* keep the last good roster */
    }
  };

  const handleRateClick = (client: ClientWithMembership) => {
    setSelectedClient(client);
    setRatingValue(client.rating || 8);
    setTrainerNotes(client.trainerNotes || "");
    setSaveError("");
    setShowModal(true);
  };

  const submitRating = async () => {
    if (!selectedClient) return;
    setSavingRating(true);
    setSaveError("");

    try {
      await api.rateMember(selectedClient.id, ratingValue, trainerNotes.trim());

      const applyUpdate = (list: ClientWithMembership[]) =>
        list.map((client) =>
          client.id === selectedClient.id
            ? { ...client, rating: ratingValue, trainerNotes: trainerNotes.trim() }
            : client
        );

      setClientsData(applyUpdate);
      setAssignedClients(applyUpdate);
      setShowModal(false);
    } catch (err) {
      setSaveError(err instanceof ApiClientError ? err.message : "Failed to save rating.");
    } finally {
      setSavingRating(false);
    }
  };

  const handleLogout = async () => {
    await api.logout().catch(() => undefined);
    router.push("/");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAF8F5] flex items-center justify-center text-[#4A4640]">
        <div className="flex flex-col items-center gap-3">
          <IconRefresh className="animate-spin text-[#C93E0B]" size={32} />
          <p className="text-sm font-medium tracking-wide">Loading Trainer Terminal...</p>
        </div>
      </div>
    );
  }

  if (loadError || !trainer) {
    return (
      <div className="min-h-screen bg-[#FAF8F5] flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-[#D93636]/30 bg-white p-8 text-center space-y-4">
          <IconAlertCircle size={32} className="mx-auto text-[#C42B2B]" />
          <h2 className="text-xl font-bold text-[#141414] font-display">Workspace unavailable</h2>
          <p className="text-xs text-[#6B6760]">{loadError || "Please sign in again."}</p>
          <button onClick={() => router.push("/trainer/login")} className="btn-secondary w-full">
            Return to Coach Sign In
          </button>
        </div>
      </div>
    );
  }

  const shiftsAttended = trainer.totalSessions;
  const shiftsAssigned = Math.max(shiftsAttended, 1);
  const attendanceRate = Math.min(Math.round((shiftsAttended / shiftsAssigned) * 100), 100);
  const presentToday = clientsData.filter((c) => c.isPresent).length;

  const membershipBadge = (status: string, daysRemaining: number) => {
    if (status === "ACTIVE") {
      return {
        label: `Active (${daysRemaining}d)`,
        className: "bg-[#1F9D55]/10 text-[#17803F] border border-[#1F9D55]/20",
      };
    }
    if (status === "EXPIRING_SOON") {
      return {
        label: `Expires in ${daysRemaining}d`,
        className: "bg-[#E0A100]/10 text-[#8A6100] border border-[#E0A100]/20",
      };
    }
    return {
      label: "Expired",
      className: "bg-[#D93636]/10 text-[#C42B2B] border border-[#D93636]/20",
    };
  };

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#141414] flex flex-col">
      <header className="border-b border-[#ECE7E0] bg-[#FFFFFF]/90 backdrop-blur-md sticky top-0 z-40 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#FF5A1F] to-[#FF5A1F] flex items-center justify-center text-[#141414] shadow-md shadow-[#141414]/10">
              <IconDumbbell size={22} />
            </div>
            <div>
              <span className="font-bold tracking-wide text-base text-[#141414]">
                AURA Athletic
              </span>
              <span className="hidden sm:inline-block ml-2 px-2 py-0.5 rounded text-[11px] font-bold tracking-wide bg-[#FF5A1F]/10 text-[#C93E0B] border border-[#FF5A1F]/20">
                Trainer Portal
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span
              className={`hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold tracking-wide ${
                trainer.currentStatus === "IN"
                  ? "bg-[#1F9D55]/10 text-[#17803F] border border-[#1F9D55]/30"
                  : "bg-[#F1EDE7] text-[#6B6760] border border-[#E0D9CF]"
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  trainer.currentStatus === "IN" ? "bg-[#1F9D55] animate-pulse" : "bg-[#A09A92]"
                }`}
              />
              {trainer.currentStatus === "IN" ? "On Duty" : "Off Duty"}
            </span>

            <button
              onClick={() => router.push("/trainer/attendance")}
              className="px-4 py-2 rounded-lg bg-[#FF5A1F] hover:bg-[#FF7A45] text-[#141414] font-bold text-xs flex items-center gap-2 transition-all shadow-md shadow-[#141414]/10"
            >
              <IconQrCode size={16} />
              <span>Duty Terminal</span>
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
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-[#ECE7E0]/80">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#141414] font-display">
              Coach {trainer.name}
            </h1>
            <p className="text-xs sm:text-sm text-[#6B6760] mt-1">
              Specialization:{" "}
              <span className="text-[#2A2724]">{trainer.specialization || "General Fitness"}</span>{" "}
              · {assignedClients.length} Assigned Clients
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 bg-white/90 p-1.5 rounded-xl border border-[#ECE7E0]">
            {(
              [
                ["assigned", `My Clients (${assignedClients.length})`],
                ["today", `Active Today (${presentToday})`],
                ["all", `All Members (${clientsData.length})`],
                ["duty", "Duty Stats"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`px-3 sm:px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === key
                    ? "bg-[#F1EDE7] text-[#141414] shadow-sm"
                    : "text-[#6B6760] hover:text-[#2A2724]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {activeTab === "assigned" && (
          <div className="bg-[#FFFFFF] rounded-2xl border border-[#ECE7E0] overflow-hidden">
            <div className="p-6 border-b border-[#ECE7E0] flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-[#141414] font-display">
                  Assigned Trainees Roster
                </h2>
                <p className="text-xs text-[#6B6760] mt-1">
                  Manage assigned client workout consistency, membership standing, and feedback.
                </p>
              </div>
              <span className="text-xs font-semibold text-[#6B6760]">
                {assignedClients.length} Trainees Assigned
              </span>
            </div>

            {assignedClients.length === 0 ? (
              <div className="p-12 text-center text-[#6B6760]">
                <IconUser size={36} className="mx-auto mb-3 opacity-40" />
                <p className="font-semibold text-[#4A4640]">No trainees assigned to you yet</p>
                <p className="text-xs text-[#7A756D] mt-1">
                  Members who select you as their personal trainer during registration will appear
                  here.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs sm:text-sm">
                  <thead className="bg-white/80 text-[#6B6760] text-[11px] font-semibold tracking-wide border-b border-[#ECE7E0]">
                    <tr>
                      <th className="py-3.5 px-6">Member Name</th>
                      <th className="py-3.5 px-6">Phone</th>
                      <th className="py-3.5 px-6">Membership</th>
                      <th className="py-3.5 px-6">Sessions</th>
                      <th className="py-3.5 px-6">Status Today</th>
                      <th className="py-3.5 px-6">Score</th>
                      <th className="py-3.5 px-6 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#ECE7E0]/80 text-[#2A2724]">
                    {assignedClients.map((client) => {
                      const badge = membershipBadge(
                        client.membership.status,
                        client.membership.daysRemaining
                      );
                      return (
                        <tr key={client.id} className="hover:bg-[#F1EDE7]/40 transition-colors">
                          <td className="py-4 px-6 font-semibold text-[#141414]">{client.name}</td>
                          <td className="py-4 px-6 text-[#6B6760]">{client.phone}</td>
                          <td className="py-4 px-6">
                            <span
                              className={`whitespace-nowrap px-2.5 py-1 rounded-md text-[11px] font-bold tracking-wide ${badge.className}`}
                            >
                              {badge.label}
                            </span>
                          </td>
                          <td className="py-4 px-6 font-semibold">{client.attendanceCount}</td>
                          <td className="py-4 px-6">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                                client.isPresent
                                  ? "bg-[#FF5A1F]/10 text-[#C93E0B]"
                                  : "bg-[#F1EDE7] text-[#6B6760]"
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  client.isPresent ? "bg-[#FF5A1F]" : "bg-[#A09A92]"
                                }`}
                              />
                              {client.isPresent ? "Checked In" : "Absent"}
                            </span>
                          </td>
                          <td className="py-4 px-6">
                            <span className="font-bold text-[#8A6100]">
                              {client.rating ? `${client.rating} / 10` : "-"}
                            </span>
                          </td>
                          <td className="py-4 px-6 text-right">
                            <button
                              onClick={() => handleRateClick(client)}
                              className="px-3 py-1.5 rounded-lg bg-[#F1EDE7] hover:bg-[#E4DED5] text-[#2A2724] border border-[#E0D9CF] text-xs font-semibold transition-all"
                            >
                              Rate Workout
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === "today" && (
          <div className="bg-[#FFFFFF] rounded-2xl border border-[#ECE7E0] overflow-hidden">
            <div className="p-6 border-b border-[#ECE7E0] flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-[#141414] font-display">
                  Present on Gym Floor Today
                </h2>
                <p className="text-xs text-[#6B6760] mt-1">
                  Members who have recorded a check-in at the facility entrance terminal.
                </p>
              </div>
              <button onClick={refreshRoster} className="btn-slate text-xs py-1.5 px-3">
                <IconRefresh size={14} />
                <span>Refresh</span>
              </button>
            </div>

            {presentToday === 0 ? (
              <div className="p-12 text-center text-[#6B6760]">
                <IconClock size={36} className="mx-auto mb-3 opacity-40" />
                <p className="font-semibold text-[#4A4640]">No members checked in yet today</p>
                <p className="text-xs text-[#7A756D] mt-1">
                  When members scan their entry QR, their presence appears here.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs sm:text-sm">
                  <thead className="bg-white/80 text-[#6B6760] text-[11px] font-semibold tracking-wide border-b border-[#ECE7E0]">
                    <tr>
                      <th className="py-3.5 px-6">Member Name</th>
                      <th className="py-3.5 px-6">Phone</th>
                      <th className="py-3.5 px-6">Assigned Trainer</th>
                      <th className="py-3.5 px-6">Membership</th>
                      <th className="py-3.5 px-6 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#ECE7E0]/80 text-[#2A2724]">
                    {clientsData
                      .filter((c) => c.isPresent)
                      .map((client) => (
                        <tr key={client.id} className="hover:bg-[#F1EDE7]/40 transition-colors">
                          <td className="py-4 px-6 font-semibold text-[#141414]">{client.name}</td>
                          <td className="py-4 px-6 text-[#6B6760]">{client.phone}</td>
                          <td className="py-4 px-6">{client.assignedTrainer?.name || "General"}</td>
                          <td className="py-4 px-6">
                            <span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-[#FF5A1F]/10 text-[#C93E0B] border border-[#FF5A1F]/20">
                              {client.membership.planName}
                            </span>
                          </td>
                          <td className="py-4 px-6 text-right">
                            <button
                              onClick={() => handleRateClick(client)}
                              className="px-3 py-1.5 rounded-lg bg-[#F1EDE7] hover:bg-[#E4DED5] text-[#2A2724] border border-[#E0D9CF] text-xs font-semibold transition-all"
                            >
                              Rate Workout
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

        {activeTab === "all" && (
          <div className="bg-[#FFFFFF] rounded-2xl border border-[#ECE7E0] overflow-hidden">
            <div className="p-6 border-b border-[#ECE7E0]">
              <h2 className="text-xl font-bold text-[#141414] font-display">
                All Registered Gym Members
              </h2>
              <p className="text-xs text-[#6B6760] mt-1">
                Complete member directory across all training tiers.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead className="bg-white/80 text-[#6B6760] text-[11px] font-semibold tracking-wide border-b border-[#ECE7E0]">
                  <tr>
                    <th className="py-3.5 px-6">Member Name</th>
                    <th className="py-3.5 px-6">Phone</th>
                    <th className="py-3.5 px-6">Trainer</th>
                    <th className="py-3.5 px-6">Membership Standing</th>
                    <th className="py-3.5 px-6">Total Sessions</th>
                    <th className="py-3.5 px-6">Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ECE7E0]/80 text-[#2A2724]">
                  {clientsData.map((client) => {
                    const badge = membershipBadge(
                      client.membership.status,
                      client.membership.daysRemaining
                    );
                    return (
                      <tr key={client.id} className="hover:bg-[#F1EDE7]/40 transition-colors">
                        <td className="py-4 px-6 font-semibold text-[#141414]">{client.name}</td>
                        <td className="py-4 px-6 text-[#6B6760]">{client.phone}</td>
                        <td className="py-4 px-6">
                          {client.assignedTrainer?.name || "Not Assigned"}
                        </td>
                        <td className="py-4 px-6">
                          <span
                            className={`whitespace-nowrap px-2.5 py-1 rounded-md text-[11px] font-bold tracking-wide ${badge.className}`}
                          >
                            {client.membership.status}
                          </span>
                        </td>
                        <td className="py-4 px-6 font-semibold">{client.attendanceCount}</td>
                        <td className="py-4 px-6 font-bold text-[#8A6100]">
                          {client.rating ? `${client.rating} / 10` : "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "duty" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-[#FFFFFF] rounded-2xl border border-[#ECE7E0] p-6 space-y-6">
              <div>
                <h3 className="text-xl font-bold text-[#141414] font-display">
                  Duty Attendance Consistency
                </h3>
                <p className="text-xs text-[#6B6760] mt-1">
                  Track your professional shifts and duty check-in record.
                </p>
              </div>

              <div className="bg-white/80 p-5 rounded-xl border border-[#ECE7E0]">
                <span className="text-xs font-semibold tracking-wide text-[#6B6760]">
                  Consistency Score
                </span>
                <p className="text-5xl font-bold text-[#C93E0B] mt-2 font-display tabular-nums">
                  {attendanceRate}%
                </p>
                <p className="text-xs text-[#6B6760] mt-1">
                  Shifts Attended: <strong className="text-[#141414]">{shiftsAttended}</strong> /{" "}
                  {shiftsAssigned} assigned
                </p>
              </div>

              <div className="pt-2">
                <button
                  onClick={() => router.push("/trainer/attendance")}
                  className="w-full py-3 rounded-xl bg-[#FF5A1F] hover:bg-[#FF7A45] text-[#141414] font-bold text-xs tracking-wide flex items-center justify-center gap-2 transition-all shadow-md shadow-[#141414]/10"
                >
                  <IconQrCode size={18} />
                  <span>Scan Duty Entrance / Exit</span>
                </button>
              </div>
            </div>

            <div className="bg-[#FFFFFF] rounded-2xl border border-[#ECE7E0] p-6 space-y-4">
              <div>
                <h3 className="text-xl font-bold text-[#141414] font-display">
                  Management Notices
                </h3>
                <p className="text-xs text-[#6B6760] mt-1">
                  Official communications from gym admin.
                </p>
              </div>

              <div className="space-y-3">
                {MANAGEMENT_NOTICES.map((notice, i) => (
                  <div
                    key={i}
                    className="p-4 rounded-xl bg-white/80 border border-[#ECE7E0] text-xs text-[#4A4640] leading-relaxed"
                  >
                    <span className="text-[#C93E0B] font-bold block mb-1">Notice #{i + 1}</span>
                    {notice}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {showModal && selectedClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#141414]/60 backdrop-blur-sm">
          <div className="bg-[#FFFFFF] rounded-2xl border border-[#ECE7E0] w-full max-w-lg p-6 sm:p-8 space-y-6 shadow-md">
            <div className="flex items-center justify-between pb-4 border-b border-[#ECE7E0]">
              <div>
                <h3 className="text-xl font-bold text-[#141414] font-display">
                  Rate Workout: {selectedClient.name}
                </h3>
                <p className="text-xs text-[#6B6760] mt-0.5">
                  Record performance score and coach feedback for this trainee.
                </p>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="text-[#6B6760] hover:text-[#141414] text-sm"
              >
                Close
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs tracking-wide font-semibold text-[#6B6760] mb-2">
                  Performance Score (1 - 10):{" "}
                  <span className="text-[#8A6100] font-bold">{ratingValue}/10</span>
                </label>
                <div className="grid grid-cols-10 gap-1.5">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((score) => (
                    <button
                      key={score}
                      type="button"
                      onClick={() => setRatingValue(score)}
                      className={`py-2 rounded-lg text-xs font-bold transition-all ${
                        ratingValue === score
                          ? "bg-[#E0A100] text-[#141414] scale-105 shadow-md shadow-[#141414]/10"
                          : "bg-[#F1EDE7] text-[#4A4640] hover:bg-[#E4DED5]"
                      }`}
                    >
                      {score}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs tracking-wide font-semibold text-[#6B6760] mb-2">
                  Coach Guidance & Session Notes
                </label>
                <textarea
                  rows={3}
                  value={trainerNotes}
                  onChange={(e) => setTrainerNotes(e.target.value)}
                  placeholder="e.g. Great intensity today on compound movements. Focus on posture during deadlifts."
                  className="w-full bg-[#F7F4EF] border border-[#ECE7E0] rounded-xl p-3 text-xs text-[#141414] focus:outline-none focus:border-[#FF5A1F] transition-colors"
                />
              </div>

              {saveError && (
                <div className="p-3 rounded-xl bg-[#D93636]/10 border border-[#D93636]/30 text-[#C42B2B] text-xs flex items-center gap-2">
                  <IconAlertCircle size={16} className="shrink-0" />
                  <span>{saveError}</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#ECE7E0]">
              <button
                onClick={() => setShowModal(false)}
                disabled={savingRating}
                className="px-4 py-2 rounded-lg bg-[#F1EDE7] hover:bg-[#E4DED5] text-[#4A4640] text-xs font-semibold transition-all"
              >
                Cancel
              </button>
              <button
                onClick={submitRating}
                disabled={savingRating}
                className="px-5 py-2 rounded-lg bg-[#FF5A1F] hover:bg-[#FF7A45] text-[#141414] font-bold text-xs tracking-wide transition-all disabled:opacity-50"
              >
                {savingRating ? "Saving..." : "Save Rating & Notes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
