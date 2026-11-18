import { useEffect, useRef, useState } from 'react';
import { hasActiveIntelligence } from '@fuelledger/shared';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BookOpenCheck, Boxes, Building2, ChevronDown, ClipboardList, Fuel, IndianRupee, LayoutDashboard, Lightbulb, Menu, Settings, ShieldCheck, X } from 'lucide-react';
import { api, type SubscriptionStatus } from '../lib/api';
import { useAuth } from './AuthProvider';
import { useStation } from './StationProvider';
import { OfflineSyncStatus } from './OfflineSyncStatus';
import { OwnerApprovalReminder, usePendingApprovals } from './OwnerApprovalReminder';
import './app-shell.css';

type Access = 'intelligence' | 'owner' | 'liveOwner' | 'liveAccount' | 'admin';
type Destination = { label: string; to: string; access?: Access };
type Section = { label: string; icon: typeof Fuel; links: Destination[]; access?: Access; mobile?: boolean };

const sections: Section[] = [
  { label: 'Dashboard', icon: LayoutDashboard, mobile: true, links: [{ label: 'Dashboard', to: '/' }] },
  { label: 'Nerve Intelligence', icon: Lightbulb, access: 'intelligence', links: [
    { label: 'Daily Brief', to: '/insights/daily-brief' }, { label: 'Agents', to: '/insights' },
  ] },
  { label: 'Operations', icon: ClipboardList, mobile: true, links: [
    { label: 'Shifts', to: '/operations' }, { label: 'Reconciliation', to: '/reconciliation' },
  ] },
  { label: 'Sales', icon: IndianRupee, mobile: true, links: [
    { label: 'Record sale', to: '/sales' }, { label: 'Sales history', to: '/sales/history' }, { label: 'Customers & fleet', to: '/customers' },
  ] },
  { label: 'Stock', icon: Boxes, mobile: true, links: [
    { label: 'Inventory', to: '/inventory' }, { label: 'Purchases', to: '/purchases' }, { label: 'Products', to: '/products' },
  ] },
  { label: 'Accounts', icon: BookOpenCheck, links: [
    { label: 'Expenses', to: '/expenses' }, { label: 'Accounting', to: '/accounting' }, { label: 'Reports', to: '/reports' },
  ] },
  { label: 'Settings', icon: Settings, links: [
    { label: 'Fuel stations & equipment', to: '/stations' }, { label: 'Staff & access', to: '/staff', access: 'owner' },
    { label: 'WhatsApp alerts', to: '/notifications', access: 'liveOwner' }, { label: 'Subscription', to: '/subscription', access: 'owner' },
    { label: 'My account', to: '/account', access: 'liveAccount' }, { label: 'User guide', to: '/help/guide' }, { label: 'Help & support', to: '/help' }, { label: 'Growth Desk', to: '/demo-leads', access: 'admin' },
  ] },
];

function contains(pathname: string, destination: string) {
  return pathname === destination || (destination !== '/' && pathname.startsWith(`${destination}/`));
}

function useIntelligenceAccess(ownerId: string | undefined) {
  const [plan, setPlan] = useState<{ ownerId: string; status: SubscriptionStatus }>();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!ownerId) return;
    let latest = 0;
    let active = true;
    async function refresh() {
      const request = ++latest;
      try {
        const status = await api.subscription();
        if (active && request === latest && ownerId) setPlan({ ownerId, status });
      } catch { /* Keep the last verified entitlement for this session. */ }
      if (active) setNow(Date.now());
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [ownerId]);
  return Boolean(ownerId && plan?.ownerId === ownerId && hasActiveIntelligence(plan.status, new Date(now)));
}

