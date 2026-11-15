"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { IconRefresh } from "@/lib/svgIcons";

/** `/trainer` is a convenience entry point into the trainer dashboard. */
export default function TrainerIndex() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/trainer/dashboard");
  }, [router]);

  return (
    <div className="min-h-screen bg-[#FAF8F5] flex items-center justify-center gap-2 text-[#4A4640]">
      <IconRefresh className="animate-spin text-[#C93E0B]" size={20} />
      <span className="text-sm font-medium">Opening trainer portal...</span>
    </div>
  );
}
