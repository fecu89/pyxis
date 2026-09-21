"use client";

import type { CSSProperties } from "react";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { AttachmentViewer } from "@/components/pad/attachments/attachment-viewer";
import type { AttachmentMetadataInput, AttachmentViewData } from "@/components/pad/attachments/types";
import styles from "@/components/pad/attachments/sortable-attachment-list.module.css";

type SortableAttachmentListProps = {
  attachments: AttachmentViewData[];
  canDownload: boolean;
  canEdit: boolean;
  movePending: boolean;
  onDelete: (attachment: AttachmentViewData) => void;
  onUpdateMetadata: (attachmentId: string, value: AttachmentMetadataInput) => Promise<void>;
  onReorder: (attachmentIds: string[]) => void | Promise<void>;
};

function SortableAttachment({ attachment, disabled, props }: {
  attachment: AttachmentViewData;
  disabled: boolean;
  props: Omit<SortableAttachmentListProps, "attachments" | "onReorder">;
}) {
  const { setNodeRef, isDragging, attributes, listeners, transform, transition } = useSortable({ id: attachment.id, disabled });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  } as CSSProperties;
  return (
    <div ref={setNodeRef} className={styles.item} data-dragging={isDragging || undefined} style={style}>
      <button
        type="button"
        className={styles.handle}
        disabled={disabled}
        {...attributes}
        {...listeners}
        aria-label={`${attachment.originalName} 순서 이동`}
        title="드래그해서 순서 변경"
      >
        <GripVertical size={17} />
      </button>
      <AttachmentViewer attachments={[attachment]} canDownload={props.canDownload} canEdit={props.canEdit} onDelete={props.onDelete} onUpdateMetadata={props.onUpdateMetadata} />
    </div>
  );
}

export function SortableAttachmentList(props: SortableAttachmentListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const sortable = props.canEdit && props.attachments.length > 1;

  function dragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id || props.movePending) return;
    const from = props.attachments.findIndex((attachment) => attachment.id === event.active.id);
    const to = props.attachments.findIndex((attachment) => attachment.id === event.over?.id);
    if (from < 0 || to < 0) return;
    void props.onReorder(arrayMove(props.attachments, from, to).map((attachment) => attachment.id));
  }

  if (!sortable) {
    return <AttachmentViewer attachments={props.attachments} canDownload={props.canDownload} canEdit={props.canEdit} onDelete={props.onDelete} onUpdateMetadata={props.onUpdateMetadata} />;
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}>
      <SortableContext items={props.attachments.map((attachment) => attachment.id)} strategy={verticalListSortingStrategy}>
        <div className={styles.list} aria-label="본문 미배치 첨부 순서">
          {props.attachments.map((attachment) => <SortableAttachment key={attachment.id} attachment={attachment} disabled={props.movePending} props={props} />)}
        </div>
      </SortableContext>
    </DndContext>
  );
}
