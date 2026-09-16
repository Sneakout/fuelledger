import {describe,expect,it} from 'vitest';
import {purchaseDashboardActions} from '../src/modules/dashboard/service.js';

describe('dashboard purchase actions',()=>{
  it('uses pending price approvals and recent invoices as the shared dashboard source',()=>{
    const actions=purchaseDashboardActions([{id:'invoice-1',invoiceNumber:'IOCL-1',totalAmount:1207079,supplier:{name:'Indian Oil Corporation Limited'}}],[{id:'approval-1',reason:'Price changed',evidence:{product:{code:'HSD',unit:'LITRE'},invoice:{id:'invoice-1',invoiceNumber:'IOCL-1'},currentPurchasePrice:88,proposedPurchasePrice:100.59}}]);
    expect(actions).toEqual([
      expect.objectContaining({id:'price-approval-approval-1',severity:'HIGH',title:'New invoice IOCL-1 recorded — HSD price change needs confirmation',href:'/purchases?invoiceId=invoice-1'}),
      expect.objectContaining({id:'purchases-recorded-today',severity:'MEDIUM',title:'1 new purchase invoice recorded today',detail:expect.stringContaining('Indian Oil Corporation Limited')}),
    ]);
  });

  it('does not invent purchase actions without stored records',()=>{
    expect(purchaseDashboardActions([],[])).toEqual([]);
  });

  it('ignores malformed or unchanged price evidence',()=>{
    expect(purchaseDashboardActions([],[{id:'unchanged',reason:'No material change',evidence:{product:{code:'MS',unit:'LITRE'},invoice:{id:'invoice-2',invoiceNumber:'IOCL-2'},currentPurchasePrice:98,proposedPurchasePrice:98}}])).toEqual([]);
  });
});