export function AppShell() {
  const [open, setOpen] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const sectionNav = useRef<HTMLElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const { user, logout } = useAuth();
  const { stations, selectedStationId, selectedStation, selectStation } = useStation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const owner = user?.role === 'OWNER';
  const liveOwner = owner && !user?.demoExpiresAt;
  const intelligence = useIntelligenceAccess(liveOwner ? user?.id : undefined);
  const pendingApprovals = usePendingApprovals(liveOwner ? user?.id : undefined);
  const access: Record<Access, boolean> = { owner, liveOwner, liveAccount: Boolean(user && !user.demoExpiresAt), intelligence, admin: Boolean(user?.isPlatformAdmin) };
  const visible = sections.filter(section => !section.access || access[section.access]);
  const current = visible.find(section => section.links.some(link => contains(pathname, link.to))
    || (section.access === 'intelligence' && pathname === '/intelligence-agents'));
  const currentLink = current?.links.filter(link => contains(pathname, link.to)).sort((a, b) => b.to.length - a.to.length)[0]
    ?? (current?.access === 'intelligence' ? current.links[1] : undefined);

  useEffect(() => {
    const strip = sectionNav.current;
    const activeLink = strip?.querySelector('[aria-current="page"]');
    if (!strip || !activeLink) return;
    const stripBounds = strip.getBoundingClientRect();
    const linkBounds = activeLink.getBoundingClientRect();
    if (linkBounds.right > stripBounds.right) strip.scrollLeft += linkBounds.right - stripBounds.right + 12;
    if (linkBounds.left < stripBounds.left) strip.scrollLeft += linkBounds.left - stripBounds.left - 12;
  }, [currentLink]);

  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        menuTrigger.current?.focus();
      }
      if (event.key !== 'Tab' || !sidebar.current || !closeButton.current?.getClientRects().length) return;
      const controls = Array.from(sidebar.current.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), select:not(:disabled)'));
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, [open]);

  function closeMenu() {
    setOpen(false);
    menuTrigger.current?.focus();
  }

  return <div className="shell">
    <aside ref={sidebar} id="workspace-menu" className={open ? 'sidebar open' : 'sidebar'}>
      <div className="brand">
        <span className="brand-mark"><Fuel size={22} /></span><span>FuelNerve</span>
        <button ref={closeButton} className="icon-button close" aria-label="Close menu" onClick={closeMenu}><X /></button>
      </div>
      <label className="station-card station-selector">
        <span className="station-icon"><Building2 size={18} /></span>
        <div><small>Fuel station</small><strong>{selectedStation?.name ?? 'Set up your first pump'}</strong></div>
        <select aria-label="Current fuel station" value={selectedStationId} onChange={event => {
          selectStation(event.target.value);
          setOpen(false);
          navigate('/');
        }} disabled={stations.length < 2}>
          {stations.map(station => <option key={station.id} value={station.id}>{station.name}</option>)}
        </select>
        {stations.length > 1 && <ChevronDown size={16} />}
      </label>
      <nav aria-label="Primary navigation">
        {visible.map(({ label, links, icon: Icon }) => <Link key={label} to={links[0]!.to}
          className={current?.label === label ? 'active' : undefined}
          aria-current={current?.label === label ? 'location' : undefined} onClick={() => setOpen(false)}>
          <Icon size={19} aria-hidden="true" /><span>{label}</span>
        </Link>)}
      </nav>
      <div className="sidebar-foot">
        <span className="avatar">{user?.name.slice(0, 2).toUpperCase()}</span>
        <div><strong>{user?.name}</strong><small>{user?.role.toLowerCase()}</small></div>
        <button className="signout" onClick={() => void logout()}>Sign out</button>
      </div>
    </aside>
    {open && <button className="backdrop shell-backdrop" aria-hidden="true" tabIndex={-1} onClick={closeMenu} />}
    <div className="workspace">
      <header className="topbar">
        <div className="shell-greeting"><small>{user?.demoExpiresAt ? 'Interactive product tour' : 'Welcome back'}</small><strong>{access.liveAccount ? <Link className="shell-account-link" to="/account" aria-label="My account">{user?.name}</Link> : user?.name}</strong></div>
        <OfflineSyncStatus demo={Boolean(user?.demoExpiresAt)} />
        {liveOwner && <NavLink to="/approvals" className="shell-approvals">
          <ShieldCheck size={17} aria-hidden="true" /> Approvals
          {pendingApprovals.length > 0 && <span aria-label={`${pendingApprovals.length} pending`}>{pendingApprovals.length}</span>}
        </NavLink>}
      </header>
      {user?.demoExpiresAt && <div className="demo-banner"><span><strong>48-hour demo</strong> · Read-only product tour</span><span>Access ends {new Date(user.demoExpiresAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span></div>}
      {current && current.links.length > 1 && <nav ref={sectionNav} className="shell-section-nav" aria-label={`${current.label} navigation`}>
        {current.links.filter(link => !link.access || access[link.access]).map(link => <Link key={link.to} to={link.to}
          aria-current={currentLink?.to === link.to ? 'page' : undefined}>{link.label}</Link>)}
      </nav>}
      <Outlet />
      <OwnerApprovalReminder pending={pendingApprovals} />
      <nav className="shell-mobile-nav" aria-label="Mobile navigation">
        {visible.filter(section => section.mobile).map(({ label, icon: Icon, links }) => <Link key={label} to={links[0]!.to}
          aria-current={current?.label === label ? 'location' : undefined} onClick={() => setOpen(false)}>
          <Icon size={19} aria-hidden="true" />{label}
        </Link>)}
        <button ref={menuTrigger} type="button" aria-expanded={open} aria-current={current && !current.mobile ? "location" : undefined} aria-controls="workspace-menu" onClick={() => setOpen(true)}>
          <Menu size={19} aria-hidden="true" />More
        </button>
      </nav>
    </div>
  </div>;
}
