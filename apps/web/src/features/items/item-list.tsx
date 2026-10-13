import type { ItemListRow } from "./item-columns";
import { ItemRow } from "./item-row";

export interface ItemListProps {
  items: ItemListRow[];
  getSubTitle?: (item: ItemListRow) => string | undefined;
}

export function ItemList({ items, getSubTitle }: ItemListProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <ul role="list" className="divide-y divide-border">
      {items.map((item) => (
        <ItemRow key={item.id} item={item} subtitle={getSubTitle ? getSubTitle(item) : undefined} />
      ))}
    </ul>
  );
}
