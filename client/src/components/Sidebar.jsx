import logo from "../assets/images/logo.png";
import { useEffect, useRef } from "react";

export default function Sidebar({
  currentView,
  items = [],
  activeItemId = null,
  onSelectItem,
  emptyMessage = ""
}) {
  const listRef = useRef(null);

  useEffect(() => {
    if (currentView !== "photos" || !activeItemId || !listRef.current) {
      return;
    }

    const activeButton = listRef.current.querySelector(`[data-trip-id="${activeItemId}"]`);

    activeButton?.scrollIntoView({
      block: "nearest",
      behavior: "smooth"
    });
  }, [activeItemId, currentView]);

  return (
    <aside className="fixed left-0 top-0 hidden h-screen w-[240px] flex-col border-r border-cyan-900/10 bg-white/90 px-5 py-6 backdrop-blur lg:flex">
      <div className="border-b border-stone-300/80 pb-6">
        <img src={logo} alt="AL Vault" className="h-10 w-auto" />
      </div>

      {currentView === "photos" ? (
        <div className="mt-6 flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="rounded-[1.5rem] border border-stone-300 bg-stone-50/80 px-4 py-4">
            <p className="text-xs uppercase tracking-[0.24em] text-stone-500">Trips</p>
            <p className="mt-2 text-sm text-stone-600">
              Scroll the timeline or jump straight to a destination.
            </p>
          </div>

          <div ref={listRef} className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
            {items.length > 0 ? (
              <div className="space-y-2 pb-4">
                {items.map((item) => {
                  const isActive = item.id === activeItemId;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-trip-id={item.id}
                      onClick={() => onSelectItem?.(item.id)}
                      className={`w-full rounded-[1.35rem] border px-4 py-3 text-left transition ${
                        isActive
                          ? "border-stone-900 bg-stone-900 text-stone-50 shadow-sm"
                          : "border-stone-200 bg-white/80 text-stone-700 hover:border-stone-300 hover:bg-white"
                      }`}
                    >
                      <span className="block text-sm font-semibold">
                        {item.label}
                      </span>
                      <span className={`mt-1 block text-xs ${isActive ? "text-stone-300" : "text-stone-500"}`}>
                        {item.meta}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-[1.5rem] border border-dashed border-stone-300 bg-stone-50 px-4 py-5 text-sm text-stone-500">
                {emptyMessage}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-6 rounded-[1.5rem] border border-stone-300 bg-stone-50/80 px-4 py-4 text-sm text-stone-600">
          Navigate between sections using the tabs above.
        </div>
      )}
    </aside>
  );
}
