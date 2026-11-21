import request from 'supertest';
import db, { resetDb } from './mocks/prisma';
import { appFor, userId, otherId, productId } from './helpers';
import { parsePcSelections } from '@packages/utils/pc-build-selection';
import { componentMatches } from '@packages/utils/pc-build';
import { getSavedBuild, getSavedBuilds, saveBuild, createPcBuild, buildCatalog, quoteBuild } from '../../apps/product-service/src/controllers/pc-builder.controller';
import { notifyPcBuildRestock } from '../../apps/product-service/src/utils/pc-build-restock';

const selection = { slot: 'cpu', id: productId, selectedOptions: { color: 'Black', size: '' } };
const quotedProduct = { id: productId, title: 'CPU', category: 'CPU', subCategory: 'Processor', tags: [], colors: [], sizes: [], variants: [], custom_specification: {}, sale_price: 100, stock: 5 };
beforeEach(() => {
  resetDb();
  db.products.findMany.mockResolvedValue([quotedProduct]);
});

test('saved build payload keeps only bounded component references, never stale prices or account data', () => {
  expect(parsePcSelections([{ ...selection, id: 'ABCDEF123456ABCDEF123456', price: 1, stock: 9000, ownerId: otherId }])).toEqual([
    { ...selection, id: 'abcdef123456abcdef123456' },
  ]);
  expect(parsePcSelections([])).toEqual([]);
});

test.each([
  null, {}, [null], [{ ...selection, id: 'bad' }], [{ ...selection, variantId: 'bad' }],
  [{ ...selection, variantId: '' }], [{ ...selection, slot: 'monitor' }], [selection, selection],
  Array(9).fill(selection), [{ ...selection, selectedOptions: [] }],
  [{ ...selection, selectedOptions: { color: { nested: 'Black' } } }],
  [{ ...selection, selectedOptions: { size: 'x'.repeat(201) } }],
  [{ ...selection, selectedOptions: { arbitrary: 'value' } }],
])('malformed saved or shared PC builds are rejected (%#)', value => {
  expect(() => parsePcSelections(value)).toThrow();
});

test('saved build read and write reject a stale identity after an account switch', async () => {
  expect((await request(appFor('get', '/', getSavedBuild)).get('/?ownerId=' + otherId)).status).toBe(403);
  expect((await request(appFor('put', '/', saveBuild)).put('/').send({ ownerId: otherId, revision: 0, parts: [selection] })).status).toBe(403);
  expect(db.savedPcBuild.upsert).not.toHaveBeenCalled();
  expect(db.savedPcBuild.updateMany).not.toHaveBeenCalled();
});

test('saved build read initializes only the authenticated account and disables shared caching', async () => {
  db.savedPcBuild.upsert.mockResolvedValue({ parts: [], revision: 0, updatedAt: new Date('2026-10-15') });
  const response = await request(appFor('get', '/', getSavedBuild)).get('/?ownerId=' + userId);
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body).toMatchObject({ parts: [], revision: 0 });
  expect(db.savedPcBuild.upsert.mock.calls[0][0]).toEqual({ where: { id: userId }, create: { id: userId, ownerId: userId, parts: [] }, update: { ownerId: userId } });
});

test('saving uses account-scoped compare-and-swap and never retries a conflicting overwrite', async () => {
  const app = appFor('put', '/', saveBuild);
  const body = { ownerId: userId, revision: 3, parts: [{ ...selection, sale_price: 1, stock: 500 }] };
  db.savedPcBuild.updateMany.mockResolvedValueOnce({ count: 0 });
  const conflict = await request(app).put('/').send(body);
  expect(conflict.status).toBe(409);
  expect(conflict.body.code).toBe('PC_BUILD_CONFLICT');
  expect(db.savedPcBuild.updateMany).toHaveBeenCalledTimes(1);
  expect(db.savedPcBuild.updateMany.mock.calls[0][0]).toMatchObject({
    where: { id: userId, revision: 3 },
    data: { parts: [selection], revision: { increment: 1 }, quote: { total: 100, currency: 'usd' } },
  });
  db.savedPcBuild.updateMany.mockResolvedValueOnce({ count: 1 });
  const saved = await request(app).put('/').send(body);
  expect(saved.body.revision).toBe(4);
  expect(saved.body.quote).toMatchObject({ total: 100, updatedAt: expect.any(String) });
  expect(db.pcBuildAvailabilityWatch.createMany).toHaveBeenCalledWith({ data: [{ buildId: userId, ownerId: userId, productId }] });
});

