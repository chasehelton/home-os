export function App() {
  return (
    <main className="flex min-h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-4xl font-semibold">home-os</h1>
      <p className="max-w-md text-slate-300">
        Phase 0 scaffold. Todos, meal planning, recipes, calendar, and the AI assistant arrive
        in their respective phases.
      </p>
      <a
        className="rounded bg-slate-700 px-4 py-2 text-sm hover:bg-slate-600"
        href="/health/live"
      >
        API health
      </a>
    </main>
  );
}
