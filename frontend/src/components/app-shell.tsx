"use client";

import {
  Activity,
  Boxes,
  CircleAlert,
  ClipboardCheck,
  Clock3,
  KeyRound,
  LoaderCircle,
  LogOut,
  Plus,
  QrCode,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useSession } from "@/lib/session";
import { API_BASE, type UserRole } from "@/lib/api";

const navigation: Array<{
  href: string;
  label: string;
  icon: typeof Activity;
  roles: UserRole[];
}> = [
  { href: "/dashboard", label: "Overview", icon: Activity, roles: ["REGULATOR"] },
  { href: "/dashboard#scan-log", label: "Scan log", icon: ClipboardCheck, roles: ["REGULATOR"] },
  { href: "/dashboard#flagged", label: "Flagged events", icon: CircleAlert, roles: ["REGULATOR"] },
  { href: "/ledger", label: "Ledger", icon: ShieldCheck, roles: ["REGULATOR"] },
  { href: "/manufacturer", label: "Overview", icon: Activity, roles: ["MANUFACTURER"] },
  { href: "/manufacturer#batches", label: "Batches", icon: Boxes, roles: ["MANUFACTURER"] },
  { href: "/manufacturer#create-batch", label: "Create batch", icon: Plus, roles: ["MANUFACTURER"] },
  { href: "/manufacturer#qr-sheets", label: "QR sheets", icon: QrCode, roles: ["MANUFACTURER"] },
  { href: "/scan", label: "Scan medicine", icon: ClipboardCheck, roles: ["PHARMACY"] },
  { href: "/scan/history", label: "Scan history", icon: Clock3, roles: ["PHARMACY"] },
];

const roleLabels: Record<UserRole, string> = {
  MANUFACTURER: "Manufacturer",
  PHARMACY: "Pharmacy",
  REGULATOR: "Regulator",
};

const roleHome: Record<UserRole, string> = {
  MANUFACTURER: "/manufacturer",
  PHARMACY: "/scan",
  REGULATOR: "/dashboard",
};

