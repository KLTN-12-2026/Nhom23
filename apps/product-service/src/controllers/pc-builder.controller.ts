import prisma from '@packages/libs/prisma';
import { handle, objectId, pageArgs } from '@packages/utils/api';
import { ForbiddenError, NotFoundError, ValidationError } from '@packages/error-handler';
import { Prisma } from '@prisma/client';
import { PC_SLOTS, PcSlot, COMPONENT_TERMS, componentMatches, assessCompatibility } from '@packages/utils/pc-build';
import { parsePcSelections } from '@packages/utils/pc-build-selection';
import { usdCents } from '@packages/utils/money';
import { recommendPcProducts } from '@packages/utils/pc-recommendations';

const select = { id: true, title: true, slug: true, category: true, subCategory: true, tags: true, colors: true, sizes: true, sale_price: true, stock: true, custom_specification: true, warranty: true, images: { select: { url: true }, take: 1 }, variants: { where: { active: true }, select: { id: true, sku: true, color: true, size: true, price: true, stock: true } } };
const availableProducts = (): Prisma.productsWhereInput => ({
  status: 'Active', isDeleted: false,
  shop: { sellers: { OR: [{ suspendedAt: null }, { suspendedAt: { isSet: false } }, { suspendedUntil: { not: null, isSet: true, lte: new Date() } }] } },
});
function selectionsFrom(value: unknown) {
  try { return parsePcSelections(value); }
  catch (error) { throw new ValidationError(error instanceof Error ? error.message : 'Invalid PC build'); }
}

async function syncAvailabilityWatches(buildId: string, ownerId: string, parts: ReturnType<typeof selectionsFrom>) {
  await prisma.pcBuildAvailabilityWatch.deleteMany({ where: { buildId } });
  const productIds = [...new Set(parts.map(part => part.id))];
  if (productIds.length) {
    await prisma.pcBuildAvailabilityWatch.createMany({
      data: productIds.map(productId => ({ buildId, ownerId, productId })),
    });
  }
}

async function quoteSelections(selections: ReturnType<typeof selectionsFrom>) {
  const ids = selections.map(part => part.id);
  const products = await prisma.products.findMany({ where: { ...availableProducts(), id: { in: ids } }, select });
  const parts = selections.map(selection => {
    const product = products.find(item => item.id === selection.id);
    if (!product || !componentMatches(product, selection.slot)) throw new ValidationError('A selected component is unavailable or belongs to a different category');
    const variant = product.variants.find(item => item.id === selection.variantId);
    if ((product.variants.length && !variant) || (!product.variants.length && selection.variantId)) throw new ValidationError(`Select a variant for ${product.title}`);
    const options = selection.selectedOptions || {};
    if (!variant && ((product.colors.length && !product.colors.includes(options.color)) || (product.sizes.length && !product.sizes.includes(options.size)))) throw new ValidationError(`Select options for ${product.title}`);
    const stock = Math.min(product.stock, variant?.stock ?? product.stock);
    return { ...product, slot: selection.slot, stock, variantId: variant?.id || null, sale_price: variant?.price ?? product.sale_price, selectedOptions: variant ? { color: variant.color, size: variant.size } : { color: options.color || '', size: options.size || '' } };
  });
  const compatibility = assessCompatibility(Object.fromEntries(parts.map(part => [part.slot, part])));
  const issues = [...compatibility.issues];
  for (const part of parts) if (part.stock < 1) issues.push({ level: 'error', message: `${part.title} is out of stock.` });
  return {
    parts,
    issues,
    compatibility: { checks: compatibility.checks, notes: compatibility.notes },
    total: parts.reduce((sum, part) => sum + usdCents(part.sale_price), 0) / 100,
    currency: 'usd',
    canAddToCart: !issues.some(issue => issue.level === 'error'),
  };
}

