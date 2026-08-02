import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initSettings } from './lib/settings.ts'
import { initSentLogPersistence } from './lib/sentLog.ts'

void initSettings()
initSentLogPersistence()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
