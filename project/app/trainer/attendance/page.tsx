"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { Html5Qrcode } from "html5-qrcode";
import { api, ApiClientError } from "@/lib/client";
import type { SessionUser } from "@/lib/types";
import {
  IconQrCode,
  IconCheck,
  IconAlertCircle,
  IconUpload,
  IconRefresh,
  IconChevronLeft,
  IconClock,
  IconCamera,
  IconShield,
} from "@/lib/svgIcons";

export default function TrainerAttendancePage() {
  const router = useRouter();

  const [viewMode, setViewMode] = useState<"pass" | "camera">("pass");
  const [trainer, setTrainer] = useState<SessionUser | null>(null);
  const [currentStatus, setCurrentStatus] = useState<"IN" | "OUT">("OUT");
  const [loading, setLoading] = useState(true);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState("");

  const [scanResult, setScanResult] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState<boolean | null>(null);
  const [processing, setProcessing] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);

  const [ackModal, setAckModal] = useState<{
    show: boolean;
    action: "check-in" | "check-out";
    title: string;
    message: string;
    time: string;
  } | null>(null);

  const scanLockRef = useRef(false);
  const lastScannedAtRef = useRef(0);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  const buildPass = useCallback((profile: SessionUser, isInside: boolean) => {
    const payload = JSON.stringify({
      gymId: "AURA_CLUB_MAIN_ENTRANCE",
      trainerUid: profile.uid,
      name: profile.name,
      action: isInside ? "check-out" : "check-in",
      timestamp: Date.now(),
    });

    QRCode.toDataURL(payload, {
      width: 320,
      margin: 2,
      color: { dark: "#141414", light: "#ffffff" },
    }).then(setQrCodeDataUrl);
  }, []);

  const loadProfile = useCallback(async () => {
    try {
      const data = await api.me();

      if (!data.authenticated || !data.user) {
        router.replace("/trainer/login");
        return;
      }
      if (data.user.role !== "trainer") {
        router.replace("/dashboard");
        return;
      }
      if (data.user.status !== "approved") {
        router.replace("/pending-approval");
        return;
      }

      setTrainer(data.user);
      const inside = data.user.currentStatus === "IN";
      setCurrentStatus(inside ? "IN" : "OUT");
      buildPass(data.user, inside);
    } catch {
      router.replace("/trainer/login");
    } finally {
      setLoading(false);
    }
  }, [router, buildPass]);

  useEffect(() => {
    // This effect initiates an external request or synchronizes the camera.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProfile();
  }, [loadProfile]);

  const startCameraScanner = async () => {
    setCameraError(null);
    setIsCameraActive(false);

    try {
      const element = document.getElementById("trainer-reader");
      if (!element) return;

      if (scannerRef.current) {
        try {
          if (scannerRef.current.isScanning) await scannerRef.current.stop();
          scannerRef.current.clear();
        } catch {
          /* already stopped */
        }
        scannerRef.current = null;
      }

      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setCameraError(
          "Live camera streaming requires HTTPS on mobile devices. Tap 'Open Phone Camera' below to scan with your phone's camera."
        );
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
          setCameraError(
            "Camera permission was blocked. Tap 'Grant Camera Permission' below or enable camera access in your browser settings."
          );
          return;
        }
        permStream = await navigator.mediaDevices.getUserMedia({ video: true });
      }

      permStream?.getTracks().forEach((track) => track.stop());

      const html5QrCode = new Html5Qrcode("trainer-reader");
      scannerRef.current = html5QrCode;

      const onDecoded = (decodedText: string) => {
        handleLogShift(decodedText);
      };

      try {
        await html5QrCode.start(
          { facingMode: "environment" },
          { fps: 15, qrbox: { width: 240, height: 240 }, aspectRatio: 1.0 },
          onDecoded,
          () => {}
        );
      } catch {
        await html5QrCode.start(
          { facingMode: "user" },
          { fps: 15, qrbox: { width: 240, height: 240 }, aspectRatio: 1.0 },
          onDecoded,
          () => {}
        );
      }

      setIsCameraActive(true);
    } catch (err: unknown) {
      setIsCameraActive(false);
      const error = err as { name?: string; message?: string };
      if (
        error.name === "NotAllowedError" ||
        error.message?.toLowerCase().includes("permission") ||
        error.message?.toLowerCase().includes("denied")
      ) {
        setCameraError("Camera access permission was denied. Tap 'Grant Camera Permission' below.");
      } else if (error.name === "NotFoundError") {
        setCameraError("No working camera found on this device. Tap 'Open Phone Camera' below.");
      } else {
        setCameraError(error.message || "Failed to start camera. Verify device permissions.");
      }
    }
  };

  const stopCameraScanner = async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch {
        /* already stopped */
      }
      scannerRef.current = null;
    }
    setIsCameraActive(false);
  };

  useEffect(() => {
    if (viewMode === "camera") {
      const timer = setTimeout(startCameraScanner, 150);
      return () => {
        clearTimeout(timer);
        stopCameraScanner();
      };
    }
    // This effect initiates an external request or synchronizes the camera.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    stopCameraScanner();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  async function handleLogShift(gymIdOverride?: string) {
    if (processing || scanLockRef.current || !trainer) return;

    const now = Date.now();
    if (now - lastScannedAtRef.current < 3500) return;
    lastScannedAtRef.current = now;
    scanLockRef.current = true;

    if (scannerRef.current?.isScanning) {
      try {
        scannerRef.current.pause(true);
      } catch {
        /* not scanning */
      }
    }

    setProcessing(true);
    setScanResult("Recording duty shift with server...");
    setIsSuccess(null);

    const action = currentStatus === "IN" ? "check-out" : "check-in";

    try {
      const result = await api.logAttendance(action, gymIdOverride || "AURA_CLUB_MAIN_ENTRANCE");

      setCurrentStatus(result.currentStatus);
      if (trainer) buildPass(trainer, result.currentStatus === "IN");

      setAckModal({
        show: true,
        action,
        title: action === "check-in" ? "SHIFT STARTED" : "SHIFT COMPLETED",
        message:
          action === "check-in"
            ? `Welcome on duty, ${trainer.name}! Your shift has been recorded.`
            : `Great job, ${trainer.name}! Your coaching shift has been logged.`,
        time: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
      });

      setScanResult(`Duty shift ${action === "check-in" ? "started" : "completed"} successfully.`);
      setIsSuccess(true);
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Failed to record duty shift.";

      setScanResult(message);
      setIsSuccess(false);
      setAckModal({
        show: true,
        action: "check-in",
        title: "DUTY SHIFT FAILED",
        message,
        time: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleCloseAckModal = () => {
    setAckModal(null);
    setScanResult(null);
    setIsSuccess(null);
    setViewMode("pass");

    setTimeout(() => {
      scanLockRef.current = false;
      try {
        scannerRef.current?.resume();
      } catch {
        /* not paused */
      }
    }, 2500);
  };

  const processFile = async (file: File) => {
    if (processing) return;
    if (!file.type.startsWith("image/")) {
      setScanResult("Error: please provide a valid image file.");
      setIsSuccess(false);
      setTimeout(() => {
        setScanResult(null);
        setIsSuccess(null);
      }, 3000);
      return;
    }

    setProcessing(true);
    setScanResult("Scanning QR code from uploaded image...");
    setIsSuccess(null);

    try {
      const html5QrCode = new Html5Qrcode("file-reader-hidden");
      const result = await html5QrCode.scanFileV2(file, true);
      html5QrCode.clear();
      await handleLogShift(result.decodedText);
    } catch {
      setScanResult("No valid QR code detected in that image.");
      setIsSuccess(false);
      setTimeout(() => {
        setScanResult(null);
        setIsSuccess(null);
        setProcessing(false);
      }, 3000);
    }
  };

  if (loading || !trainer) {
    return (
      <div className="min-h-screen bg-[#FAF8F5] flex items-center justify-center text-[#4A4640]">
        <div className="flex flex-col items-center gap-3">
          <IconRefresh className="animate-spin text-[#C93E0B]" size={32} />
          <p className="text-sm font-medium tracking-wide">Loading Duty Terminal...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#141414] flex flex-col items-center justify-center p-4 relative">
      <div id="file-reader-hidden" style={{ display: "none" }} />

      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center justify-between">
          <button
            onClick={() => router.push("/trainer/dashboard")}
            className="btn-slate text-xs py-2 px-3"
          >
            <IconChevronLeft size={16} />
            <span>Dashboard</span>
          </button>
          <div className="text-right">
            <span className="text-xs font-bold tracking-wide text-[#141414] block">
              AURA Athletic Club
            </span>
            <span className="text-[11px] text-[#C93E0B] font-bold tracking-wide block">
              Coach Duty Terminal
            </span>
          </div>
        </div>

        <div className="bg-[#FFFFFF] rounded-2xl border border-[#ECE7E0] p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`w-3 h-3 rounded-full ${
                currentStatus === "IN" ? "bg-[#1F9D55] animate-pulse" : "bg-[#A09A92]"
              }`}
            />
            <div>
              <span className="text-xs text-[#6B6760] block">Duty Status</span>
              <strong
                className={`text-sm font-bold ${
                  currentStatus === "IN" ? "text-[#17803F]" : "text-[#141414]"
                }`}
              >
                {currentStatus === "IN" ? "On Duty (Clocked In)" : "Off Duty (Clocked Out)"}
              </strong>
            </div>
          </div>

          <span className="px-2.5 py-1 rounded-md text-[11px] font-bold tracking-wide bg-[#FF5A1F]/10 text-[#C93E0B] border border-[#FF5A1F]/30">
            COACH
          </span>
        </div>

        <div className="flex items-center gap-1 bg-white/90 p-1.5 rounded-xl border border-[#ECE7E0]">
          <button
            onClick={() => setViewMode("pass")}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
              viewMode === "pass"
                ? "bg-[#F1EDE7] text-[#C93E0B] shadow-sm"
                : "text-[#6B6760] hover:text-[#2A2724]"
            }`}
          >
            My Duty Pass
          </button>
          <button
            onClick={() => setViewMode("camera")}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
              viewMode === "camera"
                ? "bg-[#F1EDE7] text-[#141414] shadow-sm"
                : "text-[#6B6760] hover:text-[#2A2724]"
            }`}
          >
            Camera Scanner
          </button>
        </div>

        {scanResult && (
          <div
            className={`p-3.5 rounded-xl text-xs font-bold flex items-center gap-2 ${
              isSuccess === true
                ? "bg-[#1F9D55]/10 border border-[#1F9D55]/30 text-[#17803F]"
                : isSuccess === false
                  ? "bg-[#D93636]/10 border border-[#D93636]/30 text-[#C42B2B]"
                  : "bg-[#F1EDE7] text-[#4A4640]"
            }`}
          >
            {isSuccess === true && <IconCheck size={18} className="shrink-0" />}
            {isSuccess === false && <IconAlertCircle size={18} className="shrink-0" />}
            {isSuccess === null && <IconRefresh size={18} className="animate-spin shrink-0" />}
            <span>{scanResult}</span>
          </div>
        )}

        {viewMode === "pass" && (
          <div className="hero-dark rounded-2xl border border-white/10 p-6 sm:p-8 space-y-6 text-center shadow-md">
            <div className="space-y-1">
              <span className="text-xs font-bold tracking-wide text-[#FF5A1F]">
                Coach Duty ID
              </span>
              <h2 className="text-3xl font-bold text-white font-display">{trainer.name}</h2>
              <p className="text-xs text-white/60">
                Specialization:{" "}
                <strong className="text-white">
                  {trainer.specialization || "General Fitness"}
                </strong>
              </p>
            </div>

            <div className="p-4 bg-white rounded-2xl inline-block border-4 border-[#FF5A1F]">
              {qrCodeDataUrl ? (
                <img
                  src={qrCodeDataUrl}
                  alt="Trainer duty QR code"
                  className="w-56 h-56 mx-auto block rounded-lg"
                />
              ) : (
                <div className="w-56 h-56 flex items-center justify-center text-[#6B6760]">
                  <IconRefresh className="animate-spin" size={32} />
                </div>
              )}
            </div>

            <p className="text-xs text-white/55 leading-relaxed max-w-xs mx-auto">
              Present this pass at the staff entrance reader, or use the one-touch button below.
            </p>

            <div className="pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => handleLogShift()}
                disabled={processing}
                className={`w-full py-3.5 rounded-xl font-bold text-xs tracking-wide transition-all shadow-md ${
                  currentStatus === "IN"
                    ? "bg-[#D93636] hover:bg-[#E04B4B] text-white shadow-[#141414]/10"
                    : "btn-emerald w-full py-3.5 shadow-[#141414]/10"
                } disabled:opacity-50`}
              >
                {processing
                  ? "Processing..."
                  : currentStatus === "IN"
                    ? "End Duty Shift (Clock Out)"
                    : "Start Duty Shift (Clock In)"}
              </button>
            </div>
          </div>
        )}

        {viewMode === "camera" && (
          <div className="bg-[#FFFFFF] rounded-2xl border border-[#ECE7E0] p-6 space-y-5 shadow-md">
            <div className="text-center">
              <h3 className="text-xl font-bold text-[#141414] font-display">Staff Gate Scanner</h3>
              <p className="text-xs text-[#6B6760] mt-0.5">
                Scan the staff entrance code to record your duty shift.
              </p>
            </div>

            {cameraError && (
              <div className="p-4 rounded-xl bg-[#E0A100]/10 border border-[#E0A100]/30 text-[#8A6100] text-xs space-y-3">
                <div className="flex items-start gap-2.5">
                  <IconAlertCircle size={18} className="shrink-0 text-[#8A6100] mt-0.5" />
                  <p className="leading-relaxed">{cameraError}</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={startCameraScanner}
                    className="py-2.5 px-3 rounded-xl bg-[#E0A100] text-[#141414] font-bold text-xs tracking-wide transition-all cursor-pointer text-center"
                  >
                    Grant Camera Access & Retry
                  </button>
                  <button
                    type="button"
                    onClick={() => document.getElementById("native-camera-input")?.click()}
                    className="py-2.5 px-3 rounded-xl btn-emerald text-xs tracking-wide transition-all cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <IconCamera size={14} />
                    <span>Open Phone Camera</span>
                  </button>
                </div>
              </div>
            )}

            <div className="relative rounded-2xl overflow-hidden bg-[#141414] border border-[#ECE7E0] min-h-[260px] flex items-center justify-center shadow-inner">
              <div id="trainer-reader" className="w-full" style={{ opacity: processing ? 0.3 : 1 }} />
              {!isCameraActive && !cameraError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#141414]/60 text-[#6B6760] p-4 text-center">
                  <IconRefresh className="animate-spin text-[#C93E0B]" size={24} />
                  <p className="text-xs font-semibold text-[#2A2724]">Requesting Camera Access...</p>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => document.getElementById("native-camera-input")?.click()}
              className="btn-emerald w-full py-3.5 flex items-center justify-center gap-2 shadow-md shadow-[#141414]/10 cursor-pointer"
            >
              <IconCamera size={18} />
              <span>Open Phone Camera (Tap to Scan)</span>
            </button>
            <input
              id="native-camera-input"
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])}
            />

            <div
              onClick={() => document.getElementById("file-upload")?.click()}
              className="p-3.5 rounded-xl border border-dashed border-[#E0D9CF] hover:border-[#FF5A1F]/50 bg-[#F7F4EF]/60 text-center cursor-pointer transition-all flex items-center justify-center gap-2 text-xs font-semibold text-[#4A4640] hover:text-[#141414]"
            >
              <IconUpload size={16} className="text-[#C93E0B]" />
              <span>Or Upload QR Code Screenshot</span>
              <input
                id="file-upload"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && processFile(e.target.files[0])}
              />
            </div>
          </div>
        )}
      </div>

      {ackModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#141414]/60 backdrop-blur-md">
          <div className="bg-[#FFFFFF] rounded-2xl border border-[#E0D9CF]/80 w-full max-w-sm p-6 text-center space-y-6 shadow-md">
            <div className="flex justify-center">
              {ackModal.title.includes("FAILED") ? (
                <div className="w-20 h-20 rounded-full bg-[#D93636]/20 border-4 border-[#D93636] flex items-center justify-center animate-bounce">
                  <IconAlertCircle size={44} className="text-[#C42B2B]" />
                </div>
              ) : ackModal.action === "check-in" ? (
                <div className="w-20 h-20 rounded-full bg-[#FF5A1F]/20 border-4 border-[#FF5A1F] flex items-center justify-center animate-pulse">
                  <IconCheck size={44} className="text-[#C93E0B]" />
                </div>
              ) : (
                <div className="w-20 h-20 rounded-full bg-[#2F6FED]/20 border-4 border-[#2F6FED] flex items-center justify-center animate-pulse">
                  <IconClock size={40} className="text-[#1F57C9]" />
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <span
                className={`text-[11px] font-bold tracking-wide block ${
                  ackModal.title.includes("FAILED")
                    ? "text-[#C42B2B]"
                    : ackModal.action === "check-in"
                      ? "text-[#C93E0B]"
                      : "text-[#1F57C9]"
                }`}
              >
                {ackModal.title}
              </span>
              <h3 className="text-2xl font-bold text-[#141414] font-display">
                {ackModal.title.includes("FAILED")
                  ? "Shift Not Recorded"
                  : ackModal.action === "check-in"
                    ? "You Are On Duty!"
                    : "Shift Completed!"}
              </h3>
              <p className="text-xs text-[#4A4640] leading-relaxed max-w-xs mx-auto pt-1">
                {ackModal.message}
              </p>
            </div>

            <div className="bg-white/90 rounded-2xl p-3.5 border border-[#ECE7E0] text-xs space-y-2 text-left">
              <div className="flex items-center justify-between text-[#6B6760]">
                <span>Coach</span>
                <strong className="text-[#141414] font-semibold">{trainer.name}</strong>
              </div>
              <div className="flex items-center justify-between text-[#6B6760]">
                <span>Event Time</span>
                <strong className="text-[#2A2724]">{ackModal.time}</strong>
              </div>
              <div className="flex items-center justify-between text-[#6B6760]">
                <span>Terminal</span>
                <strong className="text-[#C93E0B]">Staff Entrance</strong>
              </div>
            </div>

            <button
              type="button"
              onClick={handleCloseAckModal}
              className={`w-full py-3.5 rounded-xl font-bold text-xs tracking-wide transition-all shadow-md cursor-pointer ${
                ackModal.title.includes("FAILED")
                  ? "bg-[#D93636] hover:bg-[#E04B4B] text-white"
                  : ackModal.action === "check-in"
                    ? "btn-emerald"
                    : "bg-[#2F6FED] hover:bg-[#2F6FED] text-white"
              }`}
            >
              Done & Return to Duty Pass
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
