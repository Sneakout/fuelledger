import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DemoAccessInput,GoogleAuthInput,LoginInput,SignupInput,User } from '@fuelledger/shared';
import { ApiRequestError, api, setOfflineUserScope } from '../lib/api';

const CACHED_USER_KEY = 'fuelnerve:last-authenticated-user';
type CachedUser = { user: User; verifiedAt: number };

function remember(user: User) {
  try { localStorage.setItem(CACHED_USER_KEY, JSON.stringify({ user, verifiedAt: Date.now() } satisfies CachedUser)); } catch { /* unavailable */ }
  if (navigator.storage?.persist) void navigator.storage.persist().catch(() => false);
  setOfflineUserScope(`${user.organization.id}:${user.id}`);
}

function forget() {
  try { localStorage.removeItem(CACHED_USER_KEY); } catch { /* unavailable */ }
  setOfflineUserScope(null);
}

function recalledUser() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHED_USER_KEY) ?? 'null') as CachedUser | null;
    if (!cached) return null;
    if (cached.user.demoExpiresAt && Date.parse(cached.user.demoExpiresAt) <= Date.now()) return null;
    return cached.user;
  } catch { return null; }
}

type AuthContextValue = { user: User | null; loading: boolean; login(input: LoginInput): Promise<void>; signup(input:SignupInput):Promise<void>;googleLogin(input:GoogleAuthInput):Promise<void>;startDemo(input:DemoAccessInput):Promise<void>;changePassword(password:string):Promise<void>;logout(): Promise<void> };
const AuthContext = createContext<AuthContextValue | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null); const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.me().then(({ user: found }) => { setUser(found); remember(found); }).catch((error) => {
      if (error instanceof ApiRequestError && error.code === 'NETWORK_UNAVAILABLE') {
        const cached = recalledUser();
        setUser(cached);
        if (cached) setOfflineUserScope(`${cached.organization.id}:${cached.id}`);
      } else { setUser(null); forget(); }
    }).finally(() => setLoading(false));
  }, []);
  const login = useCallback(async (input: LoginInput) => { const result = await api.login(input); setUser(result.user); remember(result.user); }, []);
  const signup=useCallback(async(input:SignupInput)=>{const result=await api.signup(input);setUser(result.user);remember(result.user);},[]);
  const googleLogin=useCallback(async(input:GoogleAuthInput)=>{const result=await api.googleAuth(input);setUser(result.user);remember(result.user);},[]);
  const startDemo=useCallback(async(input:DemoAccessInput)=>{const result=await api.startDemo(input);setUser(result.user);remember(result.user);},[]);
  const changePassword=useCallback(async(password:string)=>{await api.changePassword({password});const result=await api.me();setUser(result.user);remember(result.user);},[]);
  const logout = useCallback(async () => {
    try { await api.logout(); }
    finally { setUser(null); forget(); }
  }, []);
  const value = useMemo(() => ({ user, loading, login,signup,googleLogin,startDemo,changePassword,logout }), [user, loading, login,signup,googleLogin,startDemo,changePassword,logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error('useAuth must be inside AuthProvider'); return value; }
