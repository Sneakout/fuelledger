import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../components/AuthProvider';
import '../account.css';

export function AccountPage() {
  const { user } = useAuth();
  if (!user || user.demoExpiresAt) return <Navigate to="/" replace />;
  return <main className="page account-page">
    <header className="page-heading"><div><h1>My account</h1><p>Manage your display name and sign-in details.</p></div></header>
    <div className="account-grid">
      <ProfileForm key={user.id} name={user.name} email={user.email} />
      <PasswordForm key={user.id} />
    </div>
  </main>;
}

function ProfileForm({ name, email }: { name: string; email: string }) {
  const { updateAccountProfile } = useAuth();
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const displayName = draft.trim();
    if (busy || displayName.length < 2 || displayName === name) return;
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await updateAccountProfile(displayName);
      setDraft(displayName);
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save your profile.');
    } finally { setBusy(false); }
  }

  return <form className="account-card" onSubmit={submit} aria-labelledby="profile-heading">
    <h2 id="profile-heading">Profile</h2>
    <label className="field"><span>Display name</span><input autoComplete="name" value={draft} onChange={event => { setDraft(event.target.value); setSaved(false); }} minLength={2} maxLength={100} required disabled={busy} /></label>
    <label className="field"><span>Sign-in email</span><input type="email" value={email} readOnly /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    {saved && <p className="success-banner" role="status">Display name saved.</p>}
    <button className="primary small" disabled={busy || draft.trim().length < 2 || draft.trim() === name}>{busy ? 'Saving…' : 'Save name'}</button>
  </form>;
}

function PasswordForm() {
  const { changePassword } = useAuth();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setSaved(false);
    if (password !== confirmation) {
      setError('The new passwords do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await changePassword(password, current);
      setCurrent('');
      setPassword('');
      setConfirmation('');
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not change your password.');
    } finally { setBusy(false); }
  }

  return <form className="account-card" onSubmit={submit} aria-labelledby="password-heading">
    <h2 id="password-heading">Change password</h2>
    <p>If you sign in only with Google, manage your password in your Google Account.</p>
    <label className="field"><span>Current password</span><input type="password" autoComplete="current-password" value={current} onChange={event => setCurrent(event.target.value)} required disabled={busy} /></label>
    <label className="field"><span>New password</span><input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} minLength={8} required disabled={busy} aria-describedby="password-guidance" /></label>
    <label className="field"><span>Confirm new password</span><input type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} minLength={8} required disabled={busy} /></label>
    <p id="password-guidance">Use at least 8 characters, including an uppercase letter and a number.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    {saved && <p className="success-banner" role="status">Password changed.</p>}
    <button className="primary small" disabled={busy || !current || !password || !confirmation}>{busy ? 'Changing…' : 'Change password'}</button>
  </form>;
}
