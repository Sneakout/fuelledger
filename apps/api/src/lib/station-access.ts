import type { User } from '@fuelledger/shared';
import { AppError } from './errors.js';
import { prisma } from './prisma.js';
export const permittedStationIds=(user:User)=>user.allStations?undefined:user.stations.map(station=>station.id);
export function assertStationAccess(user:User,stationId:string){if(!user.allStations&&!user.stations.some(station=>station.id===stationId))throw new AppError(403,'STATION_ACCESS_DENIED','You do not have access to this station.');}
export function requireOwner(user:User){if(user.role!=='OWNER')throw new AppError(403,'OWNER_REQUIRED','Only an owner can manage station access.');}
export async function assertShiftAccess(user:User,shiftId:string){if(user.allStations)return;const allowed=await prisma.shift.count({where:{id:shiftId,stationId:{in:user.stations.map(station=>station.id)}}});if(!allowed)throw new AppError(403,'STATION_ACCESS_DENIED','You do not have access to this shift.');}
export async function assertAttachmentAccess(user:User,attachmentId:string){if(user.allStations)return;const ids=user.stations.map(station=>station.id);const allowed=await prisma.attachment.count({where:{id:attachmentId,OR:[{purchaseInvoice:{stationId:{in:ids}}},{expense:{stationId:{in:ids}}}]}});if(!allowed)throw new AppError(403,'STATION_ACCESS_DENIED','You do not have access to this attachment.');}
