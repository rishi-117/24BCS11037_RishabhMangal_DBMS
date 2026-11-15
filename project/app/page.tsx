"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { GYM_PLANS } from "@/lib/membershipUtils";
import { api, ApiClientError } from "@/lib/client";
import type { SessionUser, TrainerListItem } from "@/lib/types";
import {
  IconDumbbell,
  IconUser,
  IconUsers,
  IconShield,
  IconX,
  IconAlertCircle,
  IconLogOut,
  IconCheck,
} from "@/lib/svgIcons";

type Role = "member" | "trainer";

export default function Home() {
  const router = useRouter();

  const [loadingRole, setLoadingRole] = useState<Role | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [rejectedTrainer, setRejectedTrainer] = useState<SessionUser | null>(null);
  const [session, setSession] = useState<SessionUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  const [signInRole, setSignInRole] = useState<Role | null>(null);
  const [showMemberModal, setShowMemberModal] = useState(false);
  const [showTrainerModal, setShowTrainerModal] = useState(false);

  const [trainers, setTrainers] = useState<TrainerListItem[]>([]);
  const [creds, setCreds] = useState({ identifier: "", password: "" });

  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    email: "",
    password: "",
    assignedTrainerUid: "",
    selectedPlanCode: GYM_PLANS[0].id,
    specialization: "Strength & Conditioning",
    experience: "1-3 Years",
  });

  const loadSession = useCallback(async () => {
    try {
      const data = await api.me();
      if (data.authenticated && data.user) {
        setSession(data.user);
        if (
          data.user.role === "trainer" &&
          (data.user.status === "rejected" || data.user.status === "revoked")
        ) {
          setRejectedTrainer(data.user);
        }
      } else {
        setSession(null);
      }
    } catch {
      setSession(null);
    } finally {
      setCheckingSession(false);
    }
  }, []);

  useEffect(() => {
    // This effect initiates an external request or synchronizes the camera.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSession();
  }, [loadSession]);

  useEffect(() => {
    api
      .trainers()
      .then((data) => setTrainers(data.trainers ?? []))
      .catch(() => setTrainers([]));
  }, []);

  const routeForUser = (user: SessionUser): string | null => {
    if (user.role === "admin") return "/admin";
    if (user.role === "trainer") {
      if (user.status === "approved") return "/trainer/dashboard";
      if (user.status === "pending") return "/pending-approval";
      return null;
    }
    return "/dashboard";
  };

  /** Sign in, then verify the account matches the card the user clicked. */
  const handleSignIn = async (targetRole: Role) => {
    setError("");
    setLoadingRole(targetRole);

    try {
      const { user } = await api.login(creds.identifier.trim(), creds.password);
      setSession(user);

      const destination = routeForUser(user);

      if (targetRole === "trainer") {
        if (user.role !== "trainer") {
          const label = user.role === "admin" ? "administrator" : "member";
          setError(
            `This account is registered as a ${label}. Please use the ${label === "member" ? "Member" : "Admin"} portal.`
          );
          return;
        }
        if (!destination) {
          setRejectedTrainer(user);
          setSignInRole(null);
          return;
        }
        setSignInRole(null);
        router.push(destination);
        return;
      }

      if (user.role === "trainer") {
        setError(
          "This account is registered as a coach. Please sign in through the Trainer Terminal card."
        );
        return;
      }

      setSignInRole(null);
      router.push(destination ?? "/dashboard");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Sign in failed. Please try again.");
    } finally {
      setLoadingRole(null);
    }
  };

  const submitRegistration = async (role: Role) => {
    setError("");
    setSubmitting(true);

    try {
      const result = await api.register({
        email: formData.email.trim(),
        password: formData.password,
        name: formData.name.trim() || "User",
        phone: formData.phone.trim() || "N/A",
        role,
        ...(role === "member"
          ? {
              planCode: formData.selectedPlanCode,
              assignedTrainerUid: formData.assignedTrainerUid || null,
            }
          : {
              specialization: formData.specialization,
              experience: formData.experience,
            }),
      });

      setSession(result.user);
      setShowMemberModal(false);
      setShowTrainerModal(false);
      router.push(role === "trainer" ? "/pending-approval" : "/dashboard");
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : "Registration failed. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await api.logout().catch(() => undefined);
    setSession(null);
    setRejectedTrainer(null);
  };

  const openSignIn = (role: Role) => {
    setError("");
    setCreds({ identifier: "", password: "" });
    setSignInRole(role);
  };

  const openJoin = () => {
    setError("");
    setShowMemberModal(true);
  };

  const openApply = () => {
    setError("");
    setShowTrainerModal(true);
  };

  const registrationIncomplete =
    !formData.name || !formData.phone || !formData.email || formData.password.length < 8;

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#141414] flex flex-col justify-between selection:bg-[#FF5A1F] selection:text-[#141414]">
      <header className="border-b border-[#ECE7E0]/80 bg-white/80 backdrop-blur-md px-6 py-4 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#FF5A1F] via-[#FF5A1F] to-[#FFFFFF] flex items-center justify-center text-[#141414] shadow-md shadow-[#141414]/10 ring-1 ring-[#FF5A1F]/30">
              <IconDumbbell size={22} />
            </div>
            <div>
              <span className="font-bold tracking-wide text-base text-[#141414] block leading-tight">
                AURA
              </span>
              <span className="text-[11px] text-[#C93E0B] font-semibold tracking-wide">
                Athletic Club
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.push("/admin")}
              className="px-4 py-2 rounded-xl bg-[#F7F4EF] hover:bg-[#F1EDE7] border border-[#D8D0C5] hover:border-[#BDB6AB] text-[#2A2724] text-sm font-bold tracking-wide transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
              title="Admin ERP Login"
            >
              <IconShield size={15} />
              <span>Admin</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12 flex-1 flex flex-col justify-center items-center w-full">
        {session && (
          <div className="w-full max-w-2xl mb-8 p-4 rounded-2xl bg-white/90 border border-[#FF5A1F]/30 shadow-md backdrop-blur-md flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#FF5A1F]/20 text-[#C93E0B] flex items-center justify-center font-bold">
                {session.role === "trainer" ? "TR" : session.role === "admin" ? "AD" : "MB"}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[#141414]">{session.name}</span>
                  <span className="px-2 py-0.5 rounded text-[11px] font-bold tracking-wide bg-[#FF5A1F]/10 text-[#C93E0B] border border-[#FF5A1F]/20">
                    {session.role}
                  </span>
                </div>
                <span className="text-xs text-[#6B6760]">{session.email}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const destination = routeForUser(session);
                  if (destination) router.push(destination);
                }}
                className="px-4 py-2 rounded-xl bg-[#FF5A1F] hover:bg-[#FF7A45] text-[#141414] font-bold text-xs tracking-wide transition-all cursor-pointer"
              >
                Go to Portal &rarr;
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="p-2 rounded-xl bg-[#F1EDE7] hover:bg-[#E4DED5] text-[#6B6760] hover:text-[#141414] transition-all cursor-pointer"
                title="Sign Out"
              >
                <IconLogOut size={16} />
              </button>
            </div>
          </div>
        )}

        {error && !signInRole && !showMemberModal && !showTrainerModal && (
          <div className="w-full max-w-2xl mb-6 p-4 rounded-xl bg-[#D93636]/10 border border-[#D93636]/30 text-[#C42B2B] text-xs flex items-center gap-3">
            <IconAlertCircle size={18} className="shrink-0 text-[#C42B2B]" />
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={() => setError("")}
              className="text-[#6B6760] hover:text-[#141414]"
            >
              <IconX size={16} />
            </button>
          </div>
        )}

        {rejectedTrainer && (
          <div className="w-full max-w-2xl mb-6 p-5 rounded-xl bg-[#D93636]/10 border border-[#D93636]/30 text-center space-y-2">
            <IconAlertCircle size={24} className="mx-auto text-[#C42B2B]" />
            <h4 className="text-sm font-bold text-[#141414]">Application Not Approved</h4>
            <p className="text-xs text-[#6B6760]">
              Your application to join the coaching staff was declined by gym management.
            </p>
            <button
              type="button"
              onClick={handleLogout}
              className="mt-2 px-4 py-1.5 rounded-lg bg-[#F1EDE7] hover:bg-[#E4DED5] text-xs text-[#4A4640] font-semibold"
            >
              Sign Out
            </button>
          </div>
        )}

        <div className="text-center mb-10 space-y-2">
          <span className="px-3 py-1 rounded-full text-[11px] font-bold tracking-wide bg-[#FF5A1F]/10 text-[#C93E0B] border border-[#FF5A1F]/20 inline-block mb-1">
            Sign In Portal
          </span>
          <h1 className="text-4xl sm:text-5xl font-bold text-[#141414] tracking-tight font-display">
            Choose Your Account
          </h1>
          <p className="text-[#6B6760] text-xs sm:text-sm max-w-md mx-auto">
            Please select whether you are accessing as a gym member or as coaching staff.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-3xl">
          {/* CARD 1: MEMBER */}
          <div className="relative rounded-2xl bg-[#FFFFFF]/90 border border-[#ECE7E0] hover:border-[#FF5A1F]/50 p-7 flex flex-col justify-between transition-all duration-300 group hover:shadow-md hover:shadow-[#141414]/10">
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-2xl bg-[#FF5A1F]/10 border border-[#FF5A1F]/20 text-[#C93E0B] flex items-center justify-center group-hover:scale-105 transition-transform">
                  <IconUser size={24} />
                </div>
                <span className="px-3 py-1 rounded-full text-[11px] font-bold tracking-wide bg-[#FF5A1F]/10 text-[#C93E0B] border border-[#FF5A1F]/20">
                  Member
                </span>
              </div>

              <div>
                <h2 className="text-2xl font-bold text-[#141414] group-hover:text-[#C93E0B] transition-colors font-display">
                  Member Portal
                </h2>
                <p className="text-xs text-[#6B6760] mt-1 leading-relaxed">
                  Access your active subscription, scan digital QR passes, and check coach guidance.
                </p>
              </div>

              <ul className="space-y-2 pt-2 border-t border-[#ECE7E0]/80 text-xs text-[#4A4640]">
                <li className="flex items-center gap-2">
                  <span className="text-[#C93E0B] font-bold">✓</span>
                  <span>Personal Membership & Renewal Stats</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-[#C93E0B] font-bold">✓</span>
                  <span>Instant Digital Gate QR Pass</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-[#C93E0B] font-bold">✓</span>
                  <span>Assigned Certified Coach Details</span>
                </li>
              </ul>
            </div>

            <div className="pt-6 space-y-3">
              <button
                type="button"
                onClick={() => openSignIn("member")}
                disabled={checkingSession}
                className="w-full py-3.5 px-4 rounded-xl bg-white hover:bg-[#F7F4EF] border border-[#D8D0C5] text-[#141414] font-bold text-sm tracking-wide flex items-center justify-center gap-3 transition-all cursor-pointer disabled:opacity-50"
              >
                <IconUser size={18} className="text-[#C93E0B]" />
                <span>Sign In as Member</span>
              </button>

              <p className="text-center text-[11px] text-[#7A756D]">
                New member?{" "}
                <button
                  type="button"
                  onClick={openJoin}
                  className="text-[#C93E0B] font-bold hover:underline cursor-pointer"
                >
                  Join as a Member
                </button>
              </p>
            </div>
          </div>

          {/* CARD 2: TRAINER */}
          <div className="relative rounded-2xl bg-[#FFFFFF]/90 border border-[#ECE7E0] hover:border-[#FF5A1F]/50 p-7 flex flex-col justify-between transition-all duration-300 group hover:shadow-md hover:shadow-[#141414]/10">
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-2xl bg-[#FF5A1F]/10 border border-[#FF5A1F]/20 text-[#C93E0B] flex items-center justify-center group-hover:scale-105 transition-transform">
                  <IconUsers size={24} />
                </div>
                <span className="px-3 py-1 rounded-full text-[11px] font-bold tracking-wide bg-[#FF5A1F]/10 text-[#C93E0B] border border-[#FF5A1F]/20">
                  Trainer
                </span>
              </div>

              <div>
                <h2 className="text-2xl font-bold text-[#141414] group-hover:text-[#C93E0B] transition-colors font-display">
                  Trainer Terminal
                </h2>
                <p className="text-xs text-[#6B6760] mt-1 leading-relaxed">
                  Manage assigned fitness clients, review workout performance, and log coaching
                  shifts.
                </p>
              </div>

              <ul className="space-y-2 pt-2 border-t border-[#ECE7E0]/80 text-xs text-[#4A4640]">
                <li className="flex items-center gap-2">
                  <span className="text-[#C93E0B] font-bold">✓</span>
                  <span>Assigned Trainee Rosters & Goals</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-[#C93E0B] font-bold">✓</span>
                  <span>Duty Shift Check-In & Attendance</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-[#C93E0B] font-bold">✓</span>
                  <span>Workout Logs & Performance Feedback</span>
                </li>
              </ul>
            </div>

            <div className="pt-6 space-y-3">
              <button
                type="button"
                onClick={() => openSignIn("trainer")}
                disabled={checkingSession}
                className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-[#FF5A1F] to-[#FF5A1F] hover:from-[#FF7A45] hover:to-[#FF7A45] text-[#141414] font-bold text-xs tracking-wide flex items-center justify-center gap-3 transition-all shadow-md shadow-[#141414]/10 cursor-pointer disabled:opacity-50"
              >
                <IconShield size={16} />
                <span>Sign In as Trainer</span>
              </button>

              <p className="text-center text-[11px] text-[#7A756D]">
                Want to coach here?{" "}
                <button
                  type="button"
                  onClick={openApply}
                  className="text-[#C93E0B] font-bold hover:underline cursor-pointer"
                >
                  Apply as Coach
                </button>
              </p>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-[#ECE7E0]/60 py-6 px-6 text-center text-xs text-[#7A756D]">
        <p>© 2026 AURA Athletic Club · Professional Fitness & Performance ERP</p>
      </footer>

      {/* ==================== MODAL: SIGN IN ==================== */}
      {signInRole && (
        <div className="fixed inset-0 z-50 bg-[#141414]/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#FFFFFF] border border-[#ECE7E0] rounded-2xl w-full max-w-md p-6 sm:p-7 shadow-md space-y-5 relative">
            <button
              type="button"
              onClick={() => setSignInRole(null)}
              className="absolute top-5 right-5 text-[#6B6760] hover:text-[#141414] p-1 rounded-lg hover:bg-[#F1EDE7] transition-colors cursor-pointer"
            >
              <IconX size={20} />
            </button>

            <div>
              <div className="flex items-center gap-2 text-[#C93E0B] text-xs font-bold tracking-wide mb-1">
                {signInRole === "member" ? <IconUser size={16} /> : <IconShield size={16} />}
                <span>{signInRole === "member" ? "Member Sign In" : "Coach Sign In"}</span>
              </div>
              <h3 className="text-2xl font-bold text-[#141414] font-display">
                {signInRole === "member" ? "Welcome Back" : "Coach Terminal"}
              </h3>
              <p className="text-xs text-[#6B6760]">
                {signInRole === "member"
                  ? "Sign in with the email and password you registered with."
                  : "Approved coaching staff can sign in here to access client rosters."}
              </p>
            </div>

            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                handleSignIn(signInRole);
              }}
            >
              <div>
                <label className="block text-xs font-semibold text-[#6B6760] tracking-wide mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={creds.identifier}
                  onChange={(e) => setCreds({ ...creds, identifier: e.target.value })}
                  className="gym-input"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#6B6760] tracking-wide mb-1">
                  Password
                </label>
                <input
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={creds.password}
                  onChange={(e) => setCreds({ ...creds, password: e.target.value })}
                  className="gym-input"
                  required
                />
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-[#D93636]/10 border border-[#D93636]/30 text-[#C42B2B] text-xs flex items-center gap-2">
                  <IconAlertCircle size={16} className="shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loadingRole !== null}
                className="w-full py-3.5 rounded-xl bg-[#FF5A1F] hover:bg-[#FF7A45] text-[#141414] font-bold text-xs tracking-wide transition-all disabled:opacity-50 shadow-md shadow-[#141414]/10 cursor-pointer"
              >
                {loadingRole ? "Signing In..." : "Sign In"}
              </button>
            </form>

            <p className="text-center text-[11px] text-[#7A756D] pt-2 border-t border-[#ECE7E0]/80">
              {signInRole === "member" ? (
                <>
                  No account yet?{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setSignInRole(null);
                      openJoin();
                    }}
                    className="text-[#C93E0B] font-bold hover:underline cursor-pointer"
                  >
                    Join as a Member
                  </button>
                </>
              ) : (
                <>
                  Not registered as staff?{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setSignInRole(null);
                      openApply();
                    }}
                    className="text-[#C93E0B] font-bold hover:underline cursor-pointer"
                  >
                    Apply as Coach
                  </button>
                </>
              )}
            </p>
          </div>
        </div>
      )}

      {/* ==================== MODAL: JOIN AS A MEMBER ==================== */}
      {showMemberModal && (
        <div className="fixed inset-0 z-50 bg-[#141414]/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#FFFFFF] border border-[#ECE7E0] rounded-2xl w-full max-w-lg p-6 sm:p-7 shadow-md space-y-5 relative max-h-[90vh] overflow-y-auto">
            <button
              type="button"
              onClick={() => setShowMemberModal(false)}
              className="absolute top-5 right-5 text-[#6B6760] hover:text-[#141414] p-1 rounded-lg hover:bg-[#F1EDE7] transition-colors cursor-pointer"
            >
              <IconX size={20} />
            </button>

            <div>
              <div className="flex items-center gap-2 text-[#C93E0B] text-xs font-bold tracking-wide mb-1">
                <IconUser size={16} />
                <span>Member Registration</span>
              </div>
              <h3 className="text-2xl font-bold text-[#141414] font-display">Join as a Member</h3>
              <p className="text-xs text-[#6B6760]">
                Select your subscription tier and assigned personal coach.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#6B6760] tracking-wide mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Rahul Sharma"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="gym-input"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#6B6760] tracking-wide mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="gym-input"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#6B6760] tracking-wide mb-1">
                    Contact Phone
                  </label>
                  <input
                    type="tel"
                    placeholder="+91 98765 43210"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="gym-input"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#6B6760] tracking-wide mb-1">
                  Create Password
                </label>
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="gym-input"
                  minLength={8}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#6B6760] tracking-wide mb-1">
                  Select Membership Tier
                </label>
                <div className="grid grid-cols-3 gap-2.5">
                  {GYM_PLANS.map((plan) => (
                    <button
                      key={plan.id}
                      type="button"
                      onClick={() => setFormData({ ...formData, selectedPlanCode: plan.id })}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                        formData.selectedPlanCode === plan.id
                          ? "bg-[#FF5A1F]/10 border-[#FF5A1F] text-[#141414]"
                          : "bg-[#F7F4EF] border-[#ECE7E0] text-[#6B6760] hover:border-[#E0D9CF]"
                      }`}
                    >
                      <span className="block text-[11px] font-bold text-[#C93E0B]">
                        {plan.durationMonths} Mo
                      </span>
                      <span className="block text-sm font-bold text-[#141414] mt-0.5">
                        ₹{plan.price}
                      </span>
                      <span className="block text-[11px] text-[#7A756D] mt-1 truncate">
                        {plan.tier}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#6B6760] tracking-wide mb-1">
                  Assigned Coach (Verified Trainers)
                </label>
                <select
                  value={formData.assignedTrainerUid}
                  onChange={(e) => setFormData({ ...formData, assignedTrainerUid: e.target.value })}
                  className="gym-select"
                >
                  <option value="">General Floor Coach (Default)</option>
                  {trainers.map((trainer) => (
                    <option key={trainer.uid} value={trainer.uid}>
                      {trainer.name} — {trainer.specialization}
                    </option>
                  ))}
                </select>
                {trainers.length === 0 && (
                  <p className="text-[11px] text-[#8A6100] mt-1 flex items-center gap-1">
                    <IconAlertCircle size={12} />
                    <span>No personal coaches currently listed. General coach assigned.</span>
                  </p>
                )}
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-[#D93636]/10 border border-[#D93636]/30 text-[#C42B2B] text-xs flex items-center gap-2">
                  <IconAlertCircle size={16} className="shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="button"
                onClick={() => submitRegistration("member")}
                disabled={submitting || registrationIncomplete}
                className="w-full py-3.5 rounded-xl bg-[#FF5A1F] hover:bg-[#FF7A45] text-[#141414] font-bold text-xs tracking-wide transition-all disabled:opacity-50 mt-2 shadow-md shadow-[#141414]/10 cursor-pointer"
              >
                {submitting ? "Processing..." : "Complete Registration & Activate"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL: APPLY AS COACH ==================== */}
      {showTrainerModal && (
        <div className="fixed inset-0 z-50 bg-[#141414]/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#FFFFFF] border border-[#ECE7E0] rounded-2xl w-full max-w-lg p-6 sm:p-7 shadow-md space-y-5 relative max-h-[90vh] overflow-y-auto">
            <button
              type="button"
              onClick={() => setShowTrainerModal(false)}
              className="absolute top-5 right-5 text-[#6B6760] hover:text-[#141414] p-1 rounded-lg hover:bg-[#F1EDE7] transition-colors cursor-pointer"
            >
              <IconX size={20} />
            </button>

            <div>
              <div className="flex items-center gap-2 text-[#C93E0B] text-xs font-bold tracking-wide mb-1">
                <IconShield size={16} />
                <span>Coach Verification</span>
              </div>
              <h3 className="text-2xl font-bold text-[#141414] font-display">
                Apply as Coaching Staff
              </h3>
              <p className="text-xs text-[#6B6760]">
                Staff profiles enter a verification gate pending management approval.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#6B6760] tracking-wide mb-1">
                  Coach Full Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Vikram Singh"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="gym-input"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#6B6760] tracking-wide mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    autoComplete="email"
                    placeholder="coach@example.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="gym-input"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#6B6760] tracking-wide mb-1">
                    Contact Phone
                  </label>
                  <input
                    type="tel"
                    placeholder="+91 98765 43210"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="gym-input"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#6B6760] tracking-wide mb-1">
                  Create Password
                </label>
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="gym-input"
                  minLength={8}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#6B6760] tracking-wide mb-1">
                  Primary Specialization
                </label>
                <select
                  value={formData.specialization}
                  onChange={(e) => setFormData({ ...formData, specialization: e.target.value })}
                  className="gym-select"
                >
                  <option value="Strength & Conditioning">Strength & Conditioning</option>
                  <option value="Bodybuilding & Hypertrophy">Bodybuilding & Hypertrophy</option>
                  <option value="CrossFit & Functional Training">
                    CrossFit & Functional Training
                  </option>
                  <option value="Fat Loss & Endurance">Fat Loss & Endurance</option>
                  <option value="Rehabilitation & Mobility">Rehabilitation & Mobility</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#6B6760] tracking-wide mb-1">
                  Certifications & Experience
                </label>
                <input
                  type="text"
                  placeholder="e.g. ACE Certified, 4 years exp."
                  value={formData.experience}
                  onChange={(e) => setFormData({ ...formData, experience: e.target.value })}
                  className="gym-input"
                />
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-[#D93636]/10 border border-[#D93636]/30 text-[#C42B2B] text-xs flex items-center gap-2">
                  <IconAlertCircle size={16} className="shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="p-3 rounded-xl bg-[#2F6FED]/10 border border-[#2F6FED]/20 text-[11px] text-[#1F57C9] flex items-start gap-2">
                <IconCheck size={14} className="shrink-0 mt-0.5" />
                <span>
                  Coach accounts require administrator approval before accessing client rosters and
                  duty terminals.
                </span>
              </div>

              <button
                type="button"
                onClick={() => submitRegistration("trainer")}
                disabled={submitting || registrationIncomplete}
                className="w-full py-3.5 rounded-xl bg-[#FF5A1F] hover:bg-[#FF7A45] text-[#141414] font-bold text-xs tracking-wide transition-all disabled:opacity-50 mt-2 shadow-md shadow-[#141414]/10 cursor-pointer"
              >
                {submitting ? "Submitting..." : "Submit Trainer Application"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
