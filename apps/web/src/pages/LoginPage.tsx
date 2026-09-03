import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Building2,
  Eye,
  Fuel,
  LockKeyhole,
  Mail,
  UserRound,
} from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../components/AuthProvider";
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(input: {
            client_id: string;
            callback(response: { credential: string }): void;
          }): void;
          renderButton(
            element: HTMLElement,
            options: Record<string, unknown>,
          ): void;
        };
      };
    };
  }
}
const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as
  | string
  | undefined;
export function LoginPage() {
  const { user, login, signup, googleLogin } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [email, setEmail] = useState("owner@fuelledger.local");
  const [password, setPassword] = useState("FuelLedger123!");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const googleButton = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!googleClientId) return;
    const render = () => {
      if (!window.google || !googleButton.current) return;
      googleButton.current.replaceChildren();
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: (response) => {
          setBusy(true);
          setError("");
          void googleLogin({ credential: response.credential })
            .catch((item) =>
              setError(
                item instanceof Error
                  ? item.message
                  : "Unable to continue with Google.",
              ),
            )
            .finally(() => setBusy(false));
        },
      });
      window.google.accounts.id.renderButton(googleButton.current, {
        theme: "outline",
        size: "large",
        width: 360,
        text: mode === "signup" ? "signup_with" : "signin_with",
        shape: "rectangular",
      });
    };
    const existing = document.querySelector<HTMLScriptElement>(
      "script[data-google-identity]",
    );
    if (existing) {
      render();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = "true";
    script.onload = render;
    document.head.append(script);
  }, [googleLogin, mode]);
  if (user) return <Navigate to="/" replace />;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "signup")
        await signup({ name, organizationName, email, password });
      else await login({ email, password });
    } catch (item) {
      setError(item instanceof Error ? item.message : "Unable to continue.");
    } finally {
      setBusy(false);
    }
  }
  const switchMode = (next: "signin" | "signup") => {
    setMode(next);
    setError("");
    if (next === "signup") {
      setEmail("");
      setPassword("");
    }
  };
  return (
    <main className="login">
      <section className="login-story">
        <div className="login-brand">
          <span className="brand-mark">
            <Fuel size={24} />
          </span>
          FuelLedger
        </div>
        <div>
          <span className="eyebrow light">Fuel station business OS</span>
          <h1>
            Every litre.
            <br />
            Every product.
            <br />
            <em>Every rupee.</em>
          </h1>
          <p>
            One calm, connected view of your station—from the forecourt to the
            books.
          </p>
        </div>
        <small>Built for owners, managers and accountants.</small>
      </section>
      <section className="login-panel">
        <form onSubmit={submit} className="auth-form">
          <div className="auth-tabs">
            <button
              type="button"
              className={mode === "signin" ? "active" : ""}
              onClick={() => switchMode("signin")}
            >
              Sign in
            </button>
            <button
              type="button"
              className={mode === "signup" ? "active" : ""}
              onClick={() => switchMode("signup")}
            >
              Create account
            </button>
          </div>
          <span className="eyebrow">
            {mode === "signup" ? "Start your FuelLedger" : "Welcome back"}
          </span>
          <h2>
            {mode === "signup"
              ? "Create your business account"
              : "Sign in to FuelLedger"}
          </h2>
          <p>
            {mode === "signup"
              ? "You’ll be the owner and can build your first station next."
              : "Use your FuelLedger account to continue."}
          </p>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          {mode === "signup" && (
            <>
              <label>
                Your name
                <div className="input-wrap">
                  <UserRound size={18} />
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="name"
                    required
                  />
                </div>
              </label>
              <label>
                Business name
                <div className="input-wrap">
                  <Building2 size={18} />
                  <input
                    value={organizationName}
                    onChange={(event) =>
                      setOrganizationName(event.target.value)
                    }
                    autoComplete="organization"
                    required
                  />
                </div>
              </label>
            </>
          )}
          <label>
            Email address
            <div className="input-wrap">
              <Mail size={18} />
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </div>
          </label>
          <label>
            Password
            <div className="input-wrap">
              <LockKeyhole size={18} />
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={
                  mode === "signup" ? "new-password" : "current-password"
                }
                minLength={8}
                required
              />
            </div>
          </label>
          <button className="primary" disabled={busy}>
            {busy
              ? "Please wait…"
              : mode === "signup"
                ? "Create account"
                : "Sign in securely"}
          </button>
          <div className="auth-divider">
            <span>or continue with</span>
          </div>
          {googleClientId ? (
            <div
              ref={googleButton}
              className="google-button"
              aria-label="Google authentication"
            />
          ) : (
            <button type="button" className="social-auth" disabled>
              Google is not configured
            </button>
          )}
          {mode === "signin" && (
            <>
              <Link className="demo-entry-link" to="/demo">
                <Eye /> Explore the 48-hour demo
              </Link>
              <small className="demo-note">No account or password required.</small>
            </>
          )}
        </form>
      </section>
    </main>
  );
}
