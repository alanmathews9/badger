import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'

// BrowserRouter, not HashRouter: the server already serves index.html for any
// path it does not recognise (`serveStatic` in app/server/server.mjs), so real
// paths work on a cold load and the URLs stay clean.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
