import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, ChevronDown, Info, Loader2, X, XCircle } from 'lucide-react';

export const cn = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');

/* ================================ BOUTONS ================================ */

type Variant = 'primary' | 'secondary' | 'soft' | 'ghost' | 'danger' | 'dangerSoft';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary:
    'sheen bg-gradient-to-b from-[#ff8a3d] to-brand-600 text-white shadow-brand hover:brightness-105 active:brightness-95',
  secondary: 'bg-white text-ink border border-line shadow-sm hover:border-brand/50 hover:text-brand-800',
  soft: 'bg-brand-50 text-brand-800 border border-brand/20 hover:bg-brand-100',
  ghost: 'text-muted hover:bg-sand hover:text-ink',
  danger: 'bg-red-600 text-white shadow-sm hover:bg-red-700',
  dangerSoft: 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-600 hover:text-white hover:border-red-600',
};

const sizes: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-[13px] rounded-xl gap-1.5',
  md: 'h-11 px-5 text-sm rounded-2xl gap-2',
  lg: 'h-14 px-6 text-base rounded-2xl gap-2.5',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, block, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap font-bold transition-all duration-150',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/25 active:scale-[0.97]',
        'disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: 'ghost' | 'secondary' | 'danger' | 'onDark';
  size?: 'sm' | 'md';
}

