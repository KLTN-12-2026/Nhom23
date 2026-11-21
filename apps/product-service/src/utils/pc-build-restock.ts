import prisma from '@packages/libs/prisma';

export async function notifyPcBuildRestock(productId: string, title: string) {
  const watches = await prisma.pcBuildAvailabilityWatch.findMany({
    where: { productId },
    select: { ownerId: true },
  });
  const ownerIds = [...new Set(watches.map(watch => watch.ownerId))];
  if (!ownerIds.length) return;
  await prisma.notifications.createMany({
    data: ownerIds.map(userId => ({
      userId,
      type: 'System',
      title: 'Saved PC component back in stock',
      message: `${title} is back in stock for a saved PC build.`,
      redirectUrl: '/pc-builder',
    })),
  });
}
