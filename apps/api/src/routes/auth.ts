import { Router } from 'express';
import { changePasswordSchema,demoAccessSchema,googleAuthSchema,loginSchema,signupSchema } from '@fuelledger/shared';
import { AppError } from '../lib/errors.js';
import { changePassword,currentUser,googleAuth,login,signup,startDemo } from '../modules/auth/service.js';

export const authRouter = Router();
const setSession=(res:Parameters<Parameters<typeof authRouter.post>[1]>[1],result:Awaited<ReturnType<typeof login>>)=>{res.cookie('fuelledger_session',result.token,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:8*60*60*1000});res.json({user:result.user});};
authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, 'VALIDATION_ERROR', 'Please check the information entered.', parsed.error.flatten());
  const result = await login(parsed.data);
  setSession(res,result);
});
authRouter.post('/signup',async(req,res)=>{const parsed=signupSchema.safeParse(req.body);if(!parsed.success)throw new AppError(400,'VALIDATION_ERROR','Please check the information entered.',parsed.error.flatten());setSession(res,await signup(parsed.data));});
authRouter.post('/google',async(req,res)=>{const parsed=googleAuthSchema.safeParse(req.body);if(!parsed.success)throw new AppError(400,'VALIDATION_ERROR','Google sign-in information is invalid.',parsed.error.flatten());setSession(res,await googleAuth(parsed.data));});
authRouter.post('/demo',async(req,res)=>{const parsed=demoAccessSchema.safeParse(req.body);if(!parsed.success)throw new AppError(400,'VALIDATION_ERROR','Enter a valid email address or mobile number.',parsed.error.flatten());const result=await startDemo(parsed.data);res.cookie('fuelledger_session',result.token,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:48*60*60*1000});res.json({user:result.user});});
authRouter.get('/me', async (req, res) => {
  const token = req.cookies.fuelledger_session as string | undefined;
  if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in.');
  res.json({ user: await currentUser(token) });
});
authRouter.post('/change-password',async(req,res)=>{const token=req.cookies.fuelledger_session as string|undefined;if(!token)throw new AppError(401,'UNAUTHENTICATED','Please sign in.');const user=await currentUser(token);const parsed=changePasswordSchema.safeParse(req.body);if(!parsed.success)throw new AppError(400,'VALIDATION_ERROR','Choose a stronger password.',parsed.error.flatten());await changePassword(user.id,parsed.data);res.json({ok:true});});
authRouter.post('/logout', (_req, res) => { res.clearCookie('fuelledger_session'); res.status(204).send(); });
