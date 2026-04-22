import { useState, type ReactNode } from 'react';
import { IconButton } from './ui/Button';
import { Sheet } from './ui/Sheet';
import { cn } from './ui/cn';

export interface NavItem<T extends string = string> {
  id: T;
  label: string;
  icon: ReactNode;
}

interface AppShellProps<T extends string> {
  items: NavItem<T>[];
  current: T;
  onSelect: (id: T) => void;
  user: { displayName: string; pictureUrl: string | null };
  onSignOut: () => void;
  children: ReactNode;
  banner?: ReactNode;
}

// Which nav items appear in the primary mobile bottom bar. The rest collapse
// into a "More" sheet so the bar stays legible on small screens.
const PRIMARY_MOBILE_IDS = new Set(['todos', 'recipes', 'meals', 'calendar']);

export function AppShell<T extends string>({
  items,
  current,
  onSelect,
  user,
  onSignOut,
  children,
  banner,
}: AppShellProps<T>) {
  const [moreOpen, setMoreOpen] = useState(false);
  const primary = items.filter((i) => PRIMARY_MOBILE_IDS.has(i.id));
  const overflow = items.filter((i) => !PRIMARY_MOBILE_IDS.has(i.id));
  const overflowActive = overflow.some((i) => i.id === current);

  return (
    <div className="flex min-h-full w-full bg-surface text-on-surface">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-outline-variant/60 bg-surface-container-low px-4 py-6 md:flex">
        <div className="px-3 pb-8">
          <div className="font-display text-headline-lg leading-none text-on-surface">home-os</div>
          <div className="mt-1 text-label-sm text-on-surface-variant">
            A quiet house, well kept.
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {items.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              active={item.id === current}
              onClick={() => onSelect(item.id)}
            />
          ))}
        </nav>
        <UserBlock user={user} onSignOut={onSignOut} />
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-outline-variant/60 bg-surface/90 px-4 py-3 backdrop-blur md:hidden">
          <div className="font-display text-headline-md text-on-surface">home-os</div>
          <button
            onClick={() => setMoreOpen(true)}
            className="flex items-center gap-2 rounded-full px-2 py-1 text-label-md text-on-surface-variant hover:bg-surface-container"
            aria-label="Account"
          >
            {user.pictureUrl ? (
              <img
                src={user.pictureUrl}
                alt=""
                referrerPolicy="no-referrer"
                className="h-8 w-8 rounded-full"
              />
            ) : (
              <span className="grid h-8 w-8 place-items-center rounded-full bg-primary-container text-primary-on-container">
                {user.displayName.slice(0, 1).toUpperCase()}
              </span>
            )}
          </button>
        </header>

        {banner}

        <main className="flex-1 pb-24 md:pb-0">{children}</main>

        {/* Mobile bottom tab bar */}
        <nav className="fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around border-t border-outline-variant/60 bg-surface-container-low/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
          {primary.map((item) => (
            <TabBarButton
              key={item.id}
              item={item}
              active={item.id === current}
              onClick={() => onSelect(item.id)}
            />
          ))}
          <TabBarButton
            item={{ id: 'more' as string, label: 'More', icon: <span aria-hidden>⋯</span> }}
            active={overflowActive}
            onClick={() => setMoreOpen(true)}
          />
        </nav>

        <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
          <div className="flex items-center gap-3 pb-4">
            {user.pictureUrl ? (
              <img
                src={user.pictureUrl}
                alt=""
                referrerPolicy="no-referrer"
                className="h-10 w-10 rounded-full"
              />
            ) : (
              <span className="grid h-10 w-10 place-items-center rounded-full bg-primary-container text-primary-on-container">
                {user.displayName.slice(0, 1).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <div className="truncate text-body-md text-on-surface">{user.displayName}</div>
              <button
                onClick={() => {
                  setMoreOpen(false);
                  onSignOut();
                }}
                className="text-label-md text-on-surface-variant underline-offset-2 hover:underline"
              >
                Sign out
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            {overflow.map((item) => (
              <NavButton
                key={item.id}
                item={item}
                active={item.id === current}
                onClick={() => {
                  onSelect(item.id);
                  setMoreOpen(false);
                }}
              />
            ))}
          </div>
        </Sheet>
      </div>
    </div>
  );
}

function NavButton({
  item,
  active,
  onClick,
}: {
  item: NavItem<string>;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex items-center gap-3 rounded-md px-3 py-2.5 text-left text-body-md font-medium transition-colors duration-200 ease-soft',
        active
          ? 'bg-primary-container text-primary-on-container'
          : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
      )}
    >
      <span className="grid h-5 w-5 shrink-0 place-items-center text-[1.05rem]">{item.icon}</span>
      <span className="truncate">{item.label}</span>
    </button>
  );
}

function TabBarButton({
  item,
  active,
  onClick,
}: {
  item: { id: string; label: string; icon: ReactNode };
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-label-sm',
        active ? 'text-primary' : 'text-on-surface-variant',
      )}
    >
      <span className="text-lg leading-none">{item.icon}</span>
      <span>{item.label}</span>
    </button>
  );
}

function UserBlock({
  user,
  onSignOut,
}: {
  user: { displayName: string; pictureUrl: string | null };
  onSignOut: () => void;
}) {
  return (
    <div className="mt-4 flex items-center gap-3 rounded-lg bg-surface-container p-3">
      {user.pictureUrl ? (
        <img
          src={user.pictureUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="h-10 w-10 rounded-full"
        />
      ) : (
        <span className="grid h-10 w-10 place-items-center rounded-full bg-primary-container text-primary-on-container">
          {user.displayName.slice(0, 1).toUpperCase()}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-body-md text-on-surface">{user.displayName}</div>
      </div>
      <IconButton
        size="sm"
        variant="ghost"
        onClick={onSignOut}
        aria-label="Sign out"
        title="Sign out"
      >
        <span aria-hidden>↪</span>
      </IconButton>
    </div>
  );
}