export function LoginScreen() {
  const { login } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(email, password);
      setPassword("");
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Unable to sign in",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-aside">
        <span className="brand-mark"><ShieldCheck size={23} strokeWidth={2.2} /></span>
        <span className="eyebrow">VERITY / SUPPLY CHAIN</span>
        <h1>Know what moved.<br /><span>Trust what you verify.</span></h1>
        <p>One place to register, verify, and review medicine custody records.</p>
        <div className="login-stamp"><Activity size={19} /><span>MEDICINE TRACEABILITY<br /><b>PHASE 1 MVP</b></span></div>
      </section>
      <section className="login-panel">
        <div className="login-panel-heading">
          <span className="eyebrow">ACCOUNT ACCESS</span>
          <h2>Sign in</h2>
          <p>Continue with your manufacturer, pharmacy, or regulator account.</p>
        </div>
        <form onSubmit={submit} className="login-form">
          <label htmlFor="login-email">Email address</label>
          <input id="login-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
          <label htmlFor="login-password">Password</label>
          <input id="login-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          {error && <div className="error-banner"><CircleAlert size={17} />{error}</div>}
          <button className="button button-primary login-submit" type="submit" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={17} /> : <KeyRound size={17} />}
            Sign in
          </button>
        </form>
        <div className="login-foot"><ShieldCheck size={16} /> Access is restricted by account role</div>
      </section>
    </main>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { ready, token, user, logout } = useSession();
  const [hash, setHash] = useState("");
  const [apiStatus, setApiStatus] = useState<"checking" | "connected" | "offline">("checking");

  useEffect(() => {
    let active = true;
    void fetch(`${API_BASE}/health`, { cache: "no-store" })
      .then((response) => {
        if (active) setApiStatus(response.ok ? "connected" : "offline");
      })
      .catch(() => {
        if (active) setApiStatus("offline");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const updateHash = () => setHash(window.location.hash);
    updateHash();
    window.addEventListener("hashchange", updateHash);
    return () => window.removeEventListener("hashchange", updateHash);
  }, []);

  useEffect(() => {
    if (!ready || !user) return;
    const canAccessRoute = navigation.some((item) => {
      if (!item.roles.includes(user.role)) return false;
      const basePath = item.href.split("#")[0];
      return pathname === basePath || pathname.startsWith(`${basePath}/`);
    });
    if (pathname === "/" || pathname === "/login" || !canAccessRoute) {
      router.replace(roleHome[user.role]);
    }
  }, [pathname, ready, router, user]);

  if (!ready) {
    return <main className="boot-screen"><LoaderCircle className="spin" size={22} /><span>Checking session</span></main>;
  }
  if (!token || !user) return pathname === "/login" ? children : <LoginScreen />;
  if (pathname === "/" || pathname === "/login") {
    return <main className="boot-screen"><LoaderCircle className="spin" size={22} /><span>Opening your workspace</span></main>;
  }

  const items = navigation.filter((item) => item.roles.includes(user.role));
  const activeItem =
    items.find((item) => item.href === `${pathname}${hash}`) ??
    items.find((item) => {
      const basePath = item.href.split("#")[0];
      return basePath === pathname || pathname.startsWith(`${basePath}/`);
    });
  const allowed = items.some((item) => {
    const basePath = item.href.split("#")[0];
    return pathname === basePath || pathname.startsWith(`${basePath}/`);
  });

  return (
    <div className="app-shell">
      <aside className="rail">
        <Link className="brand" href="/" aria-label="Verity home">
          <span className="brand-mark"><ShieldCheck size={21} strokeWidth={2.2} /></span>
          <span>verity<span className="brand-dot">.</span></span>
        </Link>
        <div className="rail-label">{roleLabels[user.role].toUpperCase()}</div>
        <nav className="rail-nav" aria-label="Main navigation">
          {items.map(({ href, label, icon: Icon }) => (
            <Link className={`rail-link ${activeItem?.href === href ? "rail-link-active" : ""}`} href={href} key={href}>
              <Icon size={18} /><span>{label}</span>{pathname === href && <span className="rail-indicator" />}
            </Link>
          ))}
        </nav>
        <div className="rail-bottom">
          <div className="system-status"><span className={`status-dot status-dot-${apiStatus}`} /><span>API STATUS<br /><b>{apiStatus === "checking" ? "CHECKING" : apiStatus === "connected" ? "CONNECTED" : "OFFLINE"}</b></span></div>
          <div className="account-row">
            <div className="account-avatar">{user.name.slice(0, 1).toUpperCase()}</div>
            <div className="account-info"><b>{user.name}</b><span>{roleLabels[user.role]}</span></div>
            <button className="icon-button signout-button" onClick={logout} title="Sign out" aria-label="Sign out"><LogOut size={17} /></button>
          </div>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb"><span>Control room</span><span className="breadcrumb-separator">/</span><b>{activeItem?.label ?? roleLabels[user.role]}</b></div>
          <div className="topbar-right"><span className={`live-dot status-dot-${apiStatus}`} />{roleLabels[user.role].toUpperCase()} VIEW<span className="topbar-divider" /><span>{user.email}</span></div>
        </header>
        {allowed ? children : (
          <div className="content-wrap"><div className="error-banner"><CircleAlert size={17} />This page is not available for your account role.</div></div>
        )}
      </main>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {items.map(({ href, label, icon: Icon }) => (
          <Link className={activeItem?.href === href ? "mobile-nav-active" : ""} href={href} key={href}>
            <Icon size={18} /><span>{label}</span>
          </Link>
        ))}
        <button onClick={logout} aria-label="Sign out"><LogOut size={18} /><span>Sign out</span></button>
      </nav>
    </div>
  );
}