const NAV_ITEMS = [
  { id: "photos", label: "Timeline" },
  { id: "people", label: "People" },
  { id: "tags", label: "Tags" },
  { id: "upload", label: "Upload" },
  { id: "export", label: "Import / Export" },
  { id: "settings", label: "Settings" }
];

export default function Sidebar({ currentView, onNavigate }) {
  return (
    <aside className="fixed left-0 top-0 flex h-screen w-[240px] flex-col border-r border-stone-300/80 bg-stone-50/95 px-5 py-6 backdrop-blur">
      <div className="border-b border-stone-300/80 pb-6">
        <p className="text-xs uppercase tracking-[0.35em] text-stone-500">content-vault</p>
      </div>

      <nav className="mt-6 flex flex-col gap-2">
        {NAV_ITEMS.map((item) => {
          const isActive = item.id === currentView;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={`w-full rounded-2xl px-4 py-3 text-left text-sm font-medium transition ${
                isActive
                  ? "bg-stone-900 text-stone-50"
                  : "text-stone-700 hover:bg-white hover:text-stone-900"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-stone-300/80 pt-4">
        <p className="text-xs uppercase tracking-[0.28em] text-stone-500">Local Only</p>
        <p className="mt-3 text-sm leading-6 text-stone-600">
          Family travel media catalog for personal workflows, running on this machine only.
        </p>
      </div>
    </aside>
  );
}
