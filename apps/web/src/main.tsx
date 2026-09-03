import '@fontsource-variable/manrope';
import './manager-access.css';
import './login-demo-link.css';
import './subscription.css';
import './leads.css';
import './notifications.css';
import { StrictMode } from 'react'; import { createRoot } from 'react-dom/client'; import { BrowserRouter } from 'react-router-dom'; import App from './App'; import { AuthProvider } from './components/AuthProvider'; import { ErrorBoundary } from './components/ErrorBoundary'; import { StationProvider } from './components/StationProvider'; import './styles.css'; import './form-controls.css'; import './fuel-tank-bank.css'; import './staff.css';
createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><BrowserRouter><AuthProvider><StationProvider><App/></StationProvider></AuthProvider></BrowserRouter></ErrorBoundary></StrictMode>);
