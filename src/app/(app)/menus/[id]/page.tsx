import { MenuEditor } from '@/components/menus/MenuEditor';

export const metadata = { title: 'Review menu · QuotePlate' };

export default async function MenuPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MenuEditor menuId={id} />;
}
