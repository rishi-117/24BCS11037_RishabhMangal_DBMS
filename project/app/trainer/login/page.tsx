"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiClientError } from "@/lib/client";
import {
  IconDumbbell,
  IconShield,
  IconAlertCircle,
  IconCheck,
} from "@/lib/svgIcons";

/**
 * Dedicated coach sign-in / application page.
 * Shares the same session endpoint as the landing page.
 */
export default function TrainerLoginPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"login" | "apply">("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [creds, setCreds] = useState({ identifier: "", password: "" });
  const [applyForm, setApplyForm] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    specialization: "Strength & Conditioning",
    experience: "1-3 Years",
  });

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      const { user } = await api.login(creds.identifier.trim(), creds.password);

      if (user.role !== "trainer") {
        setError(
          `This account is registered as a ${user.role}. Please use the ${
            user.role === "admin" ? "Admin ERP" : "Member Portal"
          }.`
        );
        return;
      }

      if (user.status === "approved") {
        router.push("/trainer/dashboard");
      } else if (user.status === "pending") {
        router.push("/pending-approval");
      } else {
        setError("Your coaching application is not active. Please contact management.");
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to sign in.");
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      await api.register({
        role: "trainer",
        name: applyForm.name.trim(),
        email: applyForm.email.trim(),
        phone: applyForm.phone.trim(),
        password: applyForm.password,
        specialization: applyForm.specialization,
        experience: applyForm.experience,
      });

      router.push("/pending-approval");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Application submission failed.");
      setLoading(false);
    }
  };

  const applyIncomplete =
    !applyForm.name || !applyForm.phone || !applyForm.email || applyForm.password.length < 8;

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#141414] flex flex-col justify-center items-center p-6 selection:bg-[#FF5A1F] selection:text-[#141414]">
      <div className="w-full max-w-md bg-[#FFFFFF] border border-[#ECE7E0] rounded-2xl p-6 sm:p-8 shadow-md space-y-6 relative">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#FF5A1F] to-[#FF5A1F] flex items-center justify-center text-[#141414] mx-auto shadow-md shadow-[#141414]/10">
            <IconDumbbell size={24} />
          </div>
          <h2 className="text-3xl font-bold text-[#141414] tracking-wide font-display">
            Coach Terminal
          </h2>
          <p className="text-xs text-[#6B6760]">
            Certified Trainers & Fitness Coaching Staff Portal
          </p>
        </div>

        <div className="flex items-center gap-1 bg-white/90 p-1.5 rounded-xl border border-[#ECE7E0]">
          <button
            type="button"
            onClick={() => {
              setActiveTab("login");
              setError("");
            }}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
              activeTab === "login"
                ? "bg-[#F1EDE7] text-[#C93E0B] shadow-sm"
                : "text-[#6B6760] hover:text-[#2A2724]"
            }`}
          >
            Coach Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab("apply");
              setError("");
            }}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
              activeTab === "apply"
                ? "bg-[#F1EDE7] text-[#C93E0B] shadow-sm"
                : "text-[#6B6760] hover:text-[#2A2724]"
            }`}
          >
            Apply as Staff
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-[#D93636]/10 border border-[#D93636]/30 text-[#C42B2B] text-xs flex items-center gap-2">
            <IconAlertCircle size={16} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="p-3 rounded-xl bg-[#FF5A1F]/10 border border-[#FF5A1F]/30 text-[#C93E0B] text-xs flex items-center gap-2">
            <IconCheck size={16} className="shrink-0" />
            <span>{success}</span>
          </div>
        )}

        {activeTab === "login" && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#6B6760] tracking-wide mb-1">
                Coach Email Address
              </label>
              <input
                type="email"
                autoComplete="email"
                placeholder="coach@example.com"
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

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 px-4 bg-[#FF5A1F] hover:bg-[#FF7A45] text-[#141414] font-bold rounded-xl text-sm tracking-wide flex items-center justify-center gap-3 transition-all disabled:opacity-50"
            >
              {loading ? "Verifying Coach Account..." : "Sign In as Coach"}
            </button>

            <div className="p-3.5 rounded-xl bg-white/90 border border-[#ECE7E0] text-xs text-[#6B6760] space-y-1">
              <span className="font-semibold text-[#2A2724] block">Trainer Access Note:</span>
              <p className="text-[11px] leading-relaxed">
                Coaching staff accounts require verified status approved by gym management before
                accessing client rosters and shift terminals.
              </p>
            </div>
          </form>
        )}

        {activeTab === "apply" && (
          <form onSubmit={handleApply} className="space-y-3.5">
            <div>
              <label className="block text-xs font-semibold text-[#6B6760] tracking-wide mb-1">
                Full Legal Name
              </label>
              <input
                type="text"
                placeholder="e.g. Vikram Singh"
                value={applyForm.name}
                onChange={(e) => setApplyForm({ ...applyForm, name: e.target.value })}
                className="gym-input"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#6B6760] tracking-wide mb-1">
                Email Address
              </label>
              <input
                type="email"
                autoComplete="email"
                placeholder="coach@example.com"
                value={applyForm.email}
                onChange={(e) => setApplyForm({ ...applyForm, email: e.target.value })}
                className="gym-input"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#6B6760] tracking-wide mb-1">
                Phone Number
              </label>
              <input
                type="tel"
                placeholder="+91 98765 43210"
                value={applyForm.phone}
                onChange={(e) => setApplyForm({ ...applyForm, phone: e.target.value })}
                className="gym-input"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#6B6760] tracking-wide mb-1">
                Create Password
              </label>
              <input
                type="password"
                autoComplete="new-password"
                placeholder="At least 8 characters"
                value={applyForm.password}
                onChange={(e) => setApplyForm({ ...applyForm, password: e.target.value })}
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
                value={applyForm.specialization}
                onChange={(e) => setApplyForm({ ...applyForm, specialization: e.target.value })}
                className="gym-select"
              >
                <option value="Strength & Conditioning">Strength & Conditioning</option>
                <option value="Bodybuilding & Hypertrophy">Bodybuilding & Hypertrophy</option>
                <option value="CrossFit & Functional Training">CrossFit & Functional Training</option>
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
                placeholder="e.g. ACE Certified, 4 Years Exp."
                value={applyForm.experience}
                onChange={(e) => setApplyForm({ ...applyForm, experience: e.target.value })}
                className="gym-input"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading || applyIncomplete}
              className="w-full py-3 rounded-xl bg-[#FF5A1F] hover:bg-[#FF7A45] text-[#141414] font-bold text-xs tracking-wide transition-all disabled:opacity-50 mt-1 shadow-md shadow-[#141414]/10"
            >
              {loading ? "Submitting..." : "Submit Coach Application"}
            </button>
          </form>
        )}

        <div className="pt-2 border-t border-[#ECE7E0]/80 flex items-center justify-between text-xs text-[#7A756D]">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="hover:text-[#C93E0B] transition-colors"
          >
            &larr; Member Portal
          </button>
          <button
            type="button"
            onClick={() => router.push("/admin")}
            className="hover:text-[#8A6100] transition-colors"
          >
            Admin ERP &rarr;
          </button>
        </div>
      </div>
    </div>
  );
}
