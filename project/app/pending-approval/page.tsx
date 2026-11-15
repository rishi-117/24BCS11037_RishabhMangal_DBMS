"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import type { SessionUser } from "@/lib/types";
import { IconClock, IconShield, IconCheck, IconLogOut } from "@/lib/svgIcons";

/** Trainer waiting room. Polls the approval status so the unlock is near-instant. */
export default function PendingApprovalPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [isApproved, setIsApproved] = useState(false);

  const checkStatus = useCallback(async () => {
    try {
      const data = await api.me();

      if (!data.authenticated || !data.user) {
        router.replace("/");
        return;
      }

      if (data.user.role !== "trainer") {
        router.replace("/dashboard");
        return;
      }

      setProfile(data.user);

      if (data.user.status === "approved") {
        setIsApproved(true);
        setTimeout(() => router.replace("/trainer/dashboard"), 1500);
      }
    } catch {
      router.replace("/");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    // This effect initiates an external request or synchronizes the camera.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    checkStatus();
    const interval = setInterval(checkStatus, 10_000);
    return () => clearInterval(interval);
  }, [checkStatus]);

  const handleLogout = async () => {
    await api.logout().catch(() => undefined);
    router.push("/");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAF8F5] flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-[#FF5A1F] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-[#6B6760]">Verifying account credentials...</p>
        </div>
      </div>
    );
  }

  if (isApproved) {
    return (
      <div className="min-h-screen bg-[#FAF8F5] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-[#FFFFFF] border border-[#FF5A1F]/40 rounded-2xl p-8 shadow-md text-center">
          <div className="w-14 h-14 rounded-full bg-[#FF5A1F]/10 text-[#C93E0B] flex items-center justify-center mx-auto mb-4 border border-[#FF5A1F]/30">
            <IconCheck size={28} />
          </div>
          <h2 className="text-2xl font-bold text-[#141414] mb-2 font-display">
            Application Approved
          </h2>
          <p className="text-sm text-[#6B6760] leading-relaxed mb-6">
            Gym management has authorized your coaching account. Welcome to the AURA Athletic staff.
          </p>
          <div className="p-3 rounded-lg bg-[#FF5A1F]/10 border border-[#FF5A1F]/20 text-xs font-semibold text-[#C93E0B]">
            Unlocking Trainer Dashboard...
          </div>
        </div>
      </div>
    );
  }

  const rejected = profile?.status === "rejected" || profile?.status === "revoked";

  return (
    <div className="min-h-screen bg-[#FAF8F5] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#FFFFFF] border border-[#ECE7E0] rounded-2xl p-8 shadow-md">
        <div className="text-center mb-6">
          <div
            className={`inline-flex items-center justify-center w-12 h-12 rounded-xl mb-3 border ${
              rejected
                ? "bg-[#D93636]/10 border-[#D93636]/20 text-[#C42B2B]"
                : "bg-[#E0A100]/10 border-[#E0A100]/20 text-[#8A6100]"
            }`}
          >
            <IconClock size={24} />
          </div>
          <h1 className="text-2xl font-bold text-[#141414] font-display">
            {rejected ? "Application Not Approved" : "Application Pending Approval"}
          </h1>
          <p className="text-xs text-[#6B6760] mt-1">
            {rejected ? "Contact management for details" : "Management Verification in Progress"}
          </p>
        </div>

        <div className="bg-[#F7F4EF] border border-[#ECE7E0] rounded-xl p-4 mb-6 space-y-3">
          <div className="flex items-center justify-between text-xs pb-2 border-b border-[#ECE7E0]">
            <span className="text-[#6B6760]">Status</span>
            {rejected ? (
              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-[#D93636]/10 text-[#C42B2B] border border-[#D93636]/20">
                Not Approved
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-[#E0A100]/10 text-[#8A6100] border border-[#E0A100]/20 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#E0A100] animate-pulse" />
                Under Review
              </span>
            )}
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="text-[#6B6760]">Applicant</span>
            <span className="font-semibold text-[#2A2724]">{profile?.name}</span>
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="text-[#6B6760]">Specialization</span>
            <span className="text-[#2A2724]">{profile?.specialization || "General Fitness"}</span>
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="text-[#6B6760]">Contact</span>
            <span className="text-[#4A4640]">{profile?.phone || "—"}</span>
          </div>
        </div>

        <div className="p-3.5 rounded-lg bg-[#2F6FED]/10 border border-[#2F6FED]/20 text-xs text-[#1F57C9] leading-relaxed mb-6 flex items-start gap-2.5">
          <IconShield size={16} className="shrink-0 mt-0.5" />
          <span>
            {rejected
              ? "This account has been declined or revoked by gym management. Please contact the front desk if you believe this is a mistake."
              : "This page checks your verification status automatically. Once an administrator approves your profile, the trainer dashboard unlocks immediately."}
          </span>
        </div>

        <button type="button" onClick={handleLogout} className="btn-secondary w-full">
          <IconLogOut size={16} />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );
}
