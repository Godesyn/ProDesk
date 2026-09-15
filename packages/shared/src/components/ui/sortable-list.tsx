import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
  horizontalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';

/** Props to spread onto whichever element should act as the drag handle. */
export type DragHandleProps = Record<string, unknown>;

type RenderArgs<T> = { item: T; index: number; handleProps: DragHandleProps; isDragging: boolean };

/**
 * Generic drag-to-reorder list (dnd-kit). The render prop receives `handleProps`
 * to spread onto the element that should initiate the drag (a grip button for
 * list rows, or the tile itself for media). `onReorder` is called with the full
 * id list in its new order. Replaces the old up/down arrow reorder controls so
 * every reorderable surface uses the same drag interaction.
 */
export function SortableList<T>({
  items, getId, onReorder, orientation = 'vertical', className, itemClassName, children,
}: {
  items: T[];
  getId: (item: T) => string;
  onReorder: (orderedIds: string[]) => void;
  orientation?: 'vertical' | 'horizontal';
  className?: string;
  itemClassName?: string;
  children: (args: RenderArgs<T>) => React.ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = items.map(getId);

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={orientation === 'horizontal' ? horizontalListSortingStrategy : verticalListSortingStrategy}>
        <div className={className}>
          {items.map((item, index) => (
            <SortableRow key={getId(item)} id={getId(item)} className={itemClassName}>
              {(handleProps, isDragging) => children({ item, index, handleProps, isDragging })}
            </SortableRow>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({ id, className, children }: {
  id: string;
  className?: string;
  children: (handleProps: DragHandleProps, isDragging: boolean) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  // Inline the CSS transform (avoids a dependency on @dnd-kit/utilities).
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 1 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} className={className}>
      {children({ ...attributes, ...listeners }, isDragging)}
    </div>
  );
}
