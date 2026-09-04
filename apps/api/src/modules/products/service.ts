import type { ProductInput } from '@fuelledger/shared';
import { Prisma } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

const productInclude = { taxCategory: true, customCategory: true, sellingPriceHistory:{orderBy:{effectiveFrom:'desc' as const}} };
const effectivePrice=(product:{sellingPrice:Prisma.Decimal;sellingPriceHistory:Array<{price:Prisma.Decimal;effectiveFrom:Date}>},at=new Date())=>product.sellingPriceHistory.find(row=>row.effectiveFrom<=at)?.price??product.sellingPrice;
const shapeProduct=<T extends {sellingPrice:Prisma.Decimal;sellingPriceHistory:Array<{price:Prisma.Decimal;effectiveFrom:Date}>}>(product:T)=>({...product,sellingPrice:effectivePrice(product)});
async function assertReferences(organizationId: string, input: ProductInput) {
  if (input.taxCategoryId) { const tax = await prisma.taxCategory.findFirst({ where: { id: input.taxCategoryId, organizationId, active: true } }); if (!tax) throw new AppError(400, 'TAX_CATEGORY_INVALID', 'Choose an active tax category from this organization.'); }
  if (input.customCategoryId) { const category = await prisma.productCategorySetting.findFirst({ where: { id: input.customCategoryId, organizationId, active: true } }); if (!category) throw new AppError(400, 'CATEGORY_INVALID', 'Choose an active custom category from this organization.'); }
}
export async function listCatalog(organizationId: string) { const [products, categories, taxCategories] = await Promise.all([prisma.product.findMany({ where: { organizationId }, orderBy: [{ active: 'desc' }, { name: 'asc' }], include: productInclude }), prisma.productCategorySetting.findMany({ where: { organizationId }, orderBy: { name: 'asc' } }), prisma.taxCategory.findMany({ where: { organizationId }, orderBy: { rate: 'asc' } })]); return { products:products.map(product=>shapeProduct(product)), categories, taxCategories }; }
export async function createProduct(organizationId: string, input: ProductInput) { await assertReferences(organizationId, input);const{sellingPriceEffectiveFrom,...values}=input;const effectiveFrom=sellingPriceEffectiveFrom?new Date(sellingPriceEffectiveFrom):new Date();try { return await prisma.$transaction(async tx=>shapeProduct(await tx.product.create({ data: { organizationId, ...values, hsnCode: input.hsnCode || null, customCategoryId: input.customCategoryId ?? null, taxCategoryId: input.taxCategoryId ?? null, purchasePrice: new Prisma.Decimal(input.purchasePrice), sellingPrice: new Prisma.Decimal(input.sellingPrice),sellingPriceHistory:{create:{price:new Prisma.Decimal(input.sellingPrice),effectiveFrom}} }, include: productInclude }))); } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new AppError(409, 'PRODUCT_CODE_EXISTS', 'A product already uses this SKU/code.'); throw error; } }
export async function updateProduct(organizationId:string,id:string,input:ProductInput){
  const now=new Date();
  const existing=await prisma.product.findFirst({where:{id,organizationId},include:{_count:{select:{tanks:true,nozzles:true}},sellingPriceHistory:{where:{effectiveFrom:{lte:now}},orderBy:{effectiveFrom:'desc'},take:1}}});
  if(!existing)throw new AppError(404,'PRODUCT_NOT_FOUND','This product was not found.');
  if(existing._count.tanks&&(!input.tankLinked||!input.inventoryTracked))throw new AppError(409,'PRODUCT_IN_USE','This product is assigned to station tanks and must remain inventory- and tank-linked.');
  if(existing._count.nozzles&&(!input.meterLinked||!input.inventoryTracked))throw new AppError(409,'PRODUCT_IN_USE','This product is assigned to station nozzles and must remain inventory- and meter-linked.');
  if(existing.code!==input.code&&await prisma.product.findFirst({where:{organizationId,code:input.code,NOT:{id}}}))throw new AppError(409,'PRODUCT_CODE_EXISTS','A product already uses this SKU/code.');
  await assertReferences(organizationId,input);
  const{sellingPriceEffectiveFrom,...values}=input;
  const effectiveFrom=sellingPriceEffectiveFrom?new Date(sellingPriceEffectiveFrom):now;
  const priceChanged=Number(input.sellingPrice)!==Number(existing.sellingPriceHistory[0]?.price??existing.sellingPrice);
  return prisma.$transaction(async tx=>{
    if(priceChanged||sellingPriceEffectiveFrom)await tx.productSellingPrice.upsert({where:{productId_effectiveFrom:{productId:id,effectiveFrom}},update:{price:new Prisma.Decimal(input.sellingPrice)},create:{productId:id,effectiveFrom,price:new Prisma.Decimal(input.sellingPrice)}});
    const product=await tx.product.update({where:{id},data:{...values,hsnCode:input.hsnCode||null,customCategoryId:input.customCategoryId??null,taxCategoryId:input.taxCategoryId??null,purchasePrice:new Prisma.Decimal(input.purchasePrice),...(effectiveFrom<=now?{sellingPrice:new Prisma.Decimal(input.sellingPrice)}:{})},include:productInclude});
    return shapeProduct(product);
  });
}
export async function createCategory(organizationId: string, input: { name: string; code: string }) { try { return await prisma.productCategorySetting.create({ data: { organizationId, ...input } }); } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new AppError(409, 'CATEGORY_CODE_EXISTS', 'A category already uses this code.'); throw error; } }
export async function createTaxCategory(organizationId: string, input: { name: string; rate: number }) { try { return await prisma.taxCategory.create({ data: { organizationId, name: input.name, rate: new Prisma.Decimal(input.rate) } }); } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new AppError(409, 'TAX_CATEGORY_EXISTS', 'A tax category already uses this name.'); throw error; } }
