"use client";

import { Button } from "@/components/button";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

type ModeSwitcherButtonProps = {
  href: string;
  label: string;
};

export function ModeSwitcherButton({ href, label }: ModeSwitcherButtonProps) {
  const router = useRouter();

  const handleClick = useCallback(() => {
    const hash = typeof window === "undefined" ? "" : window.location.hash;
    router.push(`${href}${hash}`);
  }, [href, router]);

  return (
    <Button variant="transparent" className="hidden md:flex" onClick={handleClick}>
      {label}
    </Button>
  );
}
