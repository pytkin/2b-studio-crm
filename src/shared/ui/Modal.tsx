import * as Dialog from '@radix-ui/react-dialog';
import {
  createContext,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
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
  const notice = useRef<HTMLDivElement>(null);
  const lastField = useRef<HTMLElement | null>(null);
  const blocked = !!accessNotice;
  useLayoutEffect(() => {
    if (blocked) notice.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    else if (lastField.current?.isConnected) lastField.current.focus();
  }, [blocked]);
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
          <div ref={notice}>{accessNotice}</div>
          <div
            hidden={blocked}
            inert={blocked}
            onFocusCapture={(event) => {
              if (event.target instanceof HTMLElement) {
                lastField.current = event.target;
                (event.target.closest('.field') ?? event.target).scrollIntoView?.({
                  block: 'nearest',
                });
              }
            }}
          >
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
