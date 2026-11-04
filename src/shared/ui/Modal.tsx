import * as Dialog from '@radix-ui/react-dialog';
import { createContext, type ReactNode, useContext, useState } from 'react';
export const ModalAccessNotice = createContext<ReactNode>(null);

export function Modal({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const accessNotice = useContext(ModalAccessNotice);
  const [trigger] = useState(() => document.activeElement);
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !accessNotice) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="dialog-content"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
            else document.querySelector<HTMLElement>('main h1')?.focus();
          }}
        >
          <Dialog.Title>{accessNotice ? 'Проверка доступа' : title}</Dialog.Title>
          <Dialog.Description className={description && !accessNotice ? '' : 'sr-only'}>
            {accessNotice ? 'Проверьте подключение к базе.' : (description ?? title)}
          </Dialog.Description>
          {accessNotice}
          <div hidden={!!accessNotice} inert={!!accessNotice}>
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