test('named builds are owner-scoped and save a server-priced compatibility snapshot', async () => {
  const app = appFor('post', '/', createPcBuild);
  db.pcBuild.count.mockResolvedValue(0);
  db.pcBuild.create.mockResolvedValue({ id: otherId, name: 'Gaming PC', parts: [selection], quote: { total: 100 }, updatedAt: new Date('2026-10-15') });
  const denied = await request(app).post('/').send({ ownerId: otherId, name: 'Other build', parts: [selection] });
  expect(denied.status).toBe(403);
  expect(db.pcBuild.create).not.toHaveBeenCalled();

  const response = await request(app).post('/').send({ ownerId: userId, name: ' Gaming PC ', parts: [selection], quote: { total: 1 } });
  expect(response.status).toBe(201);
  expect(response.body).toMatchObject({ id: otherId, name: 'Gaming PC', quote: { total: 100 } });
  expect(db.pcBuild.create.mock.calls[0][0].data).toMatchObject({ ownerId: userId, name: 'Gaming PC', parts: [selection], quote: { total: 100 } });
  expect(db.pcBuildAvailabilityWatch.createMany).toHaveBeenCalledWith({ data: [{ buildId: otherId, ownerId: userId, productId }] });
});

test('named build list cannot be read as another account', async () => {
  expect((await request(appFor('get', '/', getSavedBuilds)).get('/?ownerId=' + otherId)).status).toBe(403);
  expect(db.pcBuild.findMany).not.toHaveBeenCalled();
});

test('a restock notification is created once per owner, even for multiple saved builds', async () => {
  db.pcBuildAvailabilityWatch.findMany.mockResolvedValue([
    { ownerId: userId }, { ownerId: userId }, { ownerId: otherId },
  ]);
  await notifyPcBuildRestock(productId, 'Test CPU');
  expect(db.notifications.createMany).toHaveBeenCalledWith({
    data: [userId, otherId].map(userId => expect.objectContaining({
      userId,
      type: 'System',
      title: 'Saved PC component back in stock',
      message: 'Test CPU is back in stock for a saved PC build.',
      redirectUrl: '/pc-builder',
    })),
  });
});

test.each([-1, 1.5, '0', null, 2147483647])('invalid revisions cannot write the saved build: %s', async revision => {
  expect((await request(appFor('put', '/', saveBuild)).put('/').send({ ownerId: userId, revision, parts: [selection] })).status).toBe(400);
  expect(db.savedPcBuild.updateMany).not.toHaveBeenCalled();
});

test('an empty build cannot silently erase saved selections', async () => {
  expect((await request(appFor('put', '/', saveBuild)).put('/').send({ ownerId: userId, revision: 0, parts: [] })).status).toBe(400);
  expect(db.savedPcBuild.updateMany).not.toHaveBeenCalled();
});

test('PC catalog and quote filter suspended sellers at the database boundary', async () => {
  db.products.findMany.mockResolvedValue([]);
  expect((await request(appFor('get', '/', buildCatalog)).get('/?slot=cpu')).status).toBe(200);
  expect((await request(appFor('post', '/', quoteBuild)).post('/').send({ parts: [selection] })).status).toBe(400);
  for (const [args] of db.products.findMany.mock.calls) expect(args.where).toMatchObject({
    isDeleted: false, status: 'Active', shop: { sellers: { OR: [
      { suspendedAt: null }, { suspendedAt: { isSet: false } }, { suspendedUntil: { not: null, isSet: true, lte: expect.any(Date) } },
    ] } },
  });
});

