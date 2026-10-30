'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface SettingsDirtyContextValue {
  isDirty: boolean;
  changedSummary: string;
  setSectionDirty: (dirty: boolean, summary?: string) => void;
}

const SettingsDirtyContext = createContext<SettingsDirtyContextValue | null>(null);

export function useSettingsDirty(): SettingsDirtyContextValue {
  const value = useContext(SettingsDirtyContext);
  if (!value) {
    throw new Error('useSettingsDirty must be used inside SettingsDirtyProvider');
  }
  return value;
}

function sameDocumentPath(href: string, pathname: string): boolean {
  try {
    const url = new URL(href, window.location.origin);
    return url.origin === window.location.origin
      && url.pathname === pathname
      && url.search === window.location.search;
  } catch {
    return href === pathname;
  }
}

export function SettingsDirtyProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [dirtyPath, setDirtyPath] = useState(pathname);
  const [isDirty, setIsDirty] = useState(false);
  const [changedSummary, setChangedSummary] = useState('');
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const sectionIsDirty = isDirty && dirtyPath === pathname;
  const sectionSummary = sectionIsDirty ? changedSummary : '';

  const setSectionDirty = useCallback((dirty: boolean, summary = '') => {
    setDirtyPath(pathname);
    setIsDirty(dirty);
    setChangedSummary(dirty ? summary : '');
  }, [pathname]);

  useEffect(() => {
    if (!sectionIsDirty) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const anchor = (event.target as HTMLElement | null)?.closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
      if (sameDocumentPath(href, pathname)) return;
      event.preventDefault();
      event.stopPropagation();
      const url = new URL(href, window.location.origin);
      setPendingHref(url.pathname + url.search + url.hash);
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [pathname, sectionIsDirty]);

  const value = useMemo(
    () => ({ isDirty: sectionIsDirty, changedSummary: sectionSummary, setSectionDirty }),
    [sectionIsDirty, sectionSummary, setSectionDirty],
  );

  return (
    <SettingsDirtyContext.Provider value={value}>
      {children}
      <Dialog open={pendingHref !== null} onOpenChange={(open) => { if (!open) setPendingHref(null); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Leave without saving?</DialogTitle>
            <DialogDescription>
              This section has changes that are not saved. If you leave now, those changes are lost.
              {sectionSummary ? ` Changed: ${sectionSummary}.` : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="min-h-11" onClick={() => setPendingHref(null)}>
              Stay
            </Button>
            <Button
              variant="destructive"
              className="min-h-11"
              onClick={() => {
                if (!pendingHref) return;
                const href = pendingHref;
                setIsDirty(false);
                setChangedSummary('');
                setPendingHref(null);
                router.push(href);
              }}
            >
              Leave without saving
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsDirtyContext.Provider>
  );
}
