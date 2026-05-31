import type { ReactElement } from "react";
import { useState } from "react";
import styles from "../App.module.css";

type LoginGateProps = {
  checking: boolean;
  error: string;
  onLogin: (password: string) => Promise<void>;
};

export function LoginGate({
  checking,
  error,
  onLogin,
}: LoginGateProps): ReactElement {
  const [password, setPassword] = useState("");

  return (
    <div className={styles.loginPage}>
      <form
        aria-label="LAN login"
        className={styles.loginPanel}
        onSubmit={(event) => {
          event.preventDefault();
          void onLogin(password);
        }}
      >
        <span className={styles.workspaceMark}>cw</span>
        <h1>codex_web</h1>
        <p>局域网访问需要输入本机启动时生成的访问密码。</p>
        <input
          aria-label="访问密码"
          type="password"
          placeholder="访问密码"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoFocus
        />
        {error ? <div className={styles.errorBox}>{error}</div> : null}
        <button
          className={styles.loginButton}
          type="submit"
          disabled={checking || !password.trim()}
        >
          {checking ? "验证中..." : "进入"}
        </button>
      </form>
    </div>
  );
}
