import { describe,expect,it,vi } from 'vitest';
import type { NextFunction,Request,Response } from 'express';

vi.mock('../src/modules/auth/service.js',()=>({currentUser:vi.fn().mockResolvedValue({id:'demo-owner',name:'Demo Visitor',email:'owner@fuelledger.local',role:'OWNER',organization:{id:'demo-org',name:'ABC Fuels'},allStations:true,stations:[],demoExpiresAt:new Date(Date.now()+60_000).toISOString()})}));

describe('demo mode',async()=>{const{authenticate}=await import('../src/middleware/authenticate.js');it('allows reads but rejects writes server-side',async()=>{const run=async(method:string)=>{const req={method,cookies:{fuelledger_session:'valid-demo-token'}} as unknown as Request;let error:unknown;await authenticate(req,{} as Response,((item?:unknown)=>{error=item;}) as NextFunction);return error;};expect(await run('GET')).toBeUndefined();const blocked=await run('POST');expect(blocked).toMatchObject({status:403,code:'DEMO_READ_ONLY'});});});
