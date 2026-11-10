import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { FournisseurStore } from './store'
import App from './App'
import { enregistrerServiceWorker } from './lib/pwa'

enregistrerServiceWorker(import.meta.env.PROD)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FournisseurStore>
      <App />
    </FournisseurStore>
  </StrictMode>,
)
