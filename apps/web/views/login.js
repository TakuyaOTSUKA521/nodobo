import { supabase } from '../lib/supabase.js';
import { setSession, go } from '../state.js';

export function renderLoginPage() {
  return `
    <div style="max-width:380px;margin:6vh auto 0;position:relative;z-index:1;" class="card">
      <h1 style="font-size:20px;">ログイン</h1>
      <p style="margin:4px 0 22px;font-size:13px;color:var(--muted);line-height:1.6;">Nodobo のアカウントでサインインします。</p>
      <div class="stack" style="gap:14px;">
        <label class="field">メールアドレス<input id="email" type="email"></label>
        <label class="field">パスワード<input id="password" type="password"></label>
        <button id="login-btn" class="btn-primary">ログイン</button>
        <p id="login-error" style="color:var(--negative);font-size:12px;margin:0;"></p>
      </div>
    </div>
  `;
}

export function wireLogin() {
  document.getElementById('login-btn').addEventListener('click', async () => {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      document.getElementById('login-error').textContent = error.message;
      return;
    }
    setSession(data.session);
    go('dashboard');
  });
}
