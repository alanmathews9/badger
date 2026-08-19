// The gate screen.
//
// Server-rendered and self-contained on purpose: an unauthenticated visitor
// receives this page and nothing else — no app bundle, no API surface, no
// hint of what is behind it beyond what we choose to say.
//
// One field and nothing else. The example questions that used to live here
// moved onto the search screen, where they are one click from running rather
// than something to read and forget. This page's only job is the door — it
// says nothing about what is behind it.

// The same lockup the app's sidebar uses, rather than a second hand-drawn
// mark that has to be kept in step with it. `/logo.svg` is served before
// authentication for exactly this — see the pre-auth allowlist in server.mjs.
const LOGO = `<img src="/logo.svg" alt="Badger" class="logo">`;

const escape = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function splashPage({ error = null } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Badger</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@300..700&family=Geist+Mono:wght@400..600&display=swap">
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px;
       background:#fff;color:#1c1917;font-family:Geist,ui-sans-serif,system-ui,sans-serif}
  .card{width:100%;max-width:360px}
  .brand{display:flex;align-items:center;margin-bottom:28px}
  .logo{height:38px;width:auto;display:block}
  .bars{display:flex;gap:4px;margin:16px 0 20px}
  .bars span{width:40px;height:3px;border-radius:2px}
  form{display:flex;gap:8px;margin-top:22px}
  input{flex:1;min-width:0;height:44px;padding:0 14px;font:400 15px Geist,sans-serif;color:#1c1917;
        border:1px solid #d6d3d1;border-radius:9px;background:#fff}
  input:focus{outline:none;border-color:#1c1917;box-shadow:0 0 0 4px rgba(28,25,23,.06)}
  button{height:44px;padding:0 18px;border:0;border-radius:9px;background:#1c1917;color:#fafaf9;
         font:500 14px Geist,sans-serif;cursor:pointer}
  button:hover{background:#292524}
  .err{margin-top:12px;padding:9px 12px;border:1px solid #fde68a;background:#fffbeb;border-radius:8px;
       font-size:12.5px;color:#92400e}
</style>
</head>
<body>
  <main class="card">
    <div class="brand">${LOGO}</div>
    <div class="bars"><span style="background:#d97706"></span><span style="background:#b45309"></span><span style="background:#78350f"></span></div>

    <form method="POST" action="/api/login" autocomplete="off">
      <input type="password" name="passphrase" placeholder="Passphrase" autofocus
             aria-label="Passphrase" required>
      <button type="submit">Enter</button>
    </form>
    ${error ? `<div class="err">${escape(error)}</div>` : ""}
  </main>
</body>
</html>`;
}
