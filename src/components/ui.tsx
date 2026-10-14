"use client";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) { return c.filter(Boolean).join(" "); }

export function Button({ variant = "primary", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "light" }) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-full px-6 h-12 text-[15px] font-medium transition active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none",
        variant === "primary" && "bg-white text-black hover:bg-zinc-200",
        variant === "light" && "bg-gradient-to-r from-fuchsia-500 to-violet-500 text-white shadow-[0_8px_30px_-8px] shadow-fuchsia-500/50 hover:brightness-110",
        variant === "ghost" && "text-zinc-300 hover:text-white hover:bg-white/5",
        className,
      )}
    />
  );
}

export function Chip({ on, children, onClick }: { on: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className={cx(
      "h-10 rounded-full px-4 text-sm capitalize transition border",
      on ? "bg-white text-black border-white" : "border-white/10 text-zinc-300 hover:border-white/25 hover:text-white",
    )}>{children}</button>
  );
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-[13px] font-medium uppercase tracking-[0.14em] text-zinc-500">{title}</h3>
        {hint && <p className="mt-1 text-sm text-zinc-500">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export const inputCls = "w-full h-12 rounded-2xl bg-white/[0.04] border border-white/10 px-4 text-base sm:text-[15px] placeholder:text-zinc-600 outline-none focus:border-white/30 transition";

export function Spinner({ className }: { className?: string }) {
  return <span className={cx("inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white", className)} />;
}
