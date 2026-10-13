import type { Tables } from "@/lib/database.types";
import { ItemRow } from "./item-row";

export interface ItemListProps {
  items: Tables<"items">[];
  getSubTitle?: (item: Tables<"items">) => string | undefined;
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
