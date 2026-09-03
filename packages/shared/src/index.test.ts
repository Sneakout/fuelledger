import { describe, expect, it } from 'vitest';
import { demoAccessSchema,googleAuthSchema,loginSchema,signupSchema } from './index.js';

describe('loginSchema', () => {
  it('accepts valid credentials', () => expect(loginSchema.safeParse({ email: 'owner@example.com', password: 'password123' }).success).toBe(true));
  it('rejects malformed credentials', () => expect(loginSchema.safeParse({ email: 'bad', password: 'tiny' }).success).toBe(false));
});

describe('signupSchema',()=>{it('accepts a strong new owner account',()=>expect(signupSchema.safeParse({name:'Asha Rao',organizationName:'Asha Fuels',email:'asha@example.com',password:'StrongPass1'}).success).toBe(true));it('rejects a weak password',()=>expect(signupSchema.safeParse({name:'Asha Rao',organizationName:'Asha Fuels',email:'asha@example.com',password:'password'}).success).toBe(false));});
describe('googleAuthSchema',()=>{it('does not require a petrol pump name',()=>expect(googleAuthSchema.safeParse({credential:'a-valid-google-credential'}).success).toBe(true));});
describe('demoAccessSchema',()=>{it.each(['buyer@example.com','+91 98765 43210'])('accepts demo contact %s',contact=>expect(demoAccessSchema.safeParse({contact}).success).toBe(true));it('rejects an uncontactable value',()=>expect(demoAccessSchema.safeParse({contact:'hello'}).success).toBe(false));});
