import React, { useId, useState, type DragEvent } from 'react';

interface FileDropProps {
  accept: string;
  actionLabel: string;
  description: string;
  fileName?: string | null;
  disabled?: boolean;
  onSelect(file: File): void;
}

export function FileDrop({
  accept,
  actionLabel,
  description,
  fileName,
  disabled = false,
  onSelect,
}: FileDropProps) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);

  const receiveDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (!disabled && file) onSelect(file);
  };

  return (
    <div
      className="file-drop"
      data-dragging={dragging || undefined}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragging(false)}
      onDrop={receiveDrop}
    >
      <div className="file-drop-mark" aria-hidden="true">⇧</div>
      <div>
        <strong>{fileName ?? 'Arraste o arquivo aqui'}</strong>
        <p>{description}</p>
      </div>
      <label htmlFor={inputId} className="secondary-button">{actionLabel}</label>
      <input
        id={inputId}
        className="visually-hidden"
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) onSelect(file);
          event.currentTarget.value = '';
        }}
      />
    </div>
  );
}
