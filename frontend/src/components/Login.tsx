import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login as loginApi, setToken } from "../lib/auth";

const Login: React.FC<{ onLogin: () => void }> = ({ onLogin }) => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setBusy(true);
    setError(null);

    try {
      const data = await loginApi(email, password);
      setToken(data.accessToken);
      onLogin();
      navigate("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="glass-card login-card">
        <div className="login-kicker">Structured Document Automation</div>
        <h2>Sign in</h2>
        <p className="login-copy">
          Access the template library, create draft documents, and review extracted data before finalization.
        </p>

        <input
          type="email"
          placeholder="Email"
          className="login-input"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
        />

        <input
          type="password"
          placeholder="Password"
          className="login-input"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
        />

        {error && <div className="error-text">{error}</div>}

        <button className="login-button" onClick={handleLogin} disabled={busy}>
          {busy ? "Signing in..." : "Sign In"}
        </button>
      </div>
    </div>
  );
};

export default Login;