function quoteSnapshot(quote: Awaited<ReturnType<typeof quoteSelections>>) {
  return {
    parts: quote.parts.map(part => ({
      slot: part.slot,
      id: part.id,
      title: part.title,
      sale_price: part.sale_price,
      stock: part.stock,
      variantId: part.variantId,
      selectedOptions: part.selectedOptions,
      custom_specification: part.custom_specification,
    })),
    issues: quote.issues,
    compatibility: quote.compatibility,
    total: quote.total,
    currency: quote.currency,
    canAddToCart: quote.canAddToCart,
    updatedAt: new Date().toISOString(),
  };
}

function pcBuildResponse(build: { id: string; name: string; parts: unknown; quote: unknown; updatedAt: Date }) {
  return { id: build.id, name: build.name, parts: build.parts, quote: build.quote, updatedAt: build.updatedAt };
}

export const getSavedBuild = handle(async (req, res) => {
  if (req.query.ownerId !== req.user!.id) throw new ForbiddenError();
  res.setHeader('Cache-Control', 'no-store');
  const id = req.user!.id;
  let saved;
  try {
    saved = await prisma.savedPcBuild.upsert({ where: { id }, create: { id, ownerId: id, parts: [] }, update: { ownerId: id } });
  } catch (error) {
    // Two devices may create the initial empty record at the same time.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    saved = await prisma.savedPcBuild.findUniqueOrThrow({ where: { id } });
  }
  const parts = selectionsFrom(saved.parts);
  if (parts.length) await syncAvailabilityWatches(id, id, parts);
  res.json({ parts, quote: saved.quote, revision: saved.revision, updatedAt: saved.updatedAt });
});

export const getSavedBuilds = handle(async (req, res) => {
  if (req.query.ownerId !== req.user!.id) throw new ForbiddenError();
  res.setHeader('Cache-Control', 'no-store');
  const builds = await prisma.pcBuild.findMany({ where: { ownerId: req.user!.id }, orderBy: { updatedAt: 'desc' }, take: 50 });
  res.json({ builds: builds.map(pcBuildResponse) });
});

export const saveBuild = handle(async (req, res) => {
  if (req.body.ownerId !== req.user!.id) throw new ForbiddenError();
  res.setHeader('Cache-Control', 'no-store');
  const revision = req.body.revision;
  if (!Number.isInteger(revision) || revision < 0 || revision >= 2147483647) throw new ValidationError('Invalid revision');
  const parts = selectionsFrom(req.body.parts);
  if (!parts.length) throw new ValidationError('Choose at least one component');
  const quote = quoteSnapshot(await quoteSelections(parts));
  const result = await prisma.savedPcBuild.updateMany({
    where: { id: req.user!.id, revision },
    data: { parts, quote, revision: { increment: 1 } },
  });
  if (!result.count) {
    res.status(409).json({ message: 'Saved PC build changed on another device', code: 'PC_BUILD_CONFLICT' });
    return;
  }
  await syncAvailabilityWatches(req.user!.id, req.user!.id, parts);
  res.json({ revision: revision + 1, quote });
});

export const createPcBuild = handle(async (req, res) => {
  if (req.body.ownerId !== req.user!.id) throw new ForbiddenError();
  res.setHeader('Cache-Control', 'no-store');
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name || name.length > 200) throw new ValidationError('Provide a build name');
  const selections = selectionsFrom(req.body.parts);
  if (!selections.length) throw new ValidationError('Choose at least one component');
  if (await prisma.pcBuild.count({ where: { ownerId: req.user!.id } }) >= 50) throw new ValidationError('You can save up to 50 named PC builds');
  const quote = quoteSnapshot(await quoteSelections(selections));
  const created = await prisma.pcBuild.create({ data: { ownerId: req.user!.id, name, parts: selections, quote } });
  await syncAvailabilityWatches(created.id, req.user!.id, selections);
  res.status(201).json(pcBuildResponse(created));
});

export const getPcBuild = handle(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const id = objectId(req.params.id);
  const build = await prisma.pcBuild.findFirst({ where: { id, ownerId: req.user!.id } });
  if (!build || build.ownerId !== req.user!.id) throw new NotFoundError('PC build not found');
  res.json(pcBuildResponse(build));
});

