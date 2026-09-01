import { ArrowRight, Droplets } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { DashboardBootstrap } from '../lib/api';

type Tank = DashboardBootstrap['tankStocks'][number];
const amount=(value:number)=>new Intl.NumberFormat('en-IN',{maximumFractionDigits:1}).format(value);

export function FuelTankBank({tanks}:{tanks:Tank[]}){
  const counters:Record<string,number>={};
  return <section className="fuel-bank"><header><div><span className="eyebrow">Fuel tank stock</span><h2>Live tank levels</h2><p>Levels move automatically with recorded stock.</p></div><Link to="/inventory">Update inventory <ArrowRight/></Link></header>{tanks.length?<div className="fuel-bank-grid">{tanks.map(tank=>{const sequence=(counters[tank.productCode]=(counters[tank.productCode]??0)+1);const colour=tank.productCode==='MS'?'ms':'hsd';return <article className={`fuel-orb-card ${colour}`} key={tank.id}><div className="fuel-orb" aria-label={`${tank.productCode} Tank ${sequence}: ${amount(tank.fillPercent)} percent full`}><span className="fuel-liquid" style={{height:`${tank.fillPercent}%`}}/><span className="fuel-percent">{amount(tank.fillPercent)}%</span></div><div className="fuel-orb-copy"><span className="fuel-product">{tank.productCode}</span><h3>{tank.productCode} Tank {sequence}</h3><dl><div><dt>Current inventory</dt><dd>{amount(tank.bookStock)} L</dd></div><div><dt>Total capacity</dt><dd>{amount(tank.workingCapacity)} L</dd></div><div><dt>Selling price</dt><dd>₹{amount(tank.sellingPrice)}/L</dd></div><div><dt>Density</dt><dd>{tank.density===null?'Morning entry due':`${amount(tank.density)} kg/m³`}</dd></div></dl></div></article>})}</div>:<div className="owner-all-clear compact"><Droplets/><h3>No MS or HSD tanks configured</h3><p>Add fuel tanks in Petrol Pump setup to see them here.</p></div>}</section>;
}
