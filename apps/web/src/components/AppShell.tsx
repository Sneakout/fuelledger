import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { BadgeCheck, BarChart3, BellRing, BookOpenCheck, Boxes, Building2, ChevronDown, ClipboardList, CreditCard, Fuel, IndianRupee, LayoutDashboard, Menu, Package, ReceiptIndianRupee, ShoppingCart, Users, X } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { useStation } from './StationProvider';

const nav = [
  ['Dashboard', '/', LayoutDashboard], ['Petrol Pumps', '/stations', Building2], ['Products', '/products', Package], ['Operations', '/operations', ClipboardList], ['Reconciliation', '/reconciliation', BadgeCheck], ['Inventory', '/inventory', Boxes], ['Sales', '/sales', IndianRupee], ['Purchases', '/purchases', ShoppingCart], ['Expenses', '/expenses', ReceiptIndianRupee], ['Customers', '/customers', Users], ['Accounting', '/accounting', BookOpenCheck], ['Reports', '/reports', BarChart3], ['Staff & access', '/staff', Users], ['WhatsApp alerts', '/notifications', BellRing], ['Subscription', '/subscription', CreditCard], ['Growth desk', '/demo-leads', Users],
] as const;
export function AppShell() {
  const [open, setOpen] = useState(false); const { user, logout } = useAuth();const{stations,selectedStationId,selectedStation,selectStation}=useStation();const navigate=useNavigate();
  return <div className="shell">
    <aside className={open ? 'sidebar open' : 'sidebar'} aria-label="Primary navigation">
      <div className="brand"><span className="brand-mark"><Fuel size={22}/></span><span>FuelLedger</span><button className="icon-button close" aria-label="Close menu" onClick={() => setOpen(false)}><X/></button></div>
      <label className="station-card station-selector"><span className="station-icon"><Building2 size={18}/></span><div><small>Petrol pump</small><strong>{selectedStation?.name??'Set up your first pump'}</strong></div><select aria-label="Current petrol pump" value={selectedStationId} onChange={event=>{selectStation(event.target.value);navigate('/');}} disabled={stations.length<2}>{stations.map(station=><option key={station.id} value={station.id}>{station.name}</option>)}</select>{stations.length>1&&<ChevronDown size={16}/>}</label>
      <nav>{nav.filter(([label])=>(label!=='Subscription'||user?.role==='OWNER')&&(label!=='WhatsApp alerts'||user?.role==='OWNER')&&(label!=='Growth desk'||user?.isPlatformAdmin)).map(([label, path, Icon]) => <NavLink key={path} to={path} end={path === '/'} onClick={() => setOpen(false)}><Icon size={19}/><span>{label}</span></NavLink>)}</nav>
      <div className="sidebar-foot"><span className="avatar">{user?.name.slice(0, 2).toUpperCase()}</span><div><strong>{user?.name}</strong><small>{user?.role.toLowerCase()}</small></div><button className="signout" onClick={() => void logout()}>Sign out</button></div>
    </aside>
    {open && <button className="backdrop" aria-label="Close menu" onClick={() => setOpen(false)}/>} 
    <div className="workspace"><header className="topbar"><button className="icon-button menu" aria-label="Open menu" onClick={() => setOpen(true)}><Menu/></button><div><small>{user?.demoExpiresAt?'Interactive product tour':'Good morning'}</small><strong>{user?.name}</strong></div><span className="status"><i/> {user?.demoExpiresAt?'Demo mode':'System ready'}</span></header>{user?.demoExpiresAt&&<div className="demo-banner"><span><strong>48-hour demo</strong> · Read-only product tour</span><span>Access ends {new Date(user.demoExpiresAt).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'})}</span></div>}<Outlet/></div>
  </div>;
}