export const updatePcBuild = handle(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const id = objectId(req.params.id);
  const build = await prisma.pcBuild.findFirst({ where: { id, ownerId: req.user!.id } });
  if (!build) throw new NotFoundError('PC build not found');
  const data: Prisma.pcBuildUpdateInput = {};
  if (req.body.name !== undefined) {
    if (typeof req.body.name !== 'string' || !req.body.name.trim() || req.body.name.trim().length > 200) throw new ValidationError('Provide a build name');
    data.name = req.body.name.trim();
  }
  let selections: ReturnType<typeof selectionsFrom> | undefined;
  if (req.body.parts !== undefined) {
    selections = selectionsFrom(req.body.parts);
    if (!selections.length) throw new ValidationError('Choose at least one component');
    data.parts = selections;
    data.quote = quoteSnapshot(await quoteSelections(selections));
  }
  if (!Object.keys(data).length) throw new ValidationError('No build changes provided');
  const updated = await prisma.pcBuild.update({ where: { id }, data });
  if (selections) await syncAvailabilityWatches(updated.id, req.user!.id, selections);
  res.json(pcBuildResponse(updated));
});

export const deletePcBuild = handle(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const id = objectId(req.params.id);
  const build = await prisma.pcBuild.findFirst({ where: { id, ownerId: req.user!.id } });
  if (!build) throw new NotFoundError('PC build not found');
  await prisma.pcBuildAvailabilityWatch.deleteMany({ where: { buildId: id } });
  await prisma.pcBuild.delete({ where: { id } });
  res.json({ ok: true });
});

export const buildCatalog = handle(async (req, res) => {
  const slot = req.query.slot as PcSlot;
  if (!PC_SLOTS.includes(slot)) throw new ValidationError('Invalid component type');
  const sort = req.query.sort ?? 'recommended';
  if (sort !== 'recommended' && sort !== 'priceAsc' && sort !== 'priceDesc') throw new ValidationError('Invalid sort option');
  let rawParts: unknown = [];
  if (req.query.parts !== undefined) {
    if (typeof req.query.parts !== 'string' || req.query.parts.length > 12000) throw new ValidationError('Invalid PC build');
    try { rawParts = JSON.parse(req.query.parts); } catch { throw new ValidationError('Invalid PC build'); }
  }
  const selections = selectionsFrom(rawParts).filter(part => part.slot !== slot);
  const selectedProducts = selections.length ? await prisma.products.findMany({ where: { ...availableProducts(), id: { in: selections.map(part => part.id) } }, select }) : [];
  const selected = Object.fromEntries(selections.map(selection => {
    const product = selectedProducts.find(product => product.id === selection.id);
    if (!product || !componentMatches(product, selection.slot)) throw new ValidationError('A selected component is unavailable or belongs to a different category');
    return [selection.slot, product];
  }));
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const where: Prisma.productsWhereInput = { ...availableProducts(), stock: { gt: 0 }, AND: [
    { OR: COMPONENT_TERMS[slot].flatMap(term => [{ category: { contains: term, mode: 'insensitive' as const } }, { subCategory: { contains: term, mode: 'insensitive' as const } }, { tags: { has: term } }]) },
    ...(q ? [{ title: { contains: q, mode: 'insensitive' as const } }] : []),
  ] };
  const { skip, take } = pageArgs(req.query);
  // Rank/filter the complete category before pagination so later pages cannot hide better matches.
  const candidates = await prisma.products.findMany({ where, select });
  const ranked = recommendPcProducts(candidates, slot, selected, sort);
  const total = ranked.length;
  res.setHeader('Cache-Control', 'no-store');
  res.json({ products: ranked.slice(skip, skip + take), currency: 'usd', pagination: { page: skip / take + 1, total, totalPages: Math.max(1, Math.ceil(total / take)) } });
});

export const quoteBuild = handle(async (req, res) => {
  const selections = selectionsFrom(req.body.parts);
  if (!selections.length) throw new ValidationError('Choose at least one component');
  res.json(await quoteSelections(selections));
});
