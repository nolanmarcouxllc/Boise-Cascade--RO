"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "password" | "magic";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = params.get("redirect") || "/";

  const [mode, setMode] = useState<Mode>("password");
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const supabase = createClient();

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          setNotice("Account created. Check your email to confirm, then sign in.");
          setIsSignUp(false);
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      }
      router.replace(redirectTo);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function handleMagic(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const emailRedirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(
        redirectTo,
      )}`;
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo },
      });
      if (error) throw error;
      setNotice(`Magic link sent to ${email}. Check your inbox.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <div className="mb-1 flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-brand-700">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-brand-600 text-xs font-bold text-white shadow-[0_2px_8px_rgba(67,99,216,0.35)]">
              RC
            </span>
            Route Consolidation
          </div>
          <h1 className="text-2xl font-semibold text-ink">
            Sign in to your account
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Find split deliveries and the cost they carry.
          </p>
        </div>

        <div className="mb-5 inline-flex rounded-lg border border-[var(--border)] bg-surface p-1 text-sm">
          <TabButton active={mode === "password"} onClick={() => setMode("password")}>
            Password
          </TabButton>
          <TabButton active={mode === "magic"} onClick={() => setMode("magic")}>
            Magic link
          </TabButton>
        </div>

        <form
          onSubmit={mode === "password" ? handlePassword : handleMagic}
          className="panel space-y-4 p-6"
        >
          <Field
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@company.com"
            autoComplete="email"
          />

          {mode === "password" && (
            <Field
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder="••••••••"
              autoComplete={isSignUp ? "new-password" : "current-password"}
            />
          )}

          {error && (
            <p className="rounded-md border border-alert/30 bg-alert/10 px-3 py-2 text-sm text-alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="rounded-md border border-good/30 bg-good/10 px-3 py-2 text-sm text-good">
              {notice}
            </p>
          )}

          <button type="submit" disabled={busy} className="btn btn-primary w-full">
            {busy
              ? "Working…"
              : mode === "magic"
                ? "Send magic link"
                : isSignUp
                  ? "Create account"
                  : "Sign in"}
          </button>

          {mode === "password" && (
            <button
              type="button"
              onClick={() => {
                setIsSignUp((v) => !v);
                setError(null);
                setNotice(null);
              }}
              className="w-full text-center text-sm text-ink-muted transition hover:text-ink"
            >
              {isSignUp
                ? "Already have an account? Sign in"
                : "Need an account? Sign up"}
            </button>
          )}
        </form>
      </div>
    </main>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 font-medium transition ${
        active ? "bg-brand-600 text-white" : "text-ink-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  ...rest
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink-muted">
        {label}
      </span>
      <input
        {...rest}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
      />
    </label>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
