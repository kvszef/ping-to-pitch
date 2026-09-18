import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import { BriefingPage } from './BriefingPage'

// Separate entry (briefing.html) for the A1 briefing writer, next to the main app.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BriefingPage />
  </StrictMode>,
)
