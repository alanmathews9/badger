// The gate screen.
//
// Server-rendered and self-contained on purpose: an unauthenticated visitor
// receives this page and nothing else — no app bundle, no API surface, no
// hint of what is behind it beyond what we choose to say.
//
// It does two jobs. The obvious one is the passphrase. The second matters more
// for an evaluation: it says what this searches and offers three questions
// worth asking. People freeze at an empty search box, and a reviewer who types
// "hello" sees nothing of the product. The examples are chosen to show the
// thesis — that the real answer is in the discussion, not in the tidy document.

const MARK = `<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
<circle cx="6.4" cy="5.6" r="1.9" fill="#f5f5f4"></circle><circle cx="17.6" cy="5.6" r="1.9" fill="#f5f5f4"></circle>
<path d="M12 2.4 L19.1 6.3 C19.1 13.2 16 19.6 12 21.6 C8 19.6 4.9 13.2 4.9 6.3 Z" fill="#f5f5f4"></path>
<path d="M12 4.9 L14.3 7 C14.3 12.3 13.3 16.8 12 18.6 C10.7 16.8 9.7 12.3 9.7 7 Z" fill="#1c1917"></path>
<circle cx="8.4" cy="9.2" r="1.05" fill="#1c1917"></circle><circle cx="15.6" cy="9.2" r="1.05" fill="#1c1917"></circle></svg>`;

const EXAMPLES = [
  "Why did the Halden engagement slip?",
  "Who knows about payments integrations?",
  "Should we ever compress discovery to win timing?",
];

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
  .card{width:100%;max-width:460px}
  .brand{display:flex;align-items:center;gap:10px;margin-bottom:28px}
  .tile{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:8px;background:#1c1917}
  .name{font-weight:600;font-size:16px;letter-spacing:-.01em}
  .bars{display:flex;gap:4px;margin:14px 0 18px}
  .bars span{width:40px;height:3px;border-radius:2px}
  h1{margin:0;font-size:26px;line-height:1.25;letter-spacing:-.02em;font-weight:600}
  p{margin:12px 0 0;font-size:13.5px;line-height:1.65;color:#57534e}
  form{display:flex;gap:8px;margin-top:22px}
  input{flex:1;min-width:0;height:44px;padding:0 14px;font:400 15px Geist,sans-serif;color:#1c1917;
        border:1px solid #d6d3d1;border-radius:9px;background:#fff}
  input:focus{outline:none;border-color:#1c1917;box-shadow:0 0 0 4px rgba(28,25,23,.06)}
  button{height:44px;padding:0 18px;border:0;border-radius:9px;background:#1c1917;color:#fafaf9;
         font:500 14px Geist,sans-serif;cursor:pointer}
  button:hover{background:#292524}
  .err{margin-top:12px;padding:9px 12px;border:1px solid #fde68a;background:#fffbeb;border-radius:8px;
       font-size:12.5px;color:#92400e}
  .try{margin-top:30px;padding-top:18px;border-top:1px solid #f5f5f4}
  .try h2{margin:0 0 10px;font:500 10px "Geist Mono",ui-monospace,monospace;letter-spacing:.1em;
          text-transform:uppercase;color:#78716c}
  .try li{font-size:13.5px;line-height:1.7;color:#292524}
  ul{margin:0;padding-left:18px}
  .foot{margin-top:26px;font:400 11.5px "Geist Mono",ui-monospace,monospace;color:#a8a29e}
</style>
</head>
<body>
  <main class="card">
    <div class="brand"><span class="tile">${MARK}</span><span class="name">badger</span></div>

    <h1>A Glean-style search agent, built on GAP.</h1>
    <div class="bars"><span style="background:#d97706"></span><span style="background:#b45309"></span><span style="background:#78350f"></span></div>
    <p>
      Badger searches the private GitHub of <strong>Arkind Consultants</strong>, a fictional
      consultancy — 18 documents, 20 issues, 5 pull requests and the arguments underneath them.
      It answers in prose, cites what it read, and verifies every citation against what it
      actually retrieved.
    </p>

    <form method="POST" action="/api/login" autocomplete="off">
      <input type="password" name="passphrase" placeholder="Passphrase" autofocus
             aria-label="Passphrase" required>
      <button type="submit">Enter</button>
    </form>
    ${error ? `<div class="err">${escape(error)}</div>` : ""}

    <div class="try">
      <h2>Once you are in, try</h2>
      <ul>${EXAMPLES.map((q) => `<li>${escape(q)}</li>`).join("")}</ul>
      <p style="font-size:12.5px">
        The first is the one worth watching: the committed retro says scope changed, and the
        discussion says four of the six weeks were self-inflicted. Badger reads both.
      </p>
    </div>

    <div class="foot">read-only · no data is written to any connected source</div>
  </main>
</body>
</html>`;
}
