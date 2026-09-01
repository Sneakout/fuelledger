import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DemoAccessInput,GoogleAuthInput,LoginInput,SignupInput,User } from '@fuelledger/shared';
import { api } from '../lib/api';

type AuthContextValue = { user: User | null; loading: boolean; login(input: LoginInput): Promise<void>; signup(input:SignupInput):Promise<void>;googleLogin(input:GoogleAuthInput):Promise<void>;startDemo(input:DemoAccessInput):Promise<void>;changePassword(password:string):Promise<void>;logout(): Promise<void> };
const AuthContext = createContext<AuthContextValue | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null); const [loading, setLoading] = useState(true);
  useEffect(() => { api.me().then(({ user: found }) => setUser(found)).catch(() => setUser(null)).finally(() => setLoading(false)); }, []);
  const login = useCallback(async (input: LoginInput) => { const result = await api.login(input); setUser(result.user); }, []);
  const signup=useCallback(async(input:SignupInput)=>{const result=await api.signup(input);setUser(result.user);},[]);
  const googleLogin=useCallback(async(input:GoogleAuthInput)=>{const result=await api.googleAuth(input);setUser(result.user);},[]);
  const startDemo=useCallback(async(input:DemoAccessInput)=>{const result=await api.startDemo(input);setUser(result.user);},[]);
  const changePassword=useCallback(async(password:string)=>{await api.changePassword({password});const result=await api.me();setUser(result.user);},[]);
  const logout = useCallback(async () => { await api.logout(); setUser(null); }, []);
  const value = useMemo(() => ({ user, loading, login,signup,googleLogin,startDemo,changePassword,logout }), [user, loading, login,signup,googleLogin,startDemo,changePassword,logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error('useAuth must be inside AuthProvider'); return value; }