test.each([
  ['', 'b'], ['&sort=priceAsc', 'c'], ['&sort=priceDesc', 'b'],
])('PC catalog ranks before pagination with stable product IDs (%s)', async (query, secondId) => {
  db.products.findMany.mockResolvedValue([
    { id: 'c', sale_price: 50, stock: 1 },
    { id: 'b', sale_price: 50, stock: 10 },
    { id: 'a', sale_price: 100, stock: 20 },
  ]);
  const response = await request(appFor('get', '/', buildCatalog)).get('/?slot=cpu&page=2&limit=1' + query);
  expect(response.status).toBe(200);
  expect(response.body.products.map((p: any) => p.id)).toEqual([secondId]);
  expect(response.body.pagination).toEqual({ page: 2, total: 3, totalPages: 3 });
});

test.each(['unknown', '', 'priceAsc&sort=priceDesc', '%5Bnested%5D=priceAsc'])('PC catalog rejects invalid or repeated sort values: %s', async sort => {
  const query = sort.startsWith('%5B') ? '&sort' + sort : '&sort=' + sort;
  expect((await request(appFor('get', '/', buildCatalog)).get('/?slot=cpu' + query)).status).toBe(400);
  expect(db.products.findMany).not.toHaveBeenCalled();
  expect(db.products.count).not.toHaveBeenCalled();
});

test('PC catalog counts the same availability, slot and search filters and bounds pagination', async () => {
  db.products.findMany.mockResolvedValue([]);
  db.products.count.mockResolvedValue(0);
  const response = await request(appFor('get', '/', buildCatalog)).get('/?slot=cpu&q=%20Ryzen%20&page=10000001&limit=1001');
  expect(response.status).toBe(200);
  expect(response.body.pagination).toEqual({ page: 1000000, total: 0, totalPages: 1 });
  const args = db.products.findMany.mock.calls[0][0];
  expect(args).toMatchObject({ where: { stock: { gt: 0 }, AND: [expect.objectContaining({ OR: expect.any(Array) }), { title: { contains: 'Ryzen', mode: 'insensitive' } }] } });
  expect(db.products.count).not.toHaveBeenCalled();
});

test.each([
  { category: 'Cooling', subCategory: 'Accessories', tags: [], field: 'category' },
  { category: 'PC', subCategory: 'COOLING', tags: [], field: 'subCategory' },
  { category: 'PC', subCategory: 'Accessories', tags: ['cooling'], field: 'tags' },
])('Cooling metadata in $field is discoverable and accepted as a cooler when quoting a build', async ({ field, ...metadata }) => {
  const product = { id: productId, title: 'Air tower', ...metadata, sale_price: 42, stock: 3, colors: [], sizes: [], variants: [], custom_specification: {} };
  db.products.findMany.mockResolvedValue([product]);
  db.products.count.mockResolvedValue(1);
  const catalog = await request(appFor('get', '/', buildCatalog)).get('/?slot=cooler');
  expect(catalog.status).toBe(200);
  expect(catalog.body.products).toEqual([{ ...product, recommendation: { status: 'unchecked', stock: 3, checks: [], compatibility: { issues: [] } } }]);
  const filter = db.products.findMany.mock.calls[0][0].where.AND[0].OR;
  expect(filter).toContainEqual(field === 'tags'
    ? { tags: { has: 'cooling' } }
    : { [field]: { contains: 'cooling', mode: 'insensitive' } });
  expect(componentMatches(product, 'cooler')).toBe(true);

  const quote = await request(appFor('post', '/', quoteBuild)).post('/').send({ parts: [{ slot: 'cooler', id: productId }] });
  expect(quote.status).toBe(200);
  expect(quote.body).toMatchObject({ total: 42, canAddToCart: true, parts: [{ id: productId, slot: 'cooler', sale_price: 42, stock: 3 }] });
});

test('opening saved references quotes current price and stock, including stock exhaustion', async () => {
  const product = { id: productId, title: 'CPU', category: 'CPU', subCategory: 'Processor', tags: [], sale_price: 99, stock: 0, colors: ['Black'], sizes: [], variants: [], custom_specification: {} };
  db.products.findMany.mockResolvedValue([product]);
  const response = await request(appFor('post', '/', quoteBuild)).post('/').send({ parts: [{ ...selection, price: 1, stock: 99 }] });
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ total: 99, canAddToCart: false, parts: [{ sale_price: 99, stock: 0 }] });
  expect(response.body.issues).toContainEqual({ level: 'error', message: 'CPU is out of stock.' });
});