export function IconButton({ label, variant = 'ghost', size = 'md', className, children, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex flex-shrink-0 items-center justify-center rounded-xl transition-all active:scale-95',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/25 disabled:opacity-40',
        size === 'md' ? 'h-10 w-10' : 'h-8 w-8',
        variant === 'ghost' && 'text-muted hover:bg-sand hover:text-ink',
        variant === 'secondary' && 'border border-line bg-white text-ink shadow-sm hover:border-brand/50',
        variant === 'danger' && 'text-muted hover:bg-red-50 hover:text-red-600',
        variant === 'onDark' && 'bg-black/40 text-white backdrop-blur hover:bg-black/60',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ============================ CHAMPS DE SAISIE ============================ */

const fieldBase =
  'w-full rounded-2xl border border-line bg-white px-4 text-base font-semibold text-ink shadow-[inset_0_1px_2px_rgba(74,37,22,0.04)] outline-none transition placeholder:font-medium placeholder:text-muted/55 focus:border-brand focus:ring-4 focus:ring-brand/15 disabled:opacity-60 sm:text-sm';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { leading?: ReactNode }>(
  function Input({ className, leading, ...rest }, ref) {
    if (!leading) return <input ref={ref} className={cn(fieldBase, 'h-12', className)} {...rest} />;
    return (
      <div className="relative">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted/70">{leading}</span>
        <input ref={ref} className={cn(fieldBase, 'h-12 pl-11', className)} {...rest} />
      </div>
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <div className={cn('relative', className)}>
      <select ref={ref} className={cn(fieldBase, 'h-12 cursor-pointer appearance-none pr-10')} {...rest}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
    </div>
  );
});

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="eyebrow block px-1">
        {label}
      </label>
      {children}
      {hint && <p className="px-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/* ============================ PETITS ÉLÉMENTS ============================ */

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors duration-200',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/25 disabled:opacity-50',
        checked ? 'bg-brand' : 'bg-line',
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  disabled,
  size = 'md',
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: ReactNode; title?: string }[];
  disabled?: boolean;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="inline-flex rounded-2xl border border-line bg-cream p-1" role="radiogroup">
      {options.map(opt => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={opt.title}
            title={opt.title}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              'inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl font-bold transition-all disabled:opacity-50',
              size === 'md' ? 'h-9 px-2.5 text-[13px] sm:px-3.5' : 'h-8 px-3 text-xs',
              active ? 'bg-white text-brand-800 shadow-sm' : 'text-muted hover:text-ink',
            )}
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function StatusDot({ online, className }: { online: boolean; className?: string }) {
  return (
    <span
      className={cn('inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full', online ? 'bg-online pulse-online' : 'bg-muted/35', className)}
      aria-label={online ? 'En ligne' : 'Hors ligne'}
      role="img"
    />
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-6 w-6 animate-spin text-brand', className)} aria-label="Chargement" />;
}

export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center border-dashed px-6 py-10 text-center">
      {icon && <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand">{icon}</div>}
      <p className="text-[15px] font-bold text-ink">{title}</p>
      {text && <p className="mt-1 max-w-xs text-sm text-muted">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3 px-1">
      <div className="min-w-0">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Badge({ children, tone = 'brand', className }: { children: ReactNode; tone?: 'brand' | 'neutral' | 'online'; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold',
        tone === 'brand' && 'bg-brand-50 text-brand-800',
        tone === 'neutral' && 'bg-sand text-muted',
        tone === 'online' && 'bg-emerald-50 text-emerald-700',
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ================================= MODALE ================================= */

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  headerActions?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  children?: ReactNode;
  z?: 'z-50' | 'z-[60]' | 'z-[70]';
}

export function Modal({ open, onClose, title, subtitle, leading, headerActions, footer, size = 'md', children, z = 'z-50' }: ModalProps) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className={cn('fixed inset-0 flex items-end justify-center sm:items-center sm:p-4', z)} role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/50 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose} />
      <div
        className={cn(
          'relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:rounded-[28px]',
          'animate-in fade-in slide-in-from-bottom-6 duration-300 sm:zoom-in-95 sm:slide-in-from-bottom-2',
          size === 'sm' && 'sm:max-w-sm',
          size === 'md' && 'sm:max-w-lg',
          size === 'lg' && 'sm:max-w-2xl',
        )}
      >
        <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-line sm:hidden" aria-hidden />
        {(title || leading || headerActions) && (
          <div className="flex items-center gap-3 border-b border-sand px-5 pb-4 pt-3 sm:pt-5">
            {leading}
            <div className="min-w-0 flex-1">
              {title && <h2 className="truncate text-lg font-extrabold text-ink">{title}</h2>}
              {subtitle && <p className="truncate text-sm text-muted">{subtitle}</p>}
            </div>
            {headerActions}
            <IconButton label="Fermer" onClick={onClose}>
              <X className="h-5 w-5" />
            </IconButton>
          </div>
        )}
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
        {footer && <div className="border-t border-sand bg-cream/60 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ====================== TOASTS & CONFIRMATIONS (contexte) ====================== */

type ToastTone = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}
interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
}
interface FeedbackApi {
  toast: (message: string, tone?: ToastTone) => void;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);

export function useFeedback() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('useFeedback doit être utilisé dans <FeedbackProvider>');
  return ctx;
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const idRef = useRef(0);

  const toast = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = ++idRef.current;
    setToasts(prev => [...prev.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), tone === 'error' ? 4500 : 2600);
  }, []);

  const confirm = useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>(resolve => setPending({ ...opts, resolve })),
    [],
  );

  const close = (value: boolean) => {
    pending?.resolve(value);
    setPending(null);
  };

  return (
    <FeedbackContext.Provider value={{ toast, confirm }}>
      {children}

      <div className="pointer-events-none fixed inset-x-0 top-[max(1rem,env(safe-area-inset-top))] z-[80] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map(t => (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto flex max-w-md items-center gap-2.5 rounded-2xl px-4 py-3 text-sm font-bold shadow-lift animate-in fade-in slide-in-from-top-3 duration-300',
              t.tone === 'success' && 'bg-ink text-white',
              t.tone === 'error' && 'bg-red-600 text-white',
              t.tone === 'info' && 'bg-white text-ink border border-line',
            )}
          >
            {t.tone === 'success' && <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-emerald-300" />}
            {t.tone === 'error' && <XCircle className="h-5 w-5 flex-shrink-0" />}
            {t.tone === 'info' && <Info className="h-5 w-5 flex-shrink-0 text-brand" />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>

      <Modal
        open={!!pending}
        onClose={() => close(false)}
        size="sm"
        z="z-[70]"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" block onClick={() => close(false)}>
              Annuler
            </Button>
            <Button variant={pending?.danger ? 'danger' : 'primary'} block onClick={() => close(true)}>
              {pending?.confirmLabel || 'Confirmer'}
            </Button>
          </div>
        }
      >
        {pending && (
          <div className="flex flex-col items-center py-2 text-center">
            <div
              className={cn(
                'mb-3 flex h-12 w-12 items-center justify-center rounded-2xl',
                pending.danger ? 'bg-red-50 text-red-600' : 'bg-brand-50 text-brand',
              )}
            >
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h3 className="text-lg font-extrabold text-ink">{pending.title}</h3>
            {pending.message && <p className="mt-1.5 text-sm text-muted">{pending.message}</p>}
          </div>
        )}
      </Modal>
    </FeedbackContext.Provider>
  );
}
