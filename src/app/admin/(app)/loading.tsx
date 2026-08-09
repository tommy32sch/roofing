import { Skeleton } from '@/components/ui/skeleton';

export default function ProtectedAdminLoading() {
  return (
    <div className="flex min-h-screen" aria-label="Loading workspace">
      <aside className="hidden w-60 shrink-0 border-r p-4 md:block">
        <Skeleton className="h-7 w-36" />
        <div className="mt-8 space-y-3">
          {[...Array(7)].map((_, index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <div className="h-14 border-b" />
        <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 md:px-6 md:py-8">
          <Skeleton className="h-8 w-44" />
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {[...Array(4)].map((_, index) => (
              <Skeleton key={index} className="h-28 w-full" />
            ))}
          </div>
          <Skeleton className="h-72 w-full" />
        </main>
      </div>
    </div>
  );
}
